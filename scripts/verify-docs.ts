import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const docsRoot = path.join(repoRoot, 'docs');
const allowedTypes = new Set(['current', 'planning', 'reference', 'archived', 'deprecated']);

type Problem = {
  file: string;
  type: string;
  message: string;
};

const problems: Problem[] = [];

function rel(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function add(file: string, type: string, message: string) {
  problems.push({ file: rel(file), type, message });
}

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      result.push(fullPath);
    }
  }
  return result;
}

function walkDirs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const result = [dir];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      result.push(...walkDirs(path.join(dir, entry.name)));
    }
  }
  return result;
}

function read(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

function withoutCodeFences(text: string): string {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  return lines
    .map((line) => {
      if (line.trim().startsWith('```')) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

function getDocType(filePath: string): string | null {
  const match = read(filePath).match(/\*\*文档类型\*\*:\s*(\w+)/);
  return match?.[1] ?? null;
}

function checkHeaders(markdownFiles: string[]) {
  for (const file of markdownFiles) {
    const text = read(file);
    const required = ['**版本**:', '**创建日期**:', '**更新日期**:', '**状态**:', '**文档类型**:'];
    for (const token of required) {
      if (!text.includes(token)) {
        add(file, 'missing-header', `缺少 header 字段 ${token}`);
      }
    }
    const docType = getDocType(file);
    if (!docType || !allowedTypes.has(docType)) {
      add(file, 'invalid-doc-type', `文档类型必须是 ${Array.from(allowedTypes).join(', ')} 之一`);
    }
  }
}

function checkLinks(markdownFiles: string[]) {
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
  for (const file of markdownFiles) {
    const text = withoutCodeFences(read(file));
    for (const match of text.matchAll(linkPattern)) {
      const rawTarget = match[1].trim();
      if (!rawTarget || rawTarget.startsWith('#')) continue;
      if (/^(https?:|mailto:|tel:|data:)/.test(rawTarget)) continue;

      const [targetWithoutHash] = rawTarget.split('#');
      const targetWithoutQuery = targetWithoutHash.split('?')[0];
      if (!targetWithoutQuery) continue;

      let decodedTarget = targetWithoutQuery;
      try {
        decodedTarget = decodeURIComponent(targetWithoutQuery);
      } catch {
        // Keep the raw target; the existence check below will report the file if needed.
      }

      const resolved = path.resolve(path.dirname(file), decodedTarget);
      if (!existsSync(resolved)) {
        add(file, 'broken-link', `${rawTarget} 指向的文件或目录不存在`);
      }
    }
  }
}

function checkDuplicateNumbers(dirs: string[]) {
  for (const dir of dirs) {
    const seen = new Map<string, string>();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue;
      const match = entry.name.match(/^(\d+)-/);
      if (!match) continue;
      const prefix = match[1];
      const previous = seen.get(prefix);
      if (previous) {
        add(dir, 'duplicate-number', `${prefix} 同时用于 ${previous} 和 ${entry.name}`);
      } else {
        seen.set(prefix, entry.name);
      }
    }
  }
}

function checkReadmes(dirs: string[]) {
  for (const dir of dirs) {
    const readme = path.join(dir, 'README.md');
    if (!existsSync(readme)) {
      add(dir, 'missing-readme', '目录缺少 README.md');
      continue;
    }
    const text = read(readme);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'README.md') continue;
      if (!text.includes(entry.name)) {
        add(readme, 'readme-missing-entry', `README 未列出直接子项 ${entry.name}`);
      }
    }
  }
}

function extractSection(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const rest = text.slice(start + heading.length + 3);
  const next = rest.search(/\n##\s+/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function checkRootCurrentEntries() {
  const rootReadme = path.join(docsRoot, 'README.md');
  if (!existsSync(rootReadme)) {
    add(rootReadme, 'missing-root-readme', 'docs/README.md 不存在');
    return;
  }
  const section = extractSection(read(rootReadme), '当前事实入口');
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of section.matchAll(linkPattern)) {
    const rawTarget = match[1].split('#')[0].split('?')[0];
    if (!rawTarget || /^(https?:|mailto:|tel:|data:)/.test(rawTarget)) continue;
    const resolved = path.resolve(path.dirname(rootReadme), decodeURIComponent(rawTarget));
    if (!existsSync(resolved) || statSync(resolved).isDirectory()) continue;
    const docType = getDocType(resolved);
    if (docType !== 'current' && docType !== 'planning') {
      add(rootReadme, 'invalid-current-entry', `${rawTarget} 是 ${docType ?? 'unknown'}，不能作为当前事实入口`);
    }
  }
}

function checkUserFacingBible(markdownFiles: string[]) {
  for (const file of markdownFiles) {
    const normalized = rel(file);
    if (!normalized.startsWith('docs/02-用户指南/') && !normalized.startsWith('docs/03-产品与流程/')) continue;
    if (getDocType(file) !== 'current') continue;
    if (/\bBible\b/.test(read(file))) {
      add(file, 'forbidden-user-term', '用户侧 current 文档不得把 Bible 作为主称呼');
    }
  }
}

function checkForbiddenClaims(markdownFiles: string[]) {
  for (const file of markdownFiles) {
    const docType = getDocType(file);
    if (docType !== 'current' && docType !== 'planning') continue;
    const lines = withoutCodeFences(read(file)).split(/\r?\n/);
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      if (/process-memory/.test(line) && /持久化|真实可用|已完成/.test(line) && !/不保证|不持久|临时|当前进程|透明/.test(line)) {
        add(file, 'forbidden-claim', `第 ${lineNumber} 行疑似把 process-memory 写成持久化或完成能力`);
      }
      if (/prompt-preview/.test(line) && /写入|已完成|真实可用/.test(line) && !/不代表|不得|禁止|仅预览|未接入|透明/.test(line)) {
        add(file, 'forbidden-claim', `第 ${lineNumber} 行疑似把 prompt-preview 写成真实写入`);
      }
      if (/unsupported/.test(line) && /成功|已完成|真实可用/.test(line) && !/不能|不得|禁止|未接入|透明|返回/.test(line)) {
        add(file, 'forbidden-claim', `第 ${lineNumber} 行疑似把 unsupported 写成成功能力`);
      }
      if (/\b(mock|fake|noop)\b/i.test(line) && /成功|已完成|真实可用/.test(line) && !/不得|不能|禁止|假成功|不|清理|反/.test(line)) {
        add(file, 'forbidden-claim', `第 ${lineNumber} 行疑似把 mock/fake/noop 写成真实能力`);
      }
    });
  }
}

function main() {
  if (!existsSync(docsRoot)) {
    console.error('[docs:verify] FAIL');
    console.error('- docs: missing-docs-root -> docs 目录不存在');
    process.exit(1);
  }

  const markdownFiles = walk(docsRoot);
  const dirs = walkDirs(docsRoot);

  checkHeaders(markdownFiles);
  checkLinks(markdownFiles);
  checkDuplicateNumbers(dirs);
  checkReadmes(dirs);
  checkRootCurrentEntries();
  checkUserFacingBible(markdownFiles);
  checkForbiddenClaims(markdownFiles);

  if (problems.length > 0) {
    console.error('[docs:verify] FAIL');
    for (const problem of problems) {
      console.error(`- ${problem.file}: ${problem.type} -> ${problem.message}`);
    }
    process.exit(1);
  }

  console.log(`[docs:verify] PASS (${markdownFiles.length} markdown files, ${dirs.length} directories)`);
}

main();
