/* Does Hive's /orders route actually paginate?
 * -------------------------------------------
 * Paste in DevTools → Console on hive.carrybee.com/orders (logged in).
 * It fires ~5 requests against AR Baby Cloud, then prints a table.
 *
 * v1 of the puller assumed page=1 was all there was and reported the page
 * size (100) as the total. v2 assumes page=2, 3, … return *different* orders.
 * This script proves or disproves that assumption before another full sweep.
 *
 * Read the output like this:
 *
 *   page 1 / 2 / 3 have DIFFERENT ids        -> pagination works, v2 is right
 *   page 1 / 2 / 3 have the SAME ids         -> Hive ignores ?page=; v2 would
 *                                               loop, so we need a date-range
 *                                               strategy instead
 *   limit=500 comes back with ~500 rows      -> simplest fix: raise the page size
 *   a "total" / "count" field appears        -> we can count without paging
 */
(async function diagnosePagination() {
  "use strict";

  var PHONE = "8801632971014";   // AR Baby Cloud — has 100+ orders
  var LABEL = "AR Baby Cloud";

  function ids(text) {
    var m = text.matchAll(/"consignmentId"\s*:\s*"([^"]+)"/g), out = new Set();
    for (var x of m) out.add(x[1]);
    return out;
  }
  function dates(text) {
    var m = text.matchAll(/"createdAt"\s*:\s*"(\d{4}-\d{2}-\d{2})/g), out = [];
    for (var x of m) out.push(x[1]);
    return out.sort();
  }
  function ints(text) {
    // any numeric field whose NAME suggests a total/count/page/limit
    var m = text.matchAll(/"([A-Za-z_]*(?:total|count|limit|page|pages|per_page)[A-Za-z_]*)"\s*:\s*(\d+)/gi);
    var out = {};
    for (var x of m) if (out[x[1]] === undefined) out[x[1]] = Number(x[2]);
    return out;
  }

  async function grab(params) {
    var url = new URL("/orders?" + new URLSearchParams(params).toString(), location.origin).toString();
    try {
      var res = await fetch(url, { credentials: "include", headers: { RSC: "1", Accept: "text/x-component" } });
      var text = await res.text();
      var d = dates(text);
      return {
        params: params,
        status: res.status,
        bytes: text.length,
        ids: ids(text),
        earliest: d[0] || "-",
        latest: d[d.length - 1] || "-",
        meta: ints(text)
      };
    } catch (e) {
      return { params: params, status: "ERR", bytes: 0, ids: new Set(), earliest: "-", latest: "-", meta: { error: e.message } };
    }
  }

  console.log("Probing " + LABEL + " (" + PHONE + ") …");

  var base = { limit: "100", businessPhone: PHONE };
  var p1 = await grab(Object.assign({}, base, { page: "1" }));
  var p2 = await grab(Object.assign({}, base, { page: "2" }));
  var p3 = await grab(Object.assign({}, base, { page: "3" }));
  var big = await grab(Object.assign({}, base, { page: "1", limit: "500" }));

  function only(a, b) {                       // ids in a that are not in b
    var n = 0; a.forEach(function (id) { if (!b.has(id)) n++; }); return n;
  }

  var rows = [p1, p2, p3, big].map(function (p) {
    return {
      request: Object.keys(p.params).map(function (k) { return k + "=" + p.params[k]; }).join("&"),
      status: p.status,
      rows: p.ids.size,
      earliest: p.earliest,
      latest: p.latest
    };
  });
  console.table(rows);

  console.log("page1 vs page2 — ids only on page1: " + only(p1.ids, p2.ids) + "   only on page2: " + only(p2.ids, p1.ids));
  console.log("page2 vs page3 — ids only on page2: " + only(p2.ids, p3.ids) + "   only on page3: " + only(p3.ids, p2.ids));

  var all = new Set(); [p1, p2, p3].forEach(function (p) { p.ids.forEach(function (i) { all.add(i); }); });
  console.log("union of pages 1-3: " + all.size);

  var verdict;
  if (p2.ids.size && only(p2.ids, p1.ids) > 0) {
    verdict = "PAGINATION WORKS — page 2 returns different orders. v2 can count correctly.";
  } else if (p2.ids.size && only(p2.ids, p1.ids) === 0 && only(p1.ids, p2.ids) === 0) {
    verdict = "PAGINATION IGNORED — page 2 repeats page 1. v2 would not progress; needs a date-range strategy.";
  } else {
    verdict = "INCONCLUSIVE — page 2 was empty or errored. Check the table above.";
  }
  console.log("%c" + verdict, "color:#0E9F6E;font-weight:bold");

  var bigSize = big.ids.size;
  if (bigSize > p1.ids.size) {
    console.log("%climit=500 returned " + bigSize + " rows — raising CFG.limit is a simple fix.", "color:#2563EB");
  }

  var merged = Object.assign({}, p1.meta, big.meta);
  var metaKeys = Object.keys(merged);
  if (metaKeys.length) {
    console.log("meta-ish numeric fields seen:", JSON.stringify(merged));
  } else {
    console.log("no total/count/page fields in the payload — counting means paging.");
  }

  window.__hiveDiag = { p1: p1, p2: p2, p3: p3, big: big, verdict: verdict };
  console.log("Full objects kept in window.__hiveDiag if you want to inspect further.");
})();
