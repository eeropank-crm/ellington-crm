"use strict";
const crypto = require("node:crypto");
const { WorkflowError } = require("./activity-workflow");
const fail = (status, message) => {
  throw new WorkflowError(status, message);
};
const fields = ["name", "email", "phone"];
const version = (c) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        c.id,
        c.client_id,
        c.name,
        c.email,
        c.phone,
        c.position,
        c.updated_at,
      ]),
    )
    .digest("hex");
const present = (c) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  phone: c.phone,
  position: c.position,
  version: version(c),
});
function values(input, editing) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) => ![...fields, ...(editing ? ["expected_version"] : [])].includes(k),
    )
  )
    fail(400, "Vigased kontaktisiku väljad.");
  const limits = { name: 150, email: 255, phone: 100 },
    out = {};
  for (const field of fields) {
    const value = input[field];
    if (
      typeof value !== "string" ||
      value.trim().length > limits[field] ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      fail(400, "Kontrolli välja: " + field + ".");
    out[field] = value.trim();
  }
  if (!out.name) fail(400, "Sisesta kontaktisiku nimi.");
  if (out.email && !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(out.email))
    fail(400, "Sisesta üks korrektne e-posti aadress.");
  return { name: out.name, email: out.email || null, phone: out.phone || null };
}
async function save(trx, user, clientId, contactId, input) {
  const data = values(input, contactId !== null);
  const client = await trx("crm_clients")
    .where({ id: clientId })
    .forUpdate()
    .first();
  if (!client) fail(404, "Klienti ei leitud.");
  if (user.role !== "admin" && Number(client.owner_user_id) !== Number(user.id))
    fail(403, "Klient ei kuulu sinu portfelli.");
  if (contactId === null) {
    const [id] = await trx("crm_contacts").insert({
      client_id: clientId,
      ...data,
    });
    return {
      contact: present(await trx("crm_contacts").where({ id }).first()),
    };
  }
  const contact = await trx("crm_contacts")
    .where({ id: contactId, client_id: clientId })
    .forUpdate()
    .first();
  if (!contact) fail(404, "Kontaktisikut ei leitud selle kliendi juures.");
  if (
    typeof input.expected_version !== "string" ||
    input.expected_version !== version(contact)
  )
    fail(409, "Kontakt muutus. Värskenda kliendikaarti ja proovi uuesti.");
  await trx("crm_contacts")
    .where({ id: contactId, client_id: clientId })
    .update({ ...data, updated_at: trx.fn.now() });
  return {
    contact: present(
      await trx("crm_contacts").where({ id: contactId }).first(),
    ),
  };
}
module.exports = { save, present, version };
