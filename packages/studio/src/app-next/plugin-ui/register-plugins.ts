/**
 * 插件 UI 注册引导
 *
 * 在前端启动时把各插件贡献的 UI section 组件注册到 section-registry，
 * 并收集插件的 uiSections 元数据供宿主（套路页）消费。
 *
 * 注意：只从插件的 pages 入口（前端安全，无后端依赖）导入元数据，
 * 不导入完整 manifest——后者会牵连 Node 专用模块进浏览器 bundle。
 */
import { WritingConfigSection, WRITING_CONFIG_UI_SECTION } from "@vivy1024/novelfork-novel-plugin/pages/writing-config";
import type { PluginUISection } from "@vivy1024/novelfork-core";
import { registerPluginSection } from "./section-registry";

let registered = false;

/** 幂等注册所有插件 section 组件。 */
export function ensurePluginSectionsRegistered(): void {
  if (registered) return;
  registered = true;
  registerPluginSection(WRITING_CONFIG_UI_SECTION.componentKey, WritingConfigSection);
}

const ALL_UI_SECTIONS: PluginUISection[] = [WRITING_CONFIG_UI_SECTION];

/** 收集所有插件的 uiSections 元数据（按 order 排序）。 */
export function getPluginUISections(mountPoint: PluginUISection["mountPoint"]): PluginUISection[] {
  ensurePluginSectionsRegistered();
  return ALL_UI_SECTIONS
    .filter((s) => s.mountPoint === mountPoint)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
