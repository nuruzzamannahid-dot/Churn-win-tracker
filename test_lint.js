/* Static guard: no exec() in a loop condition, anywhere.
 *
 *   node test_lint.js
 *
 * An inline /g regex literal inside a while condition is rebuilt on every
 * iteration, so lastIndex resets to 0 and exec() returns the first match
 * forever. That shipped once and hung a browser tab; this test makes it a
 * build failure instead.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const TARGETS = [
  "docs/hive-min.js",
  "docs/hive-inline.js",
  "docs/hive-sweep.js",
  "docs/hive-orders-pull.js",
  "docs/hive-pull.js",
  "docs/diagnose-pagination.js",
  "make_hive_script.py",
];

// `while (... .exec(...))` or `for (... .exec(...))` in a loop header.
const EXEC_LOOP = /\b(?:while|for)\s*\(.*\.exec\s*\(/;
// Same pattern written inline, e.g. while ((m = /x/g.exec(t)))
const INLINE_LITERAL_LOOP = /\b(?:while|for)\s*\(.*\/[^/\n]*\/[gimsuy]*\.exec\s*\(/;

let pass = 0, fail = 0;

for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log(`FAIL  ${rel} — file missing`);
    fail++;
    continue;
  }
  const src = fs.readFileSync(abs, "utf8");
  const lines = src.split("\n");
  const hits = [];

  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");          // ignore line comments
    if (EXEC_LOOP.test(code) || INLINE_LITERAL_LOOP.test(code)) {
      hits.push(`line ${i + 1}: ${line.trim().slice(0, 90)}`);
    }
  });

  if (hits.length) {
    console.log(`FAIL  ${rel}`);
    hits.forEach(h => console.log(`        ${h}`));
    fail++;
  } else {
    console.log(`ok    ${rel}`);
    pass++;
  }
}

// Positive control: the detector must actually catch the bug.
const BAD = 'while ((m = /"id"\\s*:\\s*"([^"]+)"/g.exec(t))) { }';
if (EXEC_LOOP.test(BAD) && INLINE_LITERAL_LOOP.test(BAD)) {
  console.log("ok    detector catches the known-bad line");
  pass++;
} else {
  console.log("FAIL  detector does not catch the known-bad line");
  fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
