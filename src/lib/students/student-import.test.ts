import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_STUDENT_IMPORT_ROWS,
  STUDENT_IMPORT_TEMPLATE,
  looksLikeFormula,
  parseBirthDate,
  parseStudentCsv,
} from "@/lib/students/student-import";
import { allocateStudentCodes } from "@/lib/services/student-import.service";

const NOW = new Date("2026-10-02T00:00:00Z");
const HEADER = "first_name,last_name,email,phone";

function rows(n: number, offset = 0): string {
  return Array.from({ length: n }, (_, i) => `Stu${i + offset},Dent,stu${i + offset}@example.com,98765${String(10000 + i + offset).slice(-5)}`).join("\n");
}

test("A1: 1 valid row parses with no issues", () => {
  const r = parseStudentCsv(`${HEADER}\nAsha,Rao,ASHA@Example.com,+91 98765 43210`, NOW);
  assert.deepEqual(r.fileErrors, []);
  assert.deepEqual(r.issues, []);
  assert.equal(r.totalRows, 1);
  assert.equal(r.rows[0]!.input.email, "asha@example.com");
  assert.equal(r.rows[0]!.input.phone, "+919876543210");
  assert.equal(r.rows[0]!.rowNumber, 2);
});

test("A1: exactly 150 rows accepted; header not counted", () => {
  const r = parseStudentCsv(`${HEADER}\n${rows(MAX_STUDENT_IMPORT_ROWS)}`, NOW);
  assert.deepEqual(r.fileErrors, []);
  assert.equal(r.totalRows, 150);
  assert.equal(r.rows.length, 150);
});

test("A1: 151 rows rejected as a file error with no rows normalized", () => {
  const r = parseStudentCsv(`${HEADER}\n${rows(151)}`, NOW);
  assert.equal(r.totalRows, 151);
  assert.equal(r.rows.length, 0);
  assert.match(r.fileErrors.join(" "), /151 student rows; the limit is 150/);
});

test("A1: blank trailing lines do not count toward the limit", () => {
  const r = parseStudentCsv(`${HEADER}\n${rows(150)}\n\n\n`, NOW);
  assert.deepEqual(r.fileErrors, []);
  assert.equal(r.totalRows, 150);
});

test("A1: missing required headers", () => {
  const r = parseStudentCsv("first_name,email\nA,a@example.com", NOW);
  assert.ok(r.fileErrors.includes('Missing required column "last_name"'));
  assert.ok(r.fileErrors.includes('Missing required column "phone"'));
});

test("A1: empty file and header-only file", () => {
  assert.match(parseStudentCsv("", NOW).fileErrors[0]!, /empty/);
  assert.match(parseStudentCsv(`${HEADER}\n`, NOW).fileErrors[0]!, /no student rows/);
});

test("A1: malformed CSV (unterminated quote) rejected", () => {
  const r = parseStudentCsv(`${HEADER}\n"Asha,Rao,a@example.com,9876543210`, NOW);
  assert.match(r.fileErrors[0]!, /quoted cell is never closed/);
});

test("A1: unknown, duplicate and org columns are file errors (no cross-org import)", () => {
  const r = parseStudentCsv(`${HEADER},org_id,email,favourite_colour\nA,B,a@example.com,9876543210,x,a@example.com,red`, NOW);
  assert.ok(r.fileErrors.some((e) => /org_id.*own organization/.test(e)));
  assert.ok(r.fileErrors.some((e) => /"email" appears more than once/.test(e)));
  assert.ok(r.fileErrors.some((e) => /Unknown column\(s\): favourite_colour/.test(e)));
});

test("A1: invalid data produces row-level issues with row numbers", () => {
  const r = parseStudentCsv(`${HEADER},date_of_birth\nA,B,not-an-email,12,2099-01-01\n,B,b@example.com,9876543210,`, NOW);
  const byRow = (n: number) => r.issues.filter((i) => i.rowNumber === n).map((i) => i.column);
  assert.ok(byRow(2).includes("email"));
  assert.ok(byRow(2).includes("phone"));
  assert.ok(byRow(2).includes("date_of_birth"));
  assert.ok(byRow(3).includes("first_name"));
  assert.equal(r.rows.length, 0);
});

test("A1: in-file duplicate email flagged on the later row", () => {
  const r = parseStudentCsv(`${HEADER}\nA,B,dup@example.com,9876543210\nC,D,DUP@example.com,9876543211`, NOW);
  assert.equal(r.rows.length, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]!.rowNumber, 3);
  assert.match(r.issues[0]!.message, /Duplicate of row 2/);
});

test("A1: mixed valid + invalid rows are both reported", () => {
  const r = parseStudentCsv(`${HEADER}\nA,B,a@example.com,9876543210\nC,D,bad,9876543211\nE,F,e@example.com,9876543212`, NOW);
  assert.equal(r.rows.length, 2);
  assert.deepEqual([...new Set(r.issues.map((i) => i.rowNumber))], [3]);
});

test("A1: quoted commas and embedded newlines are handled safely", () => {
  const r = parseStudentCsv(`${HEADER},address_line1\nA,B,a@example.com,9876543210,"Flat 4, ""Sky"" Tower\nMG Road"`, NOW);
  assert.deepEqual(r.fileErrors, []);
  assert.deepEqual(r.issues, []);
  assert.equal(r.rows[0]!.input.address?.line1, 'Flat 4, "Sky" Tower\nMG Road');
});

test("A1: unquoted comma (row wider than header) is a row error", () => {
  const r = parseStudentCsv(`${HEADER}\nA,B,a@example.com,9876543210,extra`, NOW);
  assert.match(r.issues[0]!.message, /cells but the header has 4/);
});

test("A1: formula-injection cells are rejected", () => {
  for (const v of ["=HYPERLINK(\"x\")", "@SUM(A1)", "+cmd", "-cmd|' /C calc'!A0", "\tx"]) assert.equal(looksLikeFormula(v), true, v);
  for (const v of ["+919876543210", "-5", "Asha", "O'Neil"]) assert.equal(looksLikeFormula(v), false, v);
  const r = parseStudentCsv(`${HEADER}\n=cmd(),B,a@example.com,9876543210`, NOW);
  assert.ok(r.issues.some((i) => i.column === "first_name" && /must not start with/.test(i.message)));
  assert.equal(r.rows.length, 0);
});

test("A1: header aliases, BOM and semicolon delimiter", () => {
  const r = parseStudentCsv(`\uFEFFFirst Name;Last Name;Email;Mobile\nA;B;a@example.com;9876543210`, NOW);
  assert.deepEqual(r.fileErrors, []);
  assert.equal(r.rows.length, 1);
});

test("A1: birth date formats", () => {
  assert.equal(parseBirthDate("2004-05-06"), "2004-05-06T00:00:00.000Z");
  assert.equal(parseBirthDate("06-05-2004"), "2004-05-06T00:00:00.000Z");
  assert.equal(parseBirthDate("2004-02-30"), null);
});

test("A1: template parses cleanly", () => {
  const r = parseStudentCsv(STUDENT_IMPORT_TEMPLATE, NOW);
  assert.deepEqual(r.fileErrors, []);
  assert.deepEqual(r.issues, []);
});

test("A1: oversized and non-UTF8 input rejected", () => {
  assert.match(parseStudentCsv(`${HEADER}\n${"x".repeat(520_000)}`, NOW).fileErrors[0]!, /larger than/);
  assert.match(parseStudentCsv(`${HEADER}\nA\uFFFD,B,a@example.com,9876543210`, NOW).fileErrors[0]!, /UTF-8/);
});

test("A1: code allocation skips taken codes and is sequential", () => {
  const codes = allocateStudentCodes(2026, 3, 3, new Set(["AAA-2026-0005"]));
  assert.deepEqual(codes, ["AAA-2026-0004", "AAA-2026-0006", "AAA-2026-0007"]);
});
