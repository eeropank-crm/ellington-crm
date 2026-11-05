# Pärandskeemi andmeid säilitav üleminek

05.11.2026. Lähteandmed: kasutaja saadetud PR #4 diagnostika versioonilt
`27d0dec43b1e7a94bcc2801839879eb9dd6253c2`, MariaDB 11.4.13.
Tootmisega pole ühendutud. Lisatud faili terminaliteavet, kasutajanime, andmebaasi
nime ega ühenduse andmeid ei lisatud hoidlasse. `ops/legacy-v8-profile.json`
sisaldab ainult 52 redigeeritud veerukirjeldust.

## Tulemus ja piirid

- 52 erinevust on allolevas tabelis ükshaaval käsitletud.
- Uus `004_legacy_v8_transition.js` muudab 44 teadaolevat veergu.
- 2 laiendust (`users.name`, `crm_templates.subject`) teeb juba olemasolev 002.
- 6 suuremat TEXT-välja jäetakse puutumata, et vältida mahtude vähendamist.
- 001 ja 002 pole tagantjärele muudetud; ka senine skeemileping on muutmata.
- Kolm puuduvat mitteunikaalset indeksit parandab PR #4 migratsioon 003.
- Sünteetiline täpsele profiilile vastav skeem saavutab eelkontrollis `ok: true`
  ja pärast kõiki migratsioone läbib range tegeliku lõppskeemi kontrolli.
- Tootmise andmete sobivust ei saa pelgalt skeemidiagnostikaga kinnitada.
  Vaja on allpool nimetatud 27 loenduri tulemusi ja SQL-režiimi kontrolli.

PR põhineb PR #4 harul, sest GitHubi main on endiselt `14ff627` ja PR #4 pole
sinna ühendatud. Ülevaatamisel arvesta esmalt PR #4 muudatustega.

## Eraldi vajalikud ainult lugemisega päringud

**Palun käivita valitud tootmisandmebaasis kogu
[`ops/legacy-transition-guards.sql`](../ops/legacy-transition-guards.sql) ja saada
kõik 9 tulemuste tabelit.** See on eraldi andmetõend, mitte paigalduskäsk.

Fail sisaldab ainult SELECT-päringuid. See väljastab serveriversiooni,
ühenduse SQL-režiimi ja 27 loendurit: 19 negatiivsete arvude, 4 NULL-ajatemplite
ja 4 nullkuupäevade loendurit. Seal pole kliendi-, tegevuse-, e-posti- ega
kasutajakirjete sisu või ID-de loendit, paroole ega ühenduse identiteeti.
Kõik 27 loendurit peavad olema **0**. Ühendusel peab olema
`STRICT_TRANS_TABLES` või `STRICT_ALL_TABLES`.

Mitte-null tulemust ei käsitleta automaatselt vigase andmena: tegu võib olla
pärandsüsteemi tähendusliku väärtusega. Seda ei asendata nulli, tänase kuupäeva
või mõne muu oletusega. Sellisel juhul on vaja eraldi ülevaadatud andmemudeli või
andmete säilitamise otsust; käesolev migratsioon peatub enne esimest ALTER-it.

Need loendurid kontrollitakse ka uue CLI eelkontrollis, pärast rakenduse peatamist
ning migratsiooni sees uuesti. Päringud võivad lugeda suuri tabeleid; käivita need
sobival ajal. Vanast tulemusfailist ei piisa paigaldamise hetkel. Kõik kirjutajad
peavad hoolduspausi ajaks olema peatatud.

## Muudatuste ohutus

**INT/BIGINT ja signed/unsigned.** `INT UNSIGNED → BIGINT UNSIGNED` on täieliku
lähtevahemiku laiendus. `INT → BIGINT UNSIGNED`, `BIGINT → BIGINT UNSIGNED` ning
`followup_count INT → INT UNSIGNED` on lubatud ainult siis, kui negatiivseid
väärtusi pole. Nende lähtevahemike mitte-negatiivne osa mahub sihttüüpi täielikult;
MAX-väärtuste oletamist ega JavaScripti Number-teisendust ei kasutata.

**VARCHAR.** Pikkusi ainult suurendatakse. `smtp_response VARCHAR(1000) → TEXT`
ja `original_value VARCHAR(255) → TEXT` mahutavad kogu senise utf8mb4 sisu.
Veeru olemasolev märgistik ja kollatsioon säilivad 004 muudatustes.

**TEXT.** Senised LONGTEXT/MEDIUMTEXT väärtused ei kitsene TEXT-iks.
Testis säilivad ka üle 64 KiB tekstid ja nende JSON-kujulised koopiad.

**NULL.** Nelja veeru piirang lõdveneb. Nelja `created_at` veeru piirang muutub
NOT NULL-iks ainult kontrollitud NULL- ja nullkuupäevade puudumisel.
Puuduvat sündmuse aega ei fabritseerita.

**Vaikeväärtused.** `client_type` uus default on NULL, `crm_email_outbox.status`
vaikimisi väärtus eemaldatakse ja `crm_v8_stop_reasons.sort_order` uus default on 0.
NULL-i lubama hakkavate veergude default muutub samuti NULL-iks. See muudab ainult
**tulevasi** sisestusi, milles vastav väli jäetakse andmata. Olemasolev kliendiliik,
saatmisolek, sorteerimisväärtus või muu väli jääb täpselt alles. Tootmise peidetud
4- ja 7-märgilist default-stringi ei oletata ega avaldata; nende algne sisu säilib
privaatse SQL-varukoopia ja skeemisnapshot'i kaudu. Sünteetilistes testides
kasutatud `SYN1` ja `fixture` on ainult sama pikkusega testiväärtused.

**AUTO_INCREMENT ja kommentaarid.** Seniseid ID-sid ega null-ID-d ei genereerita
ümber. AUTO_INCREMENT loendurit ei lasta väiksemaks. 004 säilitab veerukommentaarid
ja kollatsioonid. DDL-ühendus säilitab range SQL-režiimi ning lisab ajutiselt
`NO_BACKSLASH_ESCAPES` ja `NO_AUTO_VALUE_ON_ZERO`, et säilitada kommentaaride
literalid ja null-ID-d. Ühenduse algne režiim taastatakse enne ühenduse vabastamist;
globaalset SQL-režiimi ei muudeta. SQL-i privaatsed metaandmed on veaväljundis peidetud.

## Kõik 52 veeruerinevust

`NULL YES/NO` tähistab veeru nullitavust; `puudub` tähendab default-klausli puudumist.
Sihtveeru kirjeldus on skeemilepingust. Suurema TEXT-i korral on tegelik tulemus
teadlikult senine suurem tüüp, mitte tabelis näidatud miinimumtüüp.

| Veerg | Tegelik diagnostika | Lepingu siht | Otsus |
| --- | --- | --- | --- |
| crm_clients.client_type | varchar(20); NULL NO; default peidetud string (4 märki) | varchar(100); NULL YES; default NULL | 004; uus default ainult tulevastele sisestustele; NULL-piirangu lõdvendus |
| crm_clients.followup_count | int; NULL NO; default 0 | int unsigned; NULL NO; default 0 | 004; negatiivsete arv peab olema 0 |
| crm_templates.subject | varchar(255); NULL YES; default NULL | varchar(500); NULL YES; default NULL | 002: laiendus; olemasolevad väärtused säilivad |
| crm_templates.external_key | varchar(120); NULL YES; default NULL | varchar(255); NULL YES; default NULL | 004; mahutavuse laiendus |
| crm_templates.next_step_json | longtext; NULL YES; default NULL | text; NULL YES; default NULL | Jäta suurem TEXT muutmata; leping juba lubab |
| users.name | varchar(100); NULL NO; default puudub | varchar(150); NULL NO; default puudub | 002: laiendus; olemasolevad väärtused säilivad |
| crm_email_inbox.id | int unsigned; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_email_inbox.mailbox_user_id | int; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_email_inbox.outbox_id | int; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_email_inbox.client_id | int; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_email_inbox.activity_id | int; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_email_inbox.sender | varchar(254); NULL NO; default puudub | varchar(255); NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_email_inbox.recipient | varchar(254); NULL NO; default puudub | varchar(255); NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_email_inbox.body | mediumtext; NULL YES; default NULL | text; NULL YES; default NULL | Jäta suurem TEXT muutmata; leping juba lubab |
| crm_activity_details.activity_id | int unsigned; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_activity_details.template_id | int unsigned; NULL YES; default NULL | bigint unsigned; NULL YES; default NULL | 004; mahutavuse laiendus |
| crm_activity_details.instructions | longtext; NULL YES; default NULL | text; NULL YES; default NULL | Jäta suurem TEXT muutmata; leping juba lubab |
| crm_activity_details.next_step_json | longtext; NULL YES; default NULL | text; NULL YES; default NULL | Jäta suurem TEXT muutmata; leping juba lubab |
| crm_v8_activity_events.id | int unsigned; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_v8_activity_events.activity_id | int unsigned; NULL NO; default puudub | bigint unsigned; NULL YES; default NULL | 004; uus default ainult tulevastele sisestustele; NULL-piirangu lõdvendus |
| crm_v8_activity_events.user_id | int unsigned; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_v8_activity_events.details | longtext; NULL YES; default NULL | text; NULL YES; default NULL | Jäta suurem TEXT muutmata; leping juba lubab |
| crm_v8_activity_events.created_at | timestamp; NULL YES; default CURRENT_TIMESTAMP | timestamp; NULL NO; default CURRENT_TIMESTAMP | 004; NULL- ja nullkuupäevade arv peab olema 0 |
| crm_portfolio_transfer_items.id | int unsigned; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_portfolio_transfer_items.transfer_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_portfolio_transfer_items.client_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_budget_change_log.client_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_budget_change_log.user_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_budget_change_log.created_at | timestamp; NULL YES; default CURRENT_TIMESTAMP | timestamp; NULL NO; default CURRENT_TIMESTAMP | 004; NULL- ja nullkuupäevade arv peab olema 0 |
| crm_ionprint_sync_queue.id | int unsigned; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_ionprint_sync_queue.transfer_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_ionprint_sync_queue.client_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_ionprint_sync_queue.target_owner_user_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_ionprint_sync_queue.status | varchar(40); NULL NO; default puudub | varchar(50); NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_ionprint_sync_queue.created_at | timestamp; NULL YES; default CURRENT_TIMESTAMP | timestamp; NULL NO; default CURRENT_TIMESTAMP | 004; NULL- ja nullkuupäevade arv peab olema 0 |
| crm_email_outbox.activity_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_email_outbox.client_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_email_outbox.contact_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_email_outbox.user_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_email_outbox.body | longtext; NULL NO; default puudub | text; NULL NO; default puudub | Jäta suurem TEXT muutmata; leping juba lubab |
| crm_email_outbox.status | varchar(24); NULL NO; default peidetud string (7 märki) | varchar(30); NULL NO; default puudub | 004; uus default ainult tulevastele sisestustele |
| crm_email_outbox.smtp_response | varchar(1000); NULL YES; default NULL | text; NULL YES; default NULL | 004; mahutavuse laiendus |
| crm_portfolio_transfers.id | int unsigned; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_portfolio_transfers.from_user_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_portfolio_transfers.to_user_id | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_portfolio_transfers.performed_by | bigint; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; negatiivsete arv peab olema 0 |
| crm_portfolio_transfers.created_at | timestamp; NULL YES; default CURRENT_TIMESTAMP | timestamp; NULL NO; default CURRENT_TIMESTAMP | 004; NULL- ja nullkuupäevade arv peab olema 0 |
| crm_v8_stop_reasons.id | int unsigned; NULL NO; default puudub | bigint unsigned; NULL NO; default puudub | 004; mahutavuse laiendus |
| crm_v8_stop_reasons.sort_order | int; NULL NO; default 1000 | int; NULL NO; default 0 | 004; uus default ainult tulevastele sisestustele |
| crm_imported_history.activity_type | varchar(50); NULL NO; default puudub | varchar(100); NULL YES; default NULL | 004; uus default ainult tulevastele sisestustele; NULL-piirangu lõdvendus |
| crm_imported_history.original_value | varchar(255); NULL YES; default NULL | text; NULL YES; default NULL | 004; mahutavuse laiendus |
| crm_imported_history.source_column | varchar(5); NULL NO; default puudub | varchar(255); NULL YES; default NULL | 004; uus default ainult tulevastele sisestustele; NULL-piirangu lõdvendus |

## Sisulise säilimise kontroll ja paigaldustee

Paigaldaja teeb endiselt täieliku koodi-, SQL- ja konfiguratsioonivarukoopia enne
migratsioone ning säilitab ühesuunaliste migratsioonide taastetee.

Lisatud sisuaudit arvutab andmebaasis iga olemasoleva veeru binaarse sisu SHA-256
ja seejärel PK-järjestuses kirjete koondkontrollsumma. Võrreldakse ka NULL-i,
pikkusi ja kirjete arvu; arvulisi väärtusi ei tooda JavaScripti Number-kujule.
Ajatemplid kontrollitakse hetkväärtusena, sõltumatult ühenduse kuvamisajavööndist.
Kliendi- ja e-posti sisu ei saadeta auditi käigus kliendiprotsessi.

Enne kogu migratsioonirida tehtud audit kontrollib pärast migratsioone kõiki
varasemaid autentimise/CRM-i kirjeid, sealhulgas enne 001/002 tehtud laiendusi.
Ainult 002 vaikimisi lõpetamispõhjuste **uued** ID-d võivad lisanduda; kõik senised
põhjusekirjed kontrollitakse samamoodi. Uute veergude lisamine ei tähenda seniste
andmete kadumist: võrreldakse kõiki enne olemas olnud veerge. 004 teeb lisaks oma
vahetu enne/pärast sisukontrolli ning ei lisa, kustuta ega uuenda ärikirjeid.

Muutunud sisu, tundmatu skeem, vale lähtepikkus, mitte-tühi ohuloendur või DDL-i
hoiatus peatab töö. `preflight` ei muuda skeemi: see lubab ainult konkreetselt
teadaoleva ja värskete andmekontrollidega tõendatud **ootel ülemineku**.
Pärast migratsioone peab lõppkontroll läbima tegelike veerukirjeldustega; tõendit
või projektsiooni ei kasutata lõppkontrolli leevendamiseks.

Kasuta uue kontrollitud checkout'iga [paigaldusjuhendi](zone-deployment.md) tavapärast
`preflight --diagnostics` käsku. Positiivne väljund sisaldab
`transition.changes` (44 muudatust) ja `transition.checks` (27 loendurit).
Skeemi muutmise järjekord on 001 → 002 → 003 → 004.

Paigalda ainult `ops/deploy.js apply` kaudu pärast koodi ülevaatamist ja edukaid
värskeid kontrolle; ära käivita 004 tootmises varundusest ja eelkontrollist mööda.
Kui on juba tehtud osa DDL-ist, ei käivitata vana rakendust automaatselt.
Sisuauditi vea järel ära korda paigaldust uue lähteandmestikuna: uuri originaalset
privaatset `manifest.json` faili ja taasta vajadusel kontrollitud SQL-varukoopia
**eraldi tühja andmebaasi**. Puuduvad ajad või negatiivsed väärtused vajavad eraldi
otsust, mitte automaatset backfill'i. Kahe hoolduskatse vahel tehtud kirjutused
vajavad eraldi ülevaatust.

## Testitulemused

MariaDB **11.4.13**, Node.js 24.22.1; ainult isoleeritud kohalikud andmebaasid ning
sünteetilised `example.invalid` kontod ja sõnumid. Kogu komplekt: **34 läbitud,
0 ebaõnnestunud, 0 vahele jäetud**.

Lisatud seitse testi kontrollivad:

1. Kõigi 52 metaandmekirjelduse täpset vastavust profiilile ning päris CLI väljundit `preflight ok: true` ilma DDL-ita.
2. Negatiivse väärtuse keeldumist enne DDL-i; väärtust ei nullita.
3. NULL-ajatempliga ajaloo keeldumist; aega ei mõelda välja.
4. Nullkuupäeva keeldumist ilma asendamiseta.
5. Tundmatu 119-märgise lähteveeru blokeerimist kinnitatud 120 asemel.
6. Kõigi nelja migratsiooni järel olemasolevate kirjete täpset säilimist, sh UINT32 ülempiiri ID, BIGINT signed ülempiiri väärtus, null-ID, pikad tekstid/JSON, kollatsioon, kommentaari apostroof/backslash/Unicode/reavahetus ja AUTO_INCREMENT loendur.
7. Default-muutuse mõju ainult uuele sisestusele ning auditi võimet tabada tahtlikku sünteetilise kirje sisumuutust.

Senised 27 regressioonitesti läbivad samuti, sh varunduse, SQL-taastamise,
käivitusvigade ja töörežiimide õiguste testid. `git diff --check` ja süntaksikontrollid
on korras. Tootmisse pole midagi paigaldatud ega e-kirju saadetud.

Testikäsk (kõik failid `work/` all on ainult kohaliku testikeskkonna omad):

```bash
DB_NAME=ellington_test DB_PORT=3307 \
DEPLOY_TEST_ENV=work/deployment/config.env \
DEPLOY_DUMP_COMMAND=work/deployment/dump-wrapper.cjs \
DEPLOY_CLIENT_COMMAND=work/deployment/client-wrapper.cjs npm test
```
