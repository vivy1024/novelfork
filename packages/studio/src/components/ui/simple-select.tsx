import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SimpleSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SimpleSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SimpleSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * A simplified wrapper around the shadcn Select (Radix) component.
 * Provides a native-select-like API for easy migration.
 */
export function SimpleSelect({
  value,
  onValueChange,
  options,
  disabled = false,
  placeholder = "请选择",
  className,
  "aria-label": ariaLabel,
}: SimpleSelectProps) {
  return (
    <Select
      value={value || undefined}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger className={cn("w-fit", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
