"use strict";
class SyncError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}
const fail = (code, details = {}) => {
  throw new SyncError(code, details);
};
const fields = {
  company: ["firma nimi", 255],
  name: ["inimese nimi", 150],
  email: ["meiliaadress", 255],
  phone: ["telefon", 100],
};
function columns(values) {
  if (!Array.isArray(values)) fail("SHEETS_HEADERS");
  const headers = values.map((v) => String(v).trim().toLowerCase());
  const indexes = {};
  for (const [key, [name]] of Object.entries({
    ...fields,
    id: ["crm id"],
    status: ["staatus"],
  })) {
    const matches = headers.flatMap((h, i) => (h === name ? [i] : []));
    if (matches.length !== 1) fail("SHEETS_HEADERS");
    indexes[key] = matches[0];
  }
  const owners = headers.flatMap((h, i) => (h === "vastutaja" ? [i] : []));
  if (owners.length === 1) indexes.owner = owners[0];
  else if (!owners.length && headers[1] === "faas" && headers[2] === "faas")
    indexes.owner = 2;
  else fail("SHEETS_HEADERS");
  return { headers, indexes };
}
function parse(values) {
  if (!Array.isArray(values) || !Array.isArray(values[0]))
    fail("SHEETS_HEADERS");
  const { headers, indexes } = columns(values[0]);
  const seen = new Set(),
    rows = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i];
    if (!Array.isArray(raw)) fail("SHEETS_ROWS");
    const company = String(raw[indexes.company] ?? "").trim();
    if (!company) continue;
    const id = String(raw[indexes.id] ?? "")
      .trim()
      .toLowerCase();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        id,
      ) ||
      seen.has(id)
    )
      fail("SHEETS_IDS", { row: i + 1, field: "id" });
    seen.add(id);
    const data = {};
    for (const [key, [, limit]] of Object.entries(fields)) {
      data[key] = String(raw[indexes[key]] ?? "").trim();
      if (data[key].length > limit || /[\u0000-\u001f\u007f]/.test(data[key]))
        fail("SHEETS_VALUES", { row: i + 1, field: key });
    }
    if (
      data.email &&
      !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(data.email)
    )
      fail("SHEETS_VALUES", { row: i + 1, field: "email" });
    const metadata = {};
    for (const label of [
      "allikas",
      "potensiaal 1-5",
      "huvi tase 1-5",
      "tõenäeosus %",
    ]) {
      const col = headers.indexOf(label);
      if (col >= 0) {
        metadata[label] = String(raw[col] ?? "").trim();
        if (metadata[label].length > 1000 || /\u0000/.test(metadata[label]))
          fail("SHEETS_VALUES");
      }
    }
    const statusColumn = headers.indexOf("staatus"),
      lifecycleHint =
        statusColumn < 0 ? "" : String(raw[statusColumn] ?? "").trim();
    if (lifecycleHint.length > 1000 || /\u0000/.test(lifecycleHint))
      fail("SHEETS_VALUES");
    const ownerMarker = String(raw[indexes.owner] ?? "")
      .trim()
      .toUpperCase();
    if (!["", "E", "P", "I"].includes(ownerMarker))
      fail("SHEETS_OWNER_MARKER", { row: i + 1, field: "owner" });
    rows.push({ id, row: i + 1, data, metadata, lifecycleHint, ownerMarker });
  }
  return rows;
}
function slot(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Tallinn",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (
    ["Sat", "Sun"].includes(parts.weekday) ||
    ![9, 12, 15, 18].includes(Number(parts.hour))
  )
    return null;
  return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour;
}
function diagnostic(error) {
  const result = {
    code: error instanceof SyncError ? error.code : "SHEETS_FAILED",
  };
  if (
    error instanceof SyncError &&
    Number.isSafeInteger(error.details?.row) &&
    error.details.row >= 2
  )
    result.row = error.details.row;
  if (
    error instanceof SyncError &&
    (Object.hasOwn(fields, error.details?.field || "") ||
      ["id", "owner"].includes(error.details?.field))
  )
    result.field = error.details.field;
  return result;
}
function ownerId(config, marker = "") {
  if (!["", "E", "P", "I"].includes(marker)) fail("SHEETS_OWNER_MARKER");
  const id =
    marker === "P"
      ? config.ownerP
      : marker === "I"
        ? config.ownerI
        : config.owner;
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    ((marker === "P" || marker === "I") &&
      (id === config.owner || config.ownerP === config.ownerI))
  )
    fail("SHEETS_OWNER");
  return id;
}
module.exports = {
  ownerId,
  diagnostic,
  SyncError,
  fail,
  parse,
  slot,
  fields,
  columns,
};
