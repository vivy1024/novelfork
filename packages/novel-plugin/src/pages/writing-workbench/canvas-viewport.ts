/**
 * 画布视口记忆：按「作品 + 视图」记住上次的平移与缩放，下次打开回到原处。
 *
 * 只存视口，不存节点坐标——树与泳道的位置都由数据算出，存了反而会和数据对不上。
 * 这是每位读者自己的浏览习惯，放 localStorage 即可；读写失败（隐私模式、存储被禁）时
 * 退回默认视图，不影响画布本身。
 */

export interface SavedViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const PREFIX = "novelfork:canvas-viewport:";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSavedViewport(key: string | undefined): SavedViewport | null {
  if (!key) return null;
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedViewport>;
    const { x, y, zoom } = parsed;
    if (![x, y, zoom].every((value) => typeof value === "number" && Number.isFinite(value)) || zoom! <= 0) return null;
    return { x: x!, y: y!, zoom: zoom! };
  } catch {
    return null;
  }
}

export function saveViewport(key: string | undefined, viewport: SavedViewport): void {
  if (!key) return;
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify({
      x: Math.round(viewport.x),
      y: Math.round(viewport.y),
      zoom: Math.round(viewport.zoom * 1000) / 1000,
    }));
  } catch {
    // 存不下就算了：下次打开用默认视图
  }
}

export function forgetViewport(key: string | undefined): void {
  if (!key) return;
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    // 同上
  }
}
