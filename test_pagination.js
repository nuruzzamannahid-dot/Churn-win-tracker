/* Mocked-Hive test for the orders puller's counting logic (no network).
 *
 *   node test_pagination.js
 *
 * Serves a fake Hive /orders route with a known number of orders and asserts
 * the puller counts distinct order ids — not pages — and refuses to report a
 * number when pagination cannot complete.
 *
 * The puller asks for CFG.limit rows per request. These tests mirror whatever
 * limit it uses, so raising the limit does not silently invalidate them.
 */
const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "docs", "hive-orders-pull.js");
const PHONE = "8801632971014";

/** Reads the page size the puller actually asks for. */
function pullerLimit() {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  const m = src.match(/limit:\s*(\d+)/);
  return m ? Number(m[1]) : 100;
}

const LIMIT = pullerLimit();

/** Mock Hive: `total` orders, served `limit` at a time, newest-first like Hive. */
function feed(totalOrders, opts = {}) {
  return async function (url) {
    const u = new URL(String(url));
    const page = Number(u.searchParams.get("page") || 1);
    const limit = Number(u.searchParams.get("limit") || LIMIT);
    const start = (page - 1) * limit;
    const n = Math.max(0, Math.min(limit, totalOrders - start));
    const orders = [];
    for (let i = 0; i < n; i++) {
      const idx = start + i;
      orders.push({
        consignmentId: (opts.prefix || "C") + idx,
        createdAt: new Date(Date.UTC(2026, 0, 1 + (idx % 300))).toISOString(),
        businessPhone: opts.phone || PHONE,
      });
    }
    // flight repeats objects across chunks; the puller must dedupe
    const body = "2a:" + JSON.stringify({ orders, meta: { page } }) + "\n2a:" + JSON.stringify({ orders });
    return { ok: true, status: 200, text: async () => body };
  };
}

/** Mock that ignores ?page= and repeats one full page forever. */
function frozenPage() {
  return async function () {
    const orders = Array.from({ length: LIMIT }, (_, i) => ({
      consignmentId: "SAME" + i, createdAt: "2026-03-01T00:00:00Z", businessPhone: PHONE,
    }));
    return { ok: true, status: 200, text: async () => "2a:" + JSON.stringify({ orders }) };
  };
}

async function load(fetchImpl) {
  const src = fs.readFileSync(SRC_PATH, "utf8");
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

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? "ok  " : "FAIL") + "  " + name.padEnd(46) + ` got=${JSON.stringify(got)}` +
              (ok ? "" : ` want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}

(async () => {
  console.log(`puller page size (CFG.limit) = ${LIMIT}\n`);

  const cases = [
    { name: "40 orders (short first page)", total: 40, orders: 40, pages: 1 },
    { name: "100 orders (fits one page)", total: 100, orders: 100, pages: 1 },
    { name: "250 orders (fits one page)", total: 250, orders: 250, pages: 1 },
    { name: "exactly one full page", total: LIMIT, orders: LIMIT, pages: 2 },
    { name: `${LIMIT + 300} orders (needs 2 pages)`, total: LIMIT + 300, orders: LIMIT + 300, pages: 2 },
    { name: `${LIMIT * 3 + 7} orders (needs 4 pages)`, total: LIMIT * 3 + 7, orders: LIMIT * 3 + 7, pages: 4 },
    { name: "0 orders (a real, empty result)", total: 0, orders: 0, pages: 1 },
  ];

  for (const c of cases) {
    const H = await load(feed(c.total));
    const r = await H.query(["999", "Test Biz", PHONE]);
    check(c.name, { orders: r.orders, pages: r.pages }, { orders: c.orders, pages: c.pages });
  }

  // AR Baby Cloud, as measured: pages of 100 gave 100 + 100 + 62 = 262
  const H = await load(feed(262));
  const r = await H.query(["23717", "AR Baby Cloud", PHONE]);
  check("AR Baby Cloud = 262 (was reported as 100)", r.orders, 262);

  // pagination that never advances must yield null, never a page-sized number
  const Hf = await load(frozenPage());
  const rf = await Hf.query(["998", "Frozen Biz", PHONE]);
  check("frozen pagination -> blank, not a number", rf.orders, null);

  // a response that never mentions the business must not produce a count
  const wrong = async () => ({
    ok: true, status: 200,
    text: async () => '2a:{"orders":[{"consignmentId":"Z1","createdAt":"2026-01-01","businessPhone":"8801700000000"}]}',
  });
  const Hw = await load(wrong);
  const rw = await Hw.query(["997", "Other Biz", PHONE]);
  check("phone mismatch -> no invented number", rw.orders === null || rw.phoneMatched === false, true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
