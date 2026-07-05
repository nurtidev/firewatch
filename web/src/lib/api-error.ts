/** Normalize a FastAPI error body into a display string. `detail` is usually a
 *  plain string, but Pydantic validation errors send an array of `{msg, ...}`
 *  objects instead — join those into one line. Falls back to `fallback` (or
 *  undefined) when `detail` is missing or in some other shape. */
export function apiErrorText(detail: unknown, fallback?: string): string | undefined {
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    const msg = detail
      .map((e) => (e && typeof e === "object" && "msg" in e ? String((e as { msg: unknown }).msg) : String(e)))
      .join("; ");
    if (msg) return msg;
  }
  return fallback;
}
