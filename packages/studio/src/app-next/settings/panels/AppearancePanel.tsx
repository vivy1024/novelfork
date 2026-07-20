import { useEffect, useMemo, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import type { Locale } from "@vivy1024/novelfork-core/i18n";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { SettingsGroup, SettingsPage, SettingsSwitchRow } from "../components/SettingsPage";
import { useLocalBooleanPreference, useNarratorMessageRendererMode, useScreenWakeLock } from "../local-preferences";
import { publishRuntimeLocale } from "../../runtime/locale";
import {
  createUserPreferencesClient,
  type RuntimeUserPreferences,
  type UserPreferencesPatch,
} from "../../runtime-admin";

const preferencesClient = createUserPreferencesClient();

const TERMINAL_THEME_OPTIONS = [
  { value: "auto", label: "跟随界面" },
  { value: "tokyoNight", label: "Tokyo Night" },
  { value: "tokyoNightLight", label: "Tokyo Night Light" },
  { value: "catppuccin", label: "Catppuccin Mocha" },
  { value: "dracula", label: "Dracula" },
  { value: "nord", label: "Nord" },
  { value: "solarized", label: "Solarized Dark" },
] as const;

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

export function AppearancePanel() {
  const [preferences, setPreferences] = useState<RuntimeUserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [localFontSize, setLocalFontSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
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

  useEffect(() => {
    let active = true;
    preferencesClient.get()
      .then((data) => {
        if (active) setPreferences(data);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function savePreference<K extends keyof UserPreferencesPatch>(key: K, value: UserPreferencesPatch[K]) {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, [key]: value });
    setSavingField(String(key));
    setError(null);
    try {
      const updated = await preferencesClient.patch({ [key]: value } as UserPreferencesPatch);
      setPreferences(updated);
      if (key === "language") publishRuntimeLocale(updated.language);
    } catch (reason) {
      setPreferences(previous);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingField(null);
    }
  }

  function toggleFullscreen(value: boolean) {
    setFullscreen(value);
    if (value) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  }

  const terminalThemeOptions = useMemo(() => {
    if (!preferences || TERMINAL_THEME_OPTIONS.some((option) => option.value === preferences.terminalTheme)) {
      return [...TERMINAL_THEME_OPTIONS];
    }
    return [
      { value: preferences.terminalTheme, label: `${preferences.terminalTheme}（当前历史值）` },
      ...TERMINAL_THEME_OPTIONS,
    ];
  }, [preferences]);

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取显示偏好…</p>;

  const themes: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "auto", label: "跟随系统", icon: Monitor },
  ];

  return (
    <SettingsPage
      title="外观与界面"
      description="管理主题、排版、终端和输入行为等界面偏好。"
    >
      {error ? (
        <Alert>
          <AlertTitle>偏好保存失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsGroup title="主题" description="主题设置仅影响当前设备上的显示效果。">
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

      {preferences ? (
        <>
          <SettingsGroup title="自动换行" description="控制 Markdown、代码和差异视图中的长行展示。">
            <SwitchRow label="Markdown 自动换行" description="长段落在阅读区域内自动换行。" checked={preferences.wordWrapMarkdown} onChange={(value) => void savePreference("wordWrapMarkdown", value)} />
            <SwitchRow label="代码自动换行" description="代码块超出宽度时自动折行。" checked={preferences.wordWrapCode} onChange={(value) => void savePreference("wordWrapCode", value)} />
            <SwitchRow label="Diff 自动换行" description="差异视图中的长行自动折行。" checked={preferences.wordWrapDiff} onChange={(value) => void savePreference("wordWrapDiff", value)} />
          </SettingsGroup>

          <SettingsGroup title="最近标签" description="控制子代理会话是否显示在最近访问列表中。">
            <SwitchRow label="将子代理加入最近标签" description="子代理会话也显示在最近访问列表中。" checked={preferences.addSubagentToRecentTabs ?? true} onChange={(value) => void savePreference("addSubagentToRecentTabs", value)} />
          </SettingsGroup>

          <SettingsGroup title="终端" description="选择终端主题并调整 8–32 像素字号。">
            <Field orientation="responsive">
              <FieldLabel>终端主题</FieldLabel>
              <SimpleSelect
                aria-label="终端主题"
                value={preferences.terminalTheme}
                onValueChange={(value) => void savePreference("terminalTheme", value)}
                options={terminalThemeOptions}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="terminal-font-size">终端字号</FieldLabel>
              <Input
                id="terminal-font-size"
                aria-label="终端字号"
                type="range"
                min={8}
                max={32}
                step={1}
                value={localFontSize ?? preferences.terminalFontSize}
                onChange={(event) => setLocalFontSize(Number(event.currentTarget.value))}
                onPointerUp={(event) => {
                  const value = Number(event.currentTarget.value);
                  setLocalFontSize(null);
                  void savePreference("terminalFontSize", value);
                }}
                onKeyUp={(event) => {
                  const value = Number(event.currentTarget.value);
                  setLocalFontSize(null);
                  void savePreference("terminalFontSize", value);
                }}
              />
              <FieldDescription>当前 {localFontSize ?? preferences.terminalFontSize}px</FieldDescription>
            </Field>
          </SettingsGroup>

          <SettingsGroup title="语言" description="选择 NovelFork 的界面语言。">
            <Field orientation="responsive">
              <FieldLabel>界面语言</FieldLabel>
              <SimpleSelect
                aria-label="界面语言"
                value={preferences.language}
                onValueChange={(value) => void savePreference("language", value as Locale)}
                options={[
                  { value: "zh-CN", label: "简体中文" },
                  { value: "en", label: "English" },
                ]}
              />
            </Field>
          </SettingsGroup>

          <SettingsGroup title="输入" description="Shift+Enter 始终插入换行；下列选项控制 Enter 与 Ctrl/Cmd+Enter。">
            <Field orientation="responsive">
              <div>
                <FieldLabel>Enter 键行为</FieldLabel>
                <FieldDescription>选择在当前轮次、当前工具调用后发送，或立即中断。</FieldDescription>
              </div>
              <SimpleSelect aria-label="Enter 键行为" value={preferences.enterQueueMode ?? "turn"} onValueChange={(value) => void savePreference("enterQueueMode", value as "turn" | "tool" | "interrupt")} options={[{ value: "turn", label: "当前轮次后" }, { value: "tool", label: "当前工具后" }, { value: "interrupt", label: "立即中断" }]} />
            </Field>
            <Field orientation="responsive">
              <FieldLabel>Ctrl+Enter 键行为</FieldLabel>
              <SimpleSelect aria-label="Ctrl+Enter 键行为" value={preferences.ctrlEnterQueueMode ?? "tool"} onValueChange={(value) => void savePreference("ctrlEnterQueueMode", value as "turn" | "tool" | "interrupt")} options={[{ value: "turn", label: "当前轮次后" }, { value: "tool", label: "当前工具后" }, { value: "interrupt", label: "立即中断" }]} />
            </Field>
          </SettingsGroup>
        </>
      ) : null}

      {savingField ? <p className="text-xs text-muted-foreground">正在保存 {savingField}…</p> : null}
    </SettingsPage>
  );
}
