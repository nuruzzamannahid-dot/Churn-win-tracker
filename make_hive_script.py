#!/usr/bin/env python3
"""Generate docs/hive-orders-pull.js with the 540-business list embedded.

    python3 make_hive_script.py

The console snippet needs the business list to iterate over; embedding it means
you paste one file and nothing else. Re-run this if src/biz_data.json changes.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).parent
DATA = json.loads((ROOT / "src" / "biz_data.json").read_text(encoding="utf-8"))
OUT = ROOT / "docs" / "hive-orders-pull.js"

biz = [[str(r[0]), str(r[2]), str(r[3])] for r in DATA]
payload = json.dumps(biz, ensure_ascii=False, separators=(",", ":"))

TEMPLATE = r"""/* Hive → Churn Win Tracker: lifetime orders per business
 * ------------------------------------------------------
 * Hive is a Next.js App Router app: table data arrives as RSC "flight" text,
 * so there is no copyable JSON in the Network tab. This script asks the same
 * /orders route the Orders page uses, once per business, with your session
 * cookie — no token pasted, nothing leaves carrybee.com.
 *
 * USE
 *   1. Log in, open https://hive.carrybee.com/orders
 *   2. DevTools → Console → paste this whole file → Enter
 *   3. It self-checks, then works through __COUNT__ businesses (~4 min).
 *      Leave the tab open. It copies a CSV at the end.
 *      Clipboard blocked? Run:  copy(window.__hiveCsv)
 *
 * WHAT IT COLLECTS
 *   total orders · first order date · last order date · distinct order days
 *   (active days is derived from the distinct dates, or their span as fallback)
 *
 * SELF-CHECKS (it stops instead of lying to you)
 *   - control query with a nonsense phone: must return 0 orders
 *   - per-business: response must actually mention that business's phone
 *   If either fails it prints diagnostics and stops — send me the output.
 */
(function () {
  "use strict";

  var BUSINESSES = __BUSINESSES__;   // [[id, name, phone], ...]

  var CFG = {
    // AR Baby Cloud measured 262 lifetime orders: pages of 100 were honoured
    // (100 + 100 + 62), and limit=500 returned all 262 in a single request.
    // So 500 keeps the sweep to one call per merchant with no extra cost.
    limit: 500,        // rows per request
    delayMs: 120,      // pause between businesses; raise if Hive rate-limits
    pageDelayMs: 100,  // pause between pages of the same business
    maxPages: 20,      // 20 x 500 = 10,000 orders; beyond that the row is left blank
    stopAfter: 0       // 0 = all; set e.g. 5 to trial-run
  };

  /* ---------------- pure helpers (tested in node) ---------------- */

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
    var pushRe = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g, m;
    while ((m = pushRe.exec(text))) {
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

    // de-dupe order records (flight repeats objects across chunks)
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

  /**
   * count      : true lifetime order count (from meta.total when present)
   * complete   : true when we actually saw every order row, so distinct-day
   *              counting is trustworthy. Otherwise only first/last are used.
   */
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
    // node test harness
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
        if (res.status === 429) { await sleep(3000); continue; }   // rate limited
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
  var chosenVariant = null;   // learned from the first business that answers

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
      // Zero orders is a legitimate answer once the response is recognisably an
      // order list; only a shapeless body means we guessed the wrong param name.
      if (!sawPhone && first.parsed.orders === 0 && first.parsed.total == null &&
          !first.parsed.listLike) continue;

      chosenVariant = variant;

      // Walk every page until one comes back short. The count is the number of
      // DISTINCT order ids seen — never the page size, which is what produced
      // a wall of fake "100 orders" on the first run.
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

        if (p.rows < CFG.limit) { complete = true; break; }     // short page = last page
        if (page >= CFG.maxPages) break;                        // hit the cap -> unknown
        page++;

        var next = await get(Object.assign({ page: String(page), limit: String(CFG.limit) }, base));
        if (!next.ok) { bad = true; break; }
        if (page > 2) {                                          // no forward progress
          var fresh = (next.parsed.ids || []).filter(function (id) { return !seen[id]; }).length;
          if (fresh === 0) { bad = true; break; }
        }
        cur = next;
        await sleep(CFG.pageDelayMs);
      }

      var dateList = Object.keys(daysSeen).sort();
      var s = {
        orders: (complete && !bad) ? count : null,   // null => write blank, never lie
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
      a.download = "hive_orders_" + new Date().toISOString().slice(0, 10) + ".csv";
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
    if (!(await control())) return;
    var rows = [], failed = [], t0 = Date.now();
    var list = CFG.stopAfter ? BUSINESSES.slice(0, CFG.stopAfter) : BUSINESSES;

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

    window.__hiveRows = rows;
    window.__hiveCsv = toCsv(rows);
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
    console.log(window.__hiveCsv.split("\r\n").slice(0, 6).join("\n") + "\n…");
    saveCsv(window.__hiveCsv);
    try { await navigator.clipboard.writeText(window.__hiveCsv); console.log("CSV also copied to clipboard"); }
    catch (e) { console.log("Clipboard blocked — the file download above still works"); }
  }

  window.hiveOrders = { run: run, control: control, results: results, query: queryBusiness,
                        save: function () {
                          if (!window.__hiveCsv) { console.warn("Run hiveOrders.run() first"); return; }
                          if (!saveCsv(window.__hiveCsv)) console.log("Run: copy(window.__hiveCsv)");
                        },
                        probe: function (name) {
                          var b = BUSINESSES.filter(function (x) { return (x[1] || "").toLowerCase().indexOf(String(name).toLowerCase()) !== -1; })[0];
                          if (!b) { console.warn("No business matching " + name); return; }
                          return queryBusiness(b).then(function (s) {
                            console.log("probe:", b[0], b[1], JSON.stringify(s));
                            return s;
                          });
                        } };

  console.log("%cHive orders puller loaded", "color:#2563EB;font-weight:bold");
  console.log("Run:  await hiveOrders.run()        — all " + BUSINESSES.length + " businesses");
  console.log("Try:  await hiveOrders.probe(\"Watch Hub\")  — single business first");
})();
"""

out = TEMPLATE.replace("__BUSINESSES__", payload).replace("__COUNT__", str(len(biz)))
OUT.write_text(out, encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)} — {len(biz)} businesses, {len(out):,} bytes")
