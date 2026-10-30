/* Loader for docs/hive-orders-pull-min.js
 *
 * Paste this into the console on https://hive.carrybee.com/orders and press Enter.
 * Then: HO.progress()   and   await HO.auto(500)
 *
 * Why this exists: a <script src="https://raw.githubusercontent.com/..."> tag is
 * refused by Chrome because GitHub serves .js as text/plain with nosniff. Fetching
 * the source as text and evaluating it sidesteps that, and it is the same route the
 * business list JSON uses.
 */
fetch("https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/arena/e5e02462-churn-win-tracker/docs/hive-orders-pull-min.js?v=" + Date.now())
  .then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  })
  .then(function (src) {
    (0, eval)(src);                       // runs in page scope, sets window.HO
    if (typeof window.HO === "undefined") throw new Error("loaded but HO missing");
    console.log("%cLoader OK — HO is ready", "color:#0E9F6E;font-weight:bold");
    return window.HO.progress();
  })
  .catch(function (e) {
    console.error("Loader failed:", e);
    console.warn("Fallback: open the raw URL in a new tab, select all, copy, and paste it here.");
  });
