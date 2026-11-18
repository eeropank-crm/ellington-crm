const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  crypto = require("crypto");
if (!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME || ""))
  throw Error("Synthetic DB only");
for (const k of Object.keys(process.env))
  if (/^CRM_(MAIL|SMTP|IMAP)/.test(k)) delete process.env[k];
process.env.CRM_IMAP_ENABLED = "0";
const db = require("../server/db");
require("../scripts/local-database")(db);
for (const k of Object.keys(process.env))
  if (/^CRM_(MAIL|SMTP|IMAP)/.test(k)) delete process.env[k];
process.env.CRM_IMAP_ENABLED = "0";
const w = require("../server/services/activity-workflow");
let server,
  browser,
  calls = [];
require("nodemailer").createTransport = () => ({
  async sendMail(mail) {
    assert.equal(mail.to, "customer@example.invalid");
    calls.push(mail);
    return { accepted: [mail.to], response: "250 synthetic" };
  },
  close() {},
});
(async () => {
  try {
    const password = crypto.randomBytes(24).toString("hex"),
      email = crypto.randomUUID() + "@example.invalid";
    const [uid] = await db("users").insert({
        name: "Vastamise sünteetiline test",
        email,
        password_hash: await require("bcryptjs").hash(password, 10),
        role: "admin",
        is_active: 1,
      }),
      actor = { id: uid, role: "sales" };
    const [cid] = await db("crm_clients").insert({
      name: "Näidisfirma Vastuse Test",
      owner_user_id: uid,
      followup_count: 7,
    });
    const [contact] = await db("crm_contacts").insert({
      client_id: cid,
      name: "Näidiskontakt",
      email: "customer@example.invalid",
    });
    const [template] = await db("crm_templates").insert({
      type: "E-kiri",
      name: "Vastamise testi mall",
      purpose: "Vastamise testi mall",
      subject: "Sünteetiline kiri",
      body: "Ainulaadne algse kirja tekst.",
      is_active: 1,
    });
    const task = await db.transaction((trx) =>
      w.create(trx, actor, {
        client_id: cid,
        contact_id: contact,
        type: "E-kiri",
        template_id: template,
        purpose: "Vastamise testi mall",
        subject: "Sünteetiline kiri",
        instructions: "Ainulaadne algse kirja tekst.",
        due_date: w.today(),
      }),
    );
    const originalId =
      "<visual-original-" + crypto.randomUUID() + "@example.invalid>";
    await db("crm_email_outbox").insert({
      activity_id: task.id,
      client_id: cid,
      contact_id: contact,
      user_id: uid,
      sender: "staff@example.invalid",
      recipient: "customer@example.invalid",
      subject: "Sünteetiline kiri",
      body: "Ainulaadne algse kirja tekst.",
      message_id: originalId,
      status: "sent",
      sent_at: db.fn.now(),
    });
    await db.transaction((trx) => w.complete(trx, task.id, actor, {}));
    process.env["CRM_MAILBOX_" + uid] = "staff@example.invalid";
    process.env["CRM_MAIL_PASSWORD_" + uid] = "synthetic-unused";
    process.env.CRM_SMTP_HOST = "unused.invalid";
    process.env.CRM_SMTP_PORT = "465";
    const env = {
      ...process.env,
      CRM_IMAP_HOST: "unused.invalid",
      CRM_IMAP_ENABLED: "0",
      ["CRM_IMAP_ENABLED_" + uid]: "1",
    };
    const parsed = {
      messageId: "visual-reply-" + crypto.randomUUID() + "@example.invalid",
      from: { value: [{ address: "customer@example.invalid" }] },
      inReplyTo: originalId,
      subject: "Re: Sünteetiline kiri",
      text: "Tere! Soovime pakkumist.\n\nOn Monday Sender wrote:\n> Ainulaadne algse kirja tekst.",
    };
    const report = await require("../server/services/mailbox-sync")(db, {
      env,
      createClient: () => ({
        async connect() {},
        async getMailboxLock() {
          return { release() {} };
        },
        async search() {
          return [1];
        },
        async fetchOne() {
          return { source: Buffer.from("synthetic") };
        },
        async logout() {},
        close() {},
      }),
      parseMessage: async () => parsed,
    }).sync();
    assert.equal(report.imported, 1);
    const reply = await db("crm_email_inbox").where({ client_id: cid }).first();
    server = require("../server/app").listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({
      headless: true,
      executablePath: "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
        extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await page.goto(base + "/");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Logi sisse" }).click();
    await page.waitForURL("**/prototype-preview");
    await page
      .getByRole("button", { name: "Vasta kliendile", exact: true })
      .waitFor();

    const inboxBefore = await db("crm_email_inbox")
      .where({ id: reply.id })
      .first();
    const outboxBefore = await db("crm_email_outbox")
      .where({ client_id: cid })
      .orderBy("id");
    const clientBefore = await db("crm_clients").where({ id: cid }).first();
    const [reason] = await db("crm_v8_stop_reasons").insert({
      label: "Sünteetiline: klient ei ole huvitatud",
      is_active: 1,
      sort_order: 999,
    });
    await page.evaluate(async () => {
      await v8ReloadConfig();
    });
    await page
      .getByRole("button", { name: "Ava kliendikaart", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Lõpeta jälgimine", exact: true })
      .click();
    await page.locator("#crmWorkflow select").selectOption(String(reason));
    await page
      .getByRole("button", { name: "Kinnita lõpetamine", exact: true })
      .click();
    await page.waitForFunction(
      () => !v8Pending && Boolean(crmClientResult?.client?.stop_reason),
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Vasta kliendile", exact: true })
        .count(),
      0,
    );
    assert(
      (await page.locator("#crmMailHistory").innerText()).includes(
        "Soovime pakkumist.",
      ),
    );
    fs.mkdirSync("docs/stopped-reply-alerts", { recursive: true });
    await page.screenshot({
      path: "docs/stopped-reply-alerts/history.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Töölaud", exact: true }).click();
    await page.waitForFunction(() => page === "dashboard");
    assert.equal(
      await page
        .getByRole("button", { name: "Vasta kliendile", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByText("Klient vastas", { exact: true }).count(),
      0,
    );
    await page.screenshot({
      path: "docs/stopped-reply-alerts/dashboard.png",
      fullPage: true,
    });
    await page.locator("#crmWorkMode").selectOption("admin");
    await page.waitForFunction(() => crmRealMe?.role === "admin");
    assert.equal(
      await page.evaluate(
        (id) => crmReplyAlerts.some((a) => Number(a.client_id) === id),
        cid,
      ),
      false,
    );
    assert.deepEqual(
      await db("crm_email_inbox").where({ id: reply.id }).first(),
      inboxBefore,
    );
    assert.deepEqual(
      await db("crm_email_outbox").where({ client_id: cid }).orderBy("id"),
      outboxBefore,
    );
    assert.equal(
      (await db("crm_clients").where({ id: cid }).first()).followup_count,
      clientBefore.followup_count,
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS Chromium: stop monitoring from customer reply card; no reply required; dashboard alert removed in user/admin mode; inbox history preserved; no send request; 0 JS errors.",
    );
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    await db.destroy();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
