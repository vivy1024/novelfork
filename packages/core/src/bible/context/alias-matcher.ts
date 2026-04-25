export interface AliasMatchEntry {
  id: string;
  name: string;
  aliasesJson?: string;
}

interface AliasOutput<TEntry extends AliasMatchEntry> {
  entry: TEntry;
  keywordLength: number;
}

interface AliasHit<TEntry extends AliasMatchEntry> extends AliasOutput<TEntry> {
  start: number;
  end: number;
  order: number;
}

interface TrieNode<TEntry extends AliasMatchEntry> {
  next: Map<string, TrieNode<TEntry>>;
  fail: TrieNode<TEntry> | null;
  outputs: Array<AliasOutput<TEntry>>;
}

function createNode<TEntry extends AliasMatchEntry>(): TrieNode<TEntry> {
  return {
    next: new Map(),
    fail: null,
    outputs: [],
  };
}

function parseAliases(aliasesJson: string | null | undefined): string[] {
  if (!aliasesJson) return [];
  try {
    const parsed: unknown = JSON.parse(aliasesJson);
    return Array.isArray(parsed) ? parsed.filter((alias): alias is string => typeof alias === "string" && alias.length > 0) : [];
  } catch {
    return [];
  }
}

function getKeywords(entry: AliasMatchEntry): string[] {
  return Array.from(new Set([entry.name, ...parseAliases(entry.aliasesJson)].filter((keyword) => keyword.length > 0)));
}

export class AliasMatcher<TEntry extends AliasMatchEntry> {
  private readonly root: TrieNode<TEntry> = createNode<TEntry>();

  constructor(entries: readonly TEntry[]) {
    for (const entry of entries) {
      this.addEntry(entry);
    }
    this.buildFailureLinks();
  }

  match(sceneText: string): TEntry[] {
    const hits: Array<AliasHit<TEntry>> = [];
    let node = this.root;
    let index = 0;

    for (const char of sceneText) {
      while (node !== this.root && !node.next.has(char)) {
        node = node.fail ?? this.root;
      }

      node = node.next.get(char) ?? this.root;
      for (const output of node.outputs) {
        hits.push({
          ...output,
          start: index - output.keywordLength + 1,
          end: index,
          order: hits.length,
        });
      }
      index += 1;
    }

    const longestHits = hits.filter((hit) => !hits.some((other) => (
      other.keywordLength > hit.keywordLength
      && other.start <= hit.start
      && other.end >= hit.end
    )));
    const seen = new Set<string>();
    const matched: TEntry[] = [];

    for (const hit of longestHits.sort((a, b) => a.start - b.start || a.order - b.order)) {
      if (seen.has(hit.entry.id)) continue;
      seen.add(hit.entry.id);
      matched.push(hit.entry);
    }

    return matched;
  }

  private addEntry(entry: TEntry): void {
    for (const keyword of getKeywords(entry)) {
      let node = this.root;
      for (const char of keyword) {
        const next = node.next.get(char) ?? createNode<TEntry>();
        node.next.set(char, next);
        node = next;
      }
      node.outputs.push({ entry, keywordLength: Array.from(keyword).length });
    }
  }

  private buildFailureLinks(): void {
    const queue: TrieNode<TEntry>[] = [];
    this.root.fail = this.root;

    for (const child of this.root.next.values()) {
      child.fail = this.root;
      queue.push(child);
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      for (const [char, child] of current.next) {
        let fallback = current.fail ?? this.root;
        while (fallback !== this.root && !fallback.next.has(char)) {
          fallback = fallback.fail ?? this.root;
        }

        child.fail = fallback.next.get(char) ?? this.root;
        child.outputs = child.outputs.concat(child.fail.outputs);
        queue.push(child);
      }
    }
  }
}

export function createAliasMatcher<TEntry extends AliasMatchEntry>(entries: readonly TEntry[]): AliasMatcher<TEntry> {
  return new AliasMatcher(entries);
}

export function matchTrackedByAliases<TEntry extends AliasMatchEntry>(entries: readonly TEntry[], sceneText: string): TEntry[] {
  if (entries.length === 0 || sceneText.length === 0) return [];
  return createAliasMatcher(entries).match(sceneText);
}
