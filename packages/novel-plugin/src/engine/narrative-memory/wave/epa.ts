function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

function norm(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function cosine(a: readonly number[], b: readonly number[]): number {
  const denominator = norm(a) * norm(b);
  if (a.length === 0 || a.length !== b.length || denominator <= 0) return 0;
  return dot(a, b) / denominator;
}

export type EPAResult = Readonly<{
  entropy: number;
  logicDepth: number;
  fallback?: "neutral";
}>;

export function analyzeEPA(input: Readonly<{ queryVector?: readonly number[]; tagVectors?: readonly (readonly number[])[] }>): EPAResult {
  const queryVector = input.queryVector;
  const tagVectors = input.tagVectors ?? [];
  if (!queryVector || queryVector.length === 0 || tagVectors.length === 0) {
    return { entropy: 0.5, logicDepth: 0.5, fallback: "neutral" };
  }
  const scores = tagVectors
    .filter((vector) => vector.length === queryVector.length)
    .map((vector) => Math.max(0, cosine(queryVector, vector)));
  const total = scores.reduce((sum, value) => sum + value, 0);
  if (scores.length === 0 || total <= 0) return { entropy: 0.5, logicDepth: 0.5, fallback: "neutral" };
  const probabilities = scores.map((score) => score / total);
  const rawEntropy = -probabilities.reduce((sum, value) => value > 0 ? sum + value * Math.log(value) : sum, 0);
  const maxEntropy = Math.log(probabilities.length || 1) || 1;
  const entropy = Math.max(0, Math.min(1, rawEntropy / maxEntropy));
  const logicDepth = Math.max(0, Math.min(1, 1 - entropy));
  return { entropy, logicDepth };
}
