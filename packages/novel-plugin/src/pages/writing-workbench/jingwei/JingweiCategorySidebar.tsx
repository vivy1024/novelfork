import {
  Users,
  Calendar,
  Globe,
  Zap,
  Map,
  Shield,
  Package,
  Flame,
  Coins,
  Star,
  FileText,
  Heart,
  Eye,
  GitBranch,
  Clock,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_SCHEMAS, type CategorySchema } from "./category-schemas";

interface JingweiCategorySidebarProps {
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  entryCounts: Record<string, number>;
}

const ICON_MAP: Record<string, LucideIcon> = {
  "user": Users,
  "calendar": Calendar,
  "globe": Globe,
  "zap": Zap,
  "map": Map,
  "shield": Shield,
  "package": Package,
  "flame": Flame,
  "coins": Coins,
  "sparkles": Star,
  "list-tree": FileText,
  "heart-handshake": Heart,
  "eye": Eye,
  "git-branch": GitBranch,
  "clock": Clock,
  "file-text": BookOpen,
};

function getCategoryIcon(schema: CategorySchema): LucideIcon {
  return ICON_MAP[schema.icon] ?? Star;
}

export function JingweiCategorySidebar({ selectedCategory, onSelectCategory, entryCounts }: JingweiCategorySidebarProps) {
  return (
    <nav className="w-48 shrink-0 border-r border-border overflow-y-auto py-2 px-1" aria-label="经纬分类">
      <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">分类</p>
      <ul className="space-y-0.5">
        {CATEGORY_SCHEMAS.map((schema) => {
          const Icon = getCategoryIcon(schema);
          const count = entryCounts[schema.id] ?? 0;
          const active = selectedCategory === schema.id;
          return (
            <li key={schema.id}>
              <button
                type="button"
                onClick={() => onSelectCategory(schema.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="flex-1 truncate">{schema.name}</span>
                {count > 0 && (
                  <span className={`text-[10px] tabular-nums ${active ? "text-primary" : "text-muted-foreground"}`}>
                    {count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
