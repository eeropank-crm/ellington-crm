"use strict";
// Contact editing stays in the existing client card; it never rewrites mail history.
window.crmContacts = (() => {
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  let clientId,
    contacts = [],
    busy = false;
  function html(result) {
    clientId = Number(result.client.id);
    contacts = result.contacts || [];
    return `<div id="crmContactList">${contacts.map((p) => `<div class="divider"><b>${esc(p.name)}</b>${p.position ? `<div class="muted">${esc(p.position)}</div>` : ""}<div>${esc(p.email || "")}</div><div>${esc(p.phone || "")}</div><button type="button" onclick="crmContacts.edit(${Number(p.id)})">Muuda kontakti</button></div>`).join("") || '<p class="muted">Kontaktisikuid ei ole lisatud.</p>'}<button type="button" onclick="crmContacts.edit()">Lisa kontaktisik</button><div id="crmContactEditor"></div></div>`;
  }
  function edit(id = null) {
    if (busy) return;
    const p = id === null ? {} : contacts.find((c) => Number(c.id) === id);
    if (!p) return;
    document.getElementById("crmContactEditor").innerHTML =
      `<form id="crmContactForm" class="form"><h4>${id === null ? "Lisa kontaktisik" : "Muuda kontaktisikut"}</h4><label for="contactName">Nimi</label><input id="contactName" name="name" required maxlength="150" value="${esc(p.name)}"><label for="contactEmail">E-post</label><input id="contactEmail" name="email" type="email" maxlength="255" value="${esc(p.email)}"><label for="contactPhone">Telefon</label><input id="contactPhone" name="phone" type="tel" maxlength="100" value="${esc(p.phone)}"><p id="crmContactError" role="alert"></p><div><button type="submit" class="primary">Salvesta kontakt</button><button type="button" id="contactCancel">Loobu</button></div></form>`;
    const form = document.getElementById("crmContactForm"),
      targetClient = clientId;
    document.getElementById("contactCancel").onclick = () => {
      if (!busy) document.getElementById("crmContactEditor").innerHTML = "";
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const controls = [...form.querySelectorAll("input,button")],
        data = Object.fromEntries(new FormData(form));
      if (id !== null) data.expected_version = p.version;
      controls.forEach((el) => (el.disabled = true));
      try {
        await v8Api(
          "/clients/" +
            targetClient +
            "/contacts" +
            (id === null ? "" : "/" + id),
          {
            method: id === null ? "POST" : "PATCH",
            body: JSON.stringify(data),
          },
        );
        if (form.isConnected) await openClientById(targetClient);
      } catch (error) {
        const errorNode = document.getElementById("crmContactError");
        if (errorNode) errorNode.textContent = error.message;
      } finally {
        busy = false;
        controls.forEach((el) => (el.disabled = false));
      }
    };
    document.getElementById("contactName").focus();
  }
  return { html, edit };
})();
