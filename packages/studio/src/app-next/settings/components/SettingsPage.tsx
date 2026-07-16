import type { ReactNode } from "react";
import { RotateCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function SettingsPage({
  title,
  description,
  actions,
  children,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div data-slot="settings-page" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section data-slot="settings-group" className={cn("flex min-w-0 flex-col gap-4", className)} aria-labelledby={`settings-${toDomId(title)}`}>
      <div>
        <h3 id={`settings-${toDomId(title)}`} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <FieldGroup>{children}</FieldGroup>
      <Separator />
    </section>
  );
}

export function SettingsSwitchRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field data-settings-slot="switch-row" orientation="horizontal" data-disabled={disabled || undefined}>
      <FieldContent>
        <FieldTitle>{label}</FieldTitle>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </FieldContent>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </Field>
  );
}

export function SettingsSaveBar({
  dirty,
  saving,
  saveLabel = "保存更改",
  onDiscard,
  onSave,
}: {
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly saveLabel?: string;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
}) {
  if (!dirty) return null;

  return (
    <div data-slot="settings-save-bar" className="sticky bottom-0 -mx-4 mt-2 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <p className="text-sm text-muted-foreground">存在尚未保存的更改</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onDiscard} disabled={saving}>
          <RotateCcw data-icon="inline-start" />
          放弃
        </Button>
        <Button type="button" onClick={onSave} disabled={saving}>
          <Save data-icon="inline-start" />
          {saving ? "保存中…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}

function toDomId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-");
}
