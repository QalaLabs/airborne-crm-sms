import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalJobHeader, parseClosesAt, parseJobCsv, JOB_IMPORT_TEMPLATE, MAX_JOB_IMPORT_ROWS } from "./job-import";

const NOW = new Date("2026-10-02T06:30:00.000Z");

describe("job CSV headers", () => {
  it("normalizes header spelling", () => {
    assert.equal(canonicalJobHeader("Is Remote"), "is_remote");
    assert.equal(canonicalJobHeader("isRemote"), "is_remote");
    assert.equal(canonicalJobHeader(" job-type "), "job_type");
    assert.equal(canonicalJobHeader("salary"), null);
  });

  it("rejects missing required, unknown and duplicate columns", () => {
    assert.match(parseJobCsv("location,job_type\nDelhi,full_time\n", NOW).fileErrors.join(), /Missing required column "title"/);
    assert.match(parseJobCsv("title,salary\nA,1\n", NOW).fileErrors.join(), /Unknown column\(s\): salary/);
    assert.match(parseJobCsv("title,Title\nA,B\n", NOW).fileErrors.join(), /appears more than once/);
  });

  it("rejects empty, header-only, oversized and malformed files", () => {
    assert.match(parseJobCsv("", NOW).fileErrors.join(), /empty/);
    assert.match(parseJobCsv("title\n", NOW).fileErrors.join(), /no data rows/);
    assert.match(parseJobCsv('title,location\n"Unclosed,Delhi\n', NOW).fileErrors.join(), /Malformed/);
    const many = "title\n" + Array.from({ length: MAX_JOB_IMPORT_ROWS + 1 }, (_, i) => `Job ${i}`).join("\n");
    assert.match(parseJobCsv(many, NOW).fileErrors.join(), /At most 500 rows/);
    assert.match(parseJobCsv("title\nA\uFFFD\n", NOW).fileErrors.join(), /UTF-8/);
  });
});

describe("job CSV rows", () => {
  it("the downloadable template is itself a valid import", () => {
    const r = parseJobCsv(JOB_IMPORT_TEMPLATE, NOW);
    assert.deepEqual(r.fileErrors, []);
    assert.deepEqual(r.issues, []);
    assert.equal(r.rows.length, 1);
    const job = r.rows[0]!.input;
    assert.equal(job.title, "Cabin Crew Trainee");
    assert.equal(job.description, "Join our cabin crew batch, Delhi base.");
    assert.equal(job.salaryMin, 25000);
    assert.deepEqual(job.tags, ["cabin crew", "fresher"]);
    assert.deepEqual(job.metadata, { airline: "IndiGo", applyUrl: "https://careers.example.com/apply/123" });
  });

  it("handles BOM, quotes, embedded commas/newlines, UTF-8 and blank rows", () => {
    const csv =
      "\uFEFFTitle,Location,Description,Salary Min,Is Remote,Job Type\r\n" +
      '"Pilot, ""Senior""",Delhi,"Line one\nLine two",₹1,50,000,yes,Full Time\r\n' +
      "\r\n" +
      ",,,,,\r\n" +
      "प्रशिक्षक (Instructor),मुंबई,,,no,part-time\r\n";
    const r = parseJobCsv(csv, NOW);
    assert.deepEqual(r.fileErrors, []);
    // ₹1,50,000 without quotes splits into extra cells -> reported, not guessed
    assert.equal(r.issues.length, 1);
    assert.equal(r.issues[0]!.rowNumber, 2);
    assert.match(r.issues[0]!.message, /cells but the header has/);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0]!.rowNumber, 5, "blank records still count toward row numbers");
    assert.equal(r.rows[0]!.input.title, "प्रशिक्षक (Instructor)");
    assert.equal(r.rows[0]!.input.jobType, "part_time");
    assert.equal(r.totalRows, 2);

    const quoted = parseJobCsv('title,description,salary_min\n"Pilot, ""Senior""","Line one\nLine two","₹1,50,000"\n', NOW);
    assert.deepEqual(quoted.issues, []);
    assert.equal(quoted.rows[0]!.input.title, 'Pilot, "Senior"');
    assert.equal(quoted.rows[0]!.input.description, "Line one\nLine two");
    assert.equal(quoted.rows[0]!.input.salaryMin, 150000);
  });

  it("reports every invalid field with row number and column", () => {
    const csv =
      "title,job_type,closes_at,apply_url,salary_min,salary_max,is_remote,experience_years,slug,currency\n" +
      "A,freelance,2026-02-30,javascript:alert(1),abc,10,maybe,1.5,Bad Slug!,RUPEES\n";
    const r = parseJobCsv(csv, NOW);
    const cols = r.issues.map((i) => i.column).sort();
    for (const c of ["apply_url", "closes_at", "experience_years", "is_remote", "salary_min"]) assert.ok(cols.includes(c), c);
    assert.ok(r.issues.some((i) => i.column === "job_type"));
    assert.ok(r.issues.some((i) => i.column === "slug"));
    assert.ok(r.issues.some((i) => i.column === "currency"));
    assert.ok(r.issues.every((i) => i.rowNumber === 2));
    assert.equal(r.rows.length, 0);
  });

  it("missing title, past closing date and salary_min > salary_max are errors", () => {
    const r = parseJobCsv("title,closes_at,salary_min,salary_max\n,2026-12-01,,\nB,2026-01-01,,\nC,,500,100\n", NOW);
    assert.equal(r.rows.length, 0);
    assert.ok(r.issues.some((i) => i.rowNumber === 2 && i.column === "title"));
    assert.ok(r.issues.some((i) => i.rowNumber === 3 && /past/.test(i.message)));
    assert.ok(r.issues.some((i) => i.rowNumber === 4 && i.column === "salary_max"));
  });

  it("flags in-file duplicates (title+location+airline, and explicit slug)", () => {
    const r = parseJobCsv(
      "title,location,airline,slug\nCabin Crew,Delhi,IndiGo,\ncabin  crew,delhi,indigo,\nCabin Crew,Mumbai,IndiGo,x-1\nOther,Pune,,x-1\n",
      NOW,
    );
    assert.equal(r.rows.length, 2);
    assert.match(r.issues.find((i) => i.rowNumber === 3)!.message, /Duplicate of row 2/);
    assert.match(r.issues.find((i) => i.rowNumber === 5)!.message, /already used by row 4/);
  });

  it("closes_at date-only means end of that IST day", () => {
    assert.equal(parseClosesAt("2026-12-31"), "2026-12-31T18:29:59.999Z");
    assert.equal(parseClosesAt("31/12/2026"), "2026-12-31T18:29:59.999Z");
    assert.equal(parseClosesAt("2026-12-31T10:00:00+05:30"), "2026-12-31T04:30:00.000Z");
    assert.equal(parseClosesAt("2026-12-31T10:00"), null);
    assert.equal(parseClosesAt("31-02-2026"), null);
  });
});
