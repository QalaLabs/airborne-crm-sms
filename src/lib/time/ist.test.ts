import test from "node:test";
import assert from "node:assert/strict";
import { endOfISTDay, formatInIST, fromISTInput, startOfISTDay, toISTInput } from "./ist";

test("startOfISTDay: 'today' begins at 00:00 IST (18:30 UTC previous day)", () => {
  // 01:00 IST on 28 Sep = 19:30 UTC on 27 Sep — still IST day 28 Sep.
  assert.equal(startOfISTDay(new Date("2026-09-27T19:30:00.000Z")).toISOString(), "2026-09-27T18:30:00.000Z");
  // 23:00 IST on 28 Sep = 17:30 UTC on 28 Sep.
  assert.equal(startOfISTDay(new Date("2026-09-28T17:30:00.000Z")).toISOString(), "2026-09-27T18:30:00.000Z");
});

test("endOfISTDay: last millisecond before the next IST midnight", () => {
  assert.equal(endOfISTDay(new Date("2026-09-28T06:00:00.000Z")).toISOString(), "2026-09-28T18:29:59.999Z");
});

test("toISTInput renders a UTC instant as IST wall-clock (+05:30)", () => {
  assert.equal(toISTInput("2026-09-28T06:19:00.000Z"), "2026-09-28T11:49");
});

test("toISTInput crosses the date boundary at IST midnight", () => {
  assert.equal(toISTInput("2026-09-27T18:30:00.000Z"), "2026-09-28T00:00");
  assert.equal(toISTInput("2026-09-27T18:29:00.000Z"), "2026-09-27T23:59");
});

test("fromISTInput treats the datetime-local value as IST, independent of host TZ", () => {
  assert.equal(fromISTInput("2026-09-28T11:49"), "2026-09-28T06:19:00.000Z");
  assert.equal(fromISTInput("2026-09-28T00:00"), "2026-09-27T18:30:00.000Z");
});

test("IST round trip is lossless (no double conversion)", () => {
  for (const iso of [
    "2026-01-01T00:00:00.000Z",
    "2026-03-29T01:30:00.000Z",
    "2026-10-25T01:30:00.000Z",
    "2026-12-31T18:29:00.000Z",
  ]) {
    assert.equal(fromISTInput(toISTInput(iso)), iso);
  }
});

test("IST has no DST: same offset in January and July", () => {
  assert.equal(toISTInput("2026-01-15T12:00:00.000Z"), "2026-01-15T17:30");
  assert.equal(toISTInput("2026-07-15T12:00:00.000Z"), "2026-07-15T17:30");
});

test("empty / invalid inputs are safe", () => {
  assert.equal(toISTInput(null), "");
  assert.equal(toISTInput(""), "");
  assert.equal(toISTInput("not-a-date"), "");
  assert.equal(formatInIST(null), "-");
  assert.equal(formatInIST("not-a-date"), "-");
});

test("formatInIST shows IST clock time", () => {
  const out = formatInIST("2026-09-28T06:19:00.000Z", { hour: "2-digit", minute: "2-digit", hour12: false });
  assert.equal(out, "11:49");
});
