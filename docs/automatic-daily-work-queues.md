# Uue päeva vabad kohad täidetakse järjekorrast

## Põhjus

Varasem initialize valis ainult juba tänase kuupäevaga tegevused. Planeerimist
ootavate klientide seast uusi tegevusi ei loodud. Seetõttu võis uue päeva
salvestatud valik olla tühi, kuigi loendur näitas 0/38. Eelmise päeva kuus
tegevust olid eraldi planeeritud ega loonud järgmiseks päevaks uut valikut.

## Käitumine

Tavakasutaja töölauda avades/värskendades küsib kasutajaliides järjekorra
seisu ja vajadusel käivitab eraldi POST initialize toimingu. GET jääb ainult
lugemiseks. Iga kasutaja päevaplaan täidetakse oma töörežiimis; administraatori
ülevaade ei planeeri teiste kasutajate eest tegevusi.

1. Esmalt valitakse kuupäevaga tegevused, kuni kuus.
2. Ainult seni kasutamata kohad täidetakse sama kasutaja sobivate klientidega
   järjekorra algusest ja kasutajapõhise vaikemalliga.
3. Hilinenud tegevused jäävad eraldi valikusse (samuti kuni kuus).

Näited:

| Tänaseid juba planeeritud tegevusi | Järjekorrast lisatakse | Tänane valik |
| --- | --- | --- |
| 0 | kuni 6 | kuni 6 |
| 3 | kuni 3 | kuni 6 |
| 6 või rohkem | 0 | 6; ülejäänud kuupäevaga töö jääb järjekorda |

0/38 muutub kuue sobiva kliendi planeerimisel **6/38**, mitte 6/44: need
kliendid liiguvad ootel klientide hulgast tänaste tegevuste hulka. Kui kolm
kohta olid veel üldse kasutamata ja päeva jooksul lisandub sobivaid kliente,
saab neid järgmisel värskendamisel kasutada. Lõpetatud või edasi lükatud
tegevuse koht jääb kasutatuks: asemele ei looda automaatselt uut tegevust.
Edasise lisavaliku tegemiseks jäävad alles kasutaja selgesõnalised nupud.

Kui sobivaid kliente on vähem kui vabu kohti, on valik väiksem kui kuus.
Tulevase tegevusega, peatatud, teisele kasutajale kuuluvad, käsitlemata
vastusega ja varasema suhtluseta kliendid on endiselt välistatud.
Kandidaatide olemasolev järjestus ei muutu. Uute leadide turundusimporti ega
Ionprindi käibehoiatusi selle parandusega ei lisata.

## Vaikemall ja kasutuselevõtt

Käsitsi **Täida vabad kohad klientidega** valitud mall jäetakse kasutaja
järgmiste päevade vaikemalliks. Malli ID ja täitmise märge salvestatakse
olemasoleva crm_work_queue_days.state JSON-i; uut tabelit või veergu pole vaja.

Vana versiooni päevaplaanides neid välju pole. Parandus otsib kasutaja viimase
90 varasema päevaplaani seast salvestatud vaikemalli või üheselt tuvastatava
malli varasema valiku tegevustest. Vahepealsed tühjad päevad ja tühistatud
testtegevused ei peida varasemat valikut. Teise kasutaja malli ei kasutata.
Malli aktiivsus, põhiväljad ja järeltegevuste ahel kontrollitakse enne
automaatset loomist. Puuduva, mitmetähendusliku, vigase või deaktiveeritud malli
korral ei oletata juhuslikku malli: kasutaja näeb juhist mall üks kord ise
valida ning saab kuupäevaga tegevustega edasi töötada.

Ka tänaseks juba loodud tühi vana päevaplaan saab täidetud; kuupäeva vahetust
ei pea ootama. Kuus juba kasutatud kohta ei avane uuesti. Loodud tegevustes
säilivad valitud malli sisu ja järeltegevuste ahel. Pärast POST-i loetakse
tegevuste nimekiri uuesti, et ka äsja loodud tegevusi saaks kohe avada.

## Andmete ja samaaegsuse kaitse

- Automaatne täitmine **ei saada e-kirju** ega lõpeta tegevusi.
- Klientide omanikud, andmed, followup_count ja senine ajalugu ei muutu.
  Lisanduvad ainult uued planeeritud tegevused ja nende loomissündmused.
- Tehing lukustab kasutaja ning kontrollib iga kliendi lukustamisel uuesti,
  kas talle on vahepeal loodud aktiivne tegevus või saabunud käsitlemata vastus.
- Korduv värskendamine ja sama kasutaja samaaegsed päringud ei loo uut kuuest
  valikut. Kuue eraldatud koha ülempiir säilib ka tegevuste lõpetamisel.
- MariaDB deadlock pöörab kogu tehingu tagasi; ainult seda viga proovitakse
  kuni kaks korda uuesti. Tehing ei sisalda SMTP-d ega muid väliseid toiminguid.
- Päevaplaani 60 000 baidi mahupiir ja vigase JSON-i tõke säilivad. Mahupiiri
  ületamisel pööratakse tagasi ka enne kontrolli ette valmistatud tegevused.

Uusi migratsioone, sõltuvusi ega keskkonnamuutujaid pole. Tootmisega ei
ühendutud ja automaatset paigaldust ei tehtud. Kasutuselevõtt käib tavapärase
varundava paigaldajaga ning Zone'i tervisekontrolli aadressiga 127.0.135.83.

## Kontroll

Node.js 24.22.1 ja kohalik MariaDB 11.4.13, ainult sünteetilised andmed:

```bash
node --test --test-concurrency=1 test/daily-work-queues.test.js test/template-followups.test.js test/mail-content.test.js test/activity-edit.test.js test/crm.test.js test/mailboxes.test.js test/work-modes.test.js test/work-queues.test.js
```

DB_* ja SESSION_SECRET peavad viitama eraldatud kohalikule ellington_test*
andmebaasile. See on funktsiooni ja seotud töövoogude kontroll, mitte vana
paigaldus-/SQL-migratsioonitestide komplekti kordamine. Senine järgmise päeva
test kontrollib nüüd oodatud uute tegevuste lisandumist ning kõigi varasemate
kirjete muutumatust, mitte kogu andmebaasi muutumatust pärast uue päeva loomist.

15 uut regressiooni katavad: olemasoleva 0/38 päeva, 3+3 ja 6+0 eelisjärjekorra,
samaaegsed algseadistused, lõpetamise/edasilükkamise järel mittetäitmise,
järgmise päeva valiku, kolme omaniku eraldatuse ja admini vaatamisrežiimi,
puuduva/mitmetähendusliku/inaktiivse malli, tühjad vahepäevad, kandidaatide
välistused, vähese töö, vana juba kasutatud valiku, päeva jooksul saabunud
klientidele seni kasutamata kohad, vigase malli ning mahuvea täieliku rollback'i.

Brauserikontroll:

```bash
node scripts/check-daily-work-queues-browser.cjs
```

Vajab kohalikku sünteetilist DB-d, Playwrighti ja /usr/bin/chromium'i. Kolmel
sünteetilisel kasutajal kontrolliti vana päeva taastamist: 0+6, 3+3 ja 6+0,
0/38 → 6/38 ning eraldi 2/2 hilinenud tegevust. Kontrolliti värskendamist ilma
duplikaatideta, automaatselt loodud e-kirja kohest avamist, admini vaatamise
kirjutusteta käitumist, mobiili ja kliendiandmete/loendurite säilimist.
Saatmispäringud ja välisühendused blokeeriti. 0 saatmispäringut, 0 outbox'i
kirjet ja 0 JavaScripti viga.

- [0 planeeritud + 6 järjekorrast](daily-work-queues/eero.png)
- [3 planeeritud + 3 järjekorrast](daily-work-queues/indrek.png)
- [6 planeeritud + 0 järjekorrast](daily-work-queues/palme.png)
- [Mobiilivaade](daily-work-queues/mobile.png)

Lõpptulemus: **89 testi läbitud, 0 ebaõnnestunud, 0 vahele jäetud**
(15 uut + 74 seotud regressiooni), väljumiskood 0. Chromiumi kirjeldatud
kolme kasutaja kontroll läbis. JavaScripti süntaks ja git diff --check korras.

Testide eraldatuse parandamiseks otsib senine režiimitest oma konkreetset
sünteetilist klienti nime järgi: üldine „Sünteetiline” päring võis jätta selle
50 tulemuse piirangu taha. Järgmise päeva test kontrollib oma kasutaja
ülesannete säilimist ega lehitse enam kõigi teiste testkasutajate ajalugu.
Toote otsingu- ja administraatori lehitsemisloogikat ei muudetud.
