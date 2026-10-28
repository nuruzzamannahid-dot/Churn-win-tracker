/* Hive -> Churn Win Tracker: backfill order dates
 * ------------------------------------------------
 * Paste the WHOLE file in DevTools -> Console on https://hive.carrybee.com/orders,
 * logged in. Expect "Targets: 191", progress every 20 merchants, then a
 * HIVEDATES1 ... HIVEDATES0 block.
 *
 * Why this exists: 191 merchants have an order count but no first/last order
 * date, so the projection panel cannot derive a monthly rate for them. Only
 * those 191 are swept, which is far less work than another full run.
 *
 * Rows are `id|orders|days|first|last`. first and last are the earliest and
 * latest distinct order dates anywhere in that merchant's history - the sweep
 * already collects those dates in order to count active days, it just never
 * printed them.
 *
 * Loop safety, carried over from hive-min.js:
 *   - matchAll only; no exec() in a loop condition anywhere
 *   - every loop numerically bounded (page <= 20, tries < 4)
 */
(async function () {
  var LIMIT = 500;
  var MAXPAGES = 20;
  var RETRIES = 4;
  var DELAY = 60;
  var LIST = "https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/main/src/biz_data.json";

  var BUILD = "hive-dates-1";   // the loader verifies this before running the file

  var NEED = new Set(["10033","10176","10257","10348","10772","11293","11592","11632","11635","11658","11990","12137","12194","12202","12335","12348","12454","12478","12501","13076","13089","13230","13287","13404","13822","13871","14134","14251","14286","14292","14300","14480","14527","14772","14970","15024","15335","15395","15564","15721","15954","16252","1653","16582","16938","17205","17527","17541","17663","17688","1783","17901","17947","18255","18262","1827","18277","18303","18386","18801","18934","19027","19051","1925","19496","20192","2031","20427","20489","20594","20658","20797","20801","20925","20953","21258","21404","21513","21517","21853","21874","21914","21916","21960","21976","22245","22670","22874","23011","23212","23269","23292","23427","23565","23610","23717","23843","23898","23963","24079","24090","24167","24407","24409","24481","24523","24550","24580","24635","24682","24796","24909","24935","24995","25000","25086","25094","25101","25145","25257","25274","2536","25361","25819","25860","25950","26093","26171","26181","26277","26420","26573","26607","27080","27284","2754","27648","27996","28280","28647","28648","28686","29084","2942","29743","30345","31142","31382","31727","32154","32369","32914","33460","33602","33980","3483","359","3778","3917","4117","4177","4286","4741","5013","5053","5411","5558","5594","5719","6444","6621","669","6853","7004","7072","7126","7698","7721","794","824","8365","8469","8643","8740","8794","9145","9171","9280","9484","9697","9883"]);

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var digits = function (v) { return String(v == null ? "" : v).replace(/\D/g, ""); };

  console.log("Fetching the business list... (" + BUILD + ")");
  var lr = await fetch(LIST);
  if (!lr.ok) { console.error("Cannot load the list: HTTP " + lr.status); return; }
  var biz = (await lr.json()).filter(function (r) { return NEED.has(String(r[0])); });
  console.log("Targets: " + biz.length);
  if (!biz.length) { console.error("Nothing to sweep - the list did not match."); return; }

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
    var dates = Array.from(daySet).sort();          // ISO dates sort lexically
    var first = (ok && dates.length) ? dates[0] : "";
    var last  = (ok && dates.length) ? dates[dates.length - 1] : "";
    if (!ok) blanks++;
    out.push(id + "|" + (ok ? seen.size : "") + "|" + (ok ? daySet.size : "") +
             "|" + first + "|" + last);

    if ((i + 1) % 20 === 0) {
      var rate = ((i + 1) / ((Date.now() - t0) / 1000)).toFixed(1);
      console.log((i + 1) + "/" + biz.length + "  " + blanks + " blank  (" + rate + "/s)  " + name);
    }
    await sleep(DELAY);
  }

  var blob = out.join(";");
  window.__hiveDatesBlob = blob;
  window.__hiveDatesRows = out;

  console.log("%c--- COPY EVERYTHING BETWEEN THE MARKERS ---", "color:#2563EB;font-weight:bold");
  console.log("HIVEDATES1");
  for (var k = 0; k < blob.length; k += 800) console.log(blob.slice(k, k + 800));
  console.log("HIVEDATES0");
  console.log("%cDONE " + out.length + " merchants, " + blanks + " blank, " + blob.length + " chars",
              "color:#0E9F6E;font-weight:bold");
})();
