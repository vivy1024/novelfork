import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { JingweiFieldDefinitionView } from "./types";

interface CustomFieldEditorProps {
  fields: JingweiFieldDefinitionView[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

export function CustomFieldEditor({ fields, values, onChange }: CustomFieldEditorProps) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">当前栏目没有自定义字段。</p>;
  }

  const setValue = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {fields.map((field) => (
        <label key={field.id} className="space-y-1 text-sm font-medium">
          {field.label}
          {renderField(field, values[field.key], (value) => setValue(field.key, value))}
          {field.helpText ? <span className="block text-xs font-normal text-muted-foreground">{field.helpText}</span> : null}
        </label>
      ))}
    </div>
  );
}

function renderField(field: JingweiFieldDefinitionView, value: unknown, onChange: (value: unknown) => void) {
  switch (field.type) {
    case "textarea":
      return <Textarea value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
    case "number":
    case "chapter":
      return <Input type="number" value={typeof value === "number" ? value : ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} />;
    case "boolean":
      return <Switch checked={value === true} onCheckedChange={onChange} aria-label={field.label} />;
    case "select":
      return (
        <select value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="">未选择</option>
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    case "multi-select":
    case "tags":
      return <Input value={Array.isArray(value) ? value.join(",") : typeof value === "string" ? value : ""} onChange={(event) => onChange(splitList(event.target.value))} />;
    case "relation":
    case "text":
    default:
      return <Input value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
  }
}

function splitList(value: string): string[] {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}
