const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  path = require("node:path"),
  fs = require("node:fs"),
  os = require("node:os"),
  express = require("express");
if (!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME || ""))
  throw Error("Synthetic DB required");
const db = require("../server/db");
require("../scripts/local-database")(db);
const model = require("../server/integrations/google-sheets/model"),
  source = require("../server/integrations/google-sheets/source"),
  create = require("../server/integrations/google-sheets/service");
const headers = [
  "firma nimi",
  "inimese nimi",
  "meiliaadress",
  "telefon",
  "Faas",
  "Faas",
  "followupide arv",
  "staatus",
  "CRM ID",
  "allikas",
];
const makeRow = (company = "Synthetic Company " + crypto.randomUUID()) => [
  company,
  "Synthetic Person",
  "person" + crypto.randomUUID() + "@example.invalid",
  "+372000000",
  "ignored",
  "ignored",
  "999",
  "",
  crypto.randomUUID(),
  "Synthetic marketing",
];
let user,
  env,
  rows = [],
  service,
  actor,
  server,
  base,
  readCalls = 0;
const data = () => [headers, ...rows.map((r) => [...r])];
const sync = () => service.sync({ manual: true });
async function record(id) {
  return db("crm_sheet_sync_records").where({ source_id: id }).first();
}
async function state(id) {
  return JSON.parse((await record(id)).state);
}
async function version(id) {
  return crypto
    .createHash("sha256")
    .update((await record(id)).state)
    .digest("hex");
}
async function api(route = "", body, status = 200) {
  const r = await fetch(base + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const x = await r.json();
  assert.equal(r.status, status, JSON.stringify(x));
  return x;
}
before(async () => {
  await db.migrate.latest({
    directory: path.join(__dirname, "../database/migrations"),
  });
  for (const table of [
    "crm_sheet_sync_audit",
    "crm_sheet_sync_records",
    "crm_sheet_sync_runs",
  ])
    await db(table).delete();
  const [id] = await db("users").insert({
    name: "Synthetic Sheets administrator",
    email: crypto.randomUUID() + "@example.invalid",
    password_hash: "synthetic-non-login",
    role: "admin",
    is_active: 1,
  });
  user = { id, role: "admin" };
  actor = user;
  env = {
    CRM_SHEETS_ENABLED: "1",
    CRM_SHEETS_SPREADSHEET_ID: "synthetic_sheet_identifier_12345",
    CRM_SHEETS_TAB: "Müük",
    CRM_SHEETS_CREDENTIALS_FILE: "/unused/synthetic.json",
    CRM_SHEETS_DEFAULT_OWNER_ID: String(id),
  };
  const options = {
    env,
    read: async () => {
      readCalls++;
      return data();
    },
    now: () => new Date("2026-11-11T07:00:00Z"),
  };
  service = create(db, options);
  const app2 = express();
  app2.use(express.json());
  app2.use((req, res, next) => {
    if (!actor) return res.status(401).json({ error: "Login required" });
    req.crmUser = actor;
    next();
  });
  app2.use(require("../server/routes/google-sheets")(db, options));
  server = app2.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port + "/admin/google-sheets";
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await db.destroy();
});
test("source mapping accepts the existing duplicate Faas columns but requires stable unique IDs and safe field values", () => {
  const row = makeRow(),
    parsed = model.parse([headers, row]);
  assert.equal(parsed[0].id, row[8]);
  assert.equal(parsed[0].data.company, row[0]);
  assert.equal(parsed[0].metadata.allikas, "Synthetic marketing");
  assert.equal(parsed[0].data.followup_count, undefined);
  for (const values of [
    [headers, row, row],
    [headers, [...row.slice(0, 8), ""]],
    [headers, row.map((v, i) => (i === 2 ? "bad email" : v))],
    [headers, row.map((v, i) => (i === 0 ? "x".repeat(256) : v))],
    [headers.filter((h) => h !== "CRM ID"), row],
  ])
    assert.throws(() => model.parse(values), model.SyncError);
});
test("schedule is Tallinn business days at 09/12/15/18 in winter and summer, never nights or weekends", () => {
  for (const date of [
    "2026-11-11T07:00:00Z",
    "2026-11-11T10:59:00Z",
    "2026-11-11T13:00:00Z",
    "2026-11-11T16:00:00Z",
    "2026-07-06T06:00:00Z",
  ])
    assert.ok(model.slot(new Date(date)));
  for (const date of [
    "2026-11-14T07:00:00Z",
    "2026-11-15T10:00:00Z",
    "2026-11-11T06:59:00Z",
    "2026-11-11T17:00:00Z",
    "2026-11-11T23:00:00Z",
    "2026-11-11T08:00:00Z",
  ])
    assert.equal(model.slot(new Date(date)), null);
});
test("disabled and outside-schedule runs never access the source or database", async () => {
  const never = () => {
      throw Error("must not be called");
    },
    fake = {};
  assert.equal(
    (await create(fake, { env: {}, read: never }).sync()).reason,
    "disabled",
  );
  assert.equal(
    (
      await create(fake, {
        env,
        read: never,
        now: () => new Date("2026-11-14T07:00:00Z"),
      }).sync()
    ).reason,
    "outside_schedule",
  );
});
test("the first nonempty source snapshot requires review even without a name or email match", async () => {
  rows = [makeRow()];
  const result = await sync();
  assert.equal(result.created, 0);
  assert.equal(result.pending, 1);
  assert.equal(result.initial_review, true);
  assert.equal((await record(rows[0][8])).client_id, null);
});

test("new leads are imported once with explicit owner, source IDs and contacts, ignoring statuses and followup counts", async () => {
  rows = [makeRow(), makeRow()];
  const result = await sync();
  assert.equal(result.created, 2);
  const r = await record(rows[0][8]),
    client = await db("crm_clients").where({ id: r.client_id }).first();
  assert.equal(client.owner_user_id, user.id);
  assert.equal(client.google_id, rows[0][8]);
  assert.equal(client.client_type, "Lead");
  assert.equal(client.followup_count, 0);
  assert.equal(client.stop_reason, null);
  assert.equal(
    (await db("crm_contacts").where({ id: r.contact_id }).first()).email,
    rows[0][2],
  );
  const before = await db("crm_clients").where({ id: r.client_id }).first();
  rows.reverse();
  assert.equal((await sync()).created, 0);
  assert.deepEqual(
    await db("crm_clients").where({ id: r.client_id }).first(),
    before,
  );
});
test("source-only edits update mapped fields with an audit while empty source values never clear CRM data", async () => {
  rows = [makeRow()];
  await sync();
  const id = rows[0][8],
    r = await record(id);
  rows[0][1] = "Changed source person";
  assert.equal((await sync()).updated, 1);
  assert.equal(
    (await db("crm_contacts").where({ id: r.contact_id }).first()).name,
    "Changed source person",
  );
  rows[0][1] = "";
  await sync();
  assert.equal(
    (await db("crm_contacts").where({ id: r.contact_id }).first()).name,
    "Changed source person",
  );
  assert.ok(
    await db("crm_sheet_sync_audit")
      .where({ record_id: r.id, action: "updated" })
      .first(),
  );
});
test("CRM edits survive unchanged sheets; changes on both sides produce a conflict and keeping CRM is persistent", async () => {
  rows = [makeRow()];
  await sync();
  const id = rows[0][8],
    r = await record(id);
  await db("crm_contacts")
    .where({ id: r.contact_id })
    .update({ phone: "local phone" });
  await sync();
  assert.equal(
    (await db("crm_contacts").where({ id: r.contact_id }).first()).phone,
    "local phone",
  );
  rows[0][3] = "source phone";
  assert.equal((await sync()).conflicts, 1);
  assert.equal(
    (await db("crm_contacts").where({ id: r.contact_id }).first()).phone,
    "local phone",
  );
  await service.resolve(user, r.id, {
    field: "phone",
    choice: "crm",
    expected_crm: "local phone",
    version: await version(id),
  });
  await sync();
  assert.equal(
    (await db("crm_contacts").where({ id: r.contact_id }).first()).phone,
    "local phone",
  );
  rows[0][3] = "newer source phone";
  await sync();
  assert.equal(
    (await db("crm_contacts").where({ id: r.contact_id }).first()).phone,
    "newer source phone",
  );
});
test("stale conflict resolution is rejected after source or local changes; explicit source selection is audited", async () => {
  rows = [makeRow()];
  await sync();
  const id = rows[0][8],
    r = await record(id);
  await db("crm_contacts")
    .where({ id: r.contact_id })
    .update({ name: "Local name" });
  rows[0][1] = "Source name";
  await sync();
  const old = await version(id);
  rows[0][1] = "New source name";
  await sync();
  await assert.rejects(
    service.resolve(user, r.id, {
      field: "name",
      choice: "sheet",
      expected_crm: "Local name",
      version: old,
    }),
    (e) => e.code === "SHEETS_STALE",
  );
  const v = await version(id);
  await db("crm_contacts")
    .where({ id: r.contact_id })
    .update({ name: "New local name" });
  await assert.rejects(
    service.resolve(user, r.id, {
      field: "name",
      choice: "sheet",
      expected_crm: "Local name",
      version: v,
    }),
    (e) => e.code === "SHEETS_STALE",
  );
  await service.resolve(user, r.id, {
    field: "name",
    choice: "sheet",
    expected_crm: "New local name",
    version: v,
  });
  assert.equal(
    (await db("crm_contacts").where({ id: r.contact_id }).first()).name,
    "New source name",
  );
  assert.ok(
    await db("crm_sheet_sync_audit")
      .where({ record_id: r.id, action: "resolved" })
      .first(),
  );
});
test("existing names or email matches await explicit binding, preserve ownership/history and flag initial differences", async () => {
  const row = makeRow(),
    [client] = await db("crm_clients").insert({
      name: row[0],
      owner_user_id: user.id,
      followup_count: 17,
      notes: "Preserve notes",
      stop_reason: "Preserve stop",
    }),
    [contact] = await db("crm_contacts").insert({
      client_id: client,
      name: "Existing local person",
      email: row[2],
    });
  rows = [row];
  assert.equal((await sync()).pending, 1);
  const id = row[8],
    r = await record(id);
  assert.equal(r.client_id, null);
  await service.bind(user, r.id, {
    client_id: client,
    contact_id: contact,
    version: await version(id),
  });
  assert.equal((await record(id)).status, "conflict");
  assert.equal(
    (await db("crm_contacts").where({ id: contact }).first()).name,
    "Existing local person",
  );
  const c = await db("crm_clients").where({ id: client }).first();
  assert.equal(c.followup_count, 17);
  assert.equal(c.notes, "Preserve notes");
  assert.equal(c.stop_reason, "Preserve stop");
  assert.equal(c.owner_user_id, user.id);
});
test("source row removal never deletes or archives CRM clients, contacts or activities", async () => {
  rows = [makeRow()];
  await sync();
  const r = await record(rows[0][8]),
    before = await db("crm_clients").where({ id: r.client_id }).first();
  rows = [];
  await sync();
  assert.deepEqual(
    await db("crm_clients").where({ id: r.client_id }).first(),
    before,
  );
  assert.ok(await db("crm_contacts").where({ id: r.contact_id }).first());
});
test("duplicate or malformed source rows abort the complete batch before any client writes and redact values", async () => {
  rows = [makeRow()];
  rows.push([...rows[0]]);
  const before = await db("crm_clients").count("* as n").first(),
    result = await sync();
  assert.equal(result.ok, false);
  assert.equal(result.code, "SHEETS_IDS");
  assert.deepEqual(await db("crm_clients").count("* as n").first(), before);
  assert.equal(JSON.stringify(result).includes(rows[0][2]), false);
});
test("database advisory lock prevents two worker instances importing concurrently and scheduled slots persist across instances", async () => {
  rows = [makeRow()];
  let release, entered;
  const ready = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (release = r));
  const first = create(db, {
    env,
    read: async () => {
      entered();
      await gate;
      return data();
    },
  });
  const pending = first.sync({ manual: true });
  await ready;
  assert.equal((await service.sync({ manual: true })).reason, "busy");
  release();
  assert.equal((await pending).created, 1);
  await db("crm_sheet_sync_runs")
    .where({ run_key: "scheduled:2026-11-20T09" })
    .delete();
  const opts = {
    env,
    read: async () => data(),
    now: () => new Date("2026-11-20T07:00:00Z"),
  };
  assert.equal((await create(db, opts).sync()).ok, true);
  assert.equal((await create(db, opts).sync()).reason, "already_run");
});
test("invalid default owner rolls back imports while the read-only connection check creates no run or client records", async () => {
  rows = [makeRow()];
  const bad = create(db, {
    env: { ...env, CRM_SHEETS_DEFAULT_OWNER_ID: "999999999" },
    read: async () => data(),
  });
  const before = await db("crm_clients").count("* as n").first();
  assert.equal((await bad.sync({ manual: true })).code, "SHEETS_OWNER");
  assert.deepEqual(await db("crm_clients").count("* as n").first(), before);
  const runs = await db("crm_sheet_sync_runs").count("* as n").first();
  assert.equal((await service.check()).ok, true);
  assert.deepEqual(
    await db("crm_sheet_sync_runs").count("* as n").first(),
    runs,
  );
  assert.deepEqual(await db("crm_clients").count("* as n").first(), before);
});
test("administrator APIs enforce work mode, reject invalid IDs and avoid exposing credentials", async () => {
  actor = { id: user.id, role: "sales" };
  await api("", undefined, 403);
  await api("/sync", {}, 403);
  actor = null;
  await api("", undefined, 401);
  actor = user;
  const report = await api();
  assert.equal(
    report.schedule,
    "Europe/Tallinn E–R 09:00, 12:00, 15:00, 18:00",
  );
  assert.equal(
    JSON.stringify(report).includes(env.CRM_SHEETS_CREDENTIALS_FILE),
    false,
  );
  await api("/not-an-id/bind", {}, 409);
  await api("?page=-1", undefined, 409);
});
test("Google source uses a signed read-only OAuth assertion, fixed HTTPS origins and a metadata-bounded tab range", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-sheets-auth-")),
    file = path.join(dir, "account.json"),
    { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: "service_account",
        client_email: "synthetic@example.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
      { mode: 0o600 },
    );
    let calls = [];
    const result = await source.read(
      { ...source.config(env), file },
      {
        fetch: async (url, options) => {
          calls.push({ url, options });
          assert.equal(options.redirect, "error");
          if (calls.length === 1) {
            const jwt = options.body.get("assertion"),
              parts = jwt.split("."),
              claim = JSON.parse(Buffer.from(parts[1], "base64url"));
            assert.equal(
              claim.scope,
              "https://www.googleapis.com/auth/spreadsheets.readonly",
            );
            assert.equal(claim.aud, "https://oauth2.googleapis.com/token");
            assert.ok(
              crypto.verify(
                "RSA-SHA256",
                Buffer.from(parts[0] + "." + parts[1]),
                publicKey,
                Buffer.from(parts[2], "base64url"),
              ),
            );
            return new Response(
              JSON.stringify({ access_token: "synthetic-token" }),
            );
          }
          assert.equal(options.headers.Authorization, "Bearer synthetic-token");
          if (calls.length === 2)
            return new Response(
              JSON.stringify({
                sheets: [
                  {
                    properties: {
                      title: "Müük",
                      gridProperties: { rowCount: 1000, columnCount: 32 },
                    },
                  },
                ],
              }),
            );
          if (calls.length === 3 || calls.length === 5) {
            assert.ok(decodeURIComponent(url).includes("'Müük'!A1:AF1"));
            return new Response(JSON.stringify({ values: [headers] }));
          }
          assert.ok(url.includes("/values:batchGet?"));
          const selected = [0, 1, 2, 3, 8, 7, 9];
          assert.ok(!decodeURIComponent(url).includes("'Müük'!E2"));
          return new Response(
            JSON.stringify({
              valueRanges: selected.map((col) => ({
                values: [rows.map((row) => row[col])],
              })),
            }),
          );
        },
      },
    );
    assert.deepEqual(model.parse(result), model.parse(data()));
    assert.equal(calls.length, 5);
    fs.chmodSync(file, 0o644);
    await assert.rejects(
      source.read(
        { ...source.config(env), file },
        {
          fetch: () => {
            throw Error("must not call network");
          },
        },
      ),
      (e) => e.code === "SHEETS_CREDENTIALS",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("migration 007 is restartable, preserves existing clients and strict preflight permits only its known missing tables", async () => {
  const schema = require("../ops/schema"),
    before = await db("crm_clients").orderBy("id").select("*");
  await require("../database/migrations/007_google_sheet_sync").up(db);
  assert.deepEqual(await db("crm_clients").orderBy("id").select("*"), before);
  const current = await schema.inspect(db);
  assert.equal(schema.validate(current, true).ok, true);
  const prior = structuredClone(current),
    names = [
      "crm_sheet_sync_records",
      "crm_sheet_sync_runs",
      "crm_sheet_sync_audit",
    ];
  for (const key of ["tables", "columns", "indexes"])
    prior[key] = prior[key].filter((r) => !names.includes(r.TABLE_NAME));
  prior.applied = prior.applied.filter((n) => n !== "007_google_sheet_sync.js");
  assert.equal(schema.validate(prior).ok, true);
  assert.deepEqual(schema.validate(prior).pending, [
    "007_google_sheet_sync.js",
  ]);
  assert.equal(schema.validate(prior, true).ok, false);
});

test("new untouched leads enter the work queue behind already contacted clients without creating activities or sending mail", async () => {
  rows = [makeRow()];
  await sync();
  const imported = await record(rows[0][8]);
  const [returning] = await db("crm_clients").insert({
    name: "Returning Sheets priority " + crypto.randomUUID(),
    owner_user_id: user.id,
    followup_count: 2,
  });
  const [template] = await db("crm_templates").insert({
    name: "Synthetic Sheets call",
    purpose: "Synthetic Sheets call",
    type: "Kõne",
    body: "Synthetic contact",
    is_active: 1,
  });
  const queues = require("../server/services/work-queues"),
    actor = { id: user.id, role: "sales" },
    day = require("../server/services/activity-workflow").today();
  const before = (
    await db("crm_clients").where({ id: imported.client_id }).first()
  ).followup_count;
  const selected = await queues.select(db, actor, {
    action: "initialize",
    work_date: day,
  });
  if (!selected.default_template_id) {
    await queues.select(db, actor, {
      action: "fill",
      lane: "today",
      version: selected.version,
      work_date: day,
      template_id: template,
    });
  }
  const tasks = await db("crm_activities")
    .where({ owner_user_id: user.id, status: "active" })
    .orderBy("id");
  assert.ok(tasks.length <= 6);
  assert.equal(tasks[0].client_id, returning);
  assert.equal(
    (await db("crm_clients").where({ id: imported.client_id }).first())
      .followup_count,
    before,
  );
  const overview = await queues.read(db, actor, { day });
  assert.ok(overview.unplanned.total + tasks.length >= 2);
});

test("unknown source failures store only a generic error code and never private error text", async () => {
  const privateText = "SYNTHETIC_SECRET_DO_NOT_LOG";
  const result = await create(db, {
    env,
    read: async () => {
      throw Error(privateText);
    },
  }).sync({ manual: true });
  assert.equal(result.code, "SHEETS_FAILED");
  assert.equal(JSON.stringify(result).includes(privateText), false);
  const run = await db("crm_sheet_sync_runs").where({ id: result.run }).first();
  assert.equal(run.summary.includes(privateText), false);
});
test("binding itself requires current administrator capability as well as admin work mode", async () => {
  const row = makeRow();
  await db("crm_clients").insert({ name: row[0], owner_user_id: user.id });
  rows = [row];
  await sync();
  const r = await record(row[8]);
  await assert.rejects(
    service.bind({ ...user, role: "sales" }, r.id, {
      client_id: 1,
      contact_id: 0,
      version: await version(row[8]),
    }),
    (e) => e.code === "SHEETS_FORBIDDEN",
  );
});

test("new source rows with a historical status never become active leads without explicit administrator confirmation", async () => {
  const row = makeRow();
  row[7] = "huvi puudus";
  rows = [row];
  const result = await sync();
  assert.equal(result.created, 0);
  assert.equal(result.pending, 1);
  const id = row[8],
    r = await record(id);
  assert.equal(r.client_id, null);
  await assert.rejects(
    service.createPending(user, r.id, {
      version: await version(id),
      confirm: false,
    }),
    (e) => e.code === "SHEETS_BIND",
  );
  await service.createPending(user, r.id, {
    version: await version(id),
    confirm: true,
  });
  assert.equal(
    (
      await db("crm_clients")
        .where({ id: (await record(id)).client_id })
        .first()
    ).client_type,
    "Lead",
  );
  row[7] = "pole vajadust";
  await sync();
  assert.equal(
    (
      await db("crm_clients")
        .where({ id: (await record(id)).client_id })
        .first()
    ).stop_reason,
    null,
  );
});

test("source ID preparation preserves existing IDs and all other sheet cells, and is restartable", () => {
  const vm = require("node:vm"),
    a = makeRow(),
    b = makeRow(),
    existing = a[8];
  b[8] = "";
  const cells = [headers.slice(), a.slice(), b.slice()],
    writes = [];
  const sheet = {
    getLastRow: () => cells.length,
    getLastColumn: () => cells[0].length,
    getRange(row, col, height = 1, width = 1) {
      return {
        getDisplayValues: () =>
          Array.from({ length: height }, (_, i) =>
            Array.from({ length: width }, (_, j) =>
              String(cells[row - 1 + i]?.[col - 1 + j] ?? ""),
            ),
          ),
        setValue(value) {
          writes.push(col);
          cells[row - 1] ||= [];
          cells[row - 1][col - 1] = value;
        },
        setValues(values) {
          writes.push(col);
          values.forEach((r, i) => {
            cells[row - 1 + i] ||= [];
            cells[row - 1 + i][col - 1] = r[0];
          });
        },
      };
    },
  };
  let releases = 0;
  const context = vm.createContext({
    LockService: {
      getDocumentLock: () => ({
        waitLock() {},
        releaseLock() {
          releases++;
        },
      }),
    },
    Utilities: { getUuid: () => crypto.randomUUID() },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../docs/google-sheets-ids.gs"),
      "utf8",
    ),
    context,
  );
  context.fillCrmIds_(sheet);
  assert.equal(cells[1][8], existing);
  assert.match(cells[2][8], /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    cells.map((r) => r.filter((_, i) => i !== 8)),
    [headers, a, b].map((r) => r.filter((_, i) => i !== 8)),
  );
  const before = structuredClone(cells);
  context.fillCrmIds_(sheet);
  assert.deepEqual(cells, before);
  assert.ok(writes.every((col) => col === 9));
  assert.equal(releases, 2);
});

test("source ID preparation rejects duplicate identifiers without replacing any existing cell", () => {
  const vm = require("node:vm"),
    a = makeRow(),
    cells = [headers.slice(), a.slice(), a.slice()],
    before = structuredClone(cells);
  let released = false;
  const sheet = {
    getLastRow: () => cells.length,
    getLastColumn: () => headers.length,
    getRange(row, col, height = 1, width = 1) {
      return {
        getDisplayValues: () =>
          Array.from({ length: height }, (_, i) =>
            Array.from({ length: width }, (_, j) =>
              String(cells[row - 1 + i]?.[col - 1 + j] ?? ""),
            ),
          ),
        setValue() {
          throw Error("no writes expected");
        },
        setValues() {
          throw Error("no writes expected");
        },
      };
    },
  };
  const context = vm.createContext({
    LockService: {
      getDocumentLock: () => ({
        waitLock() {},
        releaseLock() {
          released = true;
        },
      }),
    },
    Utilities: { getUuid: () => crypto.randomUUID() },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../docs/google-sheets-ids.gs"),
      "utf8",
    ),
    context,
  );
  assert.throws(() => context.fillCrmIds_(sheet), /Korduv/);
  assert.deepEqual(cells, before);
  assert.equal(released, true);
});
