/* Hive → Churn Win Tracker puller  (paste in DevTools Console)
 * ------------------------------------------------------------
 * Hive is a Next.js App Router app: the tables you see are delivered as
 * React Server Component "flight" text, so there is no clean JSON in the
 * Network tab to copy. This script asks the same routes for the same data,
 * page by page, using your existing session cookie — it never touches your
 * access token and never sends anything off carrybee.com.
 *
 * USE
 *   1. Open https://hive.carrybee.com/businesses?isActive=true  (stay logged in)
 *   2. DevTools → Console → paste this whole file → Enter
 *   3. Wait for "DONE". It copies CSV to your clipboard and prints it.
 *      If the clipboard is blocked, run: copy(window.__hiveCsv)
 *   4. Save it as hive_export.csv and hand it over.
 *
 * If it finds nothing, it prints the raw response of page 1 — send that and
 * I'll map the fields exactly.
 */
(async function main() {
  "use strict";

  // ---------- tunables ----------
  var PAGE_PARAM_SIZE = 100;   // Hive uses ?page= and ?limit= (seen on /kams)
  var MAX_PAGES = 300;
  var ROUTE = "/businesses";
  var QUERY = { isActive: "true" };

  var ID_KEYS    = ["_id", "id", "businessId", "business_id", "shopId", "storeId", "merchantId"];
  var NAME_KEYS  = ["name", "businessName", "business_name", "shopName", "storeName", "business_name_en"];
  var PHONE_KEYS = ["phone", "phoneNumber", "phone_number", "mobile", "mobileNumber", "contactNumber", "contact", "msisdn"];
  var ORDER_KEYS = ["lifetimeOrders", "lifetime_orders", "totalOrders", "total_orders", "totalOrder",
                    "orders", "orderCount", "order_count", "deliveredOrders", "delivered_orders", "orderQty"];
  var DAY_KEYS   = ["activeDays", "active_days", "daysActive", "days_active", "activeDayCount",
                    "active_day_count", "activeDaysCount", "totalActiveDays", "daysSinceFirstOrder"];

  // ---------- small helpers ----------
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v).replace(/,/g, "").replace(/[^\d.\-]/g, "");
    if (!s || s === "-" || s === ".") return null;
    var f = parseFloat(s);
    return isFinite(f) ? f : null;
  }
  function firstKey(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return k;
    }
    return null;
  }
  function dig(obj, keys) {               // shallow: also looks one level into .business/.stats
    var flat = Object.assign({}, obj);
    ["business", "businessInfo", "Shop", "shop", "stats", "statistics", "metrics", "summary"].forEach(function (k) {
      if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) Object.assign(flat, obj[k]);
    });
    return flat;
  }

  // ---------- flight payload extraction ----------
  // Next.js flight rows look like:  2a:{"businesses":[{"_id":"...","orders":12}]}
  // and inline ones:                self.__next_f.push([1,"2a:{...}\n"])
  function extractFlight(text) {
    var out = [];
    var seen = typeof WeakSet !== "undefined" ? new WeakSet() : null;

    function walk(node, depth) {
      if (!node || depth > 10 || typeof node !== "object") return;
      if (seen) { if (seen.has(node)) return; seen.add(node); }
      if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth + 1); }); return; }
      out.push(node);
      Object.keys(node).forEach(function (k) { walk(node[k], depth + 1); });
    }

    function parseChunk(raw) {
      var s = String(raw).trim();
      if (!s) return null;
      if (s.charAt(0) === "{" || s.charAt(0) === "[") {
        try { return JSON.parse(s); } catch (e) { /* not pure JSON */ }
      }
      return null;
    }

    // 1) inline script payloads
    // matchAll only: an exec() loop is one stray /g literal away from hanging.
    for (var m of text.matchAll(/self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g)) {
      var inner;
      try { inner = JSON.parse(m[1]); } catch (e) { continue; }
      inner.split("\n").forEach(function (line) {
        var v = parseChunk(line.replace(/^[0-9a-fA-F]+:/, ""));
        if (v) walk(v, 0);
      });
    }

    // 2) plain flight stream lines
    text.split("\n").forEach(function (line) {
      var v = parseChunk(line.replace(/^[0-9a-fA-F]+:/, "").replace(/^\$/, ""));
      if (v) walk(v, 0);
    });

    return out;
  }

  // ---------- row detection ----------
  function detect(objects) {
    var counts = {}, found = [];
    objects.forEach(function (o) {
      if (!o || typeof o !== "object" || Array.isArray(o)) return;
      var f = dig(o);
      var id = firstKey(f, ID_KEYS), ord = firstKey(f, ORDER_KEYS), day = firstKey(f, DAY_KEYS);
      if (!id || (!ord && !day)) return;
      if (typeof f[id] === "object") return;
      found.push({ flat: f, idKey: id, orderKey: ord, dayKey: day });
      [["id", id], ["name", firstKey(f, NAME_KEYS)], ["phone", firstKey(f, PHONE_KEYS)],
       ["orders", ord], ["days", day]].forEach(function (p) {
        if (p[1]) counts[p[0] + ":" + p[1]] = (counts[p[0] + ":" + p[1]] || 0) + 1;
      });
    });
    // most common key wins for each field
    var best = {};
    Object.keys(counts).forEach(function (k) {
      var field = k.split(":")[0], key = k.slice(field.length + 1);
      if (!best[field] || counts[k] > counts[field + ":" + best[field]]) best[field] = key;
    });
    return { rows: found, keys: best, counts: counts };
  }

  function buildCsv(records, keys) {
    var esc = function (v) {
      v = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var head = ["Business ID", "Business Name", "Phone", "Lifetime Orders", "Active Days"];
    var lines = [head.join(",")];
    records.forEach(function (r) {
      var f = dig(r);
      lines.push([
        keys.id ? f[keys.id] : "",
        keys.name ? f[keys.name] : "",
        keys.phone ? f[keys.phone] : "",
        keys.orders ? num(f[keys.orders]) : "",
        keys.days ? num(f[keys.days]) : ""
      ].map(esc).join(","));
    });
    return lines.join("\r\n");
  }

  // ---------- fetch one page ----------
  async function fetchPage(page) {
    var qs = new URLSearchParams(Object.assign({}, QUERY, { page: String(page), limit: String(PAGE_PARAM_SIZE) }));
    var url = new URL(ROUTE + "?" + qs.toString(), location.origin).toString();

    var attempts = [
      { headers: { RSC: "1", Accept: "text/x-component" } },        // RSC flight, like the router does
      { headers: { Accept: "application/json" } },                   // plain JSON if the route supports it
      { headers: { "x-nextjs-data": "1", Accept: "application/json" } } // next/data style
    ];
    for (var i = 0; i < attempts.length; i++) {
      try {
        var res = await fetch(url, Object.assign({ credentials: "include" }, attempts[i]));
        if (!res.ok) continue;
        var text = await res.text();
        var objs = [];
        try { objs = [JSON.parse(text)]; } catch (e) { objs = extractFlight(text); }
        var hit = detect(objs);
        if (hit.rows.length) return { rows: hit, text: text };
        if (i === attempts.length - 1) return { rows: { rows: [], keys: {}, counts: {} }, text: text };
      } catch (e) { /* try next */ }
    }
    return { rows: { rows: [], keys: {}, counts: {} }, text: "" };
  }

  // ---------- main loop ----------
  var byId = {}, keys = {}, firstRaw = null, page = 1, emptyRun = 0;

  console.log("%cHive puller — starting", "color:#2563EB;font-weight:bold");

  while (page <= MAX_PAGES) {
    var got = await fetchPage(page);
    if (!firstRaw && got.text) firstRaw = got.text.slice(0, 1200);
    Object.keys(got.rows.keys).forEach(function (f) { if (!keys[f]) keys[f] = got.rows.keys[f]; });

    var fresh = 0;
    got.rows.rows.forEach(function (r) {
      var id = String(r.flat[r.idKey]);
      if (byId[id]) return;
      byId[id] = r.flat;
      fresh++;
    });

    console.log("page " + page + " → " + got.rows.rows.length + " rows (" + fresh + " new, " + Object.keys(byId).length + " total)");

    if (!fresh) { emptyRun++; if (emptyRun >= 2) break; } else emptyRun = 0;
    page++;
  }

  var records = Object.keys(byId).map(function (k) { return byId[k]; });

  if (!records.length) {
    console.warn("No rows detected. Page 1 response preview follows — send this text over:");
    console.log(firstRaw || "(empty response)");
    return;
  }

  console.log("Detected column mapping:", JSON.stringify(keys));
  console.log("Businesses collected:", records.length);

  var noOrders = records.filter(function (r) { var f = dig(r); return keys.orders ? num(f[keys.orders]) === null : true; }).length;
  var noDays = records.filter(function (r) { var f = dig(r); return keys.days ? num(f[keys.days]) === null : true; }).length;
  if (!keys.orders) console.warn("!! No lifetime-orders field detected — mapping:", JSON.stringify(keys));
  if (!keys.days) console.warn("!! No active-days field detected — mapping:", JSON.stringify(keys));
  if (noOrders) console.warn(noOrders + " row(s) have no order value");
  if (noDays) console.warn(noDays + " row(s) have no active-days value");

  var csv = buildCsv(records, keys);
  window.__hiveCsv = csv;
  window.__hiveRows = records;

  console.log(csv.split("\r\n").slice(0, 6).join("\n") + "\n…");
  try {
    await navigator.clipboard.writeText(csv);
    console.log("%cDONE — CSV (" + records.length + " rows) copied to clipboard", "color:#0E9F6E;font-weight:bold");
  } catch (e) {
    console.log("%cDONE — clipboard blocked. Run: copy(window.__hiveCsv)", "color:#B45309;font-weight:bold");
  }
})();
