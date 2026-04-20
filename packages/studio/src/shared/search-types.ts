export type SearchType = "chapter" | "setting" | "message" | "file" | "all";

export interface SearchDocument {
  id: string;
  type: Exclude<SearchType, "all">;
  title: string;
  content: string;
  bookId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResult extends SearchDocument {
  score: number;
  highlights: string[];
}
