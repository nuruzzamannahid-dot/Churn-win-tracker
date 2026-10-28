/* Tests for docs/hive-dates.js.
 *
 *   node test_dates.js
 *
 * The script only sweeps the merchants whose ids are embedded in it, so this
 * fixture reuses two real ids from that list plus one that is deliberately not
 * in it, to prove the filter works.
 *
 * Every case runs under a hard timeout: a loop regression fails the test
 * instead of hanging the process.
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "docs", "hive-dates.js"), "utf8");
const LIMIT = Number((SRC.match(/LIMIT = (\d+)/) || [])[1] || 500);

// two ids that really are in the embedded target list
const needBlock = SRC.match(/var NEED = new Set\(\[([\s\S]*?)\]\);/)[1];
const TARGETS = (needBlock.match(/"(\d+)"/g) || []).map(s => s.replace(/"/g, ""));
const A = TARGETS[0];
const B = TARGETS[1];
const NOT_TARGET = "999999";

function payload(rows) {
  const chunk = JSON.stringify({ orders: rows });
  return "2a:" + chunk + "\n2a:" + chunk;   // flight repeats objects
}

function ordersFor(prefix, total, phone, page, startDay) {
  const start = (page - 1) * LIMIT;
  const n = Math.max(0, Math.min(LIMIT, total - start));
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(Date.UTC(2025, 0, 1 + startDay + ((start + i) % 300)));
    return {
      consignmentId: prefix + (start + i),
      createdAt: day.toISOString(),
      businessPhone: phone,
    };
  });
}

function stub(behaviours) {
  return async (url) => {
    const u = String(url);
    if (u.includes("raw.githubusercontent.com")) {
      const list = [
        [Number(A), "Churn", "Alpha", "8801111111111"],
        [Number(B), "Churn", "Beta", "8802222222222"],
        [Number(NOT_TARGET), "Churn", "NotTarget", "8809999999999"],
      ];
      return { ok: true, status: 200, json: async () => list };
    }
    const q = new URL(u).searchParams;
    const phone = q.get("businessPhone");
    const page = Number(q.get("page") || 1);
    const b = behaviours[phone];
    if (!b) return { ok: true, status: 200, text: async () => payload([]) };
    return { ok: true, status: 200, text: async () => payload(b.serve(page)) };
  };
}

async function run(label, behaviours, expect, timeoutMs = 20000) {
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  global.window = {};
  global.location = { origin: "https://hive.carrybee.com" };
  global.fetch = stub(behaviours);

  const started = Date.now();
  new Function(SRC)();

  let blob = null;
  while (Date.now() - started < timeoutMs) {
    if (global.window.__hiveDatesBlob) { blob = global.window.__hiveDatesBlob; break; }
    await new Promise(r => setTimeout(r, 25));
  }
  console.log = realLog;

  if (!blob) {
    console.log(`FAIL  ${label.padEnd(46)} still running after ${timeoutMs}ms`);
    return false;
  }

  const rows = blob.split(";").map(s => {
    const p = s.split("|");
    return { id: p[0], orders: p[1], days: p[2], first: p[3], last: p[4] };
  });
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));

  const problems = expect(byId, rows, logs);
  if (problems.length) {
    console.log(`FAIL  ${label.padEnd(46)} ${problems.join("; ")}`);
    return false;
  }
  console.log(`ok    ${label.padEnd(46)} ${Math.round(Date.now() - started)}ms`);
  return true;
}

(async () => {
  let pass = 0, fail = 0;
  const t = async (...a) => (await run(...a)) ? pass++ : fail++;

  await t("only targeted merchants are swept", {
    "8801111111111": { serve: p => ordersFor("A", 40, "8801111111111", p, 0) },
    "8802222222222": { serve: p => ordersFor("B", 25, "8802222222222", p, 10) },
    "8809999999999": { serve: p => ordersFor("C", 25, "8809999999999", p, 10) },
  }, (byId, rows) => {
    const bad = [];
    if (rows.length !== 2) bad.push(`${rows.length} rows, want 2`);
    if (byId[NOT_TARGET]) bad.push("swept a merchant that was not a target");
    return bad;
  });

  await t("first/last are min/max of the dates", {
    "8801111111111": { serve: p => ordersFor("A", 40, "8801111111111", p, 0) },
    "8802222222222": { serve: p => ordersFor("B", 25, "8802222222222", p, 10) },
  }, (byId) => {
    const bad = [];
    const a = byId[A];
    if (!a.first || !a.last) bad.push("missing dates");
    if (a.first > a.last) bad.push(`first ${a.first} > last ${a.last}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.first || "")) bad.push(`first not ISO: ${a.first}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.last || "")) bad.push(`last not ISO: ${a.last}`);
    if (a.orders !== "40") bad.push(`orders ${a.orders}`);
    return bad;
  });

  await t("dates span multiple pages", {
    "8801111111111": { serve: p => ordersFor("A", 1200, "8801111111111", p, 0) },
    "8802222222222": { serve: p => ordersFor("B", 10, "8802222222222", p, 0) },
  }, (byId) => {
    const a = byId[A];
    const bad = [];
    if (a.orders !== "1200") bad.push(`orders ${a.orders}`);
    // 1200 orders spread over 300 distinct dates -> 300 active days
    if (a.days !== "300") bad.push(`days ${a.days}`);
    if (!a.first || !a.last || a.first === a.last) bad.push(`dates ${a.first}..${a.last}`);
    return bad;
  });

  await t("filter ignored -> blank row, not a guess", {
    // last 10 digits must differ: the sweep matches on those to tolerate
    // country-code prefixes, so 8811111111111 would still count as a match.
    "8801111111111": { serve: p => ordersFor("X", 900, "8809998887776", p, 0) },
    "8802222222222": { serve: p => ordersFor("B", 10, "8802222222222", p, 0) },
  }, (byId) => {
    const a = byId[A];
    const bad = [];
    if (a.orders !== "") bad.push(`orders ${a.orders} want blank`);
    if (a.first !== "" || a.last !== "") bad.push(`dates ${a.first}..${a.last} want blank`);
    return bad;
  });

  await t("frozen pagination -> blanks, no hang", {
    "8801111111111": { serve: () => ordersFor("F", LIMIT, "8801111111111", 1, 0) },
    "8802222222222": { serve: p => ordersFor("B", 10, "8802222222222", p, 0) },
  }, (byId) => {
    const a = byId[A];
    return a.orders === "" ? [] : [`orders ${a.orders} want blank`];
  });

  await t("markers printed", {
    "8801111111111": { serve: p => ordersFor("A", 10, "8801111111111", p, 0) },
    "8802222222222": { serve: p => ordersFor("B", 10, "8802222222222", p, 0) },
  }, (byId, rows, logs) => {
    const bad = [];
    if (!logs.includes("HIVEDATES1")) bad.push("no HIVEDATES1");
    if (!logs.includes("HIVEDATES0")) bad.push("no HIVEDATES0");
    if (!logs.some(l => /Targets: 2/.test(l))) bad.push("no target count");
    return bad;
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
