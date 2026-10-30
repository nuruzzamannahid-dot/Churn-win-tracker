/* Sort UI test — clicks the real header in a real DOM.
 *
 *   node test_sort.js
 *
 * Guards the bugs that shipped in PR #20 and were only noticed later:
 *   1. <th onclick="toggleSort('orders')"> threw "toggleSort is not defined",
 *      because the handler runs in global scope and toggleSort lives in the
 *      page IIFE. Clicking the header did nothing.
 *   2. The direction glyph was written with textContent as "&#9660;", which
 *      renders literally instead of as ▼.
 *   3. "Clear filters" replaced the filters object and silently dropped the
 *      sort key, so the table reverted to spreadsheet order.
 *   4. Rows with no value floated to the top when sorting ascending.
 *
 * Uses the committed index.html, so it also proves build.py wired the template
 * correctly.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = __dirname;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const file = path.join(ROOT, "index.html");
  if (!fs.existsSync(file)) { console.log("index.html missing — run python3 build.py"); process.exit(1); }

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push((e.stack || e.message).split("\n")[0]));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ").slice(0, 200)));

  const dom = await JSDOM.fromFile(file, {
    runScripts: "dangerously", virtualConsole: vc, url: "https://churn-win-tracker.test/",
  });
  const w = dom.window, d = w.document;
  await sleep(2000);

  const rowsOf = () => [...d.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.children].map((td) => td.textContent.trim()));
  const ordersOf = () => rowsOf().map((r) => r[4]).filter((v) => v !== "—")
    .map((v) => Number(v.replace(/,/g, "")));
  const header = () => d.querySelector('th[data-sort="orders"]');

  ok("header has data-sort", !!header());
  ok("no inline onclick left on the header",
     !/onclick/i.test(header() ? header().outerHTML : ""), header() && header().outerHTML.slice(0, 120));

  // --- default: descending by lifetime orders -------------------------------
  const start = ordersOf();
  ok("default sort is descending",
     start.every((v, i) => i === 0 || start[i - 1] >= v), start.slice(0, 5).join(","));
  ok("no value-less row sits above a real order count",
     rowsOf().findIndex((r) => r[4] === "—") === -1 ||
     rowsOf().findIndex((r) => r[4] === "—") > 0);

  // --- click: descending -> ascending --------------------------------------
  const before = errors.length;
  header().dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(400);
  const asc = ordersOf();
  ok("click does not throw", errors.length === before, errors.slice(before).join(" | "));
  ok("click flips to ascending",
     asc.every((v, i) => i === 0 || asc[i - 1] <= v), asc.slice(0, 5).join(","));
  const dashAt = rowsOf().findIndex((r) => r[4] === "—");
  const tailClean = dashAt === -1 ||
    rowsOf().slice(dashAt).every((r) => r[4] === "—");
  ok("ascending puts order-less rows last", tailClean,
     "first dash at row " + (dashAt + 1) + " of " + rowsOf().length);

  // --- glyph is a real arrow, not a literal entity -------------------------
  const glyph = (d.querySelector("#sortdir-orders") || {}).textContent || "";
  ok("direction glyph is ▲ when ascending", glyph === "\u25B2", JSON.stringify(glyph));
  header().dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(400);
  const glyph2 = (d.querySelector("#sortdir-orders") || {}).textContent || "";
  ok("direction glyph is ▼ when descending", glyph2 === "\u25BC", JSON.stringify(glyph2));
  ok("clicking twice returns to descending",
     ordersOf().every((v, i, a) => i === 0 || a[i - 1] >= v));

  // --- keyboard: Enter sorts too -------------------------------------------
  const beforeKb = errors.length;
  header().dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(400);
  ok("Enter on the header sorts", errors.length === beforeKb && ordersOf().every((v, i, a) => i === 0 || a[i - 1] <= v));

  // --- clearing filters must not drop the sort ----------------------------
  const clear = d.querySelector("#btnClearFilters");
  ok("clear-filters button exists", !!clear);
  clear.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(600);
  const afterClear = ordersOf();
  ok("sort survives clearing filters",
     afterClear.length > 1 && afterClear.every((v, i) => i === 0 || afterClear[i - 1] <= v),
     afterClear.slice(0, 4).join(","));
  ok("clear filters did not throw", errors.length === beforeKb, errors.slice(beforeKb).join(" | "));

  // --- header text is intact ----------------------------------------------
  ok("header label still reads 'Lifetime orders'",
     /Lifetime orders/.test(header().textContent));

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("CRASH", e && e.message); process.exit(1); });
