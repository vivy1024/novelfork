/**
 * Outline Drift Detector — measures deviation between chapter content and outline plan.
 *
 * Implements a lightweight DOME-inspired (Dynamic Outline Management Engine) approach:
 * - Parses volume_outline.md into a 3-level tree (全书纲 → 卷纲 → 章纲)
 * - Compares chapter content against the expected outline node
 * - Returns drift score and specific deviations
 *
 * Zero LLM cost — uses keyword overlap and structural matching.
 */

import type { PostWriteViolation } from "../agents/post-write-validator.js";

// --- Outline tree types ---

export interface OutlineNode {
  readonly level: number;       // 1=book, 2=volume, 3=chapter
  readonly heading: string;
  readonly content: string;
  readonly keywords: ReadonlyArray<string>;
  readonly children: ReadonlyArray<OutlineNode>;
}

export interface OutlineDriftResult {
  readonly driftScore: number;  // 0-1, higher = more drift
  readonly matchedNode: OutlineNode | null;
  readonly violations: ReadonlyArray<PostWriteViolation>;
  readonly keywordOverlap: number;
  readonly missingKeywords: ReadonlyArray<string>;
}

// --- Outline parser ---

/**
 * Parse volume_outline.md into a tree structure.
 * Expects markdown with # (book), ## (volume/arc), ### (chapter) headers.
 */
export function parseOutlineTree(outlineContent: string): ReadonlyArray<OutlineNode> {
  if (!outlineContent.trim()) return [];

  const lines = outlineContent.split("\n");
  const root: OutlineNode[] = [];
  const stack: { node: OutlineNode; level: number }[] = [];

  let currentLines: string[] = [];
  let currentHeading = "";
  let currentLevel = 0;

  const flush = () => {
    if (!currentHeading) return;
    const content = currentLines.join("\n").trim();
    const node: OutlineNode = {
      level: currentLevel,
      heading: currentHeading,
      content,
      keywords: extractOutlineKeywords(currentHeading, content),
      children: [],
    };

    // Find parent: walk stack back to find a node with lower level
    while (stack.length > 0 && stack[stack.length - 1]!.level >= currentLevel) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      const parent = stack[stack.length - 1]!.node;
      (parent.children as OutlineNode[]).push(node);
    }
    stack.push({ node, level: currentLevel });
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      flush();
      currentLevel = headerMatch[1]!.length;
      currentHeading = headerMatch[2]!.trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return root;
}

function extractOutlineKeywords(heading: string, content: string): ReadonlyArray<string> {
  const kw = new Set<string>();
  const combined = `${heading}\n${content}`;

  // Chinese terms (2-6 chars)
  for (const match of combined.matchAll(/[\u4e00-\u9fff]{2,6}/g)) {
    kw.add(match[0]);
  }
  // Capitalized English words
  for (const match of combined.matchAll(/\b[A-Z][a-z]{2,}\b/g)) {
    kw.add(match[0]);
  }

  // Filter common stop words
  const stops = new Set(["一个", "这个", "那个", "什么", "怎么", "可以", "已经", "但是", "因为", "所以"]);
  return [...kw].filter((w) => !stops.has(w)).slice(0, 30);
}

// --- Drift detection ---

/**
 * Find the outline node that best matches a given chapter number.
 */
export function findOutlineNodeForChapter(
  tree: ReadonlyArray<OutlineNode>,
  chapterNumber: number,
): OutlineNode | null {
  // Search for chapter-level nodes (level 3) with matching number
  const chapterPattern = new RegExp(`(?:第|ch|chapter)\\s*${chapterNumber}(?:\\D|$)`, "i");

  function search(nodes: ReadonlyArray<OutlineNode>): OutlineNode | null {
    for (const node of nodes) {
      if (node.level === 3 && chapterPattern.test(node.heading)) {
        return node;
      }
      const found = search(node.children);
      if (found) return found;
    }
    return null;
  }

  return search(tree);
}

/**
 * Compute keyword overlap between chapter content and outline node.
 */
function computeKeywordOverlap(
  chapterContent: string,
  outlineKeywords: ReadonlyArray<string>,
): { overlap: number; missing: ReadonlyArray<string> } {
  if (outlineKeywords.length === 0) return { overlap: 1, missing: [] };

  const lowerContent = chapterContent.toLowerCase();
  const missing: string[] = [];
  let matched = 0;

  for (const kw of outlineKeywords) {
    if (lowerContent.includes(kw.toLowerCase())) {
      matched++;
    } else {
      missing.push(kw);
    }
  }

  return {
    overlap: matched / outlineKeywords.length,
    missing,
  };
}

/**
 * Detect outline drift for a chapter.
 */
export function detectOutlineDrift(
  chapterContent: string,
  chapterNumber: number,
  outlineContent: string,
): OutlineDriftResult {
  const tree = parseOutlineTree(outlineContent);
  const matchedNode = findOutlineNodeForChapter(tree, chapterNumber);

  if (!matchedNode) {
    return {
      driftScore: 0,
      matchedNode: null,
      violations: [],
      keywordOverlap: 0,
      missingKeywords: [],
    };
  }

  // Also collect parent (volume) keywords for broader context
  const allKeywords = [...matchedNode.keywords];
  const { overlap, missing } = computeKeywordOverlap(chapterContent, allKeywords);
  const driftScore = 1 - overlap;

  const violations: PostWriteViolation[] = [];

  if (driftScore > 0.7) {
    violations.push({
      rule: "DOME-001:大纲严重偏离",
      severity: "error",
      description: `本章与大纲节点「${matchedNode.heading}」的关键词重合度仅 ${Math.round(overlap * 100)}%，严重偏离预定剧情。`,
      suggestion: `缺失关键词：${missing.slice(0, 5).join("、")}。请检查是否遗漏了大纲中的核心剧情点。`,
    });
  } else if (driftScore > 0.4) {
    violations.push({
      rule: "DOME-002:大纲中度偏离",
      severity: "warning",
      description: `本章与大纲节点「${matchedNode.heading}」的关键词重合度为 ${Math.round(overlap * 100)}%，存在偏离。`,
      suggestion: `部分缺失：${missing.slice(0, 3).join("、")}。可接受的创作自由，但注意不要丢失主线。`,
    });
  }

  return { driftScore, matchedNode, violations, keywordOverlap: overlap, missingKeywords: missing };
}
