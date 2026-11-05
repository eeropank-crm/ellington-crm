# Tootmispaigalduse ettevalmistuse aruanne

Kuupäev: 05.11.2026. Alus: GitHubi main commit `2ded0b4`, milles PR #1 ja PR #2
on ühendatud. Arendusharu: `feat/safe-production-deployment`.

## Main-haru kontroll

Värskendasin main-haru GitHubist ja kontrollisin selle 43 jälgitavat faili.
Olemas on rakenduse käivitusfailid, andmebaasi- ja sessioonikiht, sisselogimine,
kontohaldus, töörežiimide õigused, CRM-i põhiruuter ning v8-, eelarve-, SMTP- ja
IMAP-laiendused, tegevuste töövooteenus, avalik sisselogimisleht, kaitstud lehed,
mõlemad versioonitud migratsioonid ja autentimise SQL-skeemid, package.json ja
lukufail ning konfiguratsiooni näidis. Päris `.env` ja `node_modules` ei peagi
Gitis olema: esimene peab säilima serveris, teise loob `npm ci`.

Uue paigaldustee failikontroll nõuab 28 kriitilist rakenduse/paigalduse faili,
muutmata checkout'i ja täieliku SHA-ga fikseeritud commit'i. Uus kood pakitakse
`git archive` abil, mitte jooksva rakenduse kataloogi üle kirjutades.

## Lisatud lahendus

- `ops/deploy.js`: ainult lugemisega `preflight`, varundav `apply`, kontrollitud
  `rollback` ja ainult tühja eraldi andmebaasi lubatud `restore-empty`.
- `ops/schema.js` ja `ops/schema-contract.json`: 18 CRM-i/autentimise tabeli
  kontrollitud võrdlusalus, kokku 149 veerukirjeldust ja 42 indeksikomponenti.
- `ops/database.js`: privaatne konfiguratsioonilugemine ja standardsete
  andmebaasi dump-/taastamisklientide kasutamine ilma paroolita käsureal.
- `ops/pm2-control.js`: olemasoleva nimega PM2 protsessi ja täpse kooditee kontroll,
  peatamine, uue tee käivitamine ning käivitusoleku salvestamine. Teiste protsesside
  käivitus-/peatamiskäske ei anta.
- `ops/test-control.js`: ainult kohalike `ellington_test*` andmebaaside jaoks
  lubatud isoleeritud testiadapter.
- `test/deployment.test.js`: skeemi kaitse ning paigalduse/taastamise läbimängud.
- [Eestikeelne paigaldusjuhend täpsete käskudega](zone-deployment.md).

Tervisekontroll tagastab nüüd ka protsessile edastatud väljalaske SHA, et
paigaldus ei loeks kogemata vana töötava protsessi vastust uue versiooni tõendiks.

## Andmete ja taastamise kaitse

Eelkontroll ei impordi rakendust ega käivita posti- või sessioonitöid ning teeb
ainult SELECT-päringuid. Knexi migratsioonide haldustabeleid see ei loo.
Kontroll arvestab teadaolevate ootel migratsioonide mõjuga: näiteks lubab vana
100-märgise kasutajanime laiendada 150-ni, kuid peatab migratsiooni, kui olemasolev
300-märgine veerg kitseneks. Juba olemasolevat poolikut v8 tabelit ei peeta korras
olevaks, sest migratsioon jätaks selle loomissammu vahele.

Enne migratsioone on rakendus peatatud, tehtud koodi- ja andmebaasivarukoopia ning
konfiguratsiooni snapshot, kontrollitud failide kontrollsummad ja SQL-dump'i
lõpetatus. Varukoopiafailid ja taastamisžurnaal kirjutatakse enne jätkamist kettale.
Failid on privaatsetes kataloogides; ajutine kliendikonfiguratsioon eemaldatakse.
Klienditööriistad ei loe kasutaja muid MySQLi seadistusfaile. MySQLi dump keelab
globaalsed GTID taastamiskäsud. `.env` sisu, päris kliendiandmeid ega ajalugu
paigaldusskript üle ei kirjuta. Uus väljalase saab viite senisele `.env` failile
ja senistele olemasolevatele üleslaadimiskaustadele.

Kui migratsiooni pole alustatud, lubatakse muutumata skeemi ja konfiguratsiooni
korral koodi taastamine. Kui migratsiooni on alustatud, peetakse ka veaga lõppenud
DDL-i võimalikuks püsivaks muudatuseks: vana koodi ei käivitata automaatselt.
SQL tuleb esmalt taastada uude tühja andmebaasi. Seejärel kontrollitakse taastatud
skeemi ja kirjete arve ning vana kood käivitatakse eraldi taastamisväljalaskest,
mis viitab uuele konfiguratsioonifailile. Algne andmebaas ja `.env` säilivad.

## Tegelikud testitulemused

Keskkond: kohalik MariaDB **11.4.13**, Node.js **24.22.1**, npm **11.9.0**.
Paigalduse test kasutab eraldi konteinerit, hosti loopback-porti 3308 ja eraldi
`ellington_test_deploy` ning `ellington_test_restore` andmebaase. CRM-i senised
testid kasutavad eraldi loopback-porti 3307. Kõik kontod ja kirjed on sünteetilised.

Kogu komplekt käivitati käsuga:

```bash
DB_NAME=ellington_test DB_PORT=3307 \
DEPLOY_TEST_ENV=work/deployment/config.env \
DEPLOY_DUMP_COMMAND=work/deployment/dump-wrapper.cjs \
DEPLOY_CLIENT_COMMAND=work/deployment/client-wrapper.cjs npm test
```

`work/deployment` sisaldas ainult selle läbimängu ajutisi konfiguratsioone ja
adaptereid. Kliendiadapterid käivitasid konteineris päris MariaDB dump- ja
importimistööriista, suunates loopback-pordi konteineri sisemisele pordile. Need
ajutised paroolifailid ja SQL-varukoopiad ei kuulu GitHubi muudatusse.

Tulemus: **22 testi läbitud, 0 ebaõnnestunud, 0 vahele jäetud**:

| Kontroll | Tulemus |
| --- | --- |
| Senised 14 CRM-i ning töörežiimide regressioonitesti | Läbitud |
| Skeemikaitse: puuduv veerg/indeks, vale märgistus/tüüp, MyISAM, CHECK/välisvõti/päästik/rutiin/sündmus, tundmatu migratsioon või lukk | Läbitud |
| Ainult lugemisega eelkontroll: skeem, kirjed ja `.env` säilivad | Läbitud |
| Liiga lai olemasolev veerg ja poolik v8 tabel peatavad töö | Läbitud |
| Ebaõnnestunud SQL-varukoopia ei käivita migratsioone ja vana rakendus taastub | Läbitud |
| Täielik paigaldus vanale baasskeemile: päris dump, migratsioonid, koodivahetus ja tervisekontroll | Läbitud |
| Sünteetilised kliendi-, konto- ja ajaloomarkerid, `.env` ning jagatud runtime-fail säilivad | Läbitud |
| Ühesuunaliste migratsioonide järel kooditaaste keeld ning rikutud dump'i tagasilükkamine | Läbitud |
| Taastamine uude tühja andmebaasi ja vana koodi käivitamine uue konfiguratsiooniga | Läbitud |
| Mitte-tühja taastamissihti ei kirjutata üle | Läbitud |
| Käivitusviga ilma migratsioonita: automaatne kooditaaste ja käsitsi kontrollitud rollback | Läbitud |
| Käivitusviga migratsiooni alustamise järel: rakendus peatatud, vana koodi käivitus keelatud | Läbitud |

Lisaks tegin eraldi **päris PM2 6.0.14** läbimängu oma `PM2_HOME` kataloogis:
protsessi status/stop/start, vale kooditee keeldumine, uue väljalaske
tervisekontroll ja salvestatud taaskäivitusolek läbisid kontrolli. Testiprotsess ja
selle PM2 deemon lõpetati pärast kontrolli.

`git diff --check` ja uute JavaScripti failide süntaksikontrollid: korras.

## Mida pole tootmisele ligipääsuta kinnitatud

Zone.ee serveri ega pärisandmebaasiga ei ühendutud. Seetõttu pole tegelikku
andmebaasiskeemi, varundusõigusi, kettaruumi, TLS/võrguühendust ega Zone'i praegust
protsessijuhtimise seadistust kinnitatud. Need kontrollib haldaja juhendi järgi;
tootmise skeemierisuste korral paigaldus peatub, mitte ei püüa neid oletuste järgi
parandada. PM2 adapterit saab kasutada siis, kui senine rakendus on tõesti ühe
nimega PM2 protsess; muu protsessihaldur vajab enne kasutamist kontrollitud adapterit.

Päris MySQL serveriga integratsioonitesti ei tehtud; MySQLi JSON-veergu kontrolliti
skeemitestis. Testitud andmebaasiversioon on ülal nimetatud MariaDB.
Väliste cron-tööde ja teiste teenuste kirjutamise peatamise kinnitab operaator.
`/health` ja anonüümsed õigustestid ei asenda haldaja HTTPS lõppkontrolli.
Väliste sümbollinkide sihtfailide eraldi varundamine ning tootmisejärgsete kirjete
vajadusel üleviimine jääb haldaja taastamisprotsessi osaks.

Selles töös e-kirju ei saadetud ja sünteetilisi andmeid tootmisse ei lisatud.
Muudatused on ainult arendusharus; main-harusse automaatset ühendamist ei tehta.
