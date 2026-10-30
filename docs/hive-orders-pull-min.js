/* Hive lifetime-orders puller — compact, paste-safe version.
 * Paste this whole file into the console on https://hive.carrybee.com/orders
 * then:  await HO.run(100)        // pull the next 100 not-yet-done businesses
 *        await HO.run(500)        // next 500
 *        HO.progress()            // how far along
 *        HO.csv()                 // re-download everything collected so far
 * Progress is stored in localStorage, so refreshing loses nothing.
 */
(function () {
  "use strict";
  var ORDER_IDS = ["consignmentId", "consignment_id", "consignmentID", "orderId",
                   "order_id", "_id", "id", "trackingId"];
  var DATE_KEYS = ["createdAt", "created_at", "orderDate", "order_date", "date",
                   "placedAt", "placed_at", "orderCreatedAt", "created", "timestamp"];
  var TOTAL_KEYS = ["total", "totalCount", "total_count", "totalOrders",
                    "total_orders", "count", "resultCount", "totalResults", "totalItems"];

  function digits(v) { return String(v == null ? "" : v).replace(/\D/g, ""); }

  function walk(o, out, seen, d) {
    if (!o || typeof o !== "object" || seen.has(o) || d > 10) return;
    seen.add(o);
    if (!Array.isArray(o)) out.push(o);
    for (var k in o) walk(o[k], out, seen, d + 1);
  }

  function objectsIn(text) {
    var out = [], seen = new Set();
    function push(s) {
      s = String(s).trim();
      if (!s || (s.charAt(0) !== "{" && s.charAt(0) !== "[")) return;
      try { walk(JSON.parse(s), out, seen, 0); } catch (e) {}
    }
    var m, re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g;
    while ((m = re.exec(text))) {
      try { JSON.parse(m[1]).split("\n").forEach(function (l) { push(l.replace(/^[0-9a-fA-F]+:/, "")); }); }
      catch (e) {}
    }
    text.split("\n").forEach(function (l) { push(l.replace(/^[0-9a-fA-F]+:/, "").replace(/^\$/, "")); });
    return out;
  }

  function dateOf(o) {
    for (var i = 0; i < DATE_KEYS.length; i++) {
      var v = o[DATE_KEYS[i]];
      if (typeof v === "string" || typeof v === "number") {
        var d = new Date(v);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
    }
    return null;
  }

  function parse(text) {
    var objs = objectsIn(text), ids = {}, dates = {}, total = null, phones = {};
    objs.forEach(function (o) {
      var id = null;
      for (var i = 0; i < ORDER_IDS.length; i++) {
        var v = o[ORDER_IDS[i]];
        if (v !== undefined && typeof v !== "object" && v !== null && String(v) !== "") { id = String(v); break; }
      }
      var dt = dateOf(o);
      if (id && dt) { ids[id] = 1; dates[dt] = 1; }
      for (var j = 0; j < TOTAL_KEYS.length; j++) {
        var t = o[TOTAL_KEYS[j]];
        if (typeof t === "number" && t >= 0 && t < 1e9) { total = Math.max(total || 0, t); }
      }
      ["businessPhone", "business_phone", "shopPhone", "merchantPhone"].forEach(function (k) {
        if (typeof o[k] === "string") { var d = digits(o[k]); if (d.length >= 10) phones[d.slice(-10)] = 1; }
      });
    });
    return { ids: Object.keys(ids), dates: Object.keys(dates).sort(), total: total,
             phones: Object.keys(phones), rows: Object.keys(ids).length };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function get(params) {
    var url = new URL("/orders?" + new URLSearchParams(params).toString(), location.origin).toString();
    var heads = [{ RSC: "1", Accept: "text/x-component" }, { Accept: "application/json" }];
    for (var i = 0; i < heads.length; i++) {
      try {
        var res = await fetch(url, { credentials: "include", headers: heads[i] });
        if (res.status === 429) { await sleep(2500); continue; }
        if (!res.ok) continue;
        var text = await res.text();
        var p = parse(text);
        if (p.rows > 0 || p.total != null || i === heads.length - 1) return { ok: true, text: text, p: p };
      } catch (e) {}
    }
    return { ok: false, text: "", p: { ids: [], dates: [], total: null, phones: [], rows: 0 } };
  }

  var VARIANTS = ["businessPhone", "phone", "business_phone", "businessNumber"];
  var chosen = null;

  async function one(b) {
    var phone = digits(b[2]);
    var order = VARIANTS.slice();
    if (chosen) order.sort(function (x) { return x === chosen ? -1 : 1; });
    for (var i = 0; i < order.length; i++) {
      var v = order[i], params = { page: "1", limit: "500" };
      params[v] = phone;
      var r = await get(params);
      if (!r.ok) continue;
      var matched = phone.length >= 10 && r.text.indexOf(phone.slice(-10)) !== -1;
      if (!matched && r.p.rows === 0 && r.p.total == null) continue;
      chosen = v;
      var full = r.p.rows < 500;
      var orders = full ? r.p.rows : (r.p.total != null ? r.p.total : null);
      var dates = full ? r.p.dates : [];   // >1 page: dates would be partial, so leave blank
      return { orders: orders, first: dates[0] || "", last: dates[dates.length - 1] || "",
               days: dates.length, matched: matched };
    }
    return { orders: null, first: "", last: "", days: 0, matched: false };
  }

  var KEY = "hiveOrdersAll_v1";

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; }
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }

  function esc(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  function buildCsv(db) {
    var head = ["Business ID", "Business Name", "Phone", "Total Orders",
                "First Order Date", "Last Order Date", "Distinct Order Days"];
    var lines = [head.join(",")];
    Object.keys(db).forEach(function (k) {
      var r = db[k];
      lines.push([r.id, r.name, r.phone, r.orders, r.first, r.last, r.days].map(esc).join(","));
    });
    return lines.join("\r\n");
  }

  function download(text, name) {
    var blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  var BIZ = [];

  async function loadBiz() {
    if (BIZ.length) return BIZ;
    var res = await fetch("https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/main/src/biz_all_orders.json");
    if (!res.ok) throw new Error("business list HTTP " + res.status);
    BIZ = await res.json();
    console.log("Loaded " + BIZ.length + " businesses");
    return BIZ;
  }

  async function run(n) {
    await loadBiz();
    var db = load();
    var todo = BIZ.filter(function (b) { return !db[b[0]]; }).slice(0, n || 100);
    if (!todo.length) { console.log("Everything is already collected — run HO.csv()"); return; }
    console.log("Pulling " + todo.length + " (already done: " + Object.keys(db).length + ")");
    var t0 = Date.now(), ok = 0, blank = 0;
    for (var i = 0; i < todo.length; i++) {
      var b = todo[i];
      var s = await one(b);
      db[b[0]] = { id: b[0], name: b[1], phone: b[2], orders: s.orders,
                   first: s.first, last: s.last, days: s.days };
      if (s.orders == null) blank++; else ok++;
      if ((i + 1) % 25 === 0 || i === todo.length - 1) {
        save(db);
        console.log((Object.keys(db).length) + "/" + BIZ.length + "  " + b[1] + " → " +
          (s.orders == null ? "—" : s.orders) + "  (" + ((i + 1) / ((Date.now() - t0) / 1000)).toFixed(1) + "/s)");
      }
      await sleep(60);
    }
    save(db);
    console.log("Batch done — " + ok + " with a count, " + blank + " left blank. Total stored: " + Object.keys(db).length);
    download(buildCsv(db), "hive_orders_all.csv");
  }

  window.HO = {
    run: run,
    progress: function () { var db = load(); console.log(Object.keys(db).length + " / " + BIZ.length + " collected"); },
    csv: function () { download(buildCsv(load()), "hive_orders_all.csv"); },
    clear: function () { localStorage.removeItem(KEY); console.log("cleared"); },
    parse: parse,
    probe: async function (n) {
      await loadBiz();
      var b = BIZ.filter(function (x) { return String(x[1]).toLowerCase().indexOf(String(n).toLowerCase()) !== -1; })[0];
      if (!b) return console.warn("no match");
      console.log("probing", b[1], b[2]);
      var s = await one(b);
      console.log(b[1], JSON.stringify(s), "param=" + chosen);
      return s;
    },
    raw: async function (n) {
      await loadBiz();
      var b = BIZ.filter(function (x) { return String(x[1]).toLowerCase().indexOf(String(n).toLowerCase()) !== -1; })[0];
      if (!b) return console.warn("no match");
      var r = await get({ page: "1", limit: "500", businessPhone: digits(b[2]) });
      console.log(b[1], "ok=" + r.ok, "rows=" + r.p.rows, "total=" + r.p.total);
      console.log(r.text.slice(0, 3000));
      return r;
    }
  };
  console.log("%cHO ready — run: await HO.run(100)", "color:#0E9F6E;font-weight:bold");
})();
