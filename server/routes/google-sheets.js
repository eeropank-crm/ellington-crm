"use strict";
const express = require("express"),
  create = require("../integrations/google-sheets/service"),
  { SyncError, diagnostic } = require("../integrations/google-sheets/model");
module.exports = (db, options = {}) => {
  const r = express.Router(),
    service = create(db, options);
  r.use("/admin/google-sheets", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.crmUser.role !== "admin")
      return res
        .status(403)
        .json({ error: "Ainult administraatori töörežiimis." });
    next();
  });
  const action = (fn) => async (req, res) => {
    try {
      const result = await fn(req);
      res.status(result?.ok === false ? 502 : 200).json(result);
    } catch (e) {
      res
        .status(e instanceof SyncError ? 409 : 503)
        .json({ ...diagnostic(e), error: diagnostic(e).code });
    }
  };
  const id = (req) => {
    const n = Number(req.params.id);
    if (!Number.isSafeInteger(n) || n < 1) throw new SyncError("SHEETS_ID");
    return n;
  };
  r.get(
    "/admin/google-sheets",
    action((req) => {
      const page = Number(req.query.page || 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
        throw new SyncError("SHEETS_PAGE");
      return service.status(page);
    }),
  );
  r.get(
    "/admin/google-sheets/clients",
    action((req) => service.search(req.query.search)),
  );
  r.post(
    "/admin/google-sheets/check",
    action(() => service.check()),
  );
  r.post(
    "/admin/google-sheets/sync",
    action(() => service.sync({ manual: true })),
  );
  r.post(
    "/admin/google-sheets/bulk-preview",
    action((req) => service.bulkPreview(req.crmUser)),
  );
  r.post(
    "/admin/google-sheets/bulk-bind",
    action((req) => service.bulkBind(req.crmUser, req.body || {})),
  );
  r.post(
    "/admin/google-sheets/:id/create",
    action((req) =>
      service.createPending(req.crmUser, id(req), req.body || {}),
    ),
  );
  r.post(
    "/admin/google-sheets/:id/bind",
    action((req) => service.bind(req.crmUser, id(req), req.body || {})),
  );
  r.post(
    "/admin/google-sheets/:id/resolve",
    action((req) => service.resolve(req.crmUser, id(req), req.body || {})),
  );
  return r;
};
