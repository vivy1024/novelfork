export interface KeywordMatch {
  keyword: string;
  start: number;
  end: number;
}

interface TrieNode {
  next: Map<string, TrieNode>;
  fail: TrieNode | null;
  outputs: string[];
}

function createNode(): TrieNode {
  return { next: new Map(), fail: null, outputs: [] };
}

export class AhoCorasickMatcher {
  private readonly root: TrieNode = createNode();

  constructor(keywords: string[]) {
    for (const keyword of [...new Set(keywords.filter(Boolean))]) {
      let node = this.root;
      for (const char of [...keyword]) {
        let next = node.next.get(char);
        if (!next) {
          next = createNode();
          node.next.set(char, next);
        }
        node = next;
      }
      node.outputs.push(keyword);
    }
    this.buildFailureLinks();
  }

  private buildFailureLinks(): void {
    const queue: TrieNode[] = [];
    this.root.fail = this.root;
    for (const child of this.root.next.values()) {
      child.fail = this.root;
      queue.push(child);
    }
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      for (const [char, child] of current.next.entries()) {
        let fallback = current.fail ?? this.root;
        while (fallback !== this.root && !fallback.next.has(char)) {
          fallback = fallback.fail ?? this.root;
        }
        child.fail = fallback.next.get(char) ?? this.root;
        child.outputs.push(...child.fail.outputs);
        queue.push(child);
      }
    }
  }

  search(text: string): KeywordMatch[] {
    const chars = [...text];
    const charOffsets: number[] = [];
    let offset = 0;
    for (const char of chars) {
      charOffsets.push(offset);
      offset += char.length;
    }

    const matches: KeywordMatch[] = [];
    let node = this.root;
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index]!;
      while (node !== this.root && !node.next.has(char)) {
        node = node.fail ?? this.root;
      }
      node = node.next.get(char) ?? this.root;
      for (const keyword of node.outputs) {
        const keywordLength = [...keyword].length;
        const startCharIndex = index - keywordLength + 1;
        const start = charOffsets[startCharIndex]!;
        const end = charOffsets[index]! + chars[index]!.length;
        matches.push({ keyword, start, end });
      }
    }
    return matches.sort((a, b) => a.start - b.start || a.end - b.end || a.keyword.localeCompare(b.keyword, "zh-Hans-CN"));
  }
}
