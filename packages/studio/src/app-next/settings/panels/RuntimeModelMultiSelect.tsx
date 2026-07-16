import { Check, ChevronsUpDown, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface RuntimeModelChoice {
  readonly value: string;
  readonly label: string;
  readonly group: string;
}

interface RuntimeModelMultiSelectProps {
  readonly label: string;
  readonly description?: string;
  readonly value: readonly string[];
  readonly options: readonly RuntimeModelChoice[];
  readonly onChange: (value: string[]) => void;
  readonly placeholder?: string;
}

export function RuntimeModelMultiSelect({
  label,
  description,
  value,
  options,
  onChange,
  placeholder = "不限制",
}: RuntimeModelMultiSelectProps) {
  const selected = new Set(value);
  const labels = new Map(options.map((option) => [option.value, option.label]));
  const groups = new Map<string, RuntimeModelChoice[]>();

  for (const option of options) {
    const items = groups.get(option.group) ?? [];
    items.push(option);
    groups.set(option.group, items);
  }

  function toggle(nextValue: string) {
    onChange(selected.has(nextValue)
      ? value.filter((candidate) => candidate !== nextValue)
      : [...value, nextValue]);
  }

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-8 w-full justify-between whitespace-normal"
            aria-label={label}
          >
            <span className="flex min-w-0 flex-wrap gap-1">
              {value.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : value.map((model) => (
                <Badge key={model} variant="secondary" className="max-w-full">
                  <span className="truncate">{labels.get(model) ?? `${model}（当前配置）`}</span>
                </Badge>
              ))}
            </span>
            <ChevronsUpDown data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))] p-0">
          <Command>
            <CommandInput placeholder="搜索模型…" />
            <CommandList>
              <CommandEmpty>没有匹配的模型。</CommandEmpty>
              {Array.from(groups, ([group, items]) => (
                <CommandGroup key={group} heading={group}>
                  {items.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value}`}
                      data-checked={selected.has(option.value)}
                      onSelect={() => toggle(option.value)}
                    >
                      {selected.has(option.value) ? <Check /> : null}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
          {value.length > 0 ? (
            <div className="flex justify-end border-t p-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
                <X data-icon="inline-start" />
                清空
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </Field>
  );
}
