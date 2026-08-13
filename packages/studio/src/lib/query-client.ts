import { QueryClient } from "@tanstack/react-query";

import { ApiRequestError } from "@/lib/api-client";
import { notify } from "@/lib/notify";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: 2 * 60_000,
      retry: 1,
    },
    mutations: {
      onError: (error) => {
        const status = (error as ApiRequestError)?.status;
        if (status === 401) return;

        notify.error("操作失败", {
          description: error.message || "发生未知错误",
        });
      },
    },
  },
});
