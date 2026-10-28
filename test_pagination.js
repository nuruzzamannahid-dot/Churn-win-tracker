/* Mocked-Hive test for the orders puller's pagination logic (no network).
 *
 *   node test_pagination.js
 *
 * Serves a fake Hive /orders route with a known number of orders and asserts
 * the puller counts distinct order ids — not pages — and refuses to report a
 * number when pagination cannot complete.
 */
const fs = require("fs");
const path = require("path");

const PHONE = "8801632971014";

function makeFeed(totalOrders) {
  // returns a fetch() that serves `totalOrders` order pages of 100
  return async function (url) {
    const u = new URL(String(url));
    const page = Number(u.searchParams.get("page") || 1);
    const limit = Number(u.searchParams.get("limit") || 100);
    const start = (page - 1) * limit;
    const n = Math.max(0, Math.min(limit, totalOrders - start));
    const orders = [];
    for (let i = 0; i < n; i++) {
      const idx = start + i;
      orders.push({
        consignmentId: "C" + idx,
        createdAt: new Date(Date.UTC(2026, 0, 1 + (idx % 300))).toISOString(),
        businessPhone: PHONE,
      });
    }
    const body = "2a:" + JSON.stringify({ orders, meta: { page } }) + "\n2a:" + JSON.stringify({ orders });
    return { ok: true, status: 200, text: async () => body };
  };
}

async function load(fetchImpl) {
  const src = fs.readFileSync(path.join(__dirname, "docs", "hive-orders-pull.js"), "utf8");
  global.window = {};
  global.location = { origin: "https://hive.carrybee.com" };
  global.fetch = fetchImpl;
  const quiet = console.log;
  console.log = () => {};
  const mod = { exports: {} };
  new Function("module", "exports", src)(mod, mod.exports);
  console.log = quiet;
  return global.window.hiveOrders;
}

const cases = [
  { name: "40 orders (short first page)", total: 40, wantOrders: 40, wantPages: 1 },
  { name: "100 orders (exactly one full page)", total: 100, wantOrders: 100, wantPages: 2 },
  { name: "250 orders (3 pages)", total: 250, wantOrders: 250, wantPages: 3 },
  { name: "412 orders (5 pages)", total: 412, wantOrders: 412, wantPages: 5 },
  { name: "0 orders", total: 0, wantOrders: 0, wantPages: 1 },
];

(async () => {
  let pass = 0, fail = 0;
  for (const c of cases) {
    const H = await load(makeFeed(c.total));
    const r = await H.query(["999", "Test Biz", PHONE]);
    const ok = r.orders === c.wantOrders && r.pages === c.wantPages;
    console.log((ok ? "ok  " : "FAIL") +
      `  ${c.name.padEnd(38)} orders=${r.orders} pages=${r.pages} first=${r.first} last=${r.last}`);
    ok ? pass++ : fail++;
  }

  // frozen pagination: page 2+ repeats page 1 forever -> must be unknown, not 100
  const frozen = async (url) => {
    const orders = Array.from({ length: 100 }, (_, i) => ({
      consignmentId: "SAME" + i, createdAt: "2026-03-01T00:00:00Z", businessPhone: PHONE,
    }));
    const body = "2a:" + JSON.stringify({ orders });
    return { ok: true, status: 200, text: async () => body };
  };
  const H2 = await load(frozen);
  const r = await H2.query(["998", "Frozen Biz", PHONE]);
  const ok = r.orders === null;
  console.log((ok ? "ok  " : "FAIL") + `  ${"frozen pagination".padEnd(38)} orders=${r.orders} (must be null)`);
  ok ? pass++ : fail++;

  // wrong business (phone never appears) -> must not invent numbers
  const wrong = async () => {
    const body = '2a:{"orders":[{"consignmentId":"Z1","createdAt":"2026-01-01","businessPhone":"8801700000000"}]}';
    return { ok: true, status: 200, text: async () => body };
  };
  const H3 = await load(wrong);
  const r3 = await H3.query(["997", "Other Biz", PHONE]);
  const ok3 = r3.orders === null || r3.phoneMatched === false;
  console.log((ok3 ? "ok  " : "FAIL") + `  ${"phone mismatch".padEnd(38)} orders=${r3.orders} matched=${r3.phoneMatched}`);
  ok3 ? pass++ : fail++;

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
