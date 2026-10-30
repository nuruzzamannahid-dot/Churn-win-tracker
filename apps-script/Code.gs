/**
 * Churn Win Tracker — Google Sheet sync endpoint
 * ---------------------------------------------------------------
 * Sits between the dashboard and the "Churn & Inactive merchant List"
 * spreadsheet. Deploy as a Web App and paste the /exec URL into the
 * dashboard's "Sheet sync" settings.
 *
 * Sheet layout (Sheet1)
 *   A Business ID | B Reason | C Business Name | D Phone
 *   E Assigned KAM | F Outcome | G Notes | H Updated
 *   I Lifetime orders | J Avg order / day
 *
 * Routes
 *   GET  ?action=ping          -> { ok:true, ... }           (connection test)
 *   GET  ?action=rows          -> { ok:true, rows:[[...]] }  (hydrate dashboard)
 *   POST {updates:[...]}       -> writes E..H for each Business ID
 *
 * Setup
 *   1. Sheet -> Extensions -> Apps Script, paste this file over Code.gs
 *   2. Set SPREADSHEET_ID below (or leave blank when bound to the sheet)
 *   3. Deploy -> New deployment -> Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   4. Authorise, copy the /exec URL, paste it into the dashboard
 *
 * Re-deploying after an edit: Deploy -> Manage deployments -> edit ->
 * Version: New version. The /exec URL stays the same.
 */

var SPREADSHEET_ID = '1X0ILBCnzOp8xAGmvCyE5GuIt7wzr-r8K7DgQZsqWieY';
var SHEET_NAME = 'Sheet1';

// Column indexes (0-based): E=4 KAM, F=5 Outcome, G=6 Notes, H=7 Updated,
// I=8 lifetime orders, J=9 average order per active day.
var COL_KAM = 4, COL_OUTCOME = 5, COL_NOTES = 6, COL_UPDATED = 7;
var COL_ORDERS = 8, COL_AVG = 9;
var LAST_COL = 10;

function getSheet_() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  // make sure the headers exist
  var want = {
    4: 'Assigned KAM', 5: 'Outcome', 6: 'Notes', 7: 'Updated',
    8: 'Lifetime orders', 9: 'Avg order / day'
  };
  var hdr = sh.getRange(1, 1, 1, LAST_COL).getValues()[0];
  var dirty = false;
  Object.keys(want).forEach(function (i) {
    if (!hdr[i]) { hdr[i] = want[i]; dirty = true; }
  });
  if (dirty) sh.getRange(1, 1, 1, LAST_COL).setValues([hdr]);

  return sh;
}

function has_(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** Business ID -> row number (1-based), computed once per request. */
function idIndex_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return {};
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  var map = {};
  for (var i = 0; i < ids.length; i++) {
    var v = String(ids[i][0] == null ? '' : ids[i][0]).trim();
    if (v) map[v] = i + 2;
  }
  return map;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** GET: ping or full row dump. */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'rows';
    var sh = getSheet_();

    if (action === 'ping') {
      return json_({ ok: true, sheet: sh.getName(), rows: Math.max(0, sh.getLastRow() - 1), at: new Date().toISOString() });
    }

    var last = sh.getLastRow();
    var rows = [];
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, 8).getValues();
      for (var i = 0; i < vals.length; i++) {
        var id = String(vals[i][0] == null ? '' : vals[i][0]).trim();
        if (!id) continue;
        // only rows that carry tracker data
        if (!vals[i][COL_KAM] && !vals[i][COL_OUTCOME] && !vals[i][COL_NOTES] && !vals[i][COL_UPDATED]) continue;
        rows.push([
          id,
          vals[i][COL_KAM] || '',
          vals[i][COL_OUTCOME] || '',
          vals[i][COL_NOTES] || '',
          vals[i][COL_UPDATED] ? new Date(vals[i][COL_UPDATED]).toISOString() : ''
        ]);
      }
    }
    return json_({ ok: true, count: rows.length, rows: rows, at: new Date().toISOString() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * POST body: { updates: [ { id, kam, outcome, notes, updated, orders, avg }, ... ] }
 * Writes whichever of E..J the update carries. Unknown IDs are reported back,
 * not created.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);   // serialise the two KAMs writing at once

    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    } else if (e && e.parameter && e.parameter.payload) {
      body = JSON.parse(e.parameter.payload);
    }

    var updates = body.updates || (body.id ? [body] : []);
    if (!updates.length) return json_({ ok: false, error: 'no updates in payload' });

    var sh = getSheet_();
    var idx = idIndex_(sh);

    var written = 0, skipped = [], maxRow = sh.getLastRow();

    updates.forEach(function (u) {
      var id = String(u.id == null ? '' : u.id).trim();
      var row = idx[id];
      if (!row) { skipped.push(id); return; }

      // Only touch a column when the update actually carries that field. An
      // orders-only push must not blank another KAM's notes.
      if (has_(u, 'kam'))     sh.getRange(row, COL_KAM + 1).setValue(u.kam || '');
      if (has_(u, 'outcome')) sh.getRange(row, COL_OUTCOME + 1).setValue(u.outcome || '');
      if (has_(u, 'notes'))   sh.getRange(row, COL_NOTES + 1).setValue(u.notes || '');
      if (has_(u, 'updated')) {
        var updated = u.updated ? new Date(u.updated) : new Date();
        if (isNaN(updated.getTime())) updated = new Date();
        sh.getRange(row, COL_UPDATED + 1).setValue(updated);
      }
      if (has_(u, 'orders')) {
        sh.getRange(row, COL_ORDERS + 1)
          .setValue(u.orders === null || u.orders === '' || u.orders === undefined ? '' : u.orders);
      }
      if (has_(u, 'avg')) {
        var a = u.avg;
        sh.getRange(row, COL_AVG + 1)
          .setValue(a === null || a === '' || a === undefined ? '' : Math.round(a * 100) / 100);
      }
      written++;
    });

    SpreadsheetApp.flush();
    return json_({
      ok: written > 0,
      written: written,
      skipped: skipped,
      total: updates.length,
      at: new Date().toISOString()
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** Optional: run once from the editor to verify wiring. */
function testWrite() {
  var sh = getSheet_();
  var idx = idIndex_(sh);
  var first = Object.keys(idx)[0];
  if (!first) return Logger.log('No business IDs found in column A');
  var row = idx[first];
  sh.getRange(row, COL_KAM + 1, 1, 4).setValues([['Ahmed Asif Rashid', 'Pending', 'connection test', new Date()]]);
  SpreadsheetApp.flush();
  Logger.log('Wrote test row for Business ID ' + first + ' at sheet row ' + row);
}
