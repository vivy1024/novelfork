import { resolve } from "node:path";

export default {
  resolve: {
    alias: {
      // novel-plugin 自己装了 react@19.2.7，而渲染用的 react-dom 来自 studio（19.2.5）。
      // 两份 React 同时加载会让 react-dom 找不到 hooks 实例（useState 读到 null），
      // 组件测试全部报错。测试里统一钉到 studio 的那一份，与运行时保持一致。
      "react-dom/client": resolve(__dirname, "../studio/node_modules/react-dom/client.js"),
      "react-dom": resolve(__dirname, "../studio/node_modules/react-dom"),
      "react/jsx-dev-runtime": resolve(__dirname, "../studio/node_modules/react/jsx-dev-runtime.js"),
      "react/jsx-runtime": resolve(__dirname, "../studio/node_modules/react/jsx-runtime.js"),
      "react": resolve(__dirname, "../studio/node_modules/react"),
      "@testing-library/react": resolve(__dirname, "../studio/node_modules/@testing-library/react/dist/index.js"),
      "@": resolve(__dirname, "../studio/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    setupFiles: [resolve(__dirname, "test-setup.ts")],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
};
