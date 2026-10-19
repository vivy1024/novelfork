import { Sparkles } from "lucide-react";

import type { EmbeddedSettingsExtension } from "@vivy1024/narrafork-runtime-bridge/frontend/runtime-page";

import { AboutPanel } from "./panels/AboutPanel";
import { AppearancePanel } from "./panels/AppearancePanel";
import { EmbeddingSettingsPanel } from "./panels/EmbeddingSettingsPanel";

/**
 * 产品设置并入 Runtime 设置页（见 fork 的 settings-host-extension）：
 * - 侧栏「小说」分组：只放 Runtime 没有的小说专属设置（向量模型）；
 * - 外观与界面：书房主题放在 Runtime 原外观页顶部，并隐藏它的插件主题下拉框，配色只认书房主题；
 * - 关于：整页换成 NovelFork 的版本与项目信息（Runtime 构建号仍在其中）；
 * Runtime 已有的（OLED、用户）由 Runtime 原页自己负责，不在这里重复。
 */
export const NOVELFORK_SETTINGS_EXTENSION: EmbeddedSettingsExtension = {
  groups: [
    {
      id: "novel",
      label: "小说",
      pages: [
        {
          id: "embedding",
          label: "向量模型",
          Icon: Sparkles,
          Component: EmbeddingSettingsPanel,
        },
      ],
    },
  ],
  AppearanceSection: AppearancePanel,
  hidePluginThemes: true,
  About: AboutPanel,
};
