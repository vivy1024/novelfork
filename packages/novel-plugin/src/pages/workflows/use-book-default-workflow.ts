import { useEffect, useState } from "react";

import { bookApiBase, workflowRequest, type BookDefaultWorkflowView } from "./workflow-api";

/** 读本书默认工作流（写作台、书设置用）；读不到时视为没设置，不打扰作者。 */
export function useBookDefaultWorkflow(bookId: string | null | undefined): BookDefaultWorkflowView | null {
  const [view, setView] = useState<BookDefaultWorkflowView | null>(null);
  useEffect(() => {
    setView(null);
    if (!bookId) return;
    let cancelled = false;
    workflowRequest<BookDefaultWorkflowView>(`${bookApiBase(bookId)}/workflow-default`)
      .then((next) => { if (!cancelled) setView(next); })
      .catch(() => { if (!cancelled) setView(null); });
    return () => { cancelled = true; };
  }, [bookId]);
  return view;
}
