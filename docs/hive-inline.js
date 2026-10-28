/* Hive → Churn Win Tracker: single-file sweep (corrected)
 * ------------------------------------------------------
 * Where: DevTools → Console on https://hive.carrybee.com/orders (logged in).
 * Then:  paste this whole file, press Enter, wait ~2 minutes.
 *
 * It fetches the 540-business list from GitHub, counts each merchant's orders
 * via /orders?businessPhone=…&limit=500, and prints a block:
 *
 *     HIVEPASTE1
 *     359|262|45;24461|40|2;…
 *     HIVEPASTE0
 *
 * Paste that block into the chat — import_paste.py turns it back into metrics.
 *
 * NOTE ON COUNTING
 *   Distinct consignment ids are collected in a Set, so flight payloads that
 *   repeat objects across chunks cannot inflate a count. A page shorter than
 *   LIMIT means the end of that merchant's history, so the total is real.
 *   Anything that cannot be established is written blank, never guessed.
 */
(async function () {
  "use strict";

  var LIMIT = 500;      // measured: honored, and covers almost every merchant
  var MAXPAGES = 20;    // 20 x 500 = 10,000 orders, then the row goes blank
  var DELAY = 80;       // ms between requests
  var LIST_URL = "https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/main/src/biz_data.json";

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var digits = function (v) { return String(v == null ? "" : v).replace(/\D/g, ""); };

  console.log("Fetching the business list…");
  var listRes = await fetch(LIST_URL);
  if (!listRes.ok) { console.error("Could not load the business list: HTTP " + listRes.status); return; }
  var biz = await listRes.json();
  console.log("Businesses: " + biz.length);

  async function fetchPage(phone, page) {
    var u = new URL("/orders", location.origin);
    u.search = new URLSearchParams({
      page: String(page), limit: String(LIMIT), businessPhone: phone
    }).toString();
    var r;
    try {
      r = await fetch(u.toString(), {
        credentials: "include",
        headers: { RSC: "1", Accept: "text/x-component" }
      });
    } catch (e) { return null; }
    if (r.status === 429) { await sleep(3000); return fetchPage(phone, page); }
    if (!r.ok) return null;
    var text = await r.text();

    // matchAll only: no exec() in a loop condition, so a stale lastIndex can
    // never spin. (An inline /g literal inside a while condition rebuilds the
    // RegExp every iteration and does exactly that.)
    var ids = new Set();
    for (var m of text.matchAll(/"consignmentId"\s*:\s*"([^"]+)"/g)) ids.add(m[1]);

    var days = new Set();
    for (var d of text.matchAll(/"createdAt"\s*:\s*"(\d{4}-\d{2}-\d{2})/g)) days.add(d[1]);

    return { text: text, ids: ids, days: days };
  }

  var out = [], blank = 0;

  for (var i = 0; i < biz.length; i++) {
    var id = String(biz[i][0]), phone = digits(biz[i][3]);
    var allIds = new Set(), allDays = new Set();
    var page = 1, complete = false, matched = false;

    while (page <= MAXPAGES) {
      var p = await fetchPage(phone, page);
      if (!p) break;

      if (page === 1) {
        var seenPhone = phone.length >= 10 && p.text.indexOf(phone.slice(-10)) !== -1;
        var emptyList = p.ids.size === 0 && /"orders"\s*:\s*\[/.test(p.text);
        matched = seenPhone || emptyList;
      }

      var before = allIds.size;
      p.ids.forEach(function (x) { allIds.add(x); });
      p.days.forEach(function (d) { allDays.add(d); });

      if (p.ids.size < LIMIT) { complete = true; break; }   // short page = the end
      if (page > 1 && allIds.size === before) break;        // no progress: stop
      if (allIds.size > 10000) break;                       // runaway guard
      page++;
      await sleep(DELAY);
    }

    var ok = complete && matched && allIds.size <= 10000;
    if (!ok) blank++;
    out.push(id + "|" + (ok ? allIds.size : "") + "|" + (ok ? allDays.size : ""));

    if ((i + 1) % 50 === 0) console.log((i + 1) + "/" + biz.length + "  (" + blank + " blank so far)");
    await sleep(DELAY);
  }

  var blob = out.join(";");
  window.__hiveBlob = blob;
  window.__hiveRows = out;

  console.log("%c--- PASTE THIS (whole block, into the chat) ---", "color:#2563EB;font-weight:bold");
  console.log("HIVEPASTE1");
  for (var k = 0; k < blob.length; k += 600) console.log(blob.slice(k, k + 600));
  console.log("HIVEPASTE0");
  console.log("%c--- end block: " + out.length + " merchants, " + blank + " blank, " + blob.length + " chars ---",
              "color:#2563EB;font-weight:bold");
})();
