/* Hive → Churn Win Tracker: lifetime orders per business (ALL 30,507 merchants)
 * ---------------------------------------------------------------
 * Hive is a Next.js App Router app: table data arrives as RSC "flight" text,
 * so there is no copyable JSON in the Network tab. This script asks the same
 * /orders route the Orders page uses, once per business, with your session
 * cookie — no token pasted, nothing leaves carrybee.com.
 *
 * It loads the full business list (30,507 merchants) from GitHub raw, then
 * walks through each one fetching order history from Hive.
 *
 * USE
 *   1. Log in, open https://hive.carrybee.com/orders
 *   2. DevTools → Console → paste this whole file → Enter
 *   3. Run:  await hiveOrdersAll.run()
 *   4. Leave the tab open. It can take hours for 30k businesses — run in
 *      batches using CFG.stopAfter (e.g. stopAfter: 500 for a trial).
 *   5. It copies a CSV at the end. Clipboard blocked? Run: copy(window.__hiveCsvAll)
 *
 * WHAT IT COLLECTS
 *   total orders · first order date · last order date · distinct order days
 *
 * SELF-CHECKS (it stops instead of lying to you)
 *   - control query with a nonsense phone: must return 0 orders
 *   - per-business: response must actually mention that business's phone
 *
 * WARNING: 30,507 businesses × ~1 API call each = a very long run.
 *          Use CFG.stopAfter to process in batches.
 */

"use strict";

// Authoritative business list — 30,507 merchants (540 from sheet + 29,967 from Hive churn CSV)
// Fetched from GitHub raw so this script file stays small.
var BIZ_URL = "https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/main/src/biz_all_orders.json";

var BUSINESSES = [];   // populated by loadBusinesses()

var CFG = {
  // limit=500 measured to work on Hive; most merchants need exactly one call
  limit: 500,          // rows per request
  delayMs: 120,        // pause between businesses; raise if Hive rate-limits
  pageDelayMs: 100,    // pause between pages of the same business
  maxPages: 20,        // 20 x 500 = 10,000 orders; beyond that the row is left blank
  stopAfter: 0         // 0 = all; set e.g. 500 to trial-run a batch
};

/* ---------------- pure helpers ---------------- */

function digits(v) { return String(v == null ? "" : v).replace(/\D/g, ""); }

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  var s = String(v).replace(/,/g, "").replace(/[^\d.\-]/g, "");
  if (!s || s === "-" || s === ".") return null;
  var f = parseFloat(s);
  return isFinite(f) ? f : null;
}

/* Next.js flight: plain "2a:{...}" lines and inline self.__next_f.push([1,"2a:{...}"]) */
function extractFlight(text) {
  var out = [], seen = new Set();
  function walk(node, depth) {
    if (!node || depth > 10 || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth + 1); }); return; }
    out.push(node);
    Object.keys(node).forEach(function (k) { walk(node[k], depth + 1); });
  }
  function parseChunk(raw) {
    var s = String(raw).trim();
    if (!s) return null;
    if (s.charAt(0) === "{" || s.charAt(0) === "[") {
      try { return JSON.parse(s); } catch (e) { return null; }
    }
    return null;
  }
  for (var m of text.matchAll(/self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g)) {
    var inner;
    try { inner = JSON.parse(m[1]); } catch (e) { continue; }
    inner.split("\n").forEach(function (line) {
      var v = parseChunk(line.replace(/^[0-9a-fA-F]+:/, ""));
      if (v) walk(v, 0);
    });
  }
  text.split("\n").forEach(function (line) {
    var v = parseChunk(line.replace(/^[0-9a-fA-F]+:/, "").replace(/^\$/, ""));
    if (v) walk(v, 0);
  });
  return out;
}

var DATE_KEYS = ["createdAt", "created_at", "orderDate", "order_date", "date", "placedAt",
                 "placed_at", "orderCreatedAt", "created", "timestamp", "deliveryDate"];
var TOTAL_KEYS = ["total", "totalCount", "total_count", "totalOrders", "total_orders",
                  "count", "resultCount", "totalResults", "totalItems", "recordsTotal"];
var BIZ_PHONE_KEYS = ["businessPhone", "business_phone", "shopPhone", "merchantPhone", "phone"];

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

function orderLike(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  var hasDate = !!dateOf(o);
  var hasId = ["consignmentId", "consignment_id", "consignmentID", "orderId", "order_id",
               "_id", "id", "trackingId", "merchantOrderId"].some(function (k) {
                 return o[k] !== undefined && typeof o[k] !== "object";
               });
  return hasDate && hasId;
}

/** Pull order records, a reported total, and business phones out of a response. */
function parseOrders(text) {
  var objects;
  try { objects = [JSON.parse(text)]; } catch (e) { objects = extractFlight(text); }

  var orders = [], totals = [], bizPhones = {}, listLike = false;
  objects.forEach(function (o) {
    if (!o || typeof o !== "object") return;
    ["orders", "data", "rows", "results", "items", "list"].forEach(function (k) {
      if (Array.isArray(o[k])) listLike = true;
    });
    if (orderLike(o)) {
      orders.push(o);
      BIZ_PHONE_KEYS.forEach(function (k) {
        if (o[k] !== undefined && typeof o[k] !== "object") {
          var d = digits(o[k]);
          if (d.length >= 10) bizPhones[d.slice(-10)] = 1;
        }
      });
      ["business", "businessInfo", "shop", "merchant"].forEach(function (k) {
        if (o[k] && typeof o[k] === "object" && o[k].phone) {
          var d2 = digits(o[k].phone);
          if (d2.length >= 10) bizPhones[d2.slice(-10)] = 1;
        }
      });
    }
    TOTAL_KEYS.forEach(function (k) {
      var v = o[k];
      if (typeof v === "number" && v >= 0 && v < 1e9) totals.push(v);
    });
  });

  var byKey = {}, uniq = [];
  orders.forEach(function (o) {
    var key = [o.consignmentId, o.consignment_id, o.orderId, o._id, o.id, dateOf(o)]
      .filter(function (x) { return x !== undefined && x !== null; })
      .map(String).join("|");
    if (!byKey[key]) { byKey[key] = 1; uniq.push(o); }
  });

  var dates = uniq.map(dateOf).filter(Boolean).sort();
  var total = totals.length ? Math.max.apply(null, totals) : null;
  var ids = uniq.map(function (o) {
    return String(o.consignmentId || o.consignment_id || o.orderId || o.order_id ||
                  o._id || o.id || o.trackingId || dateOf(o) || "");
  }).filter(Boolean);

  if (totals.length) listLike = true;
  return { orders: uniq.length, rows: uniq.length, dates: dates, ids: ids,
           total: total, listLike: listLike, bizPhones: Object.keys(bizPhones) };
}

function summarise(dates, count, complete) {
  dates = (dates || []).slice().sort();
  var distinct = {};
  dates.forEach(function (d) { distinct[d] = 1; });
  var first = dates.length ? dates[0] : "";
  var last = dates.length ? dates[dates.length - 1] : "";
  var span = 0;
  if (first && last) {
    span = Math.round((new Date(last) - new Date(first)) / 86400000) + 1;
  }
  return {
    orders: count == null ? null : count,
    first: first,
    last: last,
    distinctDays: complete ? Object.keys(distinct).length : 0,
    spanDays: span,
    complete: !!complete
  };
}

/* ---------------- browser plumbing ---------------- */

if (typeof window === "undefined") {
  module.exports = { extractFlight: extractFlight, parseOrders: parseOrders,
                     summarise: summarise, digits: digits, num: num };
  return;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function get(params) {
  var url = new URL("/orders?" + new URLSearchParams(params).toString(), location.origin).toString();
  var variants = [
    { RSC: "1", Accept: "text/x-component" },
    { Accept: "application/json" },
    { Accept: "text/html" }
  ];
  for (var i = 0; i < variants.length; i++) {
    try {
      var res = await fetch(url, { credentials: "include", headers: variants[i] });
      if (res.status === 429) { await sleep(3000); continue; }
      if (!res.ok) continue;
      var text = await res.text();
      var parsed = parseOrders(text);
      if (parsed.orders > 0 || parsed.total != null) return { ok: true, text: text, parsed: parsed };
      if (i === variants.length - 1) return { ok: true, text: text, parsed: parsed };
    } catch (e) { /* next variant */ }
  }
  return { ok: false, text: "", parsed: { orders: 0, dates: [], total: null, bizPhones: [] } };
}

function phoneParamVariants(phone) {
  return [
    { businessPhone: phone }, { phone: phone }, { business_phone: phone },
    { businessNumber: phone }, { mobile: phone }
  ];
}

async function loadBusinesses() {
  console.log("%cLoading business list from GitHub…", "color:#2563EB");
  var res = await fetch(BIZ_URL);
  if (!res.ok) throw new Error("Could not load business list: " + res.status);
  BUSINESSES = await res.json();
  console.log("%cLoaded " + BUSINESSES.length + " businesses from Hive churn CSV + sheet", "color:#0E9F6E");
  return BUSINESSES;
}

async function control() {
  console.log("%cControl check — a nonsense phone must return 0 orders", "color:#2563EB;font-weight:bold");
  var r = await get(Object.assign({ page: "1", limit: "10" }, { businessPhone: "8800000000000" }));
  var n = r.parsed.total != null ? r.parsed.total : r.parsed.orders;
  if (n !== 0) {
    console.warn("CONTROL FAILED: nonsense phone returned " + n + " orders.");
    console.warn("That means the filter is ignored (or the route needs a different param),");
    console.warn("so every business would get the same total. Stopping.");
    console.log("First 1200 chars of that response — send this over:");
    console.log(r.text.slice(0, 1200));
    return false;
  }
  console.log("%cControl passed (0 orders for junk phone)", "color:#0E9F6E");
  return true;
}

var results = {};
var chosenVariant = null;

async function queryBusiness(b) {
  var phone = digits(b[2]);
  var attempts = phoneParamVariants(phone);
  if (chosenVariant) {
    attempts.sort(function (x) { return Object.keys(x)[0] === chosenVariant ? -1 : 1; });
  }

  for (var i = 0; i < attempts.length; i++) {
    var base = attempts[i];
    var variant = Object.keys(base)[0];

    var first = await get(Object.assign({ page: "1", limit: String(CFG.limit) }, base));
    if (!first.ok) continue;

    var sawPhone = phone.length >= 10 && first.text.indexOf(phone.slice(-10)) !== -1;
    if (!sawPhone && first.parsed.orders === 0 && first.parsed.total == null &&
        !first.parsed.listLike) continue;

    chosenVariant = variant;

    var seen = {}, daysSeen = {}, count = 0, page = 1, complete = false, bad = false;
    var cur = first, pages = 0;

    while (page <= CFG.maxPages) {
      var p = cur.parsed;
      var added = 0;
      (p.ids || []).forEach(function (id) {
        if (!seen[id]) { seen[id] = 1; count++; added++; }
      });
      (p.dates || []).forEach(function (d) { daysSeen[d] = 1; });
      pages++;

      if (p.rows < CFG.limit) { complete = true; break; }
      if (page >= CFG.maxPages) break;
      page++;

      var next = await get(Object.assign({ page: String(page), limit: String(CFG.limit) }, base));
      if (!next.ok) { bad = true; break; }
      if (page > 2) {
        var fresh = (next.parsed.ids || []).filter(function (id) { return !seen[id]; }).length;
        if (fresh === 0) { bad = true; break; }
      }
      cur = next;
      await sleep(CFG.pageDelayMs);
    }

    var dateList = Object.keys(daysSeen).sort();
    var s = {
      orders: (complete && !bad) ? count : null,
      first: (complete && !bad) ? (dateList[0] || "") : "",
      last: (complete && !bad) ? (dateList[dateList.length - 1] || "") : "",
      distinctDays: (complete && !bad) ? dateList.length : 0,
      spanDays: 0,
      complete: complete && !bad,
      pages: pages,
      seen: count,
      phoneMatched: sawPhone,
      variant: variant
    };
    if (s.first && s.last) {
      s.spanDays = Math.round((new Date(s.last) - new Date(s.first)) / 86400000) + 1;
    }
    return s;
  }

  return { orders: null, first: "", last: "", distinctDays: 0, spanDays: 0, complete: false,
           pages: 0, seen: 0, phoneMatched: false, variant: null, failed: true };
}

function saveCsv(csv) {
  try {
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hive_orders_all_" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    console.log("%cSaved to your Downloads folder", "color:#0E9F6E");
    return true;
  } catch (e) {
    console.warn("Could not save the file:", e.message);
    return false;
  }
}

function toCsv(rows) {
  var esc = function (v) {
    v = v == null ? "" : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  var head = ["Business ID", "Business Name", "Phone", "Total Orders",
              "First Order Date", "Last Order Date", "Distinct Order Days"];
  return [head.join(",")].concat(rows.map(function (r) {
    return [r.id, r.name, r.phone, r.orders, r.first, r.last, r.distinctDays].map(esc).join(",");
  })).join("\r\n");
}

async function run() {
  await loadBusinesses();
  if (!(await control())) return;
  var rows = [], failed = [], t0 = Date.now();
  var list = CFG.stopAfter ? BUSINESSES.slice(0, CFG.stopAfter) : BUSINESSES;

  console.log("%cStarting pull of " + list.length + " businesses…", "color:#2563EB;font-weight:bold");

  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    var s = await queryBusiness(b);
    var row = { id: b[0], name: b[1], phone: b[2], orders: s.orders, first: s.first,
                last: s.last, distinctDays: s.distinctDays, spanDays: s.spanDays };
    rows.push(row);
    if (s.failed || !s.phoneMatched) failed.push(row);
    if ((i + 1) % 10 === 0 || i === list.length - 1) {
      var rate = (i + 1) / ((Date.now() - t0) / 1000);
      console.log((i + 1) + "/" + list.length + "  " + b[1] + " → " +
        (s.orders == null ? "?" : s.orders) + " orders, " +
        (s.spanDays || "?") + "d span  (" + rate.toFixed(1) + "/s)");
    }
    await sleep(CFG.delayMs);
  }

  window.__hiveRowsAll = rows;
  window.__hiveCsvAll = toCsv(rows);
  var ok = rows.filter(function (r) { return r.orders != null; }).length;
  var withOrders = rows.filter(function (r) { return r.orders > 0; }).length;
  var withDates = rows.filter(function (r) { return r.first; }).length;

  console.log("%cDONE — " + ok + "/" + rows.length + " businesses with a total, " +
    withOrders + " with >0 orders, " + withDates + " with dates",
    "color:#0E9F6E;font-weight:bold");
  if (failed.length) {
    console.warn(failed.length + " business(es) did not match the filter — first few:");
    console.table(failed.slice(0, 8));
  }
  console.log("Working query param: " + (chosenVariant || "(none found)"));
  console.log(window.__hiveCsvAll.split("\r\n").slice(0, 6).join("\n") + "\n…");
  saveCsv(window.__hiveCsvAll);
  try { await navigator.clipboard.writeText(window.__hiveCsvAll); console.log("CSV also copied to clipboard"); }
  catch (e) { console.log("Clipboard blocked — the file download above still works"); }
}

window.hiveOrdersAll = {
  run: run,
  control: control,
  results: results,
  query: queryBusiness,
  load: loadBusinesses,
  save: function () {
    if (!window.__hiveCsvAll) { console.warn("Run hiveOrdersAll.run() first"); return; }
    if (!saveCsv(window.__hiveCsvAll)) console.log("Run: copy(window.__hiveCsvAll)");
  },
  probe: function (name) {
    var b = BUSINESSES.filter(function (x) { return (x[1] || "").toLowerCase().indexOf(String(name).toLowerCase()) !== -1; })[0];
    if (!b) { console.warn("No business matching " + name); return; }
    return queryBusiness(b).then(function (s) {
      console.log("probe:", b[0], b[1], JSON.stringify(s));
      return s;
    });
  }
};

console.log("%cHive orders puller (ALL merchants) loaded", "color:#2563EB;font-weight:bold");
console.log("Run:  await hiveOrdersAll.run()        — all " + BUSINESSES.length + " businesses (loads first)");
console.log("Batch: CFG.stopAfter = 500; await hiveOrdersAll.run()   — first 500 only");
console.log("Try:  await hiveOrdersAll.probe(\"Watch Hub\")  — single business first");
