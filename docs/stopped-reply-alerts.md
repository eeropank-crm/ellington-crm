# Peatatud kliendi vastus ei jää töölauale

Probleem: tööjärjekorrad välistasid kliendid, kelle aktiivne jälgimine on peatatud, kuid töölaua eraldi „Klientide vastused” päring valis kõigi käsitlemata kirjade teated sõltumata kliendi peatamisest. Samal ajal keelas vastuskirja koostaja õigesti peatatud kliendile saatmise. Nii jäi töölauale toiming, mida ei saanud ega pidanudki lõpule viima.

Parandus:

- Vastuseteadete serveripäring välistab peatatud kliendid nii tavakasutaja kui administraatori töörežiimis. Reegel kehtib ka enne uuendust peatatud klientidele ja hiljem saabunud vastustele; andmete korrastamise migratsiooni pole vaja.
- Kliendikaart säilitab saabunud kirjad, kuid peatatud kliendi juures ei paku keelatud „Vasta kliendile” toimingut.
- Olemasolev peatamise töövoog värskendab pärast salvestamist vastuseteateid ja tööjärjekordi. Teate eemaldamiseks ei ole vaja saata lisakirja.
- Saabunud kirju ei kustutata ega märgita saatmist jäljendades käsitletuks. Kirjavahetus, saadetud kirjade andmed, omanik ja followupide arv säilivad. Aktiivsete klientide vastused jäävad senise õiguste ja saatmise kontrolliga käsitletavaks. Peatamine lõpetab aktiivsed tegevused senise töövoo kohaselt.

Kontrollid: kõik 57 sihitud vastuskirjade, CRM-i, töörežiimide ja tööjärjekordade regressioonitesti läbitud, 0 ebaõnnestunud ja 0 vahele jäetud. Uued testid kontrollivad peatamist avatud vastuskirja mustandi järel, olemasolevate ja uute vastuste eemaldamist omaniku/administraatori teadetest, teiste kasutajate õigusi, aktiivse kliendi teadete säilimist ning muutumatut kirjavahetust ja followupide arvu. Ainult kohalik sünteetiline MariaDB 11.4.13; päris SMTP/IMAP teenuseid ega Zone.ee serverit ei kasutatud.

Brauserikontroll: `scripts/check-stopped-replies-browser.cjs` (ainult kohaliku sünteetilise testandmebaasiga). Kontrollib kliendikaardilt peatamist, teate kadumist mõlemas töörežiimis, ajaloo säilimist ning saatmiste puudumist. Sünteetilised ekraanipildid: `docs/stopped-reply-alerts/`.

Paigaldus kasutab tavapärast varundavat protsessi. Uusi migratsioone pole ning olemasolevaid migratsioone ei muudeta. Pärast paigaldamist värskenda töölauda: juba peatatud kliendi teade kaob serveri filtri tõttu ilma kirjade või ajaloo muutmiseta.
