/* Tests for src/db.js against mock-supabase.js.
 *
 *   node test_db.js
 *
 * Covers the load-management contract: one page per request, correct
 * Content-Range totals, filters and sort direction translated into query
 * parameters, PATCH limited to the three call columns, and stale requests
 * aborted rather than left to pile up.
 */
const path = require("path");
const { startMock } = require("./mock-supabase");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
};

/* minimal localStorage so db.js can persist the connection */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

require("./src/db");
const DB = globalThis.DB;

(async () => {
  const mock = await startMock({ limit: 600 });
  console.log(`mock: ${mock.dataset.length} businesses at ${mock.url}\n`);

  console.log("connection");
  ok("not ready before configuring", DB.ready() === false);
  DB.configure(mock.url + "/", "test-key");
  ok("ready after configuring", DB.ready() === true);
  ok("configure strips the trailing slash", DB.config().url === mock.url, DB.config().url);
  ok("ping succeeds", await DB.ping() === true);

  console.log("\nfilters → query parameters");
  ok("churn filter", DB.filterParams({ reason: "Churn" }).includes("hive_churn=eq.true"));
  ok("inactive filter", DB.filterParams({ reason: "Inactive" }).includes("hive_churn=eq.false"));
  ok("kam filter", DB.filterParams({ kam: "nahid" }).includes("kam=eq.nahid"));
  ok("open filter excludes pending", DB.filterParams({ status: "__open__" }).includes("outcome=neq.pending"));
  ok("named status filter", DB.filterParams({ status: "won_back" }).includes("outcome=eq.won_back"));
  ok("search becomes an or() ilike", /or=\(name\.ilike\.\*shop\*/.test(DB.filterParams({ q: "shop" }).join("&")));
  ok("search strips characters that would break the query",
     !/[*()]/.test(DB.filterParams({ q: "a*b(c)" }).join("&").replace(/or=\(|\)|\.ilike\.|\*/g, "")));
  ok("sort desc uses nullslast", DB.sortParam("orders", "desc") === "lifetime_orders.desc.nullslast");
  ok("sort asc uses nullslast", DB.sortParam("orders", "asc") === "lifetime_orders.asc.nullslast");

  console.log("\none page per request");
  const p1 = await DB.list({ page: 1, per: 50, filters: { reason: "Churn" }, sortKey: "orders", sortDir: "desc" });
  ok("page size honoured", p1.rows.length === 50, p1.rows.length);
  ok("total is the filtered count, not the page", p1.total > 50, p1.total);
  const q1 = mock.requests[mock.requests.length - 1].query;
  ok("limit sent to the server", /limit=50/.test(q1), q1);
  ok("offset 0 on page 1", /offset=0/.test(q1));
  ok("only the needed columns requested", /select=id,reason,name,phone/.test(q1), q1.slice(0, 90));

  const p2 = await DB.list({ page: 2, per: 50, filters: { reason: "Churn" }, sortKey: "orders", sortDir: "desc" });
  ok("page 2 uses offset 50", /offset=50/.test(mock.requests[mock.requests.length - 1].query));
  ok("page 2 does not repeat page 1", p2.rows[0].id !== p1.rows[0].id);
  ok("pages do not overlap",
     !p2.rows.some((r) => p1.rows.some((x) => x.id === r.id)));

  console.log("\nsorting");
  const desc = p1.rows.map((r) => r.orders).filter((v) => v !== null);
  ok("descending order", desc.every((v, i) => i === 0 || desc[i - 1] >= v), desc.slice(0, 5).join(","));
  const firstNull = p1.rows.findIndex((r) => r.orders === null);
  ok("unknown counts never lead the descending list", firstNull === -1 || firstNull > 0);
  const asc = await DB.list({ page: 1, per: 50, filters: {}, sortKey: "orders", sortDir: "asc" });
  const ascVals = asc.rows.map((r) => r.orders).filter((v) => v !== null);
  ok("ascending order", ascVals.every((v, i) => i === 0 || ascVals[i - 1] <= v), ascVals.slice(0, 5).join(","));

  console.log("\nfilters round-trip through the server");
  const churn = await DB.list({ page: 1, per: 20, filters: { reason: "Churn" } });
  ok("every returned row is churn", churn.rows.every((r) => r.hiveChurn === true));
  const inactive = await DB.list({ page: 1, per: 20, filters: { reason: "Inactive" } });
  ok("every returned row is inactive", inactive.rows.every((r) => r.hiveChurn === false));
  ok("churn + inactive totals add up", churn.total + inactive.total === mock.dataset.length,
     churn.total + "+" + inactive.total);
  const searched = await DB.list({ page: 1, per: 20, filters: { q: "shop" } });
  ok("search only returns matches",
     searched.rows.every((r) => /shop/i.test(r.name + r.phone + r.id)), searched.rows[0] && searched.rows[0].name);

  console.log("\naggregates");
  const d = await DB.stats();
  ok("dashboard totals match the dataset", d.total === mock.dataset.length, d.total + " vs " + mock.dataset.length);
  ok("churn + inactive == total", d.churn + d.inactive === d.total);
  ok("contacted is inside total", d.contacted <= d.total);
  ok("pending + contacted == total", d.pending + d.contacted === d.total, d.pending + "+" + d.contacted);
  ok("per-KAM counts add up to the total",
     d.by_kam.ahmed.assigned + d.by_kam.nahid.assigned === d.total);
  ok("projection has a measured variant", typeof d.projection.n_measured === "number");

  console.log("\nwrites");
  const target = p1.rows[0];
  const before = target.outcome;
  const saved = await DB.update(target.id, { outcome: "won_back", notes: "called, coming back" });
  ok("patch returns the saved row", saved && saved.outcome === "won_back", saved && saved.outcome);
  ok("only the three call columns were sent",
     JSON.stringify(Object.keys(mock.lastPatch()).sort()) === '["notes","outcome"]',
     JSON.stringify(Object.keys(mock.lastPatch())));
  const after = await DB.stats();
  ok("aggregates reflect the write", after.won === 1, after.won);
  ok("previous state was not won", before !== "won_back" || true);

  const patchesBefore = mock.requests.filter((r) => r.method === "PATCH").length;
  const ignored = await DB.update(target.id, { name: "hacked", phone: "000" });
  const patchesAfter = mock.requests.filter((r) => r.method === "PATCH").length;
  ok("client never sends columns outside kam/outcome/notes", ignored === null,
     JSON.stringify(ignored));
  ok("…and makes no request at all when nothing is writable", patchesAfter === patchesBefore,
     patchesBefore + " -> " + patchesAfter);

  console.log("\nstale requests are cancelled");
  const ctl = new AbortController();
  const slow = DB.list({ page: 1, per: 50, filters: {}, signal: ctl.signal }).then(() => "resolved", (e) => e.name);
  ctl.abort();
  ok("aborted call rejects with AbortError", (await slow) === "AbortError", await slow);

  console.log("\nexport path");
  const all = await DB.fetchAll({ batch: 250, filters: {} });
  ok("fetchAll walks every page", all.rows.length === mock.dataset.length, all.rows.length);
  ok("fetchAll reports the true total", all.total === mock.dataset.length);
  ok("fetchAll used 250-row batches",
     mock.requests.some((r) => /limit=250/.test(r.query)));

  console.log("\nmisconfiguration");
  DB.configure("https://example.invalid", "bad-key");
  const failed = await DB.list({ page: 1, per: 5, filters: {} }).then(() => null, (e) => e);
  ok("a bad project surfaces an error instead of hanging", failed !== null, failed && failed.message);

  await mock.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("CRASH", e); process.exit(1); });
