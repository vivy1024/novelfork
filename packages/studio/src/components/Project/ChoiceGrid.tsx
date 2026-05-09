import type { ChoiceOption } from "./project-init-options";
import { Button } from "../ui/button";

export function ChoiceGrid<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<ChoiceOption<T>>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="grid gap-2">
      {options.map((option) => (
        <Button
          type="button"
          variant="ghost"
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`h-auto rounded-xl border px-4 py-3 text-left justify-start items-start ${
            value === option.value
              ? "border-primary/40 bg-primary/10"
              : "border-border/60 bg-background hover:border-border"
          }`}
        >
          <div>
            <div className="text-sm font-medium text-foreground">{option.title}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</div>
          </div>
        </Button>
      ))}
    </div>
  );
}
