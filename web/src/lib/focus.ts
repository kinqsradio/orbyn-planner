/**
 * Puts focus back on a row after something took it away, such as Undo restoring a deleted item.
 * Rows carry `data-row-id`; the row's own button (its title) gets focus. Waits a tick for the row to be drawn.
 */
export function focusRow(id: string): void {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const target = el.matches("button, input") ? el : (el.querySelector<HTMLElement>(".tt, .what, button") ?? el);
    target.focus();
  }, 0);
}
