import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: [
      "src/__tests__/ai-tells.test.ts",
      "src/__tests__/compliance-*.test.ts",
      "src/__tests__/continuity.test.ts",
      "src/__tests__/dialogue-generator.test.ts",
      "src/__tests__/fanfic-dimensions.test.ts",
      "src/__tests__/file-parser.test.ts",
      "src/__tests__/filter-*.test.ts",
      "src/__tests__/inline-writer.test.ts",
      "src/__tests__/jingwei-*.test.ts",
      "src/__tests__/length-normalizer.test.ts",
      "src/__tests__/multi-work-style.test.ts",
      "src/__tests__/outline-brancher.test.ts",
      "src/__tests__/pipeline-runner-memory-sync.test.ts",
      "src/__tests__/post-write-validator.test.ts",
      "src/__tests__/presets-*.test.ts",
      "src/__tests__/reviser.test.ts",
      "src/__tests__/sensitive-words.test.ts",
      "src/__tests__/settler-delta-parser.test.ts",
      "src/__tests__/state-validator-agent.test.ts",
      "src/__tests__/style-analyzer.test.ts",
      "src/__tests__/style-drift-detector.test.ts",
      "src/__tests__/variant-generator.test.ts",
      "src/__tests__/writer*.test.ts",
      "src/__tests__/writing-tools-*.test.ts",
    ],
  },
});
