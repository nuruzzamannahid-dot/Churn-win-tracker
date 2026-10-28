/* Hive → Churn Win Tracker: full sweep in one paste
 * ------------------------------------------------
 * Where: DevTools → Console on https://hive.carrybee.com/orders (logged in).
 * Then:  paste this whole file, press Enter, wait ~2 minutes.
 *
 * Measured on AR Baby Cloud: ?businessPhone= + ?page= + ?limit= are all honoured.
 * pages of 100 gave 100 + 100 + 62 = 262, and limit=500 returned all 262 in one
 * request — so most merchants need exactly one call, and the page size is never
 * mistaken for a total.
 *
 * It downloads hive_orders.csv at the end. Nothing is sent anywhere except to
 * carrybee.com and the one public GitHub fetch for the business list.
 */
(async function hiveSweep() {
  "use strict";

  var LIMIT = 500;          // measured to work; leave alone unless Hive complains
  var MAX_PAGES = 20;       // 20 x 500 = 10,000 orders, then the row goes blank
  var DELAY = 80;           // ms between requests
  var BIZ_URL = "https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/main/src/biz_data.json";

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var digits = function (v) { return String(v == null ? "" : v).replace(/\D/g, ""); };

  console.log("Fetching the business list…");
  var res = await fetch(BIZ_URL);
  if (!res.ok) { console.error("Could not load the business list:", res.status); return; }
  var biz = await res.json();
  console.log("Businesses:", biz.length);

  async function fetchPage(phone, page) {
    var url = new URL("/orders", location.origin);
    url.search = new URLSearchParams({
      page: String(page), limit: String(LIMIT), businessPhone: phone
    }).toString();
    var r = await fetch(url.toString(), {
      credentials: "include",
      headers: { RSC: "1", Accept: "text/x-component" }
    });
    if (r.status === 429) { await sleep(3000); return fetchPage(phone, page); }
    if (!r.ok) return null;
    var t = await r.text();
    var ids = new Set(), days = new Set(), m;
    var reId = /"consignmentId"\s*:\s*"([^"]+)"/g;
    while ((m = reId.exec(t))) ids.add(m[1]);
    var reDay = /"createdAt"\s*:\s*"(\d{4}-\d{2}-\d{2})/g;
    while ((m = reDay.exec(t))) days.add(m[1]);
    return { text: t, ids: ids, days: days };
  }

  var rows = [], failed = 0, done = 0;

  for (var i = 0; i < biz.length; i++) {
    var id = String(biz[i][0]), name = biz[i][2], phone = digits(biz[i][3]);
    var allIds = new Set(), allDays = new Set();
    var page = 1, complete = false, matched = false;

    while (page <= MAX_PAGES) {
      var p;
      try { p = await fetchPage(phone, page); } catch (e) { p = null; }
      if (!p) break;
      if (page === 1) {
        // Normally the response mentions this business's own phone. A merchant
        // with zero orders has no rows to carry it, so accept an empty answer
        // only when the payload is recognisably an order list.
        var phoneInText = phone.length >= 10 && p.text.indexOf(phone.slice(-10)) !== -1;
        var emptyOrderList = p.ids.size === 0 && /"orders"\s*:\s*\[/.test(p.text);
        matched = phoneInText || emptyOrderList;
      }
      var before = allIds.size;
      p.ids.forEach(function (x) { allIds.add(x); });
      p.days.forEach(function (d) { allDays.add(d); });
      if (p.ids.size < LIMIT) { complete = true; break; }       // short page = the end
      if (page > 1 && allIds.size === before) break;            // no progress -> stop
      if (allIds.size > 10000) break;
      page++;
      await sleep(DELAY);
    }

    var ok = complete && matched && allIds.size <= 10000;
    var ds = Array.from(allDays).sort();
    rows.push({
      id: id, name: name, phone: phone,
      orders: ok ? allIds.size : "",
      first: ok ? (ds[0] || "") : "",
      last: ok ? (ds[ds.length - 1] || "") : "",
      days: ok ? ds.length : ""
    });
    if (!ok) failed++;

    if (++done % 25 === 0) {
      console.log(done + "/" + biz.length + "  (" + failed + " unknown so far)");
    }
    await sleep(DELAY);
  }

  var esc = function (v) {
    v = v == null ? "" : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  var head = ["Business ID", "Business Name", "Phone", "Total Orders",
              "First Order Date", "Last Order Date", "Distinct Order Days"];
  var csv = [head.join(",")].concat(rows.map(function (r) {
    return [r.id, r.name, r.phone, r.orders, r.first, r.last, r.days].map(esc).join(",");
  })).join("\r\n");

  window.__hiveCsv = csv;
  window.__hiveRows = rows;

  var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hive_orders.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);

  var withOrders = rows.filter(function (r) { return r.orders !== ""; }).length;
  console.log("%cDONE — " + withOrders + " exact, " + failed + " left blank",
              "color:#0E9F6E;font-weight:bold");
  console.log("Downloaded hive_orders.csv — attach that file.");
})();
