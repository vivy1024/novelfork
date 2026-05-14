/**
 * Minimal ePub 3 generator — no external dependencies.
 *
 * An .epub is a ZIP archive (OCF container) containing XHTML, OPF, and NCX files.
 * Reuses the same ZIP building approach as docx-generator.ts.
 */

import { deflateRawSync } from "node:zlib";

interface Chapter {
  title: string;
  content: string;
}

interface EpubMetadata {
  title: string;
  author: string;
  language?: string;
}

/**
 * Generate a valid .epub (ePub 3) buffer from chapter data.
 */
export function generateEpub(
  chapters: Array<{ title: string; content: string }>,
  metadata: { title: string; author: string; language?: string },
): Uint8Array {
  const lang = metadata.language || "zh";
  const bookId = `novelfork-${Date.now()}`;
  const encoder = new TextEncoder();

  // Build chapter XHTML files
  const chapterFiles = chapters.map((ch, i) => ({
    path: `OEBPS/chapter-${i + 1}.xhtml`,
    data: encoder.encode(buildChapterXhtml(ch, lang)),
  }));

  // Build the ePub structure
  const files: Array<{ path: string; data: Uint8Array; store?: boolean }> = [
    // mimetype MUST be first and stored (not compressed)
    { path: "mimetype", data: encoder.encode("application/epub+zip"), store: true },
    { path: "META-INF/container.xml", data: encoder.encode(CONTAINER_XML) },
    { path: "OEBPS/content.opf", data: encoder.encode(buildContentOpf(chapters, metadata, bookId)) },
    { path: "OEBPS/toc.ncx", data: encoder.encode(buildTocNcx(chapters, metadata, bookId)) },
    { path: "OEBPS/toc.xhtml", data: encoder.encode(buildTocXhtml(chapters, metadata, lang)) },
    ...chapterFiles,
  ];

  return buildEpubZip(files);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildChapterXhtml(chapter: Chapter, lang: string): string {
  const lines = chapter.content.split("\n");
  const bodyParagraphs = lines
    .filter((l) => !l.startsWith("#"))
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => `    <p>${escapeXml(l)}</p>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(chapter.title)}</title>
</head>
<body>
  <h1>${escapeXml(chapter.title)}</h1>
${bodyParagraphs}
</body>
</html>`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function buildContentOpf(chapters: Chapter[], metadata: EpubMetadata, bookId: string): string {
  const lang = metadata.language || "zh";
  const manifestItems = chapters
    .map((_, i) => `    <item id="chapter-${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spineItems = chapters
    .map((_, i) => `    <itemref idref="chapter-${i + 1}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:creator>${escapeXml(metadata.author)}</dc:creator>
    <dc:language>${escapeXml(lang)}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;
}

function buildTocNcx(chapters: Chapter[], metadata: EpubMetadata, bookId: string): string {
  const navPoints = chapters
    .map(
      (ch, i) => `    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="chapter-${i + 1}.xhtml"/>
    </navPoint>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(bookId)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(metadata.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

function buildTocXhtml(chapters: Chapter[], metadata: EpubMetadata, lang: string): string {
  const items = chapters
    .map((ch, i) => `      <li><a href="chapter-${i + 1}.xhtml">${escapeXml(ch.title)}</a></li>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(metadata.title)} - 目录</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`;
}

// --- Minimal ZIP builder (ePub-aware: mimetype must be stored uncompressed as first entry) ---

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function writeU16LE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32LE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >>> 8) & 0xff;
  arr[offset + 2] = (value >>> 16) & 0xff;
  arr[offset + 3] = (value >>> 24) & 0xff;
}

function buildEpubZip(files: Array<{ path: string; data: Uint8Array; store?: boolean }>): Uint8Array {
  const encoder = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    // For mimetype: must be stored (no compression) per ePub spec
    const forceStore = file.store === true;
    const compressed = forceStore ? file.data : new Uint8Array(deflateRawSync(file.data));
    const useCompressed = !forceStore && compressed.length < file.data.length;
    const storedData = useCompressed ? compressed : file.data;
    const method = useCompressed ? 8 : 0; // 8 = deflate, 0 = store

    const pathBuf = encoder.encode(file.path);
    const crc = crc32(file.data);

    // Local file header (30 bytes + path + data)
    const local = new Uint8Array(30 + pathBuf.length + storedData.length);
    writeU32LE(local, 0, 0x04034b50); // signature
    writeU16LE(local, 4, 20); // version needed
    writeU16LE(local, 6, 0); // flags
    writeU16LE(local, 8, method); // compression
    writeU16LE(local, 10, 0); // mod time
    writeU16LE(local, 12, 0); // mod date
    writeU32LE(local, 14, crc); // crc32
    writeU32LE(local, 18, storedData.length); // compressed size
    writeU32LE(local, 22, file.data.length); // uncompressed size
    writeU16LE(local, 26, pathBuf.length); // filename length
    writeU16LE(local, 28, 0); // extra field length
    local.set(pathBuf, 30);
    local.set(storedData, 30 + pathBuf.length);

    // Central directory entry (46 bytes + path)
    const central = new Uint8Array(46 + pathBuf.length);
    writeU32LE(central, 0, 0x02014b50); // signature
    writeU16LE(central, 4, 20); // version made by
    writeU16LE(central, 6, 20); // version needed
    writeU16LE(central, 8, 0); // flags
    writeU16LE(central, 10, method); // compression
    writeU16LE(central, 12, 0); // mod time
    writeU16LE(central, 14, 0); // mod date
    writeU32LE(central, 16, crc); // crc32
    writeU32LE(central, 20, storedData.length); // compressed size
    writeU32LE(central, 24, file.data.length); // uncompressed size
    writeU16LE(central, 28, pathBuf.length); // filename length
    writeU16LE(central, 30, 0); // extra field length
    writeU16LE(central, 32, 0); // comment length
    writeU16LE(central, 34, 0); // disk number start
    writeU16LE(central, 36, 0); // internal attrs
    writeU32LE(central, 38, 0); // external attrs
    writeU32LE(central, 42, offset); // local header offset
    central.set(pathBuf, 46);

    localHeaders.push(local);
    centralEntries.push(central);
    offset += local.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralEntries.reduce((sum, e) => sum + e.length, 0);

  // End of central directory (22 bytes)
  const eocd = new Uint8Array(22);
  writeU32LE(eocd, 0, 0x06054b50); // signature
  writeU16LE(eocd, 4, 0); // disk number
  writeU16LE(eocd, 6, 0); // disk with central dir
  writeU16LE(eocd, 8, files.length); // entries on this disk
  writeU16LE(eocd, 10, files.length); // total entries
  writeU32LE(eocd, 12, centralDirSize); // central dir size
  writeU32LE(eocd, 16, centralDirOffset); // central dir offset
  writeU16LE(eocd, 20, 0); // comment length

  return concatBytes(...localHeaders, ...centralEntries, eocd);
}

// --- CRC32 ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
