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
    const newEmail = crypto.randomUUID() + "@example.invalid";
    const [newOwner] = await db("users").insert({
      name: "Uus sünteetiline kliendihaldur",
      email: newEmail,
      password_hash: await require("bcryptjs").hash(password, 10),
      role: "sales",
      is_active: 1,
    });
    await db("crm_user_mail_settings").insert({
      user_id: newOwner,
      signature: "Uue kliendihalduri sünteetiline allkiri",
    });
    process.env["CRM_MAILBOX_" + newOwner] = "new-owner@example.invalid";
    process.env["CRM_MAIL_PASSWORD_" + newOwner] = "synthetic-unused";
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

    await page
      .getByRole("button", { name: "Vasta kliendile", exact: true })
      .click();
    await page.locator("#crmMailBody").waitFor();
    const draftId = await page.evaluate(() => v8Active.id),
      inboxBefore = await db("crm_email_inbox").where({ id: reply.id }).first(),
      originalBefore = await db("crm_email_outbox")
        .where({ id: inboxBefore.outbox_id })
        .first();
    await page
      .locator("#crmWorkflow")
      .getByRole("button", { name: "Sulge", exact: true })
      .click();
    await page.locator("#crmWorkMode").selectOption("admin");
    await page.waitForFunction(() => crmRealMe?.mode === "admin");
    const transfer = await page.evaluate(
      async ({ from, to, client }) =>
        v8Api("/admin/portfolio-transfer", {
          method: "POST",
          body: JSON.stringify({
            from_user_id: from,
            to_user_id: to,
            client_ids: [client],
          }),
        }),
      { from: uid, to: newOwner, client: cid },
    );
    assert.equal(transfer.transferred, 1);
    assert.equal(
      await page.evaluate(
        async (id) =>
          (
            await fetch("/api/mail/replies/" + id + "/draft", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            })
          ).status,
        reply.id,
      ),
      403,
    );
    await page.evaluate(() => v8Api("/logout", { method: "POST", body: "{}" }));
    await page.goto(base + "/");
    await page.locator("#email").fill(newEmail);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Logi sisse" }).click();
    await page.waitForURL("**/prototype-preview");
    await page
      .getByRole("button", { name: "Vasta kliendile", exact: true })
      .click();
    await page.locator("#crmMailBody").waitFor();
    assert.equal(await page.evaluate(() => v8Active.id), draftId);
    assert.equal(
      await page.locator("#crmMailSignature").inputValue(),
      "Uue kliendihalduri sünteetiline allkiri",
    );
    assert.equal(
      await page.locator("#crmMailRecipient").inputValue(),
      "customer@example.invalid",
    );
    assert.equal(await page.locator("#crmMailRecipient").isEditable(), false);
    fs.mkdirSync("docs/transferred-client-replies", { recursive: true });
    await page.screenshot({
      path: "docs/transferred-client-replies/draft.png",
      fullPage: true,
    });
    await page
      .locator("#crmMailBody")
      .fill("Täname! Teie uus kontakt jätkab vestlust.");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Saada kiri", exact: true }).click();
    await page
      .getByRole("button", { name: "Jäta 14 päevaks ootele", exact: true })
      .waitFor();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].from.address, "new-owner@example.invalid");
    assert.equal(calls[0].replyTo, "new-owner@example.invalid");
    assert.equal(calls[0].inReplyTo, "<" + parsed.messageId + ">");
    const sent = await db("crm_email_outbox")
      .where({ activity_id: draftId })
      .first();
    assert.equal(sent.user_id, newOwner);
    assert.equal(sent.sender, "new-owner@example.invalid");
    const received = await db("crm_email_inbox")
      .where({ id: reply.id })
      .first();
    assert(received.handled_at);
    assert.equal(received.mailbox_user_id, uid);
    assert.equal(received.body, inboxBefore.body);
    assert.equal(received.outbox_id, inboxBefore.outbox_id);
    assert.deepEqual(
      await db("crm_email_outbox").where({ id: inboxBefore.outbox_id }).first(),
      originalBefore,
    );
    assert.equal(
      (await db("crm_clients").where({ id: cid }).first()).owner_user_id,
      newOwner,
    );
    assert.equal(
      (
        await db("crm_activities")
          .where({ client_id: cid, status: "active" })
          .first()
      ).owner_user_id,
      newOwner,
    );
    await page.screenshot({
      path: "docs/transferred-client-replies/sent.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS Chromium: real portfolio transfer; former owner denied; new owner resumes original draft; one mock send from new mailbox; original thread/inbox/outbox preserved; follow-up owned by new owner; 0 JS errors and real emails.",
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
