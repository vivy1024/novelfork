import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BookCover } from "@/components/BookCover";
import { useStyleTheme } from "@/hooks/use-style-theme";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { STYLE_THEMES } from "@/styles/style-themes";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsPage } from "../components/SettingsPage";

/**
 * 书房主题与明暗：嵌入 Runtime「外观与界面」页的顶部区块（见 novelfork-settings-extension）。
 * OLED、全屏、常亮、动画等 Runtime 已有的开关不在这里重复，它们留在 Runtime 那一份里。
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
                <div className="flex items-end gap-3">
                  <BookCover title={option.label} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-3/5 rounded-[var(--nf-control-radius)] bg-foreground/80" />
                      <span className="nf-tab-pill bg-accent px-1.5 py-0.5 text-2xs leading-none text-accent-foreground">
                        {option.tag}
                      </span>
                    </div>
                    <span className="h-2 w-1/2 rounded-[var(--nf-control-radius)] bg-muted-foreground/55" />
                    <div className="mt-1 flex items-center gap-1.5">
                      <span
                        className="inline-flex h-5 w-14 items-center justify-center rounded-[var(--nf-control-radius)] text-2xs text-primary-foreground"
                        style={{ background: "var(--nf-btn-primary-bg)" }}
                      >
                        主色
                      </span>
                      <span className="inline-flex h-5 items-center rounded-[var(--nf-badge-radius)] border border-border bg-secondary px-1.5 text-2xs text-secondary-foreground">
                        徽标
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="nf-display text-base">{option.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
                </div>
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
