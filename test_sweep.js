/* Mocked end-to-end test for docs/hive-sweep.js.
 *
 *   node test_sweep.js
 *
 * Stubs the GitHub business-list fetch and a Hive /orders route with a known
 * number of orders per business, then checks the CSV the sweep produces.
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "docs", "hive-sweep.js"), "utf8");

// four merchants: 0, 40, 262 (needs paging at limit=500? no), 1200 (needs 3 pages)
const TOTALS = { "1": 0, "2": 40, "3": 262, "4": 1200 };
const BIZ = [
  ["1", "Churn", "Zero Co", "8801111111111"],
  ["2", "Churn", "Small Co", "8802222222222"],
  ["3", "Inactive", "Mid Co", "8803333333333"],
  ["4", "Inactive", "Big Co", "8804444444444"],
];

let requests = 0;

function makeFetch() {
  return async (url, opts) => {
    const u = String(url);

    if (u.includes("raw.githubusercontent.com")) {
      return { ok: true, status: 200, json: async () => BIZ, text: async () => JSON.stringify(BIZ) };
    }

    requests++;
    const q = new URL(u).searchParams;
    const phone = q.get("businessPhone");
    const page = Number(q.get("page") || 1);
    const limit = Number(q.get("limit") || 100);
    const entry = BIZ.find(b => b[3] === phone || b[3].slice(-10) === phone.slice(-10));
    if (!entry) return { ok: true, status: 200, text: async () => "2a:{}" };

    const total = TOTALS[entry[0]] ?? 0;
    const start = (page - 1) * limit;
    const n = Math.max(0, Math.min(limit, total - start));
    const orders = [];
    for (let i = 0; i < n; i++) {
      const idx = start + i;
      orders.push({
        consignmentId: "O" + entry[0] + "_" + idx,
        createdAt: new Date(Date.UTC(2026, 0, 1 + (idx % 200))).toISOString(),
        businessPhone: entry[3],
      });
    }
    const body = "2a:" + JSON.stringify({ orders }) + "\n2a:" + JSON.stringify({ orders });
    return { ok: true, status: 200, text: async () => body };
  };
}

(async () => {
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => logs.push(a.join(" "));

  let downloaded = null;
  global.window = {};
  global.location = { origin: "https://hive.carrybee.com" };
  global.fetch = makeFetch();
  global.Blob = class { constructor(parts) { downloaded = parts.join(""); } };
  global.URL.createObjectURL = () => "blob:mock";
  global.URL.revokeObjectURL = () => {};
  global.document = {
    createElement: () => ({ click() {}, set href(v) {}, set download(v) {} }),
    body: { appendChild() {}, removeChild() {} },
  };

  new Function(SRC)();
  // wait for the sweep to publish its rows (it runs asynchronously)
  const deadline = Date.now() + 15000;
  while (!global.window.__hiveRows && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50));
  }
  console.log = realLog;

  const rows = global.window.__hiveRows || [];
  let pass = 0, fail = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? "ok  " : "FAIL") + "  " + name.padEnd(38) + ` got=${JSON.stringify(got)}` +
                (ok ? "" : ` want=${JSON.stringify(want)}`));
    ok ? pass++ : fail++;
  };

  check("rows produced", rows.length, 4);
  check("0 orders -> 0", rows[0].orders, 0);
  check("40 orders -> 40", rows[1].orders, 40);
  check("262 orders -> 262", rows[2].orders, 262);
  check("1200 orders -> 1200 (paginated)", rows[3].orders, 1200);
  check("first date populated", /^\d{4}-\d{2}-\d{2}$/.test(rows[2].first), true);
  check("distinct days populated", rows[2].days > 0, true);
  check("CSV has 5 lines (header + 4)", downloaded.trim().split("\r\n").length, 5);
  check("CSV header", downloaded.split("\r\n")[0].replace("\ufeff", ""),
        "Business ID,Business Name,Phone,Total Orders,First Order Date,Last Order Date,Distinct Order Days");
  check("CSV row for Mid Co", downloaded.split("\r\n")[3].split(",").slice(3, 4)[0], "262");
  console.log(`\nrequests made: ${requests} (500-row pages, so only Big Co needed 3)`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
