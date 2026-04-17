/**
 * Token counter — precise token counting using tiktoken
 */

import { Tiktoken } from "tiktoken/lite";
import cl100k_base from "tiktoken/encoders/cl100k_base.json" assert { type: "json" };

const encoder = new Tiktoken(
  cl100k_base.bpe_ranks,
  cl100k_base.special_tokens,
  cl100k_base.pat_str,
);

export interface TokenCountResult {
  readonly tokens: number;
  readonly characters: number;
}

/**
 * Count tokens in text using tiktoken (cl100k_base encoding for GPT-4/Claude)
 */
export function countTokens(text: string): TokenCountResult {
  const tokens = encoder.encode(text);
  return {
    tokens: tokens.length,
    characters: text.length,
  };
}

/**
 * Estimate tokens using simple heuristic (fallback)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

/**
 * Free encoder resources
 */
export function freeEncoder(): void {
  encoder.free();
}
