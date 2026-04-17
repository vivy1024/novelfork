import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Book, ChevronRight, ChevronDown } from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

interface Nav {
  toBook: (id: string) => void;
}

interface TFunction {
  (key: string): string;
}

export function SortableProjectCard({
  book,
  isExpanded,
  isActive,
  onToggle,
  nav,
  t,
}: {
  book: BookSummary;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: () => void;
  nav: Nav;
  t: TFunction;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: book.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className="w-5 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          onClick={() => nav.toBook(book.id)}
          className={`flex-1 group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-all ${
            isActive
              ? "bg-primary/10 text-primary font-semibold"
              : "text-foreground font-medium hover:bg-secondary/50"
          }`}
          {...attributes}
          {...listeners}
        >
          <Book size={14} className={isActive ? "text-primary" : "text-muted-foreground"} />
          <span className="truncate flex-1 text-left">{book.title}</span>
          {book.chaptersWritten > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {book.chaptersWritten}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
