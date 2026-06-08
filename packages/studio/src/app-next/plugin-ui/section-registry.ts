/**
 * 插件 UI Section 组件注册表
 *
 * manifest.uiSections 只携带元数据（componentKey 等）；真正的 React 组件
 * 由插件侧在前端启动时通过 registerPluginSection 注册到这里。宿主（套路页）
 * 用 componentKey 取回组件渲染。
 *
 * 设计：studio 前端已静态依赖各插件包，因此注册用静态导入即可，无需动态模块加载。
 */
import type { ComponentType } from "react";

/** 插件 section 组件接收的统一 props */
export interface PluginSectionProps {
  /** 当前选中的书籍/项目 ID（requiresBook 的 section 必有） */
  readonly bookId?: string;
  /** 当前项目根目录 */
  readonly projectRoot?: string;
  /** 当前会话 ID（用于 session 级配置，如工具开关） */
  readonly sessionId?: string;
}

export type PluginSectionComponent = ComponentType<PluginSectionProps>;

const registry = new Map<string, PluginSectionComponent>();

/** 注册一个插件 section 组件。重复 key 会覆盖。 */
export function registerPluginSection(componentKey: string, component: PluginSectionComponent): void {
  registry.set(componentKey, component);
}

/** 按 componentKey 取回已注册的组件。 */
export function getPluginSection(componentKey: string): PluginSectionComponent | undefined {
  return registry.get(componentKey);
}

/** 返回所有已注册的 componentKey。 */
export function getRegisteredSectionKeys(): string[] {
  return [...registry.keys()];
}

/** 清空注册表（测试用）。 */
export function clearPluginSections(): void {
  registry.clear();
}
