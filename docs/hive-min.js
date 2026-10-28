/* Hive → Churn Win Tracker — minimal, loop-free sweep
 * --------------------------------------------------
 * Paste in DevTools → Console on https://hive.carrybee.com/orders (logged in).
 * Paste the WHOLE file. Expect "Businesses: 540" within a second, then
 * progress every 25 merchants, then a HIVEPASTE1 … HIVEPASTE0 block.
 *
 * Design rules that make it impossible to hang:
 *   - matching uses String.prototype.matchAll only. There is no `exec()` in a
 *     loop condition anywhere, so a stale lastIndex cannot spin forever.
 *   - every loop has a literal numeric bound (page <= 20, tries < 5).
 *   - no `continue` inside a for-loop that also increments, which is how a
 *     retry can otherwise subtract and add its way to an infinite loop.
 */
(async function () {
  var LIMIT = 500;        // rows per request; measured to be honoured by Hive
  var MAXPAGES = 20;      // hard bound: 20 x 500 = 10,000 orders
  var RETRIES = 4;        // hard bound on 429 retries per page
  var DELAY = 60;         // ms between requests
  var LIST = "https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/main/src/biz_data.json";

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var digits = function (v) { return String(v == null ? "" : v).replace(/\D/g, ""); };

  console.log("Fetching the business list...");
  var lr = await fetch(LIST);
  if (!lr.ok) { console.error("Cannot load the list: HTTP " + lr.status); return; }
  var biz = await lr.json();
  console.log("Businesses: " + biz.length);

  async function page(phone, num) {
    var tries = 0;
    while (tries < RETRIES) {
      var u = new URL("/orders", location.origin);
      u.search = new URLSearchParams({
        page: String(num), limit: String(LIMIT), businessPhone: phone
      }).toString();
      var r = null;
      try {
        r = await fetch(u.toString(), {
          credentials: "include",
          headers: { RSC: "1", Accept: "text/x-component" }
        });
      } catch (e) { return null; }

      if (r.status === 429) { tries++; await sleep(2000); continue; }
      if (!r.ok) return null;

      var t = await r.text();
      var ids = [];
      for (var m of t.matchAll(/"consignmentId"\s*:\s*"([^"]+)"/g)) ids.push(m[1]);
      var days = [];
      for (var d of t.matchAll(/"createdAt"\s*:\s*"(\d{4}-\d{2}-\d{2})/g)) days.push(d[1]);
      return { text: t, ids: ids, days: days };
    }
    return null;
  }

  var out = [], blanks = 0, t0 = Date.now();

  for (var i = 0; i < biz.length; i++) {
    var id = String(biz[i][0]);
    var name = String(biz[i][2] || "");
    var phone = digits(biz[i][3]);

    var seen = new Set(), daySet = new Set();
    var complete = false, matched = false, p = 1;

    while (p <= MAXPAGES) {
      var pg = await page(phone, p);
      if (!pg) break;

      if (p === 1) {
        var phoneOk = phone.length >= 10 && pg.text.indexOf(phone.slice(-10)) !== -1;
        var emptyOk = pg.ids.length === 0 && /"orders"\s*:\s*\[/.test(pg.text);
        matched = phoneOk || emptyOk;
      }

      var before = seen.size;
      for (var a = 0; a < pg.ids.length; a++) seen.add(pg.ids[a]);
      for (var b = 0; b < pg.days.length; b++) daySet.add(pg.days[b]);

      if (pg.ids.length < LIMIT) { complete = true; break; }   // short page = end
      if (p > 1 && seen.size === before) break;                // frozen: stop
      p++;
      await sleep(DELAY);
    }

    var ok = complete && matched && seen.size <= LIMIT * MAXPAGES;
    if (!ok) blanks++;
    out.push(id + "|" + (ok ? seen.size : "") + "|" + (ok ? daySet.size : ""));

    if ((i + 1) % 25 === 0) {
      var rate = ((i + 1) / ((Date.now() - t0) / 1000)).toFixed(1);
      console.log((i + 1) + "/" + biz.length + "  " + blanks + " blank  (" + rate + "/s)  " + name);
    }
    await sleep(DELAY);
  }

  var blob = out.join(";");
  window.__hiveBlob = blob;
  window.__hiveRows = out;

  console.log("%c--- COPY EVERYTHING BETWEEN THE MARKERS ---", "color:#2563EB;font-weight:bold");
  console.log("HIVEPASTE1");
  for (var k = 0; k < blob.length; k += 800) console.log(blob.slice(k, k + 800));
  console.log("HIVEPASTE0");
  console.log("%cDONE " + out.length + " merchants, " + blanks + " blank, " + blob.length + " chars",
              "color:#0E9F6E;font-weight:bold");
})();
