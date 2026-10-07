import { useEffect } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SimpleSelect } from "@/components/ui/simple-select";
import { BookCover } from "@/components/BookCover";
import { useStyleTheme } from "@/hooks/use-style-theme";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { STYLE_THEMES } from "@/styles/style-themes";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsPage, SettingsSwitchRow } from "../components/SettingsPage";
import { useLocalBooleanPreference, useNarratorMessageRendererMode, useScreenWakeLock } from "../local-preferences";

function SwitchRow({ label, description, checked, disabled, onChange }: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <SettingsSwitchRow
      label={label}
      description={description}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  );
}

/**
 * NovelFork 产品外观：书房主题、明暗与外壳级显示偏好。
 * 通用显示偏好（换行、终端、语言、输入行为等）在 Runtime 原页「通用设置 › 外观与界面」。
 */
export function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  const { styleTheme, setStyleTheme } = useStyleTheme();
  const [oledMode, setOledMode] = useLocalBooleanPreference("narrafork_oled");
  const [fullscreen, setFullscreen] = useLocalBooleanPreference("narrafork_fullscreen");
  const [wakeLock, setWakeLock] = useLocalBooleanPreference("narrafork_wakelock");
  const [advancedAnimation, setAdvancedAnimation] = useLocalBooleanPreference("narrafork_advanced_anim");
  const [rendererMode, setRendererMode] = useNarratorMessageRendererMode();
  useScreenWakeLock(wakeLock);

  useEffect(() => {
    document.documentElement.classList.toggle("oled", oledMode);
    document.documentElement.dataset.advancedAnimation = String(advancedAnimation);
  }, [advancedAnimation, oledMode]);

  function toggleFullscreen(value: boolean) {
    setFullscreen(value);
    if (value) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  }

  const themes: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "auto", label: "跟随系统", icon: Monitor },
  ];

  return (
    <SettingsPage
      title="外观与界面"
      description="书房主题与明暗是 NovelFork 产品外观，嵌入的 Runtime 界面一同切换；其余通用显示偏好在「通用设置 › 外观与界面」。"
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
        <SwitchRow label="OLED 纯黑模式" description="深色主题下使用纯黑背景，适合 OLED 屏幕。" checked={oledMode} onChange={setOledMode} />
      </SettingsGroup>

      <SettingsGroup title="显示" description="调整全屏、动画、消息渲染和屏幕唤醒等显示行为。">
        <SwitchRow label="忽略安全区并全屏" description="请求浏览器全屏并使用完整显示区域。" checked={fullscreen} onChange={toggleFullscreen} />
        <SwitchRow label="保持屏幕唤醒" description="页面可见时通过 Screen Wake Lock 阻止屏幕休眠。" checked={wakeLock} onChange={setWakeLock} />
        <SwitchRow label="高级动画" description="启用更丰富的界面动画效果。" checked={advancedAnimation} onChange={setAdvancedAnimation} />
        <Field orientation="responsive">
          <div>
            <FieldLabel>Narrator 消息渲染器</FieldLabel>
            <FieldDescription>选择 React 或 Pixi 渲染路径。</FieldDescription>
          </div>
          <SimpleSelect
            aria-label="Narrator 消息渲染器"
            value={rendererMode}
            onValueChange={(value) => setRendererMode(value === "pixi" ? "pixi" : "react")}
            options={[{ value: "react", label: "React" }, { value: "pixi", label: "Pixi" }]}
          />
        </Field>
      </SettingsGroup>
    </SettingsPage>
  );
}
