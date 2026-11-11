"use strict";
const crypto = require("node:crypto"),
  source = require("./source"),
  model = require("./model");
const decode = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    model.fail("SHEETS_STATE");
  }
};
const version = (record) =>
  crypto.createHash("sha256").update(record.state).digest("hex");
const encoded = (s) => {
  const value = JSON.stringify(s);
  if (Buffer.byteLength(value) > 60000) model.fail("SHEETS_SIZE");
  return value;
};
module.exports = function (
  db,
  { env = process.env, read = source.read, now = () => new Date() } = {},
) {
  const cfg = () => source.config(env);
  async function exclusive(fn) {
    const connection = await db.client.acquireConnection(),
      name =
        "crm-sheets:" +
        crypto
          .createHash("sha256")
          .update(db.client.config.connection.database)
          .digest("hex")
          .slice(0, 40);
    let locked = false;
    try {
      const [[r]] = await db
        .raw("SELECT GET_LOCK(?,0) AS acquired", [name])
        .connection(connection);
      if (Number(r.acquired) !== 1) return { skipped: true, reason: "busy" };
      locked = true;
      return await fn();
    } finally {
      try {
        if (locked)
          await db.raw("SELECT RELEASE_LOCK(?)", [name]).connection(connection);
      } finally {
        await db.client.releaseConnection(connection);
      }
    }
  }
  async function audit(trx, record, user, action, details) {
    await trx("crm_sheet_sync_audit").insert({
      record_id: record,
      user_id: user?.id || null,
      action,
      details: encoded(details),
    });
  }
  async function targets(trx, record, lock = true) {
    const client = await trx("crm_clients")
      .where({ id: record.client_id })
      .modify((q) => {
        if (lock) q.forUpdate();
      })
      .first();
    if (!client) model.fail("SHEETS_TARGET");
    const contact = record.contact_id
      ? await trx("crm_contacts")
          .where({ id: record.contact_id, client_id: client.id })
          .modify((q) => {
            if (lock) q.forUpdate();
          })
          .first()
      : null;
    if (record.contact_id && !contact) model.fail("SHEETS_TARGET");
    return { client, contact };
  }
  const current = (target, key) =>
    String(
      key === "company" ? target.client.name : target.contact?.[key] || "",
    );
  async function put(trx, record, target, key, value) {
    if (key === "company") {
      await trx("crm_clients")
        .where({ id: record.client_id })
        .update({ name: value, updated_at: trx.fn.now() });
      target.client.name = value;
    } else {
      if (!target.contact) {
        const [id] = await trx("crm_contacts").insert({
          client_id: record.client_id,
          name: "Kontaktisik",
        });
        record.contact_id = id;
        target.contact = { id, name: "Kontaktisik", email: "", phone: "" };
      }
      await trx("crm_contacts")
        .where({ id: record.contact_id, client_id: record.client_id })
        .update({ [key]: value, updated_at: trx.fn.now() });
      target.contact[key] = value;
    }
  }
  async function reconcile(trx, record, state, user = null) {
    const target = await targets(trx, record);
    let changed = 0;
    state.conflicts = {};
    state.base ||= {};
    for (const key of Object.keys(model.fields)) {
      const incoming = state.latest.data[key],
        local = current(target, key),
        base = state.base[key];
      if (!incoming) continue;
      if (base && incoming === base.source) continue;
      if (
        local === incoming ||
        (!base && !local) ||
        (base && local === base.crm)
      ) {
        if (local !== incoming) {
          await put(trx, record, target, key, incoming);
          await audit(trx, record.id, user, "updated", {
            field: key,
            before: local,
            after: incoming,
          });
          changed++;
        }
        state.base[key] = { source: incoming, crm: incoming };
      } else state.conflicts[key] = { source: incoming, crm: local };
    }
    await trx("crm_sheet_sync_records")
      .where({ id: record.id })
      .update({
        contact_id: record.contact_id,
        status: Object.keys(state.conflicts).length ? "conflict" : "linked",
        state: encoded(state),
        updated_at: trx.fn.now(),
      });
    return { changed, conflicts: Object.keys(state.conflicts).length };
  }
  async function candidates(trx, row) {
    const list = await trx("crm_clients as c")
      .leftJoin("crm_contacts as ct", "ct.client_id", "c.id")
      .where((q) => {
        q.whereRaw("LOWER(TRIM(c.name)) = ?", [
          row.data.company.toLowerCase(),
        ]).orWhere("c.google_id", row.id);
        if (row.data.email)
          q.orWhereRaw("LOWER(TRIM(ct.email)) = ?", [
            row.data.email.toLowerCase(),
          ]);
      })
      .distinct("c.id")
      .limit(21);
    return list.map((c) => Number(c.id));
  }
  async function importRow(trx, row, c, summary) {
    let record = await trx("crm_sheet_sync_records")
      .where({ source_id: row.id })
      .forUpdate()
      .first();
    if (record) {
      const state = decode(record.state);
      state.latest = row;
      if (!record.client_id) {
        state.candidates = await candidates(trx, row);
        await trx("crm_sheet_sync_records")
          .where({ id: record.id })
          .update({ state: encoded(state), updated_at: trx.fn.now() });
        summary.pending++;
        return;
      }
      const result = await reconcile(trx, record, state);
      summary.updated += result.changed ? 1 : 0;
      summary.conflicts += result.conflicts ? 1 : 0;
      return;
    }
    const matches = await candidates(trx, row),
      state = {
        latest: row,
        base: {},
        conflicts: {},
        candidates: matches,
        initial_review: !!c.bootstrap,
      };
    const [id] = await trx("crm_sheet_sync_records").insert({
      source_id: row.id,
      status:
        matches.length || row.lifecycleHint || c.bootstrap
          ? "pending"
          : "linked",
      state: encoded(state),
    });
    record = { id, source_id: row.id, client_id: null, contact_id: null };
    if (matches.length || row.lifecycleHint || c.bootstrap) {
      summary.pending++;
      await audit(trx, id, null, "pending", {});
      return;
    }
    await createLead(trx, record, state, c);
    summary.created++;
  }
  async function createLead(trx, record, state, c, user = null) {
    const [client] = await trx("crm_clients").insert({
      name: state.latest.data.company,
      owner_user_id: c.owner,
      google_id: record.source_id,
      client_type: "Lead",
      followup_count: 0,
    });
    record.client_id = client;
    if (
      state.latest.data.name ||
      state.latest.data.email ||
      state.latest.data.phone
    ) {
      const [contact] = await trx("crm_contacts").insert({
        client_id: client,
        name: state.latest.data.name || "Kontaktisik",
        email: state.latest.data.email || null,
        phone: state.latest.data.phone || null,
      });
      record.contact_id = contact;
    }
    const target = await targets(trx, record);
    for (const key of Object.keys(model.fields))
      state.base[key] = {
        source: state.latest.data[key],
        crm: current(target, key),
      };
    await trx("crm_sheet_sync_records")
      .where({ id: record.id })
      .update({
        client_id: client,
        contact_id: record.contact_id,
        status: "linked",
        state: encoded(state),
      });
    await audit(trx, record.id, user, "created", {
      client_id: client,
      contact_id: record.contact_id,
    });
  }
  async function check() {
    const c = cfg();
    if (!c.configured) model.fail("SHEETS_CONFIG");
    const owner = await db("users")
      .where({ id: c.owner, is_active: 1 })
      .first("id");
    if (!owner) model.fail("SHEETS_OWNER");
    const rows = model.parse(await read(c));
    return { ok: true, read: rows.length };
  }
  async function sync({ manual = false } = {}) {
    const c = cfg();
    if (!c.enabled) return { skipped: true, reason: "disabled" };
    const window = model.slot(now());
    if (!manual && !window)
      return { skipped: true, reason: "outside_schedule" };
    if (!c.configured) return { ok: false, code: "SHEETS_CONFIG" };
    return exclusive(async () => {
      const runKey = manual
        ? "manual:" + crypto.randomUUID()
        : "scheduled:" + window;
      if (
        await db("crm_sheet_sync_runs").where({ run_key: runKey }).first("id")
      )
        return { skipped: true, reason: "already_run" };
      const [run] = await db("crm_sheet_sync_runs").insert({
        run_key: runKey,
        status: "running",
        summary: "{}",
      });
      try {
        const rows = model.parse(await read(c));
        const summary = {
          read: rows.length,
          created: 0,
          updated: 0,
          pending: 0,
          conflicts: 0,
        };
        await db.transaction(async (trx) => {
          const owner = await trx("users")
            .where({ id: c.owner, is_active: 1 })
            .forUpdate()
            .first("id");
          if (!owner) model.fail("SHEETS_OWNER");
          const bootstrap = !(await trx("crm_sheet_sync_records").first("id"));
          summary.initial_review = bootstrap;
          for (const row of rows)
            await importRow(trx, row, { ...c, bootstrap }, summary);
          await trx("crm_sheet_sync_runs")
            .where({ id: run })
            .update({
              status: "ok",
              summary: encoded(summary),
              completed_at: trx.fn.now(),
            });
        });
        return { ok: true, run, ...summary };
      } catch (error) {
        const failure = model.diagnostic(error);
        await db("crm_sheet_sync_runs")
          .where({ id: run })
          .update({
            status: "failed",
            summary: encoded(failure),
            completed_at: db.fn.now(),
          });
        return { ok: false, run, ...failure };
      }
    });
  }
  async function requireAdmin(trx, user) {
    if (
      user?.role !== "admin" ||
      !(await trx("users")
        .where({ id: user.id, role: "admin", is_active: 1 })
        .first("id"))
    )
      model.fail("SHEETS_FORBIDDEN");
  }
  async function bind(user, id, input) {
    return exclusive(() =>
      db.transaction(async (trx) => {
        await requireAdmin(trx, user);
        const record = await trx("crm_sheet_sync_records")
          .where({ id })
          .forUpdate()
          .first();
        if (!record || record.client_id) model.fail("SHEETS_BIND");
        if (input.version !== version(record)) model.fail("SHEETS_STALE");
        if (
          !Number.isSafeInteger(input.client_id) ||
          input.client_id < 1 ||
          !Number.isSafeInteger(input.contact_id) ||
          input.contact_id < 0
        )
          model.fail("SHEETS_BIND");
        record.client_id = input.client_id;
        record.contact_id = input.contact_id || null;
        await targets(trx, record);
        const state = decode(record.state);
        state.base = {};
        await reconcile(trx, record, state, user);
        await trx("crm_sheet_sync_records")
          .where({ id })
          .update({ client_id: record.client_id });
        await audit(trx, id, user, "bound", {
          client_id: record.client_id,
          contact_id: record.contact_id,
        });
        return { ok: true };
      }),
    );
  }
  async function createPending(user, id, input) {
    return exclusive(() =>
      db.transaction(async (trx) => {
        await requireAdmin(trx, user);
        const record = await trx("crm_sheet_sync_records")
          .where({ id })
          .forUpdate()
          .first();
        if (!record || record.client_id || input.confirm !== true)
          model.fail("SHEETS_BIND");
        if (input.version !== version(record)) model.fail("SHEETS_STALE");
        const state = decode(record.state),
          c = cfg();
        if (!c.configured) model.fail("SHEETS_CONFIG");
        if ((await candidates(trx, state.latest)).length)
          model.fail("SHEETS_BIND");
        if (
          !(await trx("users")
            .where({ id: c.owner, is_active: 1 })
            .forUpdate()
            .first("id"))
        )
          model.fail("SHEETS_OWNER");
        await createLead(trx, record, state, c, user);
        return { ok: true };
      }),
    );
  }
  async function resolve(user, id, input) {
    const { field: key, choice } = input;
    return exclusive(() =>
      db.transaction(async (trx) => {
        await requireAdmin(trx, user);
        if (
          !Object.hasOwn(model.fields, key) ||
          !["sheet", "crm"].includes(choice)
        )
          model.fail("SHEETS_CHOICE");
        const record = await trx("crm_sheet_sync_records")
          .where({ id })
          .forUpdate()
          .first();
        if (!record?.client_id) model.fail("SHEETS_TARGET");
        if (input.version !== version(record)) model.fail("SHEETS_STALE");
        const state = decode(record.state),
          target = await targets(trx, record),
          incoming = state.latest.data[key],
          local = current(target, key);
        if (!state.conflicts[key] || !incoming) model.fail("SHEETS_CHOICE");
        if (input.expected_crm !== local) model.fail("SHEETS_STALE");
        if (choice === "sheet") await put(trx, record, target, key, incoming);
        state.base[key] = {
          source: incoming,
          crm: choice === "sheet" ? incoming : local,
        };
        delete state.conflicts[key];
        await trx("crm_sheet_sync_records")
          .where({ id })
          .update({
            contact_id: record.contact_id,
            status: Object.keys(state.conflicts).length ? "conflict" : "linked",
            state: encoded(state),
            updated_at: trx.fn.now(),
          });
        await audit(trx, id, user, "resolved", {
          field: key,
          choice,
          before: local,
          after: current(target, key),
        });
        return { ok: true };
      }),
    );
  }
  async function withContacts(clients) {
    for (const client of clients)
      client.contacts = await db("crm_contacts")
        .where({ client_id: client.id })
        .orderBy("id")
        .limit(100)
        .select("id", "name", "email", "phone");
    return clients;
  }
  async function search(query) {
    if (
      typeof query !== "string" ||
      query.trim().length < 2 ||
      query.length > 100
    )
      model.fail("SHEETS_SEARCH");
    return {
      clients: await withContacts(
        await db("crm_clients")
          .where("name", "like", "%" + query.trim() + "%")
          .orderBy("name")
          .limit(20)
          .select("id", "name"),
      ),
    };
  }
  async function status(page = 0) {
    const c = cfg(),
      runs = await db("crm_sheet_sync_runs")
        .orderBy("id", "desc")
        .limit(10)
        .select("id", "status", "summary", "created_at", "completed_at");
    const records = await db("crm_sheet_sync_records")
      .whereIn("status", ["pending", "conflict"])
      .orderBy("id")
      .limit(25)
      .offset(page * 25);
    const [{ count }] = await db("crm_sheet_sync_records")
      .whereIn("status", ["pending", "conflict"])
      .count("* as count");
    for (const r of records) {
      r.version = version(r);
      r.state = decode(r.state);
      if (r.client_id) {
        const target = await targets(db, r, false);
        for (const key of Object.keys(r.state.conflicts))
          r.state.conflicts[key].crm = current(target, key);
      }
      const ids = r.state.candidates || [];
      r.candidates = ids.length
        ? await withContacts(
            await db("crm_clients").whereIn("id", ids).select("id", "name"),
          )
        : [];
    }
    const lastSuccess = await db("crm_sheet_sync_runs")
      .where({ status: "ok" })
      .orderBy("id", "desc")
      .first("completed_at");
    return {
      last_success: lastSuccess?.completed_at || null,
      enabled: c.enabled,
      configured: c.configured,
      schedule: "Europe/Tallinn E–R 09:00, 12:00, 15:00, 18:00",
      runs: runs.map((r) => ({ ...r, summary: decode(r.summary) })),
      records,
      total: Number(count),
      page,
    };
  }
  return { sync, check, bind, resolve, status, search, createPending };
};
