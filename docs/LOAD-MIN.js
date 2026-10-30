/* Loader for docs/hive-orders-pull-min.js — loads it AND starts pulling.
 *
 * Paste this whole file into the console on https://hive.carrybee.com/orders
 * and press Enter. That is the only step.
 *
 *   HO.progress()   how many of 30,507 are collected
 *   HO.stop()       pause after the current batch
 *   HO.auto(500)    resume (progress is kept in localStorage)
 *
 * Why a loader at all: a <script src="...raw.githubusercontent.com..."> tag is
 * refused because GitHub serves .js as text/plain with nosniff. Fetching the
 * text and evaluating it sidesteps that, and it is the same route the business
 * list JSON already loads through.
 *
 * Why it starts the pull itself: with two separate commands, running the second
 * before the first finished fetching throws "HO is not defined" and looks like
 * a broken script. One paste, one await.
 */
(function () {
  "use strict";
  var SOURCES = [
    "https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/main/docs/hive-orders-pull-min.js",
    "https://cdn.jsdelivr.net/gh/nuruzzamannahid-dot/Churn-win-tracker@main/docs/hive-orders-pull-min.js"
  ];
  var BATCH = 500;

  function tryFetch(i) {
    if (i >= SOURCES.length) throw new Error("all sources failed");
    var url = SOURCES[i] + "?v=" + Date.now();
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .catch(function (e) {
        console.warn("source " + (i + 1) + " failed (" + e.message + "), trying next");
        return tryFetch(i + 1);
      });
  }

  console.log("%cFetching the Hive orders puller…", "color:#2563EB;font-weight:bold");

  tryFetch(0)
    .then(function (src) {
      (0, eval)(src);                       // sets window.HO in page scope
      if (typeof window.HO === "undefined") throw new Error("loaded but HO is missing");
      console.log("%cLoader OK — starting the pull", "color:#0E9F6E;font-weight:bold");
      window.HO.progress();
      return window.HO.auto(BATCH);
    })
    .catch(function (e) {
      console.error("Loader failed:", e);
      console.warn("Fallback: open one of these URLs in a new tab, select all, copy, paste here:");
      SOURCES.forEach(function (u) { console.warn("  " + u); });
    });
})();
