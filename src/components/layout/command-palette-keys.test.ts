import test from "node:test";
import assert from "node:assert/strict";
import { resolvePaletteKey, wrapIndex } from "./command-palette-keys";

function ev(partial: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean }>) {
  return { key: partial.key ?? "", metaKey: partial.metaKey ?? false, ctrlKey: partial.ctrlKey ?? false };
}

test("Ctrl+K and Cmd+K toggle the palette from any state", () => {
  assert.deepEqual(resolvePaletteKey(ev({ key: "k", ctrlKey: true }), false), { type: "toggle" });
  assert.deepEqual(resolvePaletteKey(ev({ key: "k", metaKey: true }), true), { type: "toggle" });
});

test("Escape closes the palette only while open", () => {
  assert.deepEqual(resolvePaletteKey(ev({ key: "Escape" }), true), { type: "close" });
  assert.equal(resolvePaletteKey(ev({ key: "Escape" }), false), null);
});

test("arrows and enter only act while open", () => {
  assert.equal(resolvePaletteKey(ev({ key: "ArrowDown" }), false), null);
  assert.deepEqual(resolvePaletteKey(ev({ key: "ArrowDown" }), true), { type: "move", delta: 1, count: 0 });
  assert.deepEqual(resolvePaletteKey(ev({ key: "ArrowUp" }), true), { type: "move", delta: -1, count: 0 });
  assert.deepEqual(resolvePaletteKey(ev({ key: "Enter" }), true), { type: "select" });
});

test("plain K (no modifier) is ignored", () => {
  assert.equal(resolvePaletteKey(ev({ key: "k" }), false), null);
});

test("wrapIndex wraps forward and backward, never negative", () => {
  assert.equal(wrapIndex(2, 1, 4), 3);
  assert.equal(wrapIndex(3, 1, 4), 0);
  assert.equal(wrapIndex(0, -1, 4), 3);
  assert.equal(wrapIndex(0, 1, 0), 0);
  assert.equal(wrapIndex(5, 1, 4), 2);
});