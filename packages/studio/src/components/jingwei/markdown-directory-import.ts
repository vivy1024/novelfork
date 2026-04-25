export interface MarkdownDirectoryCandidate {
  key: string;
  name: string;
}

export interface MarkdownDirectoryImportPreview {
  templateHint: "advanced-template" | "generic-directory";
  candidates: MarkdownDirectoryCandidate[];
}

function normalizeCandidateName(value: string): string {
  return value
    .replace(/^[\s#>*-]+/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/[`*_~]/g, "")
    .replace(/[：:：-]+$/, "")
    .trim();
}

function normalizeCandidateKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseMarkdownDirectoryImport(content: string): MarkdownDirectoryImportPreview {
  const lines = content.split(/\r?\n/);
  const candidates: MarkdownDirectoryCandidate[] = [];
  const seen = new Set<string>();
  let inDirectorySection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^#{1,6}\s*目录\s*$/u.test(trimmed)) {
      inDirectorySection = true;
      continue;
    }

    if (/^#{1,6}\s+/u.test(trimmed) && !/^#{1,6}\s*目录\s*$/u.test(trimmed)) {
      inDirectorySection = false;
    }

    const match = trimmed.match(/^([-*+]\s+|\d+[.)、]\s+)(.+)$/u);
    if (!match) {
      continue;
    }

    if (!inDirectorySection && lines.some((item) => /^#{1,6}\s*目录\s*$/u.test(item.trim()))) {
      continue;
    }

    const name = normalizeCandidateName(match[2]);
    const key = normalizeCandidateKey(name);
    if (!name || !key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push({ key, name });
  }

  return {
    templateHint: content.includes("没钱修什么仙") ? "advanced-template" : "generic-directory",
    candidates,
  };
}
