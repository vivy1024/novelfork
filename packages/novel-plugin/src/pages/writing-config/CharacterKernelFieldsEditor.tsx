/**
 * 角色内核字段定义编辑器（自由配置原则的 UI 面）。
 *
 * 字段完全由作品级配置声明：这里只做增删改，不内置任何领域枚举；
 * config.fields 为空数组时引擎回落到 DEFAULT_KERNEL_FIELDS，
 * 因此编辑器初始展示内置默认集，首次改动即固化为显式配置。
 */

import type { CharacterKernelConfig, KernelFieldSpec } from "../../engine/narrative-memory/types";
import { DEFAULT_KERNEL_FIELDS } from "../../engine/narrative-memory/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_LABELS: Readonly<Record<KernelFieldSpec["kind"], string>> = {
  short_text: "短文本",
  long_text: "长文本",
  list: "列表",
};

function normalizeFieldKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]/gu, "_").slice(0, 48);
}

function duplicateKeys(fields: readonly KernelFieldSpec[]): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.key)) duplicated.add(field.key);
    seen.add(field.key);
  }
  return duplicated;
}

export interface CharacterKernelFieldsEditorProps {
  /** 当前生效的字段集（config.fields 为空时传内置默认集）。 */
  readonly fields: readonly KernelFieldSpec[];
  /** 提交整份字段数组；提交前已固化为显式配置。 */
  readonly onChange: (fields: CharacterKernelConfig["fields"]) => void;
}

export function CharacterKernelFieldsEditor({ fields, onChange }: CharacterKernelFieldsEditorProps) {
  const duplicated = duplicateKeys(fields);

  const updateRow = (index: number, patch: Partial<KernelFieldSpec>) => {
    const next = fields.map((field, i) => (i === index ? { ...field, ...patch } : field));
    // 首次编辑即把默认集固化成显式配置，保证"所见即所存"。
    onChange(next);
  };

  const addRow = () => {
    let index = fields.length + 1;
    while (fields.some((field) => field.key === `field_${index}`)) index += 1;
    onChange([...fields, { key: `field_${index}`, label: "新字段", kind: "short_text", llmExtract: true, injectOnWrite: true, injectPriority: 10 }]);
  };

  const removeRow = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  return (
    <div data-slot="kernel-fields-editor" data-testid="kernel-fields-editor" className="space-y-2">      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">字段定义（结算提取与写作注入均按此执行）</p>
        <Button type="button" size="sm" variant="outline" onClick={addRow} data-slot="add-kernel-field">
          <Plus className="mr-1 size-3.5" />添加字段
        </Button>
      </div>
      {fields.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          未定义任何字段：内核将不会生成也不会注入。
        </p>
      )}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[11px] text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">键</th>
              <th className="px-2 py-1.5 font-medium">显示名</th>
              <th className="px-2 py-1.5 font-medium">形态</th>
              <th className="px-2 py-1.5 text-center font-medium">LLM 提取</th>
              <th className="px-2 py-1.5 text-center font-medium">写作注入</th>
              <th className="px-2 py-1.5 text-center font-medium">优先级</th>
              <th className="w-8 px-1 py-1.5"><span className="sr-only">删除</span></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => {
              const invalidKey = field.key.trim().length === 0 || duplicated.has(field.key);
              return (
                <tr key={index} data-slot="kernel-field-row" data-testid="kernel-field-row" className="border-b border-border/60 last:border-b-0">
                  <td className="px-2 py-1.5 align-middle">
                    <Input
                      aria-label={`字段键 ${index + 1}`}
                      value={field.key}
                      onChange={(event) => updateRow(index, { key: normalizeFieldKey(event.target.value) })}
                      className={cn("h-7 w-28 font-mono text-[11px]", invalidKey && "border-destructive")}
                    />
                  </td>
                  <td className="px-2 py-1.5 align-middle">
                    <Input
                      aria-label={`显示名 ${index + 1}`}
                      value={field.label}
                      onChange={(event) => updateRow(index, { label: event.target.value })}
                      className="h-7 w-24"
                    />
                  </td>
                  <td className="px-2 py-1.5 align-middle">
                    <Select value={field.kind} onValueChange={(value) => updateRow(index, { kind: value as KernelFieldSpec["kind"] })}>
                      <SelectTrigger aria-label={`形态 ${index + 1}`} className="h-7 w-20 text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(KIND_LABELS) as readonly KernelFieldSpec["kind"][]).map((kind) => (
                          <SelectItem key={kind} value={kind}>{KIND_LABELS[kind]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5 text-center align-middle">
                    <Switch checked={field.llmExtract} onCheckedChange={(checked) => updateRow(index, { llmExtract: checked })} aria-label={`LLM 提取 ${index + 1}`} />
                  </td>
                  <td className="px-2 py-1.5 text-center align-middle">
                    <Switch checked={field.injectOnWrite} onCheckedChange={(checked) => updateRow(index, { injectOnWrite: checked })} aria-label={`写作注入 ${index + 1}`} />
                  </td>
                  <td className="px-2 py-1.5 text-center align-middle">
                    <Input
                      aria-label={`注入优先级 ${index + 1}`}
                      type="number"
                      min={0}
                      value={field.injectPriority}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isInteger(value) && value >= 0) updateRow(index, { injectPriority: value });
                      }}
                      className="ml-auto h-7 w-16 text-right"
                    />
                  </td>
                  <td className="px-1 py-1.5 text-center align-middle">
                    <Button type="button" size="icon" variant="ghost" onClick={() => removeRow(index)} aria-label={`删除字段 ${field.key || index + 1}`} className="size-6 text-muted-foreground hover:text-destructive">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {duplicated.size > 0 && (
        <p className="text-[11px] text-destructive">存在重复字段键：{[...duplicated].join("、")}。重复键会导致内核取值互相覆盖。</p>
      )}
      <p className="text-[11px] text-muted-foreground">优先级越小越先被预算裁剪；关闭「LLM 提取」的字段仅作者可填，不会被结算覆盖。</p>
    </div>
  );
}

/** config.fields 为空时展示内置默认集；一旦用户改动即转为显式配置。 */
export function effectiveKernelFields(config: CharacterKernelConfig): readonly KernelFieldSpec[] {
  return config.fields.length > 0 ? config.fields : DEFAULT_KERNEL_FIELDS;
}
