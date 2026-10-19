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
      description="NovelFork 的书房主题与明暗，嵌入的 Runtime 界面一同切换。"
    >
      <SettingsGroup title="书房主题" description="整套界面的配色、字体与纹样，叙述者面板等 Runtime 界面一同切换；每套主题都有浅色与深色。只影响当前设备。">
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="书房主题">
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
                  "flex flex-col gap-3 rounded-lg border bg-background p-3 text-left text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60",
                )}
              >
                <div className="flex items-end gap-3">
                  <BookCover title={option.label} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-1">
                    <span className="h-2 w-3/4 rounded-sm bg-foreground/80" />
                    <span className="h-2 w-1/2 rounded-sm bg-muted-foreground/60" />
                    <span className="mt-1 inline-flex h-5 w-14 items-center justify-center rounded-md bg-primary text-2xs text-primary-foreground">主色</span>
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

      <SettingsGroup title="明暗" description="主题设置仅影响当前设备上的显示效果；浏览器本地设置不会写入 Runtime。">
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
