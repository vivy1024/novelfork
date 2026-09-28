import { cn } from "@/lib/utils";

/** 竖排题签放得下的字数；更长的书名在题签上截断，完整书名由调用方另行显示。 */
const COVER_TITLE_LENGTH = 6;

export function coverTitle(title: string): string {
  const trimmed = title.trim().replace(/^《(.*)》$/u, "$1");
  return [...trimmed].slice(0, COVER_TITLE_LENGTH).join("");
}

export interface BookCoverProps {
  readonly title: string;
  /** md：书架；xs：侧栏书目前的小图标（只留轮廓与题签条）。 */
  readonly size?: "xs" | "md";
  readonly className?: string;
}

/**
 * 书封：按当前书房主题呈现（格纸、藏青函套加题签、暖纸烛光），样式全部来自主题变量，
 * 见 styles/novelfork-motifs.css。纯装饰，不承载可读信息。
 */
export function BookCover({ title, size = "md", className }: BookCoverProps) {
  return (
    <span aria-hidden="true" className={cn("nf-book-cover", className)} data-size={size} data-testid="book-cover">
      {/* 题签文字由 CSS 从 data-title 画出，不进入页面文本，免得书名在朗读、查找里重复出现。 */}
      <span className="nf-book-cover__slip" data-title={size === "xs" ? "" : coverTitle(title)} />
    </span>
  );
}
