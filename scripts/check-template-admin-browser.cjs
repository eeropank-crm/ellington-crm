if (!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME || ""))
  throw Error("Synthetic database required");
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  fs = require("node:fs");
for (const k of Object.keys(process.env))
  if (/^CRM_(MAIL|SMTP|IMAP)/.test(k)) delete process.env[k];
process.env.CRM_IMAP_ENABLED = "0";
const db = require("../server/db");
require("./local-database")(db);
let server, browser;
(async () => {
  try {
    const password = crypto.randomBytes(24).toString("hex"),
      email = crypto.randomUUID() + "@example.invalid";
    const [uid] = await db("users").insert({
      name: "Sünteetiline mallihaldur",
      email,
      password_hash: await require("bcryptjs").hash(password, 10),
      role: "admin",
      is_active: 1,
    });
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
    const ctx = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
        extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
      }),
      page = await ctx.newPage(),
      errors = [];
    let consent = true,
      modePrompts = 0,
      sends = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => {
      if (d.type() === "confirm") {
        modePrompts++;
        return consent ? d.accept() : d.dismiss();
      }
      return d.accept();
    });
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (/\/send$|\/imap\/sync$/.test(u.pathname)) {
        sends++;
        return route.abort();
      }
      return u.hostname === "127.0.0.1" ? route.continue() : route.abort();
    });
    await page.goto(base + "/");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Logi sisse" }).click();
    await page.waitForURL("**/prototype-preview");
    await page.waitForFunction(() => crmReady === true);
    await page.locator("#crmWorkMode").selectOption("admin");
    await page.waitForFunction(() => crmRealMe?.role === "admin");
    const purpose = "Sünteetiline mall " + crypto.randomUUID().slice(0, 8),
      body = "Säiliv sünteetiline sisu\nTeine rida";
    await page.evaluate(
      ({ purpose, body }) => {
        go("templates");
        blankTemplate();
        Object.assign(templateDraft, {
          type: "E-kiri",
          purpose,
          subject: "Sünteetiline pealkiri",
          body,
          follow: false,
        });
        render();
      },
      { purpose, body },
    );
    const second = await ctx.newPage();
    await second.goto(base + "/prototype-preview");
    await second.waitForFunction(() => crmReady === true);
    await second.locator("#crmWorkMode").selectOption("user");
    await second.waitForFunction(() => crmRealMe?.mode === "user");
    assert.equal(await page.evaluate(() => crmRealMe.mode), "admin");
    const denied = await page.evaluate(async () => {
      const r = await fetch("/api/v8/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "Kõne",
          purpose: "Must not exist",
          body: "Denied",
        }),
      });
      return r.status;
    });
    assert.equal(denied, 403);
    consent = false;
    await page
      .getByRole("button", { name: "Loo tegevusmall", exact: true })
      .click();
    await page.waitForFunction(() => crmTemplateSaving === false);
    assert.equal(await page.evaluate(() => templateDraft.body), body);
    assert.equal((await db("crm_templates").where({ purpose })).length, 0);
    assert.equal(
      await second.evaluate(
        async () => (await (await fetch("/api/me")).json()).user.mode,
      ),
      "user",
    );
    consent = true;
    await page
      .getByRole("button", { name: "Loo tegevusmall", exact: true })
      .click();
    await page
      .getByText("Mall salvestatud andmebaasi.", { exact: true })
      .waitFor();
    const created = await db("crm_templates").where({ purpose }).first();
    assert(created);
    assert.equal(created.body, body);
    assert.equal((await db("crm_templates").where({ purpose })).length, 1);
    assert.equal(modePrompts, 2);
    await page.evaluate((id) => editTemplate(String(id)), created.id);
    await page.evaluate(() => {
      templateDraft.body = "Muudetud sünteetiline sisu";
      render();
    });
    await page
      .getByRole("button", { name: "Salvesta muudatused", exact: true })
      .click();
    await page.waitForFunction(() => editId === null && !crmTemplateSaving);
    assert.equal(
      (await db("crm_templates").where({ id: created.id }).first()).body,
      "Muudetud sünteetiline sisu",
    );
    fs.mkdirSync("docs/template-admin", { recursive: true });
    await page.screenshot({
      path: "docs/template-admin/saved.png",
      fullPage: true,
    });
    assert.equal(sends, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS Chromium: reproduced stale admin tab and server 403; rejected recovery preserves draft and user mode; consent saves once; edit persists; 0 JS errors and email requests.",
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
