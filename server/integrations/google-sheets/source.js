"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { fail, columns } = require("./model");
function config(env = process.env) {
  const enabled = env.CRM_SHEETS_ENABLED === "1",
    id = env.CRM_SHEETS_SPREADSHEET_ID || "",
    tab = env.CRM_SHEETS_TAB || "Müük",
    file = env.CRM_SHEETS_CREDENTIALS_FILE || "",
    owner = Number(env.CRM_SHEETS_DEFAULT_OWNER_ID);
  return {
    enabled,
    id,
    tab,
    file,
    owner,
    configured:
      /^[a-zA-Z0-9_-]{20,150}$/.test(id) &&
      tab.length > 0 &&
      tab.length <= 100 &&
      path.isAbsolute(file) &&
      Number.isSafeInteger(owner) &&
      owner > 0,
  };
}
async function json(response, max = 4 * 1024 * 1024) {
  if (!response.ok) fail("SHEETS_HTTP");
  let size = 0,
    parts = [];
  for await (const part of response.body) {
    size += part.length;
    if (size > max) fail("SHEETS_SIZE");
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString());
  } catch {
    fail("SHEETS_RESPONSE");
  }
}
async function read(
  c,
  { fetch = globalThis.fetch, now = () => Date.now() } = {},
) {
  if (!c.configured) fail("SHEETS_CONFIG");
  let account;
  try {
    const stat = fs.statSync(c.file);
    if (
      !stat.isFile() ||
      stat.mode & 0o077 ||
      stat.size > 65536 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      fail("SHEETS_CREDENTIALS");
    account = JSON.parse(fs.readFileSync(c.file, "utf8"));
    if (
      account.type !== "service_account" ||
      typeof account.client_email !== "string" ||
      !account.client_email.endsWith(".gserviceaccount.com") ||
      typeof account.private_key !== "string"
    )
      fail("SHEETS_CREDENTIALS");
  } catch {
    fail("SHEETS_CREDENTIALS");
  }
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
    seconds = Math.floor(now() / 1000);
  let assertion;
  try {
    const head = b64({ alg: "RS256", typ: "JWT" }),
      body = b64({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
        aud: "https://oauth2.googleapis.com/token",
        iat: seconds,
        exp: seconds + 300,
      });
    const unsigned = head + "." + body;
    assertion =
      unsigned +
      "." +
      crypto
        .sign("RSA-SHA256", Buffer.from(unsigned), account.private_key)
        .toString("base64url");
  } catch {
    fail("SHEETS_CREDENTIALS");
  }
  const request = (url, options = {}) =>
    fetch(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  const token = await json(
    await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    }),
    65536,
  );
  if (typeof token.access_token !== "string" || !token.access_token)
    fail("SHEETS_AUTH");
  const headers = { Authorization: "Bearer " + token.access_token },
    base =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(c.id);
  const metadata = await json(
    await request(base + "?fields=sheets.properties", { headers }),
    131072,
  );
  const matches = (metadata.sheets || []).filter(
    (s) => s.properties?.title === c.tab,
  );
  if (matches.length !== 1) fail("SHEETS_TAB");
  const grid = matches[0].properties.gridProperties;
  if (
    !grid ||
    grid.rowCount > 10000 ||
    grid.columnCount > 64 ||
    grid.rowCount < 2
  )
    fail("SHEETS_SIZE");
  let col = "",
    n = grid.columnCount;
  while (n) {
    n--;
    col = String.fromCharCode(65 + (n % 26)) + col;
    n = Math.floor(n / 26);
  }
  const tab = "'" + c.tab.replace(/'/g, "''") + "'!";
  const headerResult = await json(
    await request(
      base +
        "/values/" +
        encodeURIComponent(tab + "A1:" + col + "1") +
        "?valueRenderOption=FORMATTED_VALUE",
      { headers },
    ),
  );
  const header = headerResult.values?.[0],
    mapping = columns(header);
  const selected = [
    ...new Set([
      ...Object.values(mapping.indexes),
      ...[
        "allikas",
        "potensiaal 1-5",
        "huvi tase 1-5",
        "tõenäeosus %",
        "staatus",
      ]
        .map((name) => mapping.headers.indexOf(name))
        .filter((i) => i >= 0),
    ]),
  ];
  const letter = (index) => {
    let out = "",
      n = index + 1;
    while (n) {
      n--;
      out = String.fromCharCode(65 + (n % 26)) + out;
      n = Math.floor(n / 26);
    }
    return out;
  };
  const params = new URLSearchParams({
    majorDimension: "COLUMNS",
    valueRenderOption: "FORMATTED_VALUE",
  });
  for (const index of selected) {
    const col = letter(index);
    params.append("ranges", tab + col + "2:" + col + grid.rowCount);
  }
  const result = await json(
    await request(base + "/values:batchGet?" + params, { headers }),
  );
  if (
    !Array.isArray(result.valueRanges) ||
    result.valueRanges.length !== selected.length
  )
    fail("SHEETS_RESPONSE");
  const values = [header];
  for (let i = 0; i < selected.length; i++) {
    const cells = result.valueRanges[i].values?.[0] || [];
    if (!Array.isArray(cells) || cells.length > grid.rowCount - 1)
      fail("SHEETS_RESPONSE");
    for (let row = 0; row < cells.length; row++) {
      values[row + 1] ||= [];
      values[row + 1][selected[i]] = cells[row];
    }
  }
  // Refuse a column-layout change while the separate header/data reads were in flight.
  const finalHeader = await json(
    await request(
      base +
        "/values/" +
        encodeURIComponent(tab + "A1:" + col + "1") +
        "?valueRenderOption=FORMATTED_VALUE",
      { headers },
    ),
  );
  if (JSON.stringify(finalHeader.values?.[0]) !== JSON.stringify(header))
    fail("SHEETS_HEADERS");
  return values;
}
module.exports = { config, read };
