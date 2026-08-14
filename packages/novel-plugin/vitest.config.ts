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
      // 上面的 react 别名只改写裸 `react` 说明符。@tiptap/react 是 CJS，
      // 它在自己的 node_modules 里 require("react")，pnpm 给 novel-plugin 链的那份
      // @tiptap/react 又恰好挂在 react@19.2.7 上，于是 ChapterEditor 一渲染就出现
      // 第二个 React 实例，useRef 从空 dispatcher 上读取而报 null。
      // studio 装的是同版本 @tiptap/react、但链到 19.2.5，指向它即可回到单实例。
      "@tiptap/react": resolve(__dirname, "../studio/node_modules/@tiptap/react"),
      // useApi 内部走 react-query，novel-plugin 自身未安装，测试里钉到 studio 那份（与 react 同款）。
      "@tanstack/react-query": resolve(__dirname, "../studio/node_modules/@tanstack/react-query"),
      "@vivy1024/novelfork-core/utils/length-metrics": resolve(__dirname, "../core/src/utils/length-metrics.ts"),
      "@": resolve(__dirname, "../studio/src"),
    },
    dedupe: ["react", "react-dom", "@tiptap/react"],
  },
  test: {
    environment: "jsdom",
    setupFiles: [resolve(__dirname, "test-setup.ts")],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // 少数用例走 bun:test（需要真实文件系统与 bun 运行时），vitest 无法解析
    // "bun:test" 说明符，收进 include 只会得到一条假失败。它们由 `bun test` 执行。
    exclude: ["src/handlers/jingwei-write-retire.test.ts"],
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
};
