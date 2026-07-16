/**
 * Validate a book identifier before it is resolved into a filesystem resource.
 * Runtime binding remains the authority for access; this only rejects unsafe input.
 */
export function isSafeBookId(bookId: string): boolean {
  return (
    typeof bookId === "string"
    && bookId.length > 0
    && bookId.trim() === bookId
    && bookId !== "."
    && bookId !== ".."
    && !bookId.includes("..")
    && !/[\\/\0]/.test(bookId)
  );
}
