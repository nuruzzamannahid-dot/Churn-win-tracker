/* Churn Win Tracker — Supabase data layer
 * ---------------------------------------------------------------------------
 * Talks to PostgREST with the public anon key. Nothing here caches rows: the
 * dashboard is live, so two KAMs see each other's changes on the next fetch.
 *
 * Load management, in one place:
 *   - the browser never downloads all 30,507 rows; list() asks for one page
 *   - the aggregate panels come from v_dashboard in a single request
 *   - a superseded list() call is aborted, so fast typing cannot queue up
 *     stale queries and flood the database
 *   - transient failures retry with backoff instead of hammering
 *
 * Row shape handed to the UI: the business fields the table renders, flattened.
 */
(function (root) {
  "use strict";

  var CFG_KEY = "cwt.db.v1";

  /* The project URL is not a secret — it is visible in every request the page
     makes. Baking it in means a new browser only has to be given the anon key.
     The key itself is never committed: it is typed once per browser and kept in
     localStorage, so this file stays safe to publish. */
  var DEFAULT_URL = "https://jacsvbpzkjnhrhcklyje.supabase.co";

  var cfg = { url: DEFAULT_URL, key: "" };

  function trimUrl(u) {
    return String(u || "").trim().replace(/\/+$/, "");
  }

  function configure(url, key) {
    cfg.url = trimUrl(url);
    cfg.key = String(key || "").trim();
    try {
      if (cfg.url && cfg.key) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(CFG_KEY);
    } catch (e) { /* private mode: settings live for this tab only */ }
    return cfg;
  }

  function loadConfig() {
    cfg.url = DEFAULT_URL;
    cfg.key = "";
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        var u = trimUrl(s.url);
        cfg.url = u || DEFAULT_URL;
        cfg.key = String(s.key || "").trim();
      }
    } catch (e) { cfg.url = DEFAULT_URL; cfg.key = ""; }
    return cfg;
  }

  function ready() { return !!(cfg.url && cfg.key); }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* One fetch with a timeout, a retry for transient failures, and support for
     a caller-supplied AbortSignal so a stale page request can be cancelled. */
  async function call(path, opts) {
    opts = opts || {};
    if (!ready()) throw new Error("not-configured");
    var attempt = 0, lastErr = null;
    var tries = opts.retries === undefined ? 2 : opts.retries;

    while (attempt <= tries) {
      var ctrl = new AbortController();
      var onAbort = function () { ctrl.abort(); };
      if (opts.signal) {
        if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 12000);

      try {
        var res = await fetch(cfg.url + "/rest/v1/" + path, {
          method: opts.method || "GET",
          headers: Object.assign({
            apikey: cfg.key,
            Authorization: "Bearer " + cfg.key,
            Accept: "application/json"
          }, opts.headers || {}),
          body: opts.body,
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);

        if (res.status === 401 || res.status === 403) {
          throw new Error("auth: the anon key was rejected (" + res.status + ")");
        }
        if (res.status === 404) {
          throw new Error("missing table — run supabase/schema.sql first (404)");
        }
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error("HTTP " + res.status);
          attempt++;
          if (attempt > tries) throw lastErr;
          await sleep(300 * Math.pow(2, attempt));
          continue;
        }
        if (!res.ok) {
          var detail = "";
          try { detail = (await res.text()).slice(0, 300); } catch (e) {}
          throw new Error("HTTP " + res.status + (detail ? " — " + detail : ""));
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        if (err && err.name === "AbortError") {
          // A caller abort is final; a timeout is worth retrying once.
          if (opts.signal && opts.signal.aborted) throw err;
          lastErr = new Error("timed out");
          attempt++;
          if (attempt > tries) throw lastErr;
          continue;
        }
        if (/auth:|missing table/.test(err.message)) throw err;
        lastErr = err;
        attempt++;
        if (attempt > tries) throw lastErr;
        await sleep(300 * Math.pow(2, attempt));
      }
    }
    throw lastErr || new Error("request failed");
  }

  /* ---------- row mapping ---------- */
  function toBiz(r) {
    return {
      id: String(r.id),
      reason: r.reason,
      name: r.name,
      phone: r.phone || "",
      orders: r.lifetime_orders === null || r.lifetime_orders === undefined ? null : Number(r.lifetime_orders),
      days: r.active_days === null || r.active_days === undefined ? null : Number(r.active_days),
      perMonth: r.orders_per_month === null || r.orders_per_month === undefined ? null : Number(r.orders_per_month),
      est: !!r.is_estimated,
      last: r.last_order_date || null,
      hiveChurn: !!r.hive_churn,
      kam: r.kam,
      outcome: r.outcome,
      notes: r.notes || "",
      updated: r.updated_at ? Date.parse(r.updated_at) : 0
    };
  }

  var COLUMNS = "id,reason,name,phone,lifetime_orders,active_days,orders_per_month," +
                "is_estimated,last_order_date,hive_churn,kam,outcome,notes,updated_at";

  function sortParam(key, dir) {
    var col = {
      orders: "lifetime_orders",
      days: "active_days",
      updated: "updated_at",
      name: "name"
    }[key] || "lifetime_orders";
    var d = dir === "asc" ? "asc" : "desc";
    // NULLs last in both directions: a missing count must never fill the top.
    return col + "." + d + ".nullslast";
  }

  function filterParams(f) {
    var p = [];
    if (f.reason === "Churn") p.push("hive_churn=eq.true");
    else if (f.reason === "Inactive") p.push("hive_churn=eq.false");
    if (f.kam) p.push("kam=eq." + encodeURIComponent(f.kam));
    if (f.status === "__open__") p.push("outcome=neq.pending");
    else if (f.status) p.push("outcome=eq." + encodeURIComponent(f.status));
    var q = (f.q || "").trim();
    if (q) {
      var like = "*" + q.replace(/[*,()]/g, " ") + "*";
      p.push("or=(name.ilike." + like + ",phone.ilike." + like + ",id.ilike." + like + ")");
    }
    return p;
  }

  /* One page of the table. Returns { rows, total } where total is the count of
     everything the filters match, not just this page. */
  async function list(opts) {
    opts = opts || {};
    var per = Math.max(1, opts.per || 50);
    var page = Math.max(1, opts.page || 1);
    var filters = opts.filters || {};
    var qs = ["select=" + COLUMNS,
              "order=" + sortParam(opts.sortKey, opts.sortDir),
              "limit=" + per,
              "offset=" + ((page - 1) * per)].concat(filterParams(filters));

    var res = await call("businesses?" + qs.join("&"), {
      signal: opts.signal,
      headers: { Prefer: "count=exact", "Range-Unit": "items" }
    });
    var rows;
    try { rows = await res.json(); } catch (e) { rows = []; }
    var total = rows.length;
    var cr = res.headers.get("content-range") || "";
    var m = cr.match(/\/(\d+|\*)$/);
    if (m && m[1] !== "*") total = parseInt(m[1], 10);
    return { rows: (rows || []).map(toBiz), total: total };
  }

  /* Aggregate panels: KPI cards, KAM board, donut, projection — one row. */
  async function stats() {
    var res = await call("v_dashboard?select=*", { headers: { Accept: "application/json" } });
    var rows = await res.json();
    if (!rows || !rows.length) throw new Error("v_dashboard returned no row — re-run supabase/schema.sql");
    return rows[0];
  }

  /* Write one business's call state. Only these three columns are sent, and the
     anon role is granted update on exactly these three (see schema.sql). */
  async function update(id, patch) {
    var body = {};
    ["kam", "outcome", "notes"].forEach(function (k) {
      if (patch[k] !== undefined) body[k] = patch[k];
    });
    if (!Object.keys(body).length) return null;
    var res = await call("businesses?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(body)
    });
    var out = await res.json();
    return out && out[0] ? toBiz(out[0]) : null;
  }

  /* Everything, a batch at a time, for the CSV export and backup. */
  async function fetchAll(opts) {
    opts = opts || {};
    var per = opts.batch || 1000;
    var filters = opts.filters || {};
    var out = [], page = 1, total = Infinity;
    while (out.length < total) {
      var r = await list({ page: page, per: per, filters: filters,
                           sortKey: opts.sortKey || "orders", sortDir: opts.sortDir || "desc" });
      total = r.total;
      if (!r.rows.length) break;
      out = out.concat(r.rows);
      if (opts.onProgress) opts.onProgress(out.length, total);
      page++;
      if (page > 500) break;                 // hard stop: 500k rows
    }
    return { rows: out, total: total === Infinity ? out.length : total };
  }

  async function ping() {
    var res = await call("businesses?select=id&limit=1", { retries: 0, timeout: 8000 });
    return res.ok;
  }

  root.DB = {
    configure: configure,
    defaultUrl: function () { return DEFAULT_URL; },
    loadConfig: loadConfig,
    config: function () { return { url: cfg.url, key: cfg.key }; },
    ready: ready,
    list: list,
    stats: stats,
    update: update,
    fetchAll: fetchAll,
    ping: ping,
    sortParam: sortParam,
    filterParams: filterParams,
    toBiz: toBiz,
    CFG_KEY: CFG_KEY
  };
})(typeof window !== "undefined" ? window : globalThis);
