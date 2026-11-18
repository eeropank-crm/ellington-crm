"use strict";
// The session mode is shared by tabs. Never elevate implicitly or discard a draft.
window.crmEnsureTemplateAdmin = async function () {
  const { user: current } = await v8Api("/me");
  if (!crmRealMe || Number(current.id) !== Number(crmRealMe.id))
    throw Error(
      "Sisselogitud konto on muutunud. Kopeeri malli tekst ja laadi leht uuesti.",
    );
  if (current.accountRole !== "admin")
    throw Error(
      "Mallide salvestamiseks on vaja administraatori õigusi. Sisestatud mall on vormis alles.",
    );
  let verified = current;
  if (current.mode !== "admin") {
    if (
      !confirm(
        "Seansi töörežiim on praegu Tavakasutaja, näiteks teises vahelehes tehtud valiku tõttu. Kas lülituda Administraatori režiimi ja salvestada mall? Sisestatud sisu säilib.",
      )
    )
      return false;
    verified = (
      await v8Api("/work-mode", {
        method: "POST",
        body: JSON.stringify({ mode: "admin" }),
      })
    ).user;
  }
  if (Number(verified.id) !== Number(crmRealMe.id) || verified.role !== "admin")
    throw Error(
      "Administraatori režiimi ei saanud kinnitada. Malli sisu jäi vormi alles.",
    );
  crmRealMe = verified;
  data.users = [{ name: verified.name, role: verified.role, active: true }];
  user = verified.name;
  document.getElementById("crmWorkMode").value = verified.mode;
  return true;
};
