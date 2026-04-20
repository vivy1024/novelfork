import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { SearchResultCard } from "./SearchResultCard";
import type { SearchResult, SearchType } from "../../shared/search-types";
import { XIcon, SearchIcon } from "lucide-react";

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (result: SearchResult) => void;
}

const FILTER_OPTIONS: Array<{ value: SearchType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'chapter', label: 'Chapters' },
  { value: 'setting', label: 'Settings' },
  { value: 'message', label: 'Messages' },
  { value: 'file', label: 'Files' },
];

export function SearchDialog({ open, onClose, onNavigate }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchType>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Perform search
  const performSearch = useCallback(async (searchQuery: string, searchType: SearchType) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, type: searchType }),
      });

      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
        setSelectedIndex(0);
      }
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query, filter);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, filter, performSearch]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        onNavigate(results[selectedIndex]);
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, results, selectedIndex, onClose, onNavigate]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] p-0 gap-0">
        <DialogTitle className="sr-only">Global Search</DialogTitle>

        {/* Search Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <SearchIcon className="w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search chapters, settings, messages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            autoFocus
            data-testid="global-search-input"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded-md transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 px-4 py-2 border-b border-border overflow-x-auto">
          {FILTER_OPTIONS.map(option => (
            <button
              key={option.value}
              onClick={() => setFilter(option.value)}
              className={`px-3 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${
                filter === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent text-accent-foreground hover:bg-accent/80'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="overflow-y-auto max-h-[calc(80vh-140px)]" data-testid="search-results">
          {results.length === 0 && query.trim() && !loading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results found for "{query}"
            </div>
          )}

          {results.length === 0 && !query.trim() && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Start typing to search...
            </div>
          )}

          {results.map((result, index) => (
            <SearchResultCard
              key={result.id}
              result={result}
              selected={index === selectedIndex}
              onClick={() => {
                onNavigate(result);
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            />
          ))}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
