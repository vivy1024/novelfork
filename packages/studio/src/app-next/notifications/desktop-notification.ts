/**
 * Desktop Notification — 当用户不在当前标签页时发送桌面通知。
 * 用于：长任务完成、写作提醒、错误通知。
 */

export function requestNotificationPermission(): void {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

export function sendDesktopNotification(title: string, body?: string): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!document.hidden) return; // 用户正在看页面，不需要通知

  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    // Notification constructor may fail in some environments
  }
}
