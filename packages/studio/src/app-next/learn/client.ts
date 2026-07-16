import { fetchJson } from "@/hooks/use-api";

export const LEARNING_LANG = "zh-CN";

export interface LearningAction {
  label: string;
  description: string;
  href: string;
}

export interface LearningDocSummary {
  id: string;
  category: string;
  tags: string[];
  title: string;
  summary: string;
  actions: LearningAction[];
}

export interface LearningCategory {
  id: string;
  label: string;
  description: string;
}

export interface LearningIndex {
  categories: LearningCategory[];
  docs: LearningDocSummary[];
}

export interface LearningDoc extends LearningDocSummary {
  sections: Array<{ title: string; body: string }>;
  workflow: string[];
  bestPractices: string[];
  pitfalls: string[];
  agentHints: string[];
}

export interface LearningCategoryGroup {
  category: LearningCategory;
  docs: LearningDocSummary[];
}

function languageSuffix(lang?: string): string {
  return lang ? `?lang=${encodeURIComponent(lang)}` : "";
}

export const learningClient = {
  getIndex(lang?: string, signal?: AbortSignal): Promise<LearningIndex> {
    return fetchJson<LearningIndex>(`/learning${languageSuffix(lang)}`, signal ? { signal } : undefined);
  },

  getDoc(id: string, lang?: string, signal?: AbortSignal): Promise<LearningDoc> {
    return fetchJson<LearningDoc>(
      `/learning/${encodeURIComponent(id)}${languageSuffix(lang)}`,
      signal ? { signal } : undefined,
    );
  },

  searchDocs(query: string, lang?: string, signal?: AbortSignal): Promise<{ results: LearningDocSummary[] }> {
    const langQuery = lang ? `&lang=${encodeURIComponent(lang)}` : "";
    return fetchJson<{ results: LearningDocSummary[] }>(
      `/learning/search?q=${encodeURIComponent(query)}${langQuery}`,
      signal ? { signal } : undefined,
    );
  },
};

export function filterLearningDocs(docs: LearningDocSummary[], query: string): LearningDocSummary[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return docs;
  return docs.filter((doc) => (
    [doc.title, doc.summary, doc.id, doc.category, ...doc.tags]
      .join("\n")
      .toLowerCase()
      .includes(normalizedQuery)
  ));
}

export function groupLearningDocs(
  categories: LearningCategory[],
  docs: LearningDocSummary[],
): LearningCategoryGroup[] {
  const docsByCategory = new Map<string, LearningDocSummary[]>();
  for (const doc of docs) {
    const grouped = docsByCategory.get(doc.category) ?? [];
    grouped.push(doc);
    docsByCategory.set(doc.category, grouped);
  }

  const knownIds = new Set(categories.map((category) => category.id));
  const groups = categories.map((category) => ({
    category,
    docs: docsByCategory.get(category.id) ?? [],
  }));

  for (const [categoryId, categoryDocs] of docsByCategory) {
    if (!knownIds.has(categoryId)) {
      groups.push({
        category: { id: categoryId, label: categoryId, description: "" },
        docs: categoryDocs,
      });
    }
  }

  return groups.filter((group) => group.docs.length > 0);
}

export function toStudioActionHref(href: string): string {
  if (!href.startsWith("/")) return href;
  if (href === "/settings" || href.startsWith("/settings/")) return `/next${href}`;
  if (href === "/learn" || href.startsWith("/learn?")) return `/next${href}`;
  if (href === "/search" || href.startsWith("/search?")) return `/next${href}`;
  if (href === "/routines" || href.startsWith("/routines/")) return "/next/routines";
  if (href === "/narrators" || href.startsWith("/narrators/")) return "/next/sessions";
  return href;
}
