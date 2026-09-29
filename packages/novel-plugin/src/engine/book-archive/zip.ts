/**
 * 项目档案用的最小 zip 读写。
 *
 * 为什么不引入依赖：仓库没有现成的 zip 库；fflate 等库的解压接口不暴露条目的外部属性，
 * 做不到「拒绝符号链接」，还得再自己解析一遍中央目录。node:zlib 在 Bun、Node 与编译产物里都可用，
 * 档案只需要 stored / deflate 两种方法，自己写读写两端（约两百行）比引依赖再补解析更短、更好审。
 *
 * 读取端是安全边界：档案来自用户上传，任何不认识或可疑的结构一律拒绝，而不是尽量解出来。
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

import { asBytes, bytesEqual, concatBytes, utf8Bytes } from "./bytes.js";

export interface ZipEntryInput {
  readonly path: string;
  readonly data: Uint8Array;
}

export interface ZipReadLimits {
  /** 条目数上限。 */
  readonly maxEntries: number;
  /** 单个条目解压后的字节上限。 */
  readonly maxEntryBytes: number;
  /** 全部条目解压后的字节总上限。 */
  readonly maxTotalBytes: number;
}

export const DEFAULT_ZIP_READ_LIMITS: ZipReadLimits = {
  maxEntries: 50_000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
};

/** 档案结构错误：带给作者看的说明，路由层原样返回。 */
export class ZipFormatError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ZipFormatError";
    this.code = code;
  }
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const UNIX_HOST = 3;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 校验档案内的相对路径。拒绝绝对路径、盘符、反斜杠、`..`、空段与控制字符——
 * 这些在解压到磁盘时都可能越出目标目录，或在不同系统上指向不同位置。
 */
export function assertSafeArchivePath(path: string): void {
  const reject = (why: string): never => {
    throw new ZipFormatError("unsafe-path", `档案里的路径「${path}」不安全（${why}），已拒绝整份档案。`);
  };
  if (path.length === 0 || path.length > 1024) reject("长度无效");
  if (/[\u0000-\u001f\u007f]/u.test(path)) reject("含控制字符");
  if (path.includes("\\")) reject("含反斜杠");
  if (path.startsWith("/")) reject("是绝对路径");
  if (/^[A-Za-z]:/u.test(path)) reject("带盘符");
  for (const segment of path.split("/")) {
    if (segment === "") reject("含空路径段");
    if (segment === "." || segment === "..") reject("含 . 或 .. 路径段");
  }
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f),
  };
}

/** 写 zip：条目按传入顺序写出；可压缩的用 deflate，压不小的原样存。 */
export function writeZip(entries: readonly ZipEntryInput[], modifiedAt: Date = new Date()): Uint8Array {
  const seen = new Set<string>();
  const stamp = dosDateTime(modifiedAt);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeArchivePath(entry.path);
    if (seen.has(entry.path)) throw new ZipFormatError("duplicate-entry", `档案条目重复：${entry.path}`);
    seen.add(entry.path);
    const name = utf8Bytes(entry.path);
    const crc = crc32(entry.data);
    const deflated = entry.data.length > 0 ? asBytes(deflateRawSync(entry.data)) : new Uint8Array();
    const useDeflate = deflated.length < entry.data.length;
    const payload = useDeflate ? deflated : entry.data;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORED;
    if (payload.length > 0xfffffffe || entry.data.length > 0xfffffffe || offset > 0xfffffffe) {
      throw new ZipFormatError("too-large", "档案超过 4 GB，当前格式不支持。");
    }

    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    chunks.push(local, name, payload);

    const header = new Uint8Array(46);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
    hv.setUint16(4, (UNIX_HOST << 8) | 20, true);
    hv.setUint16(6, 20, true);
    hv.setUint16(8, UTF8_FLAG, true);
    hv.setUint16(10, method, true);
    hv.setUint16(12, stamp.time, true);
    hv.setUint16(14, stamp.date, true);
    hv.setUint32(16, crc, true);
    hv.setUint32(20, payload.length, true);
    hv.setUint32(24, entry.data.length, true);
    hv.setUint16(28, name.length, true);
    // 30..37：extra / comment / disk / internal attributes 均为 0；外部属性标成普通文件。
    hv.setUint32(38, ((S_IFREG | 0o644) << 16) >>> 0, true);
    hv.setUint32(42, offset, true);
    central.push(header, name);

    offset += local.length + name.length + payload.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  if (entries.length > 0xfffe) throw new ZipFormatError("too-many-entries", "档案条目超过 65534 个，当前格式不支持。");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return concatBytes([...chunks, ...central, end]);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - (22 + 0xffff));
  for (let index = view.byteLength - 22; index >= minimum; index -= 1) {
    if (view.getUint32(index, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return index;
  }
  throw new ZipFormatError("not-zip", "上传的文件不是 zip 档案（找不到中央目录）。");
}

/**
 * 读 zip：只接受单卷、非加密、非 zip64、stored/deflate 条目；
 * 拒绝符号链接、不安全路径与重复条目；逐条校验解压长度与 CRC。目录条目忽略。
 */
export function readZip(bytes: Uint8Array, limits: ZipReadLimits = DEFAULT_ZIP_READ_LIMITS): Map<string, Uint8Array> {
  if (bytes.length < 22) throw new ZipFormatError("not-zip", "上传的文件太小，不是 zip 档案。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number): number => view.getUint16(at, true);
  const u32 = (at: number): number => view.getUint32(at, true);
  const endOffset = findEndOfCentralDirectory(view);
  const diskNumber = u16(endOffset + 4);
  const centralDisk = u16(endOffset + 6);
  const entryCount = u16(endOffset + 10);
  const centralSize = u32(endOffset + 12);
  const centralOffset = u32(endOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0) throw new ZipFormatError("multi-disk", "不支持分卷 zip 档案。");
  if (entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    throw new ZipFormatError("zip64", "不支持 zip64 档案；请用 NovelFork 导出的档案。");
  }
  if (entryCount > limits.maxEntries) throw new ZipFormatError("too-many-entries", `档案条目过多（${entryCount} 个，上限 ${limits.maxEntries}）。`);
  if (centralOffset + centralSize > endOffset) throw new ZipFormatError("corrupt", "档案中央目录越界，文件已损坏。");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const result = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > endOffset || u32(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ZipFormatError("corrupt", "档案中央目录条目损坏。");
    }
    const madeBy = u16(cursor + 4);
    const flags = u16(cursor + 8);
    const method = u16(cursor + 10);
    const crc = u32(cursor + 16);
    const compressedSize = u32(cursor + 20);
    const uncompressedSize = u32(cursor + 24);
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const externalAttributes = u32(cursor + 38);
    const localOffset = u32(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > endOffset) throw new ZipFormatError("corrupt", "档案条目名越界，文件已损坏。");
    const rawName = bytes.subarray(cursor + 46, nameEnd);
    let name: string;
    try {
      name = decoder.decode(rawName);
    } catch {
      throw new ZipFormatError("corrupt", "档案条目名不是 UTF-8 编码，不是 NovelFork 导出的档案。");
    }
    cursor = nameEnd + extraLength + commentLength;

    if (flags & ENCRYPTED_FLAG) throw new ZipFormatError("encrypted", `档案条目「${name}」已加密，不支持。`);
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    if ((madeBy >> 8) === UNIX_HOST && (unixMode & S_IFMT) === S_IFLNK) {
      throw new ZipFormatError("symlink", `档案条目「${name}」是符号链接，已拒绝整份档案：解压符号链接可能写到作品目录之外。`);
    }
    if (name.endsWith("/")) {
      assertSafeArchivePath(name.slice(0, -1));
      continue;
    }
    assertSafeArchivePath(name);
    if (result.has(name)) throw new ZipFormatError("duplicate-entry", `档案条目重复：${name}`);
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      throw new ZipFormatError("unsupported-method", `档案条目「${name}」使用了不支持的压缩方式（${method}）。`);
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ZipFormatError("entry-too-large", `档案条目「${name}」解压后过大（${uncompressedSize} 字节）。`);
    }
    totalBytes += uncompressedSize;
    if (totalBytes > limits.maxTotalBytes) throw new ZipFormatError("archive-too-large", "档案解压后总大小超过上限。");

    if (localOffset + 30 > centralOffset || u32(localOffset) !== LOCAL_HEADER_SIGNATURE) {
      throw new ZipFormatError("corrupt", `档案条目「${name}」的本地头损坏。`);
    }
    const localNameLength = u16(localOffset + 26);
    const localExtraLength = u16(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new ZipFormatError("corrupt", `档案条目「${name}」的数据越界。`);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (!bytesEqual(localName, rawName)) throw new ZipFormatError("corrupt", `档案条目「${name}」的本地头与中央目录不一致。`);

    const payload = bytes.subarray(dataStart, dataEnd);
    let data: Uint8Array;
    if (method === METHOD_STORED) {
      data = payload.slice();
    } else {
      try {
        data = uncompressedSize === 0 ? new Uint8Array() : asBytes(inflateRawSync(payload, { maxOutputLength: uncompressedSize }));
      } catch {
        throw new ZipFormatError("corrupt", `档案条目「${name}」解压失败或实际长度与声明不符。`);
      }
    }
    if (data.length !== uncompressedSize) throw new ZipFormatError("corrupt", `档案条目「${name}」解压长度与声明不符。`);
    if (crc32(data) !== crc) throw new ZipFormatError("crc-mismatch", `档案条目「${name}」校验和不符，文件已损坏。`);
    result.set(name, data);
  }
  return result;
}
