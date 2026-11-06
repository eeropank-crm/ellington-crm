# Avatud tegevuse tüübi ja malli muutmine

Tavakasutaja avab oma tegevuse ja vajutab **Muuda tegevust**. Valida saab
Kõne, E-kiri või Kohtumine ning selle tüübi aktiivse eesmärgi/malli. Malli
valimine laadib selle pealkirja ja juhise/sisu; neid saab enne salvestamist
kohandada. **Salvesta muudatus** muudab sama tegevust. **Loobu muudatusest**
jätab senise tegevuse ja poolelioleva kirjamustandi alles.

Tegevuse ID, klient, omanik, kontaktisik, tähtaeg, järjekorravalik ja
sequence_number ei muutu. Klientide followup_count ja senine ajalugu ei muutu.
Muudatus ei lõpeta tegevust, ei käsitle kliendi vastuseid ega saada kirja.
E-kirjaks muutmisel avaneb tavaline saatmisvorm; kirja saab saata ainult
**Saada kiri** nupuga. Saatmiseks peab kasutajal olema seadistatud postkast
ja kliendil sobiv kontaktisik. Malli vahetus uuendab selle tegevuse edasise
järeltegevuse malli/ahela, mitte teiste tegevuste malle.

Muuta saab ainult enda ja endiselt enda portfelli kuuluva kliendi aktiivset
tegevust tavakasutaja režiimis. Administraatori režiimis muutmine on keelatud.
Peatatud kliendi ning lõpetatud/tühistatud tegevust ei muudeta. Igasugune
registreeritud outbox-kirje, sh sending, uncertain, sent või failed, blokeerib
muutmise. See muudatus ei lisa saatmise korduskatset ega kustuta outbox-kirjeid.

Server lukustab kliendi ja tegevuse samas järjekorras nagu kirjasaatmine.
Saatmisreservatsiooni, üksikasjade ja viimase sündmuse kontrollid kasutavad
lukustavat lugemist, et näha ka lukustuse ootamise ajal kinnitatud muudatusi.
Vorm saab versioonitunnuse: vana vormi salvestamine tagastab 409. Kasutaja
peab vormi sulgema ja uuesti avama. Muudatus ning activity_edited sündmus
salvestuvad ühes tehingus; audit säilitab varasema sisu, märkmed ja ahela.
Liiga mahukas audit lükatakse tagasi enne kirjutamist, et TEXT ei kärbiks ajalugu.
Kliendikaardi ajaloos kuvatakse muutja, aeg ning vana ja uus tüüp/eesmärk.

Uusi migratsioone, keskkonnamuutujaid ega sõltuvusi pole. Tootmise paigaldus
kasutab olemasolevat varundavat paigaldajat ja Zone'i health-host 127.0.135.83.
Selle arenduse käigus tootmisega ei ühenduta ega seda ei paigaldata.

## Kontroll

Kohalik MariaDB 11.4.13, sünteetilised kasutajad ja kliendid. Sihitud käsk:

```bash
node --test --test-concurrency=1 test/activity-edit.test.js test/crm.test.js test/mailboxes.test.js test/work-modes.test.js test/work-queues.test.js
```

Määra enne käsu käivitamist kohaliku eraldatud testandmebaasi DB_* ja
SESSION_SECRET väärtused. Testid keelduvad tootmisnimega/mitte-kohalikust DB-st.
See pole kogu varasema paigaldus-/migratsioonitestide komplekti kordamine.
CRM-i vana testi globaalne outbox=0 eeldus on parandatud konkreetse testitava
tegevuse kontrolliks, et teiste sünteetiliste saatmisolekute kirjed tulemust ei mõjutaks.

13 uut testi: kuus suunda, sama tüübi mallivahetus, vana detailideta tegevus,
vigased sisendid, kasutaja- ja režiimiõigused, lõpetatud/peatatud tegevused,
kõik saatmisolekud, aegunud ning samaaegsed muudatused, portfelli üleandmine,
nähtav audit/algse sisu säilimine, Unicode'i auditi mahupiir, tavapärane
idempotentne lõpetamine ning samaaegne saatmisreservatsioon ja muutmine.

Chromiumi kontroll: scripts/check-activity-edit-browser.cjs. See vajab
arenduskeskkonnas Playwrighti ja /usr/bin/chromium'i ning ainult kohalikku
ellington_test* andmebaasi. Brauser blokeerib saatmise/IMAP-sync päringud
ja välised URL-id. Kontrollitakse tüübi vahetamist, poolelioleva mustandi
säilimist loobumisel, mobiilivaadet, admini vaatamisrežiimi, nähtavat ajalugu,
muutumatut followup_count'i ning JS-vigade ja saatmispäringute puudumist.

Ekraanipildid ainult sünteetilistest andmetest:

- [E-kiri → kõne](activity-edit/email-to-call.png)
- [Kõne → kohtumine](activity-edit/call-to-meeting.png)
- [Kohtumine → e-kiri](activity-edit/meeting-to-email.png)
- [Mobiil](activity-edit/mobile.png)
- [Muutmisajalugu](activity-edit/history.png)

Lõpptulemus Node.js 24.22.1 ja MariaDB 11.4.13-ga: **53 testi läbitud,
0 ebaõnnestunud, 0 vahele jäetud** (13 uut + 40 seotud regressiooni).
Chromiumi kontroll läbis: töölaua/mobiili vormid, mustandist loobumine,
nähtav kliendiajalugu ja admini vaatamisrežiim; 0 saatmispäringut ning
0 JavaScripti viga. JavaScripti süntaks ja git diff --check korras.
