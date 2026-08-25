import { useEffect, useState } from "react";

/** 输入防抖：值稳定 delayMs 毫秒后才更新，避免每键击触发取数/请求。 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}
