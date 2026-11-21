import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BookCover } from "@/components/BookCover";
import { useStyleTheme } from "@/hooks/use-style-theme";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { STYLE_THEMES } from "@/styles/style-themes";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsPage } from "../components/SettingsPage";

/**
 * 每套主题一眼可辨的结构差异，写在外观面板里而不是 style-themes.ts——
 * 那里登记的是产品文案（叫什么、适合什么），这里是给人看形状的图注。
 */
const STRUCTURE_HINTS: Record<string, string> = {
  gaozhi: "方格纸面 · 装订虚线 · 轻影",
  shuhan: "锐角题签 · 顶压线 · 方耳",
  yegeng: "暖烛晕光 · 胶囊 · 漫反射",
  zhusha: "雕版切角 · 朱砂双线 · 方印",
  ruyao: "瓷釉高光 · 玉润圆角 · 上浮",
};

/**
 * 书房主题与明暗：嵌入 Runtime「外观与界面」页的顶部区块（见 novelfork-settings-extension）。
 * OLED、全屏、常亮、动画等 Runtime 已有的开关不在这里重复，它们留在 Runtime 那一份里。
 *
 * 预览卡里的纸面、卡片、控件全部走 .nf-* 辅助类与 --nf-* 令牌，不按主题名写分支：
 * 卡片容器带 data-nf-theme-preview，novelfork-motifs.css 的预览作用域就会把那一套
 * 纹样、圆角、边饰与材质高光就地渲染出来，和真正切换后的界面一致。
 */
export function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  const { styleTheme, setStyleTheme } = useStyleTheme();

  const themes: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "auto", label: "跟随系统", icon: Monitor },
  ];

  return (
    <SettingsPage
      title="书房主题"
      description="选择界面配色与明暗。"
    >
      <SettingsGroup title="书房主题" description="五套差异化书房风格，切换后同步联动配色、字体、圆角、卡片与侧栏材质，均含浅色与深色。">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="书房主题">
          {STYLE_THEMES.map((option) => {
            const selected = styleTheme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`style-theme-${option.id}`}
                data-nf-theme-preview={option.id}
                onClick={() => setStyleTheme(option.id)}
                className={cn(
                  "nf-surface-card flex flex-col gap-3 p-3 text-left text-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "!border-primary ring-1 ring-primary" : "hover:!border-primary/60",
                )}
              >
                {/* 缩略界面：侧栏头 + 稿面纸纹 + 主/次按钮 + 徽章 + 页签，四种材质一次摆出来 */}
                <span aria-hidden="true" className="nf-surface-sub flex flex-col gap-2 p-2">
                  <span className="nf-sidebar-head flex items-center gap-1.5 rounded-[var(--nf-control-radius)] px-1.5 py-1">
                    <span className="nf-sidebar-head-icon block size-3 shrink-0" />
                    <span className="block h-1.5 w-2/5 rounded-[var(--nf-control-radius)] bg-foreground/55" />
                    <span className="nf-tab-pill ml-auto bg-accent px-1.5 py-0.5 text-2xs leading-none text-accent-foreground">
                      {option.tag}
                    </span>
                  </span>
                  <span className="flex items-end gap-2">
                    <BookCover title={option.label} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="nf-preview-paper flex h-9 items-center px-1.5">
                        <span className="block h-1 w-full rounded-[var(--nf-control-radius)] bg-foreground/25" />
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="nf-mini-button inline-flex h-4 items-center px-2 text-2xs leading-none">
                          主色
                        </span>
                        <span className="nf-mini-badge inline-flex h-4 items-center px-1.5 text-2xs leading-none">
                          徽标
                        </span>
                      </span>
                    </span>
                  </span>
                </span>
                <span className="flex flex-col gap-1">
                  <span className="nf-display block text-base">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                  <span className="nf-preview-caption block px-1.5 py-0.5 text-2xs leading-snug">
                    {STRUCTURE_HINTS[option.id] ?? ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="明暗" description="只影响当前设备。">
        <div className="grid gap-2 sm:grid-cols-3">
          {themes.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              type="button"
              variant={theme === value ? "default" : "outline"}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
            >
              <Icon data-icon="inline-start" />
              {label}
            </Button>
          ))}
        </div>
      </SettingsGroup>

    </SettingsPage>
  );
}
