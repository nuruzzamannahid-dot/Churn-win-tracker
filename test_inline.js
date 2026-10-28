/* Mocked test for docs/hive-inline.js — the single-file console sweep.
 *
 *   node test_inline.js
 *
 * Guards against the bug that shipped in chat: a `/g` regex created inside a
 * while condition resets lastIndex every iteration and loops forever. The test
 * runs with a hard timeout so a regression fails loudly instead of hanging.
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "docs", "hive-inline.js"), "utf8");

const BIZ = [
  ["1", "Churn", "Zero Co", "8801111111111"],     // 0 orders
  ["2", "Churn", "Small Co", "8802222222222"],    // 40 orders (short page)
  ["3", "Inactive", "Mid Co", "8803333333333"],   // 262 orders (short page at 500)
  ["4", "Inactive", "Big Co", "8804444444444"],   // 1200 orders (needs 3 pages)
  ["5", "Churn", "Ghost Co", "8805555555555"],    // server ignores the filter
];
const TOTALS = { "1": 0, "2": 40, "3": 262, "4": 1200, "5": 2500, "9": 2500 };

const LIMIT = Number((SRC.match(/LIMIT = (\d+)/) || [])[1] || 500);

function orderPayload(entry, page) {
  const total = TOTALS[entry[0]] ?? 0;
  const start = (page - 1) * LIMIT;
  const n = Math.max(0, Math.min(LIMIT, total - start));
  const orders = [];
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    orders.push({
      consignmentId: "O" + entry[0] + "_" + idx,
      createdAt: new Date(Date.UTC(2026, 0, 1 + (idx % 200))).toISOString(),
      businessPhone: entry[3],
    });
  }
  const chunk = JSON.stringify({ orders });
  // flight repeats the same object twice, as observed on the real site
  return "2a:" + chunk + "\n2a:" + chunk;
}

function makeFetch() {
  return async (url) => {
    const u = String(url);
    if (u.includes("raw.githubusercontent.com")) {
      return { ok: true, status: 200, json: async () => BIZ, text: async () => JSON.stringify(BIZ) };
    }
    const q = new URL(u).searchParams;
    const phone = q.get("businessPhone");
    const page = Number(q.get("page") || 1);
    const entry = BIZ.find(b => b[3] === phone || b[3].slice(-10) === phone.slice(-10));
    if (!entry) return { ok: true, status: 200, text: async () => '2a:{"orders":[]}' };

    // Ghost Co: server ignores businessPhone and serves the whole population,
    // whose rows carry someone else's phone -> must be left blank.
    if (entry[0] === "5") {
      const body = orderPayload(["9", "", "", "8809999999999"], page);
      return { ok: true, status: 200, text: async () => body };
    }
    return { ok: true, status: 200, text: async () => orderPayload(entry, page) };
  };
}

(async () => {
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => logs.push(a.join(" "));

  global.window = {};
  global.location = { origin: "https://hive.carrybee.com" };
  global.fetch = makeFetch();

  new Function(SRC)();

  const deadline = Date.now() + 20000;
  while (!global.window.__hiveBlob && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 40));
  }
  console.log = realLog;

  if (!global.window.__hiveBlob) {
    console.log("FAIL  sweep never finished within 20s — possible infinite loop");
    process.exit(1);
  }

  const entries = Object.fromEntries(
    global.window.__hiveBlob.split(";").map(s => {
      const [id, orders, days] = s.split("|");
      return [id, { orders, days }];
    })
  );

  let pass = 0, fail = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? "ok  " : "FAIL") + "  " + name.padEnd(44) + ` got=${JSON.stringify(got)}` +
                (ok ? "" : ` want=${JSON.stringify(want)}`));
    ok ? pass++ : fail++;
  };

  check("entries produced", Object.keys(entries).length, BIZ.length);
  check("0 orders -> 0", entries["1"].orders, "0");
  check("40 orders -> 40", entries["2"].orders, "40");
  check("262 orders -> 262", entries["3"].orders, "262");
  check("1200 orders -> 1200 (3 pages)", entries["4"].orders, "1200");
  check("filter ignored -> blank", entries["5"].orders, "");
  check("flight duplication did not inflate 262", entries["3"].orders === "524", false);
  check("distinct days populated", Number(entries["3"].days) > 0, true);
  check("paste block printed", logs.some(l => l === "HIVEPASTE1"), true);
  check("paste block closed", logs.some(l => l === "HIVEPASTE0"), true);
  check("closing summary printed", logs.some(l => /5 merchants/.test(l)), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
