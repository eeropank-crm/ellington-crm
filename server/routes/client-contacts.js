"use strict";
const express = require("express"),
  contacts = require("../services/client-contacts"),
  { WorkflowError } = require("../services/activity-workflow");
module.exports = (db) => {
  const r = express.Router();
  const handle = (editing) => async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      const clientId = Number(req.params.clientId),
        contactId = editing ? Number(req.params.contactId) : null;
      if (
        !Number.isSafeInteger(clientId) ||
        clientId < 1 ||
        (editing && (!Number.isSafeInteger(contactId) || contactId < 1))
      )
        return res
          .status(400)
          .json({ error: "Vigane kliendi või kontaktisiku ID." });
      const result = await db.transaction((trx) =>
        contacts.save(trx, req.crmUser, clientId, contactId, req.body),
      );
      res.status(editing ? 200 : 201).json(result);
    } catch (e) {
      if (e instanceof WorkflowError)
        res.status(e.status).json({ error: e.message });
      else next(e);
    }
  };
  r.post("/clients/:clientId/contacts", handle(false));
  r.patch("/clients/:clientId/contacts/:contactId", handle(true));
  return r;
};
