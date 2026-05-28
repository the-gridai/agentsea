/**
 * Write text to the system clipboard.
 *
 * Prefers the async Clipboard API (the only path that works on a modern
 * secure-context site), then falls back to a hidden-textarea + execCommand
 * path so HTTP previews and older Safari builds still work. Throws if both
 * paths fail so the caller can show "Copy failed".
 */
export async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* fall through */
    }
  }
  if (typeof document === "undefined") {
    throw new Error("clipboard unavailable");
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("execCommand returned false");
  } finally {
    document.body.removeChild(textarea);
  }
}
