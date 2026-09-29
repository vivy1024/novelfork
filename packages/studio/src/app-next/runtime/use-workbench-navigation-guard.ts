import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";

/** 工作台提供草稿确认，Studio 在真正改变页面/书籍前等待确认。 */
export function useWorkbenchNavigationGuard(bookId: string) {
  const router = useRouter({ warn: false });
  const beforeLeave = useRef<(() => Promise<boolean>) | null>(null);
  const register = useCallback((guard: (() => Promise<boolean>) | null) => {
    beforeLeave.current = guard;
  }, []);

  useEffect(() => {
    // 独立组件测试没有路由；产品运行时始终由 Studio RouterProvider 托管。
    if (!router) return;
    return router.history.block({
      enableBeforeUnload: false, // 浏览器关闭由正文保存 hook 按实时 dirty 状态处理。
      blockerFn: async ({ currentLocation, nextLocation }) => {
        if (currentLocation.pathname === nextLocation.pathname) return false;
        const guard = beforeLeave.current;
        return guard ? !(await guard()) : false;
      },
    });
  }, [router, bookId]);

  return register;
}
