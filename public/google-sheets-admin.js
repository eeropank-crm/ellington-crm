"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    esc = (x) =>
      String(x ?? "").replace(
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
  let busy = false,
    page = 0;
  const messages = {
    SHEETS_HEADERS:
      "Tabelis peavad olema üheselt nimetatud CRM ID, firma nimi, inimese nimi, meiliaadress, telefon ja staatus.",
    SHEETS_IDS:
      "Mõnel real puudub korrektne püsiv CRM ID või esineb korduv ID.",
    SHEETS_CREDENTIALS:
      "Teenusekonto võtmefail puudub või selle õigused ei sobi.",
    SHEETS_OWNER_MARKER: "Vastutaja tähis peab olema P, I, E või tühi.",
    SHEETS_OWNER: "Uute leadide vaikimisi vastutaja puudub või on peatatud.",
    SHEETS_CONFIG: "Ühenduse seadistus on puudulik.",
    SHEETS_STALE:
      "Andmed on vahepeal muutunud. Värskenda vaadet ja kontrolli uuesti.",
    SHEETS_VALUES:
      "Mõni nimi, e-post või telefon ei vasta lubatud kujule. Kontrolli tabelit.",
    SHEETS_SIZE: "Tabel või vastus on lubatust suurem. Kontrolli tabeli mahtu.",
    SHEETS_TAB: "Seadistatud tabelilehte ei leitud.",
    SHEETS_HTTP:
      "Google ei lubanud päringut. Kontrolli faili jagamist ja Google Sheetsi API lubamist.",
    SHEETS_AUTH: "Google’i teenusekonto autentimine ebaõnnestus.",
    SHEETS_RESPONSE: "Google’i vastust ei saanud terviklikult kontrollida.",
    SHEETS_BIND:
      "Seostamise andmed on muutunud või leidub võimalik olemasolev klient. Värskenda ja kontrolli valikut.",
    SHEETS_TARGET: "Seotud klient või kontaktisik puudub. Kontrolli seost.",
    SHEETS_FORBIDDEN: "Toiming vajab administraatori õigusi.",
    SHEETS_FAILED:
      "Sünkroonimine ebaõnnestus. Kontrolli ühendust ja viimast käivitust.",
    disabled: "Sünk on seadistuses välja lülitatud.",
    busy: "Teine sünkroonimise toiming on pooleli.",
  };
  const time = (x) =>
    x
      ? new Intl.DateTimeFormat("et-EE", {
          timeZone: "Europe/Tallinn",
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(x))
      : "veel puudub";
  const labels = {
    owner: "Vastutaja",
    company: "Ettevõte",
    name: "Kontaktisik",
    email: "E-post",
    phone: "Telefon",
  };
  async function api(path = "", body) {
    const r = await fetch("/api/admin/google-sheets" + path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const x = await r.json().catch(() => {
      throw Error("SHEETS_FAILED");
    });
    if (!r.ok)
      throw Object.assign(Error(x.error || x.code || "SHEETS_FAILED"), {
        row: x.row,
        field: x.field,
      });
    return x;
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    const controls = [...document.querySelectorAll("button")].map((b) => [
      b,
      b.disabled,
    ]);
    controls.forEach(([b]) => (b.disabled = true));
    try {
      await fn();
      await load();
    } catch (e) {
      $("notice").textContent =
        "Toiming peatati: " +
        ((messages[e.message] ||
          "Kontrolli ühendust ja oma valikuid ning värskenda vaadet.") +
          (e.row ? " Tabeli rida " + e.row + "." : ""));
    } finally {
      busy = false;
      controls.forEach(([b, disabled]) => (b.disabled = disabled));
    }
  }
  async function load() {
    const x = await api("?page=" + page);
    $("notice").textContent = x.enabled
      ? x.configured
        ? "Ühendusseaded on sisestatud."
        : "Ühenduse seadistus on puudulik."
      : "Automaatne sünk on välja lülitatud.";
    $("content").innerHTML =
      `<section><h2>Ajakava</h2><p>Uued leadid: P → ${esc(x.owner_mapping?.P?.name || "seadistamata")}, I → ${esc(x.owner_mapping?.I?.name || "seadistamata")}, E või tühi → ${esc(x.owner_mapping?.E?.name || "seadistamata")}.</p><p>${esc(x.schedule)}</p><small>Taustakäsk peab olema serveri cron-is seadistatud. See vaade ise taimerit ei käivita.</small><p>Viimane edukas sünk: ${esc(time(x.last_success))}</p><h2>Viimased käivitused</h2>${x.runs.map((r) => `<p>${esc(time(r.created_at))} · ${esc(r.status)} ${r.summary.row ? `· tabeli rida ${r.summary.row}` : ""} · loetud ${esc(r.summary.read ?? "—")}, uusi ${esc(r.summary.created ?? 0)}, muudetud ${esc(r.summary.updated ?? 0)}, seostamata ${esc(r.summary.pending ?? 0)}, konfliktiga ${esc(r.summary.conflicts ?? 0)} ${esc(r.summary.code ? messages[r.summary.code] || "Kontrolli ühendust." : "")}</p>`).join("") || "<p>Käivitusi veel pole.</p>"}</section><h2>Seostamist või otsust ootavad read (${x.total})</h2>${x.records
        .map(
          (r) =>
            `<section><h3>${esc(r.state.latest.data.company)}</h3><small>Tabeli rida ${r.state.latest.row} · püsiv ID ${esc(r.source_id)}</small><pre>${esc(JSON.stringify({ ...r.state.latest.data, ...r.state.latest.metadata, staatus: r.state.latest.lifecycleHint || "", vastutaja: r.state.latest.ownerMarker || "E" }, null, 2))}</pre>${
              r.status === "pending"
                ? `<label>Otsi olemasolevat CRM-klienti <input id="search-${r.id}" value="${esc(r.state.latest.data.company)}"></label><button data-search="${r.id}">Otsi CRM-ist</button><label>CRM-klient <select id="client-${r.id}"><option value="">Vali klient</option>${r.candidates.map((c) => `<option value="${Number(c.id)}">${esc(c.name)}</option>`).join("")}</select></label><label>Kontaktisik <select id="contact-${r.id}"><option value="">Vali esmalt klient</option></select></label><button data-bind="${r.id}" data-version="${esc(r.version)}">Seosta kliendiga</button>${r.state.initial_review ? "<p>Esmase sünkroonimise rida vajab kinnitamist.</p>" : ""}${r.state.latest.lifecycleHint ? `<p>Tabeli staatus: ${esc(r.state.latest.lifecycleHint)}. Automaatset aktiveerimist ei tehtud.</p>` : ""}${!r.candidates.length ? `<button data-create="${r.id}" data-version="${esc(r.version)}">Lisa uue aktiivse leadina</button>` : ""}<small>Nime või e-posti kattumine on ainult vihje. Enne seostamist kontrolli kliendikaarti. Erinevad olemasolevad väärtused vajavad järgmist kinnitust.</small>`
                : Object.entries(r.state.conflicts)
                    .map(
                      ([key, c]) =>
                        `<p><b>${esc(labels[key])}</b><br>CRM-is: ${esc(c.crm)}<br>Tabelis: ${esc(c.source)}</p><button data-resolve="${r.id}" data-field="${key}" data-choice="crm" data-current="${esc(c.crm)}" data-version="${esc(r.version)}">Säilita CRM-i väärtus</button><button data-resolve="${r.id}" data-field="${key}" data-choice="sheet" data-current="${esc(c.crm)}" data-version="${esc(r.version)}">Kasuta tabeli väärtust</button>`,
                    )
                    .join("")
            }</section>`,
        )
        .join(
          "",
        )}<button id="prev" ${page ? "" : "disabled"}>Eelmised</button><button id="next" ${(page + 1) * 25 < x.total ? "" : "disabled"}>Järgmised</button>`;
    function clientOptions(r) {
      const select = $("client-" + r.id);
      select.onchange = () => {
        const client = r.candidates.find((c) => String(c.id) === select.value),
          contact = $("contact-" + r.id);
        contact.innerHTML =
          '<option value="">Vali kontaktisik</option><option value="0">Loo uus kontaktisik</option>' +
          (client?.contacts || [])
            .map(
              (c) =>
                `<option value="${Number(c.id)}">${esc(c.name)} · ${esc(c.email || c.phone || "")}</option>`,
            )
            .join("");
        const matches =
          client?.contacts.filter(
            (c) =>
              c.email &&
              c.email.toLowerCase() === r.state.latest.data.email.toLowerCase(),
          ) || [];
        if (matches.length === 1) contact.value = String(matches[0].id);
      };
    }
    x.records.filter((r) => r.status === "pending").forEach(clientOptions);
    document.querySelectorAll("[data-search]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (busy) return;
          try {
            const result = await api(
                "/clients?search=" +
                  encodeURIComponent($("search-" + b.dataset.search).value),
              ),
              r = x.records.find((r) => r.id === Number(b.dataset.search));
            r.candidates = result.clients;
            $("client-" + r.id).innerHTML =
              '<option value="">Vali klient</option>' +
              r.candidates
                .map(
                  (c) =>
                    `<option value="${Number(c.id)}">${esc(c.name)}</option>`,
                )
                .join("");
            $("contact-" + r.id).innerHTML =
              '<option value="">Vali esmalt klient</option>';
            clientOptions(r);
          } catch {
            $("notice").textContent =
              "Otsing ebaõnnestus. Sisesta vähemalt kaks märki.";
          }
        }),
    );
    document.querySelectorAll("[data-bind]").forEach(
      (b) =>
        (b.onclick = () =>
          run(() => {
            const client = $("client-" + b.dataset.bind).value,
              contact = $("contact-" + b.dataset.bind).value;
            if (!client || contact === "")
              throw Error(
                "Vali klient ja kontaktisik või uue kontakti loomine.",
              );
            return api("/" + b.dataset.bind + "/bind", {
              client_id: Number(client),
              contact_id: Number(contact),
              version: b.dataset.version,
            });
          })),
    );
    document.querySelectorAll("[data-create]").forEach(
      (b) =>
        (b.onclick = () =>
          run(async () => {
            if (
              confirm(
                "Lisada see rida uue aktiivse leadina hoolimata tabeli staatusest?",
              )
            )
              return api("/" + b.dataset.create + "/create", {
                version: b.dataset.version,
                confirm: true,
              });
          })),
    );
    document.querySelectorAll("[data-resolve]").forEach(
      (b) =>
        (b.onclick = () =>
          run(() =>
            api("/" + b.dataset.resolve + "/resolve", {
              field: b.dataset.field,
              choice: b.dataset.choice,
              expected_crm: b.dataset.current,
              version: b.dataset.version,
            }),
          )),
    );
    $("prev").onclick = () => {
      if (page) {
        page--;
        run(async () => {});
      }
    };
    $("next").onclick = () => {
      if ((page + 1) * 25 < x.total) {
        page++;
        run(async () => {});
      }
    };
  }
  $("bulk-preview").onclick = () =>
    run(async () => {
      const plan = await api("/bulk-preview", {});
      $("bulk-result").innerHTML =
        `<p>Seostamiseks sobib ${plan.eligible.length} rida. Käsitsi ülevaatusele jääb ${plan.manual} rida.</p><p>Olemasolevad kliendiandmed, omanikud, tegevused ja järeltegevuste arv säilivad.</p><ul>${plan.eligible.map((r) => `<li>Tabeli rida ${esc(r.row)}: ${esc(r.company)} · ${esc(r.email)} → CRM-klient #${Number(r.client_id)}, kontakt #${Number(r.contact_id)}</li>`).join("")}</ul>${plan.eligible.length ? '<button id="bulk-confirm">Kinnita eelvaate kõik seosed</button>' : ""}`;
      if ($("bulk-confirm"))
        $("bulk-confirm").onclick = () =>
          run(async () => {
            if (
              !confirm(
                `Seostada eelvaate ${plan.eligible.length} rida? CRM-i andmeid ei muudeta.`,
              )
            )
              return;
            const result = await api("/bulk-bind", {
              token: plan.token,
              confirm: true,
            });
            if (result.skipped) throw Error(result.reason);
            $("bulk-result").textContent =
              `Seostatud ${result.bound} rida. Käsitsi ülevaatusele jäi ${result.manual} rida.`;
          });
    });
  $("check").onclick = () =>
    run(async () => {
      const r = await api("/check", {});
      alert(
        "Ühendus ja tabel kontrollitud. Kliendiridu: " +
          r.read +
          ". CRM-i andmeid ei muudetud.",
      );
    });
  $("refresh").onclick = () => run(async () => {});
  $("sync").onclick = () =>
    run(async () => {
      if (confirm("Käivitada kontaktandmete sünkroonimine nüüd?")) {
        const r = await api("/sync", {});
        if (r.skipped) throw Error(r.reason);
      }
    });
  run(async () => {});
})();
