import { resolve } from "node:path";

export default {
  resolve: {
    alias: {
      "@testing-library/react": resolve(__dirname, "../studio/node_modules/@testing-library/react/dist/index.js"),
      "@": resolve(__dirname, "../studio/src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
};
