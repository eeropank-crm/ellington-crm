const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  path = require("node:path");
if (!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME || ""))
  throw Error("Synthetic database required");
for (const k of Object.keys(process.env))
  if (/^CRM_(MAIL|SMTP|IMAP)/.test(k)) delete process.env[k];
process.env.CRM_IMAP_ENABLED = "0";
const db = require("../server/db");
require("../scripts/local-database")(db);
const w = require("../server/services/activity-workflow");
let server,
  base,
  users = [],
  cookies = [],
  template;
async function api(
  route,
  body,
  status = 200,
  who = 0,
  method = body === undefined ? "GET" : "POST",
) {
  const res = await fetch(base + "/api" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-Proto": "https",
      ...(who === null ? {} : { Cookie: cookies[who] }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  assert.equal(res.status, status, JSON.stringify(data));
  return data;
}
const contactData = {
  name: "Synthetic Contact",
  email: "person@example.invalid",
  phone: "+372000000",
};
async function fixture(owner = 0) {
  const [id] = await db("crm_clients").insert({
    name: "Synthetic contacts " + crypto.randomUUID(),
    owner_user_id: users[owner].id,
    followup_count: 8,
  });
  return id;
}
const detail = (id) => api("/clients/" + id);
const add = (id, x = contactData, status = 201, who = 0) =>
  api("/clients/" + id + "/contacts", x, status, who);
const update = (id, c, x = {}, status = 200, who = 0) =>
  api(
    "/clients/" + id + "/contacts/" + c.id,
    { ...contactData, expected_version: c.version, ...x },
    status,
    who,
    "PATCH",
  );
before(async () => {
  await db.migrate.latest({
    directory: path.join(__dirname, "../database/migrations"),
  });
  const password = crypto.randomBytes(24).toString("hex"),
    hash = await require("bcryptjs").hash(password, 10);
  for (const role of ["sales", "sales", "admin"]) {
    const email = crypto.randomUUID() + "@example.invalid";
    const [id] = await db("users").insert({
      name: "Synthetic contact editor",
      email,
      password_hash: hash,
      role,
      is_active: 1,
    });
    users.push({ id, email, role });
  }
  const [id] = await db("crm_templates").insert({
    name: "Synthetic contact call",
    purpose: "Synthetic contact call",
    type: "Kõne",
    body: "Synthetic instructions",
    is_active: 1,
  });
  template = id;
  server = require("../server/app").listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  for (const u of users) {
    const res = await fetch(base + "/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({ email: u.email, password }),
    });
    assert.equal(res.status, 200);
    cookies.push(res.headers.get("set-cookie").split(";")[0]);
  }
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await db.destroy();
});
test("owners add and edit all contact fields, preserving other contacts, client ownership and history", async () => {
  const id = await fixture(),
    clientBefore = await db("crm_clients").where({ id }).first();
  const c = (await add(id)).contact,
    other = (await add(id, { ...contactData, name: "Second contact" })).contact;
  const [h] = await db("crm_imported_history").insert({
    client_id: id,
    activity_type: "Kõne",
    original_value: "Original historical data",
  });
  const history = await db("crm_imported_history").where({ id: h }).first();
  await db("crm_contacts")
    .where({ id: c.id })
    .update({ position: "Existing position" });
  const current = (await detail(id)).contacts.find((x) => x.id === c.id);
  const result = await update(id, current, {
    name: "New name",
    email: "new@example.invalid",
    phone: "123456",
  });
  assert.equal(result.contact.id, c.id);
  assert.equal(result.contact.name, "New name");
  assert.equal(result.contact.position, "Existing position");
  assert.notEqual(result.contact.version, current.version);
  assert.deepEqual(await db("crm_clients").where({ id }).first(), clientBefore);
  assert.deepEqual(
    await db("crm_imported_history").where({ id: h }).first(),
    history,
  );
  assert.deepEqual(
    (await detail(id)).contacts.find((x) => x.id === other.id),
    other,
  );
});
test("authentication and server permissions protect foreign clients and contacts; admin user mode remains scoped", async () => {
  const id = await fixture(),
    c = (await add(id)).contact,
    foreign = await fixture(1);
  await add(id, contactData, 401, null);
  await add(id, contactData, 403, 1);
  await update(id, c, {}, 403, 1);
  await update(foreign, c, {}, 404, 1);
  await add(id, contactData, 403, 2);
  await api("/work-mode", { mode: "admin" }, 200, 2);
  await add(id, { ...contactData, name: "Admin created" }, 201, 2);
  await update(id, c, { name: "Admin edited" }, 200, 2);
  await api("/work-mode", { mode: "user" }, 200, 2);
  await api("/work-mode", { mode: "admin" }, 403, 0);
});
test("contact input, protected fields, stale versions and concurrent changes fail without overwrites", async () => {
  const id = await fixture(),
    c = (await add(id)).contact;
  for (const x of [
    { name: "" },
    { email: "one@example.invalid;two@example.invalid" },
    { phone: "x".repeat(101) },
    { name: "a\nb" },
    { client_id: id },
    { owner_user_id: users[1].id },
  ])
    await add(id, { ...contactData, ...x }, 400);
  await update(id, c, { expected_version: "" }, 409);
  const results = await Promise.allSettled([
    update(id, c, { phone: "first" }),
    update(id, c, { phone: "second" }),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.find((x) => x.status === "rejected").reason.actual, 409);
  const stale = await api(
    "/clients/" + id + "/contacts/" + c.id,
    { ...contactData, expected_version: c.version },
    409,
    0,
    "PATCH",
  );
  assert.match(stale.error, /Kontakt muutus/);
  const latest = (await detail(id)).contacts[0];
  await update(id, latest, { email: "", phone: "" });
  assert.equal((await detail(id)).contacts[0].email, null);
});
async function task(client, contact) {
  return db.transaction((trx) =>
    w.create(trx, users[0], {
      client_id: client,
      contact_id: contact,
      type: "Kõne",
      template_id: template,
      purpose: "Synthetic contact call",
      instructions: "Synthetic instructions",
      due_date: w.today(),
    }),
  );
}
async function editTask(t, contact, status = 200, who = 0) {
  const x = await api("/v8/activities/" + t.id + "/edit");
  return api(
    "/v8/activities/" + t.id,
    {
      type: x.type,
      template_id: x.template_id,
      purpose: x.purpose,
      subject: x.subject,
      instructions: x.instructions,
      expected_version: x.version,
      contact_id: contact,
    },
    status,
    who,
    "PATCH",
  );
}
test("activity contact selection validates client and keeps ID, date, sequence and followup count unchanged", async () => {
  const id = await fixture(),
    c = (await add(id)).contact,
    second = (await add(id, { ...contactData, name: "Selected contact" }))
      .contact;
  const foreign = await fixture(),
    foreignContact = (await add(foreign)).contact,
    t = await task(id, c.id);
  const before = await db("crm_activities").where({ id: t.id }).first(),
    client = await db("crm_clients").where({ id }).first();
  const form = await api("/v8/activities/" + t.id + "/edit");
  assert(form.contacts.some((x) => x.id === second.id));
  await editTask(t, foreignContact.id, 400);
  await editTask(t, second.id, 403, 1);
  await editTask(t, second.id);
  const after = await db("crm_activities").where({ id: t.id }).first();
  for (const f of [
    "id",
    "client_id",
    "owner_user_id",
    "due_date",
    "sequence_number",
    "status",
  ])
    assert.deepEqual(after[f], before[f]);
  assert.equal(after.contact_id, second.id);
  assert.deepEqual(await db("crm_clients").where({ id }).first(), client);
  const event = await db("crm_v8_activity_events")
    .where({ activity_id: t.id, event_type: "activity_edited" })
    .first();
  assert.equal(JSON.parse(event.details).after.contact_id, second.id);
  await editTask(t, null);
  assert.equal(
    (await db("crm_activities").where({ id: t.id }).first()).contact_id,
    null,
  );
});
test("contact updates preserve sent mail snapshots and completed activity selection; completed edits remain blocked", async () => {
  const id = await fixture(),
    c = (await add(id)).contact,
    t = await task(id, c.id);
  await db("crm_activities")
    .where({ id: t.id })
    .update({ status: "completed" });
  const before = await db("crm_activities").where({ id: t.id }).first();
  const [mail] = await db("crm_email_outbox").insert({
    activity_id: t.id,
    client_id: id,
    contact_id: c.id,
    user_id: users[0].id,
    sender: "staff@example.invalid",
    recipient: c.email,
    subject: "Original subject",
    body: "Original body",
    message_id: crypto.randomUUID(),
    status: "sent",
  });
  const snapshot = await db("crm_email_outbox").where({ id: mail }).first();
  await update(id, c, { email: "changed@example.invalid" });
  assert.deepEqual(
    await db("crm_email_outbox").where({ id: mail }).first(),
    snapshot,
  );
  assert.deepEqual(
    await db("crm_activities").where({ id: t.id }).first(),
    before,
  );
  await api("/v8/activities/" + t.id + "/edit", undefined, 409);
});
test("CRM contact editing remains protected by Google Sheets three-way conflict detection", async () => {
  const id = await fixture(),
    c = (await add(id)).contact;
  const company = (await detail(id)).client.name;
  const header = [
    "firma nimi",
    "inimese nimi",
    "meiliaadress",
    "telefon",
    "CRM ID",
    "staatus",
    "Vastutaja",
  ];
  let row = [company, c.name, c.email, c.phone, crypto.randomUUID(), "", "E"];
  const svc = require("../server/integrations/google-sheets/service")(db, {
    env: {
      CRM_SHEETS_ENABLED: "1",
      CRM_SHEETS_SPREADSHEET_ID: "synthetic_contact_sheet_12345",
      CRM_SHEETS_TAB: "Müük",
      CRM_SHEETS_CREDENTIALS_FILE: "/unused.json",
      CRM_SHEETS_DEFAULT_OWNER_ID: String(users[0].id),
    },
    read: async () => [header, row],
  });
  await api("/work-mode", { mode: "admin" }, 200, 2);
  const admin = { id: users[2].id, role: "admin" };
  assert.equal((await svc.sync({ manual: true })).ok, true);
  let rec = await db("crm_sheet_sync_records")
    .where({ source_id: row[4] })
    .first();
  const version = crypto.createHash("sha256").update(rec.state).digest("hex");
  await svc.bind(admin, rec.id, { client_id: id, contact_id: c.id, version });
  await update(id, c, { phone: "CRM edited phone" });
  assert.equal((await svc.sync({ manual: true })).ok, true);
  assert.equal((await detail(id)).contacts[0].phone, "CRM edited phone");
  row[3] = "Sheet edited phone";
  assert.equal((await svc.sync({ manual: true })).ok, true);
  rec = await db("crm_sheet_sync_records").where({ source_id: row[4] }).first();
  assert.equal(rec.status, "conflict");
  assert.equal(JSON.parse(rec.state).conflicts.phone.crm, "CRM edited phone");
  assert.equal((await detail(id)).contacts[0].phone, "CRM edited phone");
});
