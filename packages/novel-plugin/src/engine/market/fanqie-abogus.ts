/**
 * Tomato/Fanqie a_bogus signer.
 * Ported from wengchengjian/fanqie-rank-mcp a_bogus.py (SM3 + RC4 + custom base64).
 */

const SM3_IV = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
  0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
] as const;

const ENCODE_TABLES: Record<string, string> = {
  s0: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
  s1: "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
  s2: "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
  s3: "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe",
  s4: "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe",
};

const WINDOW_ENV_STR = "1536|747|1536|834|0|30|0|0|1536|834|1536|864|1525|747|24|24|Win32";
const SAFE_URL_BYTES = new Set(Buffer.from(" -_.~").values());
const HEX_CHARS = Buffer.from("0123456789ABCDEF");

function u32(value: number): number {
  return value >>> 0;
}

function leftRotate(x: number, n: number): number {
  const shift = n % 32;
  return u32((x << shift) | (x >>> (32 - shift)));
}

function sm3FFj(j: number, x: number, y: number, z: number): number {
  return j < 16 ? x ^ y ^ z : (x & y) | (x & z) | (y & z);
}

function sm3GGj(j: number, x: number, y: number, z: number): number {
  return j < 16 ? x ^ y ^ z : (x & y) | (~x & z);
}

function sm3Tj(j: number): number {
  return j < 16 ? 0x79cc4519 : 0x7a879d8a;
}

function sm3P0(x: number): number {
  return x ^ leftRotate(x, 9) ^ leftRotate(x, 17);
}

function concatBytes(chunks: readonly Buffer[]): Buffer {
  return Buffer.concat(chunks as readonly Uint8Array[]);
}

function compressBlock(reg: number[], block: Buffer): number[] {
  const w = new Array<number>(132).fill(0);
  for (let i = 0; i < 16; i += 1) w[i] = block.readUInt32BE(4 * i);
  for (let n = 16; n < 68; n += 1) {
    let a = w[n - 16]! ^ w[n - 9]! ^ leftRotate(w[n - 3]!, 15);
    a = a ^ leftRotate(a, 15) ^ leftRotate(a, 23);
    w[n] = u32(a ^ leftRotate(w[n - 13]!, 7) ^ w[n - 6]!);
  }
  for (let n = 0; n < 64; n += 1) w[n + 68] = w[n]! ^ w[n + 4]!;

  const v = [...reg];
  for (let c = 0; c < 64; c += 1) {
    let ss1 = u32(leftRotate(v[0]!, 12) + v[4]! + leftRotate(sm3Tj(c), c));
    ss1 = leftRotate(ss1, 7) ^ leftRotate(v[0]!, 12);
    const tt1 = u32(sm3FFj(c, v[0]!, v[1]!, v[2]!) + v[3]! + ss1 + w[c + 68]!);
    const tt2 = u32(sm3GGj(c, v[4]!, v[5]!, v[6]!) + v[7]! + (ss1 + leftRotate(v[0]!, 12)) + w[c]!);
    v[3] = v[2]!;
    v[2] = leftRotate(v[1]!, 9);
    v[1] = v[0]!;
    v[0] = tt1;
    v[7] = v[6]!;
    v[6] = leftRotate(v[5]!, 19);
    v[5] = v[4]!;
    v[4] = sm3P0(tt2);
  }
  return reg.map((value, index) => u32(value ^ v[index]!));
}

function urlEncodeBytes(input: string): Buffer {
  const source = Buffer.from(input, "utf8");
  const out: number[] = [];
  for (const ch of source) {
    if ((ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || SAFE_URL_BYTES.has(ch)) {
      out.push(ch);
    } else {
      out.push(37, HEX_CHARS[ch >> 4]!, HEX_CHARS[ch & 0x0f]!);
    }
  }
  return Buffer.from(out);
}

export function rc4Encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  let ii = 0;
  let jj = 0;
  const result = Buffer.alloc(plaintext.length);
  for (let n = 0; n < plaintext.length; n += 1) {
    ii = (ii + 1) & 0xff;
    jj = (jj + s[ii]!) & 0xff;
    [s[ii], s[jj]] = [s[jj]!, s[ii]!];
    const t = (s[ii]! + s[jj]!) & 0xff;
    result[n] = s[t]! ^ plaintext[n]!;
  }
  return result;
}

class SM3 {
  private reg: number[] = [...SM3_IV];
  private chunk = Buffer.alloc(0);
  private size = 0;

  reset(): void {
    this.reg = [...SM3_IV];
    this.chunk = Buffer.alloc(0);
    this.size = 0;
  }

  writeBytes(data: Buffer): void {
    this.size += data.length;
    if (this.chunk.length + data.length < 64) {
      this.chunk = concatBytes([this.chunk, data]);
      return;
    }
    const fill = 64 - this.chunk.length;
    this.reg = compressBlock(this.reg, concatBytes([this.chunk, data.subarray(0, fill)]));
    this.chunk = Buffer.alloc(0);
    let offset = fill;
    while (offset + 64 <= data.length) {
      this.reg = compressBlock(this.reg, data.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < data.length) this.chunk = data.subarray(offset);
  }

  writeStr(value: string): void {
    this.writeBytes(urlEncodeBytes(value));
  }

  private fill(): void {
    const bitLen = 8 * this.size;
    const padded = [this.chunk, Buffer.from([0x80])];
    let length = this.chunk.length + 1;
    while (length % 64 < 56) {
      padded.push(Buffer.from([0]));
      length += 1;
    }
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeUInt32BE(Math.floor(bitLen / 0x100000000), 0);
    lenBuf.writeUInt32BE(bitLen >>> 0, 4);
    this.chunk = concatBytes([...padded, lenBuf]);
  }

  private digest(): Buffer {
    this.fill();
    for (let i = 0; i < this.chunk.length; i += 64) {
      const block = this.chunk.subarray(i, i + 64);
      if (block.length === 64) this.reg = compressBlock(this.reg, block);
    }
    const out = Buffer.alloc(32);
    this.reg.forEach((value, index) => out.writeUInt32BE(value, index * 4));
    return out;
  }

  sumHex(value: string): string {
    this.reset();
    this.writeStr(value);
    const digest = this.digest();
    this.reset();
    return digest.toString("hex");
  }

  sumBytes(value: string): Buffer {
    this.reset();
    this.writeStr(value);
    const digest = this.digest();
    this.reset();
    return digest;
  }

  sumBytesFromBytes(data: Buffer): Buffer {
    this.reset();
    this.writeBytes(data);
    const digest = this.digest();
    this.reset();
    return digest;
  }
}

export function resultEncrypt(data: Buffer, tableName: string): string {
  const table = ENCODE_TABLES[tableName] ?? ENCODE_TABLES.s0!;
  const chunks = Math.floor(data.length / 3);
  let out = "";
  for (let round = 0; round < chunks; round += 1) {
    const r = round * 3;
    const longInt = (data[r]! << 16) | (data[r + 1]! << 8) | data[r + 2]!;
    out += table[(longInt & 0xfc0000) >> 18];
    out += table[(longInt & 0x03f000) >> 12];
    out += table[(longInt & 0x000fc0) >> 6];
    out += table[longInt & 63];
  }
  return out;
}

function generateRandomPart(randomVal: number, option: readonly [number, number]): Buffer {
  return Buffer.from([
    (randomVal & 0xff & 0xaa) | (option[0] & 0x55),
    (randomVal & 0xff & 0x55) | (option[0] & 0xaa),
    ((randomVal >> 8) & 0xff & 0xaa) | (option[1] & 0x55),
    ((randomVal >> 8) & 0xff & 0x55) | (option[1] & 0xaa),
  ]);
}

function generateRandomStr(random: () => number): Buffer {
  return concatBytes([
    generateRandomPart(Math.floor(random() * 10000), [3, 45]),
    generateRandomPart(Math.floor(random() * 10000), [1, 0]),
    generateRandomPart(Math.floor(random() * 10000), [1, 5]),
  ]);
}

function generateRc4Bb(urlSearchParams: string, userAgent: string, nowMs: number): Buffer {
  const sm3 = new SM3();
  const startTimeMs = nowMs & 0xffffffff;
  const urlSearchParamsList = sm3.sumBytes(sm3.sumHex(urlSearchParams));
  const cusList = sm3.sumBytes(sm3.sumHex("cus"));
  const uaBytes = Buffer.from(userAgent, "latin1");
  const uaBase64 = resultEncrypt(rc4Encrypt(uaBytes, Buffer.from([0x01, 0x00, 0x0e])), "s3");
  const uaList = sm3.sumBytesFromBytes(Buffer.from(uaBase64, "latin1"));
  const endTimeMs = nowMs & 0xffffffff;

  const b: Record<number, number> = {};
  b[8] = 3;
  b[10] = endTimeMs;
  b[16] = startTimeMs;
  b[18] = 44;
  b[20] = (b[16] >> 24) & 0xff;
  b[21] = (b[16] >> 16) & 0xff;
  b[22] = (b[16] >> 8) & 0xff;
  b[23] = b[16] & 0xff;
  b[24] = 0;
  b[25] = 0;
  b[26] = 0;
  b[27] = 0;
  b[28] = 0;
  b[29] = 0;
  b[30] = 0;
  b[31] = 1;
  b[32] = 0;
  b[33] = 0;
  b[34] = 0;
  b[35] = 0;
  b[36] = 0;
  b[37] = 14;
  b[38] = urlSearchParamsList[21]!;
  b[39] = urlSearchParamsList[22]!;
  b[40] = cusList[21]!;
  b[41] = cusList[22]!;
  b[42] = uaList[23]!;
  b[43] = uaList[24]!;
  b[44] = (b[10] >> 24) & 0xff;
  b[45] = (b[10] >> 16) & 0xff;
  b[46] = (b[10] >> 8) & 0xff;
  b[47] = b[10] & 0xff;
  b[48] = b[8];
  b[49] = 0;
  b[50] = 0;
  const pageId = 6241;
  const aid = 6383;
  b[51] = pageId;
  b[52] = (pageId >> 24) & 0xff;
  b[53] = (pageId >> 16) & 0xff;
  b[54] = (pageId >> 8) & 0xff;
  b[55] = pageId & 0xff;
  b[56] = aid;
  b[57] = aid & 0xff;
  b[58] = (aid >> 8) & 0xff;
  b[59] = (aid >> 16) & 0xff;
  b[60] = (aid >> 24) & 0xff;
  const windowEnvBytes = Buffer.from(WINDOW_ENV_STR, "latin1");
  b[64] = windowEnvBytes.length;
  b[65] = windowEnvBytes.length & 0xff;
  b[66] = (windowEnvBytes.length >> 8) & 0xff;
  b[69] = 0;
  b[70] = 0;
  b[71] = 0;
  b[72] = (
    b[18]! ^ b[20]! ^ b[26]! ^ b[30]! ^ b[38]! ^ b[40]! ^ b[42]!
    ^ b[21]! ^ b[27]! ^ b[31]! ^ b[35]! ^ b[39]! ^ b[41]! ^ b[43]!
    ^ b[22]! ^ b[28]! ^ b[32]! ^ b[36]!
    ^ b[23]! ^ b[29]! ^ b[33]! ^ b[37]!
    ^ b[44]! ^ b[45]! ^ b[46]! ^ b[47]! ^ b[48]! ^ b[49]! ^ b[50]!
    ^ b[24]! ^ b[25]!
    ^ b[52]! ^ b[53]! ^ b[54]! ^ b[55]!
    ^ b[57]! ^ b[58]! ^ b[59]! ^ b[60]!
    ^ b[65]! ^ b[66]!
    ^ b[70]! ^ b[71]!
  );

  const bbOrder = [
    18, 20, 52, 26, 30, 34, 58, 38, 40, 53, 42, 21, 27, 54, 55, 31,
    35, 57, 39, 41, 43, 22, 28, 32, 60, 36, 23, 29, 33, 37, 44, 45,
    59, 46, 47, 48, 49, 50, 24, 25, 65, 66, 70, 71,
  ];
  const bb = concatBytes([
    Buffer.from(bbOrder.map((idx) => (b[idx] ?? 0) & 0xff)),
    windowEnvBytes,
    Buffer.from([b[72]! & 0xff]),
  ]);
  const utf8 = Buffer.from(bb.toString("utf8"), "utf8");
  return rc4Encrypt(utf8, Buffer.from([121]));
}

export function generateABogus(
  urlSearchParams: string,
  userAgent: string,
  options: { readonly nowMs?: number; readonly random?: () => number } = {},
): string {
  const random = options.random ?? Math.random;
  const nowMs = options.nowMs ?? Date.now();
  const combined = concatBytes([
    generateRandomStr(random),
    generateRc4Bb(urlSearchParams, userAgent, nowMs),
  ]);
  return `${resultEncrypt(combined, "s4")}=`;
}
