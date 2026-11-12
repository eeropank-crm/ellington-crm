// Run only with an explicitly configured local synthetic test database.
if (!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME || ""))
  throw Error("Synthetic database required");
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  crypto = require("node:crypto");
for (const k of Object.keys(process.env))
  if (/^CRM_(MAIL|SMTP|IMAP)/.test(k)) delete process.env[k];
process.env.CRM_IMAP_ENABLED = "0";
const db = require("../server/db");
require("./local-database")(db);
const w = require("../server/services/activity-workflow");
let browser, server;
(async () => {
  try {
    const password = crypto.randomBytes(24).toString("hex"),
      email = crypto.randomUUID() + "@example.invalid";
    const [uid] = await db("users").insert({
      name: "Sünteetiline kontaktihaldur",
      email,
      password_hash: await require("bcryptjs").hash(password, 10),
      role: "admin",
      is_active: 1,
    });
    const [other] = await db("users").insert({
      name: "Teine sünteetiline kasutaja",
      email: crypto.randomUUID() + "@example.invalid",
      password_hash: "synthetic-non-login",
      role: "sales",
      is_active: 1,
    });
    const [client] = await db("crm_clients").insert({
      name: "Sünteetiline kontaktide näidisklient",
      owner_user_id: uid,
      followup_count: 6,
    });
    const [foreign] = await db("crm_clients").insert({
      name: "Teise töötaja sünteetiline klient",
      owner_user_id: other,
      followup_count: 4,
    });
    const [contact] = await db("crm_contacts").insert({
      client_id: client,
      name: "Näidiskontakt",
      email: "original@example.invalid",
      phone: "+372000001",
    });
    const [template] = await db("crm_templates").insert({
      name: "Kontaktihalduse testkõne",
      purpose: "Kontaktihalduse testkõne",
      type: "Kõne",
      body: "Sünteetiline juhis",
      is_active: 1,
    });
    const task = await db.transaction((trx) =>
      w.create(
        trx,
        { id: uid, role: "sales" },
        {
          client_id: client,
          contact_id: contact,
          type: "Kõne",
          template_id: template,
          purpose: "Kontaktihalduse testkõne",
          instructions: "Sünteetiline juhis",
          due_date: w.today(),
        },
      ),
    );
    require("nodemailer").createTransport = () => {
      throw Error("Real mail forbidden");
    };
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
    let sendAttempts = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (/\/send$|\/imap\/sync$/.test(u.pathname)) {
        sendAttempts++;
        return route.abort();
      }
      return u.hostname === "127.0.0.1" ? route.continue() : route.abort();
    });
    await page.goto(base + "/");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("button[type=submit]").click();
    await page.waitForURL("**/prototype-preview");
    await page.waitForFunction(() => crmReady === true);
    await page.evaluate(async (id) => {
      page = "clients";
      await openClientById(id);
    }, client);
    await page
      .getByRole("button", { name: "Muuda kontakti", exact: true })
      .click();
    await page
      .getByLabel("Nimi", { exact: true })
      .fill("Uuendatud näidiskontakt");
    await page
      .getByLabel("E-post", { exact: true })
      .fill("updated@example.invalid");
    await page.getByLabel("Telefon", { exact: true }).fill("+372000002");
    await page
      .getByRole("button", { name: "Salvesta kontakt", exact: true })
      .click();
    await page.getByText("Uuendatud näidiskontakt", { exact: true }).waitFor();
    assert.equal(
      (await db("crm_contacts").where({ id: contact }).first()).email,
      "updated@example.invalid",
    );
    await page
      .getByRole("button", { name: "Lisa kontaktisik", exact: true })
      .click();
    await page.getByLabel("Nimi", { exact: true }).fill("Teine näidiskontakt");
    await page
      .getByLabel("E-post", { exact: true })
      .fill("second@example.invalid");
    await page.getByLabel("Telefon", { exact: true }).fill("+372000003");
    await page
      .getByRole("button", { name: "Salvesta kontakt", exact: true })
      .click();
    await page.getByText("Teine näidiskontakt", { exact: true }).waitFor();
    const second = await db("crm_contacts")
      .where({ client_id: client, name: "Teine näidiskontakt" })
      .first();
    fs.mkdirSync("docs/client-contacts", { recursive: true });
    await page.screenshot({
      path: "docs/client-contacts/client-card.png",
      fullPage: true,
    });
    await page.evaluate((id) => v8OpenTask(id), task.id);
    await page
      .getByRole("button", { name: "Muuda tegevust", exact: true })
      .click();
    await page.getByLabel("Kontaktisik", { exact: true }).waitFor();
    await page
      .getByLabel("Kontaktisik", { exact: true })
      .selectOption(String(second.id));
    await page.screenshot({
      path: "docs/client-contacts/activity-contact.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Salvesta muudatus", exact: true })
      .click();
    await page.waitForFunction(() => v8Pending === false && !v8Active?.edit);
    assert.equal(
      (await db("crm_activities").where({ id: task.id }).first()).contact_id,
      second.id,
    );
    assert.equal(
      (await db("crm_clients").where({ id: client }).first()).followup_count,
      6,
    );
    await page.evaluate(() => crmCloseWorkflow());
    await page
      .getByRole("button", { name: "Lisa kontaktisik", exact: true })
      .click();
    await page
      .getByLabel("Nimi", { exact: true })
      .fill("Mobiilivaate näidiskontakt");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    assert(await page.getByLabel("E-post", { exact: true }).isVisible());
    assert(await page.getByLabel("Telefon", { exact: true }).isVisible());
    await page
      .locator("#crmContactForm")
      .screenshot({ path: "docs/client-contacts/mobile-form.png" });
    await page.getByRole("button", { name: "Loobu", exact: true }).click();
    await page.locator("#crmWorkMode").selectOption("admin");
    await page.waitForFunction(() => crmRealMe?.role === "admin");
    await page.evaluate(async (id) => {
      page = "clients";
      await openClientById(id);
    }, foreign);
    await page
      .getByRole("button", { name: "Lisa kontaktisik", exact: true })
      .click();
    await page
      .getByLabel("Nimi", { exact: true })
      .fill("Administraatori lisatud kontakt");
    await page
      .getByRole("button", { name: "Salvesta kontakt", exact: true })
      .click();
    await page
      .getByText("Administraatori lisatud kontakt", { exact: true })
      .waitFor();
    assert.equal(
      (await db("crm_contacts").where({ client_id: foreign })).length,
      1,
    );
    assert.equal(
      (await db("crm_clients").where({ id: foreign }).first()).owner_user_id,
      other,
    );
    assert.deepEqual(errors, []);
    assert.equal(sendAttempts, 0);
    console.log(
      "PASS Chromium: own contact creation/editing; activity contact selection; admin foreign-client creation; mobile; 0 JS errors; 0 email send requests.",
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
