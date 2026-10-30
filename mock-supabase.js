/* A miniature PostgREST that behaves like the Supabase schema.
 *
 *   const { startMock } = require("./mock-supabase");
 *   const mock = await startMock();      // mock.url, mock.dataset, mock.requests
 *
 * It implements only what src/db.js uses — filtered paging over `businesses`,
 * the `v_dashboard` aggregate row, and PATCH of the three call columns — but it
 * implements them the way PostgREST does, including Content-Range and
 * nullslast ordering, so the client is tested against realistic responses.
 * No network: it binds to 127.0.0.1 and is closed by mock.close().
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname);

const STATUSES = ["pending", "no_answer", "callback", "won_back", "activated",
                  "not_interested", "wrong_number"];
const WINS = ["won_back", "activated"];
const LOST = ["not_interested", "wrong_number"];

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return fallback; }
}

/* A realistic slice: the 540 sheet businesses with their real Hive numbers,
   plus 60 businesses that exist only in Hive's churn list. */
function buildDataset(limit = 600) {
  const sheet = readJson(path.join(ROOT, "src/biz_data.json"), []);
  const metrics = readJson(path.join(ROOT, "src/biz_metrics.json"), {});

  const churnIds = new Set();
  const churnCsv = path.join(ROOT, "src/hive_churn_30plus_days.csv");
  if (fs.existsSync(churnCsv)) {
    const lines = fs.readFileSync(churnCsv, "utf8").split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const id = (lines[i].split(",")[0] || "").trim();
      if (id) churnIds.add(id);
    }
  }

  const rows = new Map();
  let n = 0;
  const add = (id, reason, name, phone) => {
    if (rows.has(id) || n >= limit) return;
    const m = metrics[id] || {};
    rows.set(id, {
      id: String(id),
      reason,
      name,
      phone: phone || "",
      lifetime_orders: m.orders === undefined ? null : m.orders,
      active_days: m.days === undefined ? null : m.days,
      orders_per_month: m.orders === undefined || !m.days ? null
        : Math.round((m.orders / Math.max(1, ((Date.parse(m.last || 0) - Date.parse(m.first || 0)) / 86400000) || 30)) * 30.44 * 100) / 100,
      is_estimated: false,
      last_order_date: m.last || null,
      hive_churn: churnIds.has(String(id)),
      kam: n % 2 === 0 ? "ahmed" : "nahid",
      outcome: "pending",
      notes: "",
      updated_at: new Date(Date.UTC(2026, 9, 30, 12, 0, 0)).toISOString(),
    });
    n++;
  };

  for (const r of sheet) add(r[0], r[1], r[2], r[3]);
  for (const id of churnIds) add(id, "Churn", "Hive only " + id, "8801700000000");
  return [...rows.values()];
}

function matches(row, params) {
  for (const [k, v] of params) {
    if (k === "select" || k === "order" || k === "limit" || k === "offset") continue;
    if (k === "or") {
      const m = v.match(/^\((.*)\)$/);
      if (!m) continue;
      const terms = m[1].split(",");
      const hit = terms.some((t) => {
        const p = t.match(/^(\w+)\.ilike\.\*(.*)\*$/);
        if (!p) return false;
        return String(row[p[1]] || "").toLowerCase().includes(p[2].toLowerCase());
      });
      if (!hit) return false;
      continue;
    }
    const i = v.indexOf(".");
    const op = v.slice(0, i), val = v.slice(i + 1);
    if (op === "eq" && String(row[k]) !== val) return false;
    if (op === "neq" && String(row[k]) === val) return false;
  }
  return true;
}

function sortRows(rows, order) {
  if (!order) return rows;
  const [col, dir] = order.split(".");
  const desc = dir !== "asc";
  const val = (r) => r[col];
  return rows.slice().sort((a, b) => {
    const av = val(a), bv = val(b);
    const aNull = av === null || av === undefined;
    const bNull = bv === null || bv === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;                     // nullslast, as requested
    if (bNull) return -1;
    if (av === bv) return 0;
    return (desc ? bv > av : av > bv) ? 1 : -1;
  });
}

function dashboard(rows) {
  const count = (f) => rows.filter(f).length;
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = count((r) => r.outcome === s);
  const byKam = {};
  for (const kam of ["ahmed", "nahid"]) {
    const mine = rows.filter((r) => r.kam === kam);
    byKam[kam] = {
      assigned: mine.length,
      contacted: mine.filter((r) => r.outcome !== "pending").length,
      won: mine.filter((r) => WINS.includes(r.outcome)).length,
      wonBack: mine.filter((r) => r.outcome === "won_back").length,
      activated: mine.filter((r) => r.outcome === "activated").length,
      notInterested: mine.filter((r) => r.outcome === "not_interested").length,
      noAnswer: mine.filter((r) => r.outcome === "no_answer").length,
      callback: mine.filter((r) => r.outcome === "callback").length,
      pending: mine.filter((r) => r.outcome === "pending").length,
      churnTotal: mine.filter((r) => r.hive_churn).length,
      churnWon: mine.filter((r) => r.hive_churn && WINS.includes(r.outcome)).length,
      inactiveTotal: mine.filter((r) => !r.hive_churn).length,
      inactiveWon: mine.filter((r) => !r.hive_churn && WINS.includes(r.outcome)).length,
    };
  }
  const withRate = rows.filter((r) => r.orders_per_month !== null);
  const sum = (list, f) => Math.round(list.reduce((a, r) => a + (f(r) ? r.orders_per_month : 0), 0) * 100) / 100;
  const bucket = (r) => WINS.includes(r.outcome) ? "won" : (LOST.includes(r.outcome) ? "lost" : "open");
  const projection = {
    total: sum(withRate, () => true),
    won: sum(withRate, (r) => bucket(r) === "won"),
    lost: sum(withRate, (r) => bucket(r) === "lost"),
    open: sum(withRate, (r) => bucket(r) === "open"),
    n: withRate.length,
    est: withRate.filter((r) => r.is_estimated).length,
    excluded: rows.filter((r) => r.lifetime_orders !== null && r.orders_per_month === null).length,
    total_measured: sum(withRate.filter((r) => !r.is_estimated), () => true),
    won_measured: sum(withRate.filter((r) => !r.is_estimated), (r) => bucket(r) === "won"),
    lost_measured: sum(withRate.filter((r) => !r.is_estimated), (r) => bucket(r) === "lost"),
    open_measured: sum(withRate.filter((r) => !r.is_estimated), (r) => bucket(r) === "open"),
    n_measured: withRate.filter((r) => !r.is_estimated).length,
  };
  const today = new Date().toISOString().slice(0, 10);
  const churnRows = rows.filter((r) => r.hive_churn);
  const inactiveRows = rows.filter((r) => !r.hive_churn);
  const prog = (list) => ({
    called: list.filter((r) => r.outcome !== "pending").length,
    won: list.filter((r) => WINS.includes(r.outcome)).length,
  });
  return {
    total: rows.length,
    churn: churnRows.length,
    inactive: inactiveRows.length,
    contacted: count((r) => r.outcome !== "pending"),
    won: count((r) => WINS.includes(r.outcome)),
    pending: count((r) => r.outcome === "pending"),
    metrics_known: count((r) => r.lifetime_orders !== null),
    today_calls: rows.filter((r) => r.updated_at.slice(0, 10) === today && r.outcome !== "pending").length,
    today_wins: rows.filter((r) => r.updated_at.slice(0, 10) === today && WINS.includes(r.outcome)).length,
    by_status: byStatus,
    by_kam: byKam,
    churn_progress: prog(churnRows),
    inactive_progress: prog(inactiveRows),
    projection,
  };
}

function startMock(opts) {
  const dataset = (opts && opts.rows) || buildDataset((opts && opts.limit) || 600);
  const requests = [];
  let lastPatchBody = null;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, body, headers) => {
      res.writeHead(code, Object.assign({ "Content-Type": "application/json" }, headers || {}));
      res.end(body === undefined ? "" : JSON.stringify(body));
    };

    requests.push({ method: req.method, path: url.pathname, query: url.search });

    if (url.pathname === "/rest/v1/businesses" && req.method === "GET") {
      const params = [...url.searchParams.entries()];
      const get = (k) => (url.searchParams.get(k) || "");
      let rows = dataset.filter((r) => matches(r, params));
      const total = rows.length;
      rows = sortRows(rows, get("order"));
      const limit = parseInt(get("limit"), 10) || total;
      const offset = parseInt(get("offset"), 10) || 0;
      const slice = rows.slice(offset, offset + limit);
      const end = slice.length ? offset + slice.length - 1 : offset;
      return send(200, slice, { "Content-Range": `${offset}-${end}/${total}` });
    }

    if (url.pathname === "/rest/v1/v_dashboard" && req.method === "GET") {
      return send(200, [dashboard(dataset)]);
    }

    if (url.pathname === "/rest/v1/businesses" && req.method === "PATCH") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const patch = JSON.parse(body || "{}");
        lastPatchBody = patch;
        const idParam = get2(url).get("id") || "";
        const id = idParam.replace(/^eq\./, "");
        const row = dataset.find((r) => r.id === id);
        if (!row) return send(404, { message: "no such business" });
        for (const k of Object.keys(patch)) {
          if (!["kam", "outcome", "notes"].includes(k)) {
            return send(403, { message: "column " + k + " is not writable" });
          }
          row[k] = patch[k];
        }
        row.updated_at = new Date().toISOString();
        return send(200, [row]);
      });
      return;
    }

    send(404, { message: "not found: " + url.pathname });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        dataset,
        requests,
        lastPatch: () => lastPatchBody,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const get2 = (url) => url.searchParams;

module.exports = { startMock, dashboard, buildDataset, sortRows, matches };
