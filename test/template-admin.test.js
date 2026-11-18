const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const source = fs.readFileSync(
  require.resolve("../public/template-admin.js"),
  "utf8",
);
function context(
  current,
  { consent = true, reply = current, fail = false } = {},
) {
  const calls = [],
    select = { value: "admin" },
    c = {
      window: {},
      crmRealMe: { id: 1, name: "Synthetic admin", role: "admin" },
      data: { users: [] },
      user: "Synthetic admin",
      document: { getElementById: () => select },
      confirm: () => consent,
      v8Api: async (path, options) => {
        calls.push({ path, options });
        if (path === "/me") return { user: current };
        if (fail) throw Error("Synthetic denial");
        return { user: reply };
      },
    };
  vm.createContext(c);
  vm.runInContext(source, c);
  return { c, calls, select, run: () => c.window.crmEnsureTemplateAdmin() };
}
const admin = {
  id: 1,
  name: "Synthetic admin",
  accountRole: "admin",
  role: "admin",
  mode: "admin",
};
test("template admin check accepts current admin without changing session mode", async () => {
  const x = context(admin);
  assert.equal(await x.run(), true);
  assert.deepEqual(
    x.calls.map((c) => c.path),
    ["/me"],
  );
});
test("stale tab requires explicit consent and verifies mode switch before saving", async () => {
  const x = context(
    { ...admin, role: "sales", mode: "user" },
    { reply: admin },
  );
  assert.equal(await x.run(), true);
  assert.deepEqual(
    x.calls.map((c) => c.path),
    ["/me", "/work-mode"],
  );
  assert.equal(JSON.parse(x.calls[1].options.body).mode, "admin");
  assert.equal(x.c.crmRealMe.role, "admin");
  assert.equal(x.select.value, "admin");
});
test("declining mode recovery never elevates or writes", async () => {
  const x = context(
    { ...admin, role: "sales", mode: "user" },
    { consent: false },
  );
  assert.equal(await x.run(), false);
  assert.deepEqual(
    x.calls.map((c) => c.path),
    ["/me"],
  );
});
test("sales account and changed login cannot activate template administration", async () => {
  for (const current of [
    { ...admin, accountRole: "sales", role: "sales", mode: "user" },
    { ...admin, id: 2 },
  ]) {
    const x = context(current);
    await assert.rejects(x.run());
    assert.deepEqual(
      x.calls.map((c) => c.path),
      ["/me"],
    );
  }
});
test("failed or invalid mode-switch response aborts without trusting stale admin UI", async () => {
  for (const options of [
    { fail: true },
    { reply: { ...admin, role: "sales", mode: "user" } },
    { reply: { ...admin, id: 2 } },
  ]) {
    const x = context({ ...admin, role: "sales", mode: "user" }, options);
    await assert.rejects(x.run());
    assert.equal(x.c.crmRealMe.id, 1);
  }
});
