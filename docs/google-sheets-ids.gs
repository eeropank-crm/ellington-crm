// Paste into Extensions > Apps Script of the SOURCE spreadsheet only.
// Run setupCrmIds once. onEdit subsequently fills missing IDs on edited client rows.
// No other source columns are changed; duplicates are rejected, never silently replaced.
function setupCrmIds() {
  fillCrmIds_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Müük"));
}
function onEdit(e) {
  if (e && e.range && e.range.getSheet().getName() === "Müük")
    fillCrmIds_(e.range.getSheet());
}
function fillCrmIds_(sheet) {
  if (!sheet) throw Error("Lehte Müük ei leitud.");
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const lastRow = sheet.getLastRow(),
      lastCol = sheet.getLastColumn();
    if (lastRow > 10000 || lastCol > 63)
      throw Error("Tabel on lubatust suurem.");
    const headers = sheet
      .getRange(1, 1, 1, lastCol)
      .getDisplayValues()[0]
      .map((x) => x.trim().toLowerCase());
    if (
      headers.filter((x) => x === "firma nimi").length !== 1 ||
      headers.filter((x) => x === "crm id").length > 1
    )
      throw Error("Kontrolli päiseid.");
    let idCol = headers.indexOf("crm id") + 1;
    const companyCol = headers.indexOf("firma nimi") + 1;
    if (!idCol) {
      idCol = lastCol + 1;
      sheet.getRange(1, idCol).setValue("CRM ID");
    }
    if (lastRow < 2) return;
    const companies = sheet
        .getRange(2, companyCol, lastRow - 1, 1)
        .getDisplayValues(),
      ids = sheet.getRange(2, idCol, lastRow - 1, 1).getDisplayValues(),
      seen = new Set();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i][0].trim().toLowerCase();
      if (!id) continue;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          id,
        ) ||
        seen.has(id)
      )
        throw Error("Korduv või vigane CRM ID.");
      seen.add(id);
    }
    // Write only previously blank ID cells; preserve all existing identifiers and other data.
    let start = 0,
      pending = [];
    const flush = () => {
      if (pending.length)
        sheet.getRange(start + 2, idCol, pending.length, 1).setValues(pending);
      pending = [];
    };
    for (let i = 0; i < ids.length; i++) {
      if (companies[i][0].trim() && !ids[i][0].trim()) {
        if (!pending.length) start = i;
        pending.push([Utilities.getUuid()]);
      } else flush();
    }
    flush();
  } finally {
    lock.releaseLock();
  }
}
