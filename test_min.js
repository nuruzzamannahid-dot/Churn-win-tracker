/* Adversarial tests for docs/hive-min.js.
 *
 *   node test_min.js
 *
 * Every scenario runs under a hard wall-clock timeout: if a loop regresses, the
 * test fails loudly instead of hanging the process (and, in a browser, the tab).
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "docs", "hive-min.js"), "utf8");
const LIMIT = Number((SRC.match(/LIMIT = (\d+)/) || [])[1] || 500);

function payload(rows) {
  const chunk = JSON.stringify({ orders: rows });
  return "2a:" + chunk + "\n2a:" + chunk;   // flight repeats objects, as observed
}

function ordersFor(prefix, total, phone, page) {
  const start = (page - 1) * LIMIT;
  const n = Math.max(0, Math.min(LIMIT, total - start));
  return Array.from({ length: n }, (_, i) => ({
    consignmentId: prefix + (start + i),
    createdAt: new Date(Date.UTC(2026, 0, 1 + ((start + i) % 180))).toISOString(),
    businessPhone: phone,
  }));
}

/** Build a fetch stub from a per-phone behaviour table. */
function stub(behaviours) {
  return async (url) => {
    const u = String(url);
    if (u.includes("raw.githubusercontent.com")) {
      const list = Object.keys(behaviours).map(k => [k, "Churn", "Biz " + k, k]);
      return { ok: true, status: 200, json: async () => list, text: async () => JSON.stringify(list) };
    }
    const q = new URL(u).searchParams;
    const phone = q.get("businessPhone");
    const page = Number(q.get("page") || 1);
    const b = behaviours[phone];
    if (!b) return { ok: true, status: 200, text: async () => payload([]) };
    if (b.status) return { ok: b.status < 400, status: b.status, text: async () => "" };
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
    if (global.window.__hiveBlob) { blob = global.window.__hiveBlob; break; }
    await new Promise(r => setTimeout(r, 25));
  }
  console.log = realLog;

  if (!blob) {
    console.log(`FAIL  ${label.padEnd(42)} still running after ${timeoutMs}ms — possible infinite loop`);
    return false;
  }

  const got = Object.fromEntries(blob.split(";").map(s => {
    const [id, orders, days] = s.split("|");
    return [id, { orders, days }];
  }));
  const problems = expect(got, logs);
  if (problems.length) {
    console.log(`FAIL  ${label.padEnd(42)} ${problems.join("; ")}`);
    return false;
  }
  console.log(`ok    ${label.padEnd(42)} ${Math.round(Date.now() - started)}ms`);
  return true;
}

(async () => {
  const P = n => "880000000000" + n;
  let pass = 0, fail = 0;
  const t = async (...a) => (await run(...a)) ? pass++ : fail++;

  await t("normal 0/40/262 orders", {
    [P(0)]: { serve: p => ordersFor("Z", 0, P(0), p) },
    [P(1)]: { serve: p => ordersFor("S", 40, P(1), p) },
    [P(2)]: { serve: p => ordersFor("M", 262, P(2), p) },
  }, got => {
    const bad = [];
    if (got[P(0)]?.orders !== "0") bad.push(`zero=${got[P(0)]?.orders} want 0`);
    if (got[P(1)]?.orders !== "40") bad.push(`40=${got[P(1)]?.orders}`);
    if (got[P(2)]?.orders !== "262") bad.push(`262=${got[P(2)]?.orders}`);
    return bad;
  });

  await t("multi-page 1200 orders", {
    [P(3)]: { serve: p => ordersFor("B", 1200, P(3), p) },
  }, got => (got[P(3)]?.orders === "1200" ? [] : [`1200=${got[P(3)]?.orders}`]));

  await t("duplicated flight chunks don't inflate", {
    [P(4)]: { serve: p => ordersFor("D", 250, P(4), p) },
  }, got => (got[P(4)]?.orders === "250" ? [] : [`250=${got[P(4)]?.orders}`]));

  await t("filter ignored -> blank", {
    [P(5)]: { serve: p => ordersFor("X", 900, "8811111111111", p) },
  }, got => (got[P(5)]?.orders === "" ? [] : [`got=${got[P(5)]?.orders} want blank`]));

  await t("frozen pagination -> blanks, no hang", {
    [P(6)]: { serve: () => ordersFor("F", LIMIT, P(6), 1) },
  }, got => (got[P(6)]?.orders === "" ? [] : [`got=${got[P(6)]?.orders} want blank`]));

  await t("429 then success", {
    [P(7)]: { status: 429 },
  }, (got, logs) => (got[P(7)]?.orders === "" ? [] : [`got=${got[P(7)]?.orders}`]), 25000);

  await t("block markers printed", {
    [P(8)]: { serve: p => ordersFor("K", 10, P(8), p) },
  }, (got, logs) => {
    const bad = [];
    if (!logs.includes("HIVEPASTE1")) bad.push("no HIVEPASTE1");
    if (!logs.includes("HIVEPASTE0")) bad.push("no HIVEPASTE0");
    if (!logs.some(l => /Businesses: 1/.test(l))) bad.push("no business count");
    return bad;
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
