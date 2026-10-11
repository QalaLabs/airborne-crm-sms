"use client";

/**
 * Pure keyboard logic for the command palette (N-01).
 *
 * Extracted so the Ctrl/Cmd+K toggle, Escape-to-close and arrow navigation
 * can be unit-tested without a DOM. The component wires results into state.
 */

export type PaletteKeyEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">;

export type PaletteKeyAction =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "move"; delta: -1 | 1; count: number }
  | { type: "select" };

/**
 * Map a raw keydown to an intent.
 * - Ctrl/Cmd+K toggles the palette regardless of open state.
 * - Everything else only applies while the palette is open.
 * Returns null when the event should be ignored.
 */
export function resolvePaletteKey(e: PaletteKeyEvent, open: boolean): PaletteKeyAction | null {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    return { type: "toggle" };
  }
  if (!open) return null;
  switch (e.key) {
    case "Escape":
      return { type: "close" };
    case "ArrowDown":
      return { type: "move", delta: 1, count: 0 };
    case "ArrowUp":
      return { type: "move", delta: -1, count: 0 };
    case "Enter":
      return { type: "select" };
    default:
      return null;
  }
}

/** Move the selection index, wrapping around a list of `count` items. */
export function wrapIndex(index: number, delta: -1 | 1, count: number): number {
  if (count <= 0) return 0;
  return (index + delta + count) % count;
}