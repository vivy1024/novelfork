const FORBIDDEN_PATH_CHARS = /[/\\\0]/;

export function isSafeBookId(bookId: string): boolean {
  if (!bookId) return false;
  if (bookId.trim() !== bookId) return false;
  if (bookId === "." || bookId === "..") return false;
  if (bookId.includes("..")) return false;
  return !FORBIDDEN_PATH_CHARS.test(bookId);
}
