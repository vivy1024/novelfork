/**
 * Minimal .docx generator — no external dependencies.
 *
 * A .docx is a ZIP archive containing XML files. We build the minimal
 * required structure using Node's built-in zlib for deflation and manual
 * ZIP local/central directory construction.
 */

import { deflateRawSync } from "node:zlib";

interface Chapter {
  title: string;
  content: string;
}

/**
 * Generate a valid .docx buffer from chapter data.
 */
export function generateDocx(chapters: Chapter[], bookTitle?: string): Uint8Array {
  const documentXml = buildDocumentXml(chapters, bookTitle);
  const encoder = new TextEncoder();

  const files: Array<{ path: string; data: Uint8Array }> = [
    { path: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES_XML) },
    { path: "_rels/.rels", data: encoder.encode(RELS_XML) },
    { path: "word/_rels/document.xml.rels", data: encoder.encode(DOCUMENT_RELS_XML) },
    { path: "word/document.xml", data: encoder.encode(documentXml) },
    { path: "word/styles.xml", data: encoder.encode(STYLES_XML) },
  ];

  return buildZip(files);
}

// --- XML Templates ---

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="480" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="48"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="360" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="200" w:line="360" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:sz w:val="24"/><w:rFonts w:eastAsia="SimSun"/></w:rPr>
  </w:style>
</w:styles>`;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildDocumentXml(chapters: Chapter[], bookTitle?: string): string {
  const paragraphs: string[] = [];

  // Book title as Heading1
  if (bookTitle) {
    paragraphs.push(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(bookTitle)}</w:t></w:r></w:p>`,
    );
  }

  for (const chapter of chapters) {
    // Chapter title as Heading2
    paragraphs.push(
      `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${escapeXml(chapter.title)}</w:t></w:r></w:p>`,
    );

    // Split content into paragraphs by newlines, skip markdown headings
    const lines = chapter.content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue; // skip empty lines
      if (trimmed.startsWith("#")) continue; // skip markdown headings (already used title)
      paragraphs.push(
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(trimmed)}</w:t></w:r></w:p>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
${paragraphs.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

// --- Minimal ZIP builder (no dependencies) ---

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

function buildZip(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const compressed = new Uint8Array(deflateRawSync(file.data));
    const useCompressed = compressed.length < file.data.length;
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
