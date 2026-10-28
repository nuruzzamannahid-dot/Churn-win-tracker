/* Checks docs/diagnose-pagination.js under a mocked Hive, in both scenarios. */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "docs", "diagnose-pagination.js"), "utf8");

function pageBody(ids, dayOffset) {
  const orders = ids.map((id, i) => ({
    consignmentId: id,
    createdAt: new Date(Date.UTC(2026, 0, 1 + ((i + dayOffset) % 280))).toISOString(),
  }));
  return "2a:" + JSON.stringify({ orders, meta: { page: 1 } });
}

async function run(label, fetchImpl, expectVerdictIncludes) {
  const logs = [];
  const realLog = console.log, realTable = console.table;
  console.log = (...a) => logs.push(a.join(" "));
  console.table = () => {};
  global.window = {};
  global.location = { origin: "https://hive.carrybee.com" };
  global.fetch = fetchImpl;

  new Function(SRC)();                     // no awaits outside -> returns a promise
  await new Promise(r => setTimeout(r, 60));

  console.log = realLog; console.table = realTable;
  const verdict = logs.find(l => /PAGINATION|INCONCLUSIVE/.test(l)) || "(no verdict)";
  const ok = verdict.includes(expectVerdictIncludes);
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(34)} -> ${verdict.replace(/%c/g, "")}`);
  return ok;
}

(async () => {
  let pass = 0, fail = 0;

  // Scenario A: real pagination. page N serves a different slice.
  const paginating = async (url) => {
    const p = Number(new URL(String(url)).searchParams.get("page") || 1);
    const limit = Number(new URL(String(url)).searchParams.get("limit") || 100);
    const ids = Array.from({ length: limit }, (_, i) => `A${p}_${i}`);
    return { status: 200, text: async () => pageBody(ids, p * 17) };
  };
  (await run("page 2 differs (works)", paginating, "PAGINATION WORKS")) ? pass++ : fail++;

  // Scenario B: frozen. ?page= ignored, same 100 rows every time.
  const frozen = async (url) => {
    const limit = Number(new URL(String(url)).searchParams.get("limit") || 100);
    const ids = Array.from({ length: Math.min(limit, 100) }, (_, i) => `S${i}`);
    return { status: 200, text: async () => pageBody(ids, 0) };
  };
  (await run("page 2 repeats (ignored)", frozen, "PAGINATION IGNORED")) ? pass++ : fail++;

  // Scenario C: limit is honoured -> should also print the limit hint
  const bigLimit = async (url) => {
    const u = new URL(String(url));
    const p = Number(u.searchParams.get("page") || 1);
    const limit = Number(u.searchParams.get("limit") || 100);
    const ids = Array.from({ length: Math.min(limit, 500) }, (_, i) => `L${p}_${i}`);
    return { status: 200, text: async () => pageBody(ids, p * 5) };
  };
  const logs = [];
  const realLog = console.log, realTable = console.table;
  console.log = (...a) => logs.push(a.join(" ")); console.table = () => {};
  global.window = {}; global.location = { origin: "https://hive.carrybee.com" }; global.fetch = bigLimit;
  new Function(SRC)();
  await new Promise(r => setTimeout(r, 60));
  console.log = realLog; console.table = realTable;
  const hinted = logs.some(l => /raising CFG.limit/.test(l));
  console.log(`${hinted ? "ok  " : "FAIL"}  ${"limit=500 honoured".padEnd(34)} -> ${hinted ? "suggests raising the limit" : "no hint printed"}`);
  hinted ? pass++ : fail++;

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
