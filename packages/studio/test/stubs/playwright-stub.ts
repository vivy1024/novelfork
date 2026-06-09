// Test stub for optional browser deps (playwright / playwright-core).
// 真实包在运行时通过动态 import + try/catch 加载；测试不驱动真实浏览器，
// 用空 stub 避免 vite 转换阶段因可选依赖未声明而解析失败。
export const chromium = undefined;
export default {};
