/* End-to-end UI test: the real index.html talking to mock-supabase.js.
 *
 *   node test_ui.js
 *
 * Replaces the old test_sort.js, which needed the 30,507 rows inlined in the
 * page. Nothing is stubbed inside the app: the page runs its own code, makes
 * real HTTP requests to the mock PostgREST, and the assertions read the DOM.
 */
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { startMock } = require("./mock-supabase");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 6000, step = 60) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (fn()) return true; } catch (e) {}
    await sleep(step);
  }
  return false;
}

(async () => {
  const mock = await startMock({ limit: 600 });

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push((e.stack || e.message).split("\n")[0]));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ").slice(0, 200)));

  const dom = await JSDOM.fromFile(path.join(__dirname, "index.html"), {
    runScripts: "dangerously",
    virtualConsole: vc,
    url: "https://tracker.test/",
    beforeParse(window) {
      // jsdom has no fetch; hand it the runtime's, so requests really go out.
      window.fetch = (...args) => globalThis.fetch(...args);
      window.AbortController = globalThis.AbortController;
      window.localStorage.setItem("cwt.db.v1", JSON.stringify({ url: mock.url, key: "anon-test" }));
    },
  });
  const w = dom.window, d = w.document;
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const rows = () => [...d.querySelectorAll("tbody tr")];
  const cells = (tr) => [...tr.children].map((td) => td.textContent.trim());
  const orders = () => rows().map((r) => cells(r)[4]).filter((v) => v !== "—")
    .map((v) => Number(v.replace(/,/g, "")));
  const kpiVal = (label) => {
    const card = [...d.querySelectorAll(".kpi")].find((k) => k.textContent.includes(label));
    return card ? card.querySelector(".val").textContent.trim() : null;
  };

  console.log("boot");
  const rendered = await waitFor(() =>
    rows().length > 0 && !d.querySelector("tbody .empty") &&
    d.querySelector("#syncPillTxt").textContent === "Live");
  ok("page loads rows from the database", rendered, d.querySelector("#tblCount").textContent);
  ok("pill shows Live", d.querySelector("#syncPillTxt").textContent === "Live", d.querySelector("#syncPillTxt").textContent);
  ok("subtitle shows the real total", d.querySelector("#subCount").textContent.replace(/,/g, "") === String(mock.dataset.length),
     d.querySelector("#subCount").textContent);
  ok("no console errors on boot", errors.length === 0, errors[0]);
  ok("one page of rows, not the whole table", rows().length === 50, rows().length);

  console.log("\nKPI panels");
  const dash = require("./mock-supabase").dashboard(mock.dataset);
  ok("total merchants card", kpiVal("Total merchants") === String(dash.total), kpiVal("Total merchants"));
  ok("still pending card", kpiVal("Still pending") === String(dash.pending), kpiVal("Still pending"));
  ok("KAM board rendered", d.querySelectorAll(".kamcard").length === 2);
  ok("donut has segments", d.querySelectorAll("#donut circle").length > 0);
  ok("projection panel filled", d.querySelector("#pjTotal").textContent !== "—");

  console.log("\nsorting (the bug that shipped in PR #20)");
  ok("default is descending", orders().every((v, i, a) => i === 0 || a[i - 1] >= v), orders().slice(0, 5).join(","));
  const header = d.querySelector('th[data-sort="orders"]');
  ok("header has no inline onclick", !/onclick/i.test(header.outerHTML));
  const before = errors.length;
  click(header);
  await waitFor(() => d.querySelector("#pgNum").textContent.startsWith("1 /"));
  await sleep(350);
  const asc = orders();
  ok("click sorts ascending", asc.every((v, i, a) => i === 0 || a[i - 1] <= v), asc.slice(0, 5).join(","));
  ok("click throws nothing", errors.length === before, errors[before]);
  ok("glyph is a real arrow", d.querySelector("#sortdir-orders").textContent === "\u25B2",
     JSON.stringify(d.querySelector("#sortdir-orders").textContent));
  const lastQuery = mock.requests.filter((r) => r.method === "GET" && r.query.includes("order=")).pop();
  ok("the client asked the database to sort", /order=lifetime_orders\.asc\.nullslast/.test(lastQuery.query), lastQuery.query);
  ok("ascending still puts unknown counts last",
     rows().findIndex((r) => cells(r)[4] === "—") === -1 ||
     rows().slice(rows().findIndex((r) => cells(r)[4] === "—")).every((r) => cells(r)[4] === "—"));
  click(header);
  await sleep(400);
  ok("clicking again returns to descending", orders().every((v, i, a) => i === 0 || a[i - 1] >= v));

  console.log("\npagination");
  const firstIdPage1 = cells(rows()[0])[1];
  click(d.querySelector("#pgNext"));
  await waitFor(() => d.querySelector("#pgNum").textContent.startsWith("2 /"));
  await sleep(300);
  ok("next page loads different rows", cells(rows()[0])[1] !== firstIdPage1, cells(rows()[0])[1]);
  const navQuery = mock.requests.filter((r) => r.query.includes("offset=50")).pop();
  ok("offset sent to the database", !!navQuery, navQuery && navQuery.query);
  click(d.querySelector("#pgPrev"));
  await waitFor(() => d.querySelector("#pgNum").textContent.startsWith("1 /"));
  await sleep(250);
  ok("prev returns to page 1", d.querySelector("#pgNum").textContent.startsWith("1 /"));

  console.log("\nfilters");
  const fReason = d.querySelector("#fReason");
  fReason.value = "Inactive"; fire(fReason, "change");
  await waitFor(() => d.querySelector("#pgInfo").textContent.includes("of"));
  await sleep(400);
  ok("inactive filter is applied server-side",
     mock.requests.some((r) => r.query.includes("hive_churn=eq.false")));
  // The Reason column follows Hive, not the sheet label: an "Inactive only"
  // filter must never produce rows that read "Active".
  ok("inactive rows are labelled Inactive",
     rows().every((r) => cells(r)[6] === "Inactive"), cells(rows()[0])[6]);
  ok("no row is ever labelled Active",
     rows().every((r) => cells(r)[6] !== "Active"), cells(rows()[0])[6]);
  fReason.value = "Churn"; fire(fReason, "change");
  await sleep(400);
  ok("churn filter restored", rows().length > 0);
  ok("churn rows are labelled Churn",
     rows().every((r) => cells(r)[6] === "Churn"), cells(rows()[0])[6]);

  const fKam = d.querySelector("#fKam");
  fKam.value = "nahid"; fire(fKam, "change");
  await sleep(400);
  ok("kam filter is applied server-side", mock.requests.some((r) => r.query.includes("kam=eq.nahid")));
  ok("only nahid rows", rows().every((r) => r.querySelector("select.kam").value === "nahid"));
  fKam.value = ""; fire(fKam, "change");
  await sleep(300);

  const q = d.querySelector("#q");
  q.value = "shop"; fire(q, "input");
  await waitFor(() => mock.requests.some((r) => r.query.includes("shop")));
  await sleep(400);
  ok("search is debounced into one query", mock.requests.filter((r) => r.query.includes("shop")).length <= 2,
     mock.requests.filter((r) => r.query.includes("shop")).length);
  ok("search narrows the list", rows().length > 0 &&
     rows().every((r) => /shop/i.test(cells(r).slice(0, 3).join(" "))), rows().length);
  q.value = ""; fire(q, "input");
  await sleep(500);

  console.log("\nediting a call outcome");
  const before_won = Number(kpiVal("Won back"));
  const row = rows()[0];
  const id = row.querySelector("select.st").getAttribute("data-st");
  const st = row.querySelector("select.st");
  st.value = "won_back"; fire(st, "change");
  await waitFor(() => Number(kpiVal("Won back")) === before_won + 1, 5000);
  ok("PATCH reached the database", mock.requests.some((r) => r.method === "PATCH"));
  const patched = mock.dataset.find((r) => r.id === id);
  ok("the row was written", patched && patched.outcome === "won_back", patched && patched.outcome);
  ok("KPI card updated from the database", Number(kpiVal("Won back")) === before_won + 1,
     kpiVal("Won back") + " vs " + (before_won + 1));
  ok("row is marked as a win", rows().some((r) => r.className.includes("winrow")));

  console.log("\nnotes");
  const note = rows().find((r) => !r.className.includes("winrow")).querySelector("input.note");
  const noteId = note.getAttribute("data-note");
  note.value = "left a voicemail";
  fire(note, "input");
  fire(note, "blur");
  await waitFor(() => {
    const r = mock.dataset.find((x) => x.id === noteId);
    return r && r.notes === "left a voicemail";
  }, 4000);
  ok("note saved to the database", (mock.dataset.find((x) => x.id === noteId) || {}).notes === "left a voicemail",
     (mock.dataset.find((x) => x.id === noteId) || {}).notes);

  console.log("\nread-only safety");
  ok("no write attempt rewrote a task column",
     mock.dataset.every((r) => typeof r.name === "string" && r.name.length > 0));

  console.log("\nno errors overall");
  ok("console stayed clean", errors.length === 0, errors.slice(0, 2).join(" | "));

  await mock.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("CRASH", e && e.stack); process.exit(1); });
