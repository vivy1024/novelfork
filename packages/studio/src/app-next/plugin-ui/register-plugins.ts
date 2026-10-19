/**
 * 插件 UI 注册引导
 *
 * 在前端启动时把各插件贡献的 UI section 组件注册到 section-registry，
 * 并收集插件的 uiSections 元数据供宿主（套路页「本书设置」）消费。
 *
 * 当前没有插件贡献套路分区：写作配置已并入写作台的本书设置。扩展点保留，供将来的插件使用。
 */
import type { PluginUISection } from "@vivy1024/novelfork-core";

const ALL_UI_SECTIONS: PluginUISection[] = [];

let registered = false;

/** 幂等注册所有插件 section 组件（当前无）。 */
export function ensurePluginSectionsRegistered(): void {
  if (registered) return;
  registered = true;
}

/** 收集所有插件的 uiSections 元数据（按 order 排序）。 */
export function getPluginUISections(mountPoint: PluginUISection["mountPoint"]): PluginUISection[] {
  ensurePluginSectionsRegistered();
  return ALL_UI_SECTIONS
    .filter((s) => s.mountPoint === mountPoint)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
