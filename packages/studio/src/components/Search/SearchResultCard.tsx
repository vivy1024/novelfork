import type { SearchResult } from "../../shared/search-types";
import { FileTextIcon, BookOpenIcon, MessageSquareIcon, FileIcon } from "lucide-react";

interface SearchResultCardProps {
  result: SearchResult;
  selected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

const TYPE_ICONS = {
  chapter: BookOpenIcon,
  setting: FileTextIcon,
  message: MessageSquareIcon,
  file: FileIcon,
};

const TYPE_LABELS = {
  chapter: 'Chapter',
  setting: 'Setting',
  message: 'Message',
  file: 'File',
};

export function SearchResultCard({ result, selected, onClick, onMouseEnter }: SearchResultCardProps) {
  const Icon = TYPE_ICONS[result.type];

  return (
    <div
      className={`px-4 py-3 cursor-pointer transition-colors border-b border-border last:border-b-0 ${
        selected ? 'bg-accent' : 'hover:bg-accent/50'
      }`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Type badge */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground">
              {TYPE_LABELS[result.type]}
            </span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs text-muted-foreground truncate">
              {result.bookId}
            </span>
          </div>

          {/* Title */}
          <div className="font-medium text-sm mb-1 truncate">
            {highlightText(result.title, extractTermsFromHighlights(result.highlights))}
          </div>

          {/* Highlights */}
          {result.highlights.length > 0 && (
            <div className="text-xs text-muted-foreground line-clamp-2">
              {result.highlights[0]}
            </div>
          )}
        </div>

        {/* Score badge (for debugging) */}
        {process.env.NODE_ENV === 'development' && (
          <div className="text-xs text-muted-foreground">
            {result.score}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Extract search terms from highlights
 */
function extractTermsFromHighlights(highlights: string[]): string[] {
  // Simple heuristic: extract words that appear in highlights
  const terms = new Set<string>();
  for (const highlight of highlights) {
    const words = highlight.toLowerCase().match(/\b\w+\b/g) || [];
    words.forEach(w => terms.add(w));
  }
  return Array.from(terms);
}

/**
 * Highlight matching terms in text
 */
function highlightText(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text;

  const regex = new RegExp(`(${terms.join('|')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, i) => {
    const isMatch = terms.some(term => part.toLowerCase() === term.toLowerCase());
    return isMatch ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">
        {part}
      </mark>
    ) : (
      part
    );
  });
}
