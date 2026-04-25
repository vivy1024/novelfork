export interface NestedRefEntry {
  id: string;
  nestedRefsJson?: string;
}

export interface ResolveNestedRefsOptions {
  maxDepth?: number;
}

function parseNestedRefs(refsJson: string | null | undefined): string[] {
  if (!refsJson) return [];
  try {
    const parsed: unknown = JSON.parse(refsJson);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

export function resolveNestedRefs<TEntry extends NestedRefEntry>(
  seedEntries: readonly TEntry[],
  allEntries: readonly TEntry[],
  options: ResolveNestedRefsOptions = {},
): TEntry[] {
  const maxDepth = options.maxDepth ?? 3;
  if (maxDepth <= 0) return [];

  const byId = new Map(allEntries.map((entry) => [entry.id, entry]));
  const visited = new Set(seedEntries.map((entry) => entry.id));
  const resolved: TEntry[] = [];
  const queue: Array<{ entry: TEntry; depth: number }> = seedEntries.map((entry) => ({ entry, depth: 0 }));

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { entry, depth } = queue[cursor]!;
    if (depth >= maxDepth) continue;

    for (const refId of parseNestedRefs(entry.nestedRefsJson)) {
      if (visited.has(refId)) continue;
      const ref = byId.get(refId);
      if (!ref) continue;

      visited.add(refId);
      resolved.push(ref);
      queue.push({ entry: ref, depth: depth + 1 });
    }
  }

  return resolved;
}
