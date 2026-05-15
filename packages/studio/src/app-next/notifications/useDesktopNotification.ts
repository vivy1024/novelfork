/**
 * useDesktopNotification — 桌面通知 hook
 *
 * 当浏览器标签不可见时，通过 Notification API 发送桌面通知。
 * 用于叙述者完成任务时提醒用户。
 */

export function useDesktopNotification() {
  const notify = (title: string, body?: string) => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    } else if (Notification.permission !== "denied") {
      void Notification.requestPermission().then((p) => {
        if (p === "granted") new Notification(title, { body, icon: "/favicon.ico" });
      });
    }
  };

  /** 仅在页面不可见时发送通知 */
  const notifyIfHidden = (title: string, body?: string) => {
    if (document.hidden) {
      notify(title, body);
    }
  };

  return { notify, notifyIfHidden };
}
