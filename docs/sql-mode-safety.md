# PR #5 SQL-režiimi tootmiseelne kontroll

05.11.2026. Kasutaja teatatud tootmistulemus: MariaDB 11.4.13, kõik 27
ohuloendurit 0, algrežiim `IGNORE_SPACE,NO_AUTO_CREATE_USER`. Tootmisega selles
töös ei ühendutud; järgnevad kontrollid tehti ainult kohalikus sünteetilises
MariaDB-s.

## Probleem

PR #4 `ops/database.js` lõi ühendused serveri vaikerežiimiga. PR #5 eelkontroll ja
004 nõudsid juba olemasolevat ranget režiimi, kuid ei lisanud seda. 004 ajutine
DDL-skoop lisas ainult `NO_BACKSLASH_ESCAPES` ja `NO_AUTO_VALUE_ON_ZERO`.
Seega jäid antud mitte-range algrežiimiga ühendused peatuma vaatamata andmekontrollide
nulltulemusele. Ainult 004 muutmisest poleks piisanud, sest 001–003 peavad samuti
käima paigaldaja rangetel ühendustel.

## Parandus

- `ops/sql-mode.js` lisab `STRICT_TRANS_TABLES` ainult siis, kui kumbagi ranget
  lippu pole. Olemasolev `STRICT_ALL_TABLES` säilib; olemasolevaid lippe ei eemaldata.
- Paigaldaja `ops/database.connect()` seab režiimi iga füüsilise pool-ühenduse
  `afterCreate` etapis ja kontrollib serverilt tegelikku tulemust enne ühenduse
  päringutele kättesaadavaks tegemist. See katab eelkontrolli ning kogu 001–004
  migratsioonirea, ka uued/teised füüsilised ühendused.
- Algne režiim salvestatakse ühenduse kohta ja taastatakse kontrollitult enne
  füüsilise ühenduse sulgemist. Lahendus kasutab Knex 3.3/Tarni ühenduse
  hävitamise teed; sama lukufaili versiooniga kontrolliti seda päris ühendustel.
- 004 kasutab sama helperi eraldi skoopi täpselt sellel ühendusel, mille kaudu
  DDL läheks. Kommentaari- ja null-ID lipud säilivad; skoop taastab tööühenduse
  eelneva režiimi ka vea korral. Paigaldaja ühendus jääb seejärel rangeks kuni
  käsu lõpuni, mil taastatakse algne serverilt pärit režiim.
- Kui ranget režiimi ei saa kinnitada, ühendus lükatakse tagasi. Kui taastamine
  nurjub, ühendus hävitatakse ja seda ei anta järgmisele tööle edasi.
- Kõik SQL-režiimi muutmiskäsud on `SET SESSION sql_mode`; `SET GLOBAL` ei kasutata.
  Tavalise CRM-i `server/db.js` ühendusloogikat ei muudetud.
- `001_base.js`, `002_v8.js`, skeemileping, andmekontrollid, varundus ja taastetee
  jäid muutmata. Muudatus ei anna luba andmete teisendamiseks ilma seniste kaitseteta.

`preflight --diagnostics` väljundi `transition.sqlMode` näitab nüüd:

```json
{
  "original": "IGNORE_SPACE,NO_AUTO_CREATE_USER",
  "effective": "IGNORE_SPACE,STRICT_TRANS_TABLES,NO_AUTO_CREATE_USER",
  "scope": "SESSION",
  "globalChanged": false
}
```

Lippude järjestuse määrab server; oluline on nende säilimine. Diagnostika ei
väljasta paroole, ühenduse identiteeti ega ärikirjete sisu. `preflight` teeb
metaandmete/loendurite lugemise kõrval ainult ühenduse ajutisi SQL-režiimi
muudatusi ja taastamise; skeemi, ärikirjeid ja globaalset režiimi ei muudeta.

## Käivitatud testid

```bash
DEPLOY_TEST_ENV=work/deployment/config.env \
node --test --test-concurrency=1 \
  test/sql-mode.test.js test/schema-compatibility.test.js
```

Tulemus: **9 läbitud, 0 ebaõnnestunud, 0 vahele jäetud**.

Viis SQL-režiimi regressioonitesti kontrollivad:

1. Vajaliku range lipu lisamist ja olemasoleva `STRICT_ALL_TABLES` säilimist.
2. Kontrollimata mitte-range ühenduse tagasilükkamist ja hävitamist.
3. Kahe füüsilise ühenduse seadistamist, lippude säilimist ja algrežiimi taastamist enne sulgemist; globaalrežiim ei muutu.
4. 004-ga sama ühendusskoobi käitumist edu ja sünteetilise vea korral; tööks on SELECT, DDL-i ei tehta.
5. Päris CLI `preflight --diagnostics` edukust mitte-range algrežiimiga füüsilistel ühendustel ning skeemi ja olemasolevate kirjete kontrollsummade säilimist.

Neljas eraldi skeemivõrdluse testis jäävad esituslikud erinevused lubatuks ning
ohtlikud muutused blokeerituks. Mitte-range algrežiimi jäljendab ainult
loopback-testandmebaasi lubav testipreload `test/fixtures/non-strict-mysql.js`;
ka see teeb ainult `SET SESSION`, mitte globaalmuudatusi.

Selles töös **ei käivitatud migratsioone**: varasem 34 testi sisaldav DDL-komplekt
jäi käivitamata. Käivitati sihitud režiimi-, muutmatuse- ja skeemivõrdluse testid.
Zone.ee-sse midagi ei paigaldatud, andmeid ei muudetud ja e-kirju ei saadetud.

## Järgmine samm

Kasutaja teatatud 27 nulltulemuse ja parandatud ühenduspoliitika põhjal on järgmise
sammuna valmis **uuendatud PR #5 koodi** `preflight --diagnostics` käivitamine.
Oodatav tulemus on `ok: true`, kui skeem ja andmed vastavad endiselt senisele
profiilile. Tootmise tegelikku uut väljundit pole veel kinnitatud.

Kasuta uut kontrollitud checkout'i, selle täielikku SHA-d ja senist privaatset
`.env` faili. Kontrolli nii `ok`, 27 värsket loendurit kui ka ülaltoodud režiimiinfot.
Selleks pole vaja serveri globaalset režiimi muuta, migratsioone käivitada ega
rakendust uuesti paigaldada. PR #4 ja #5 automaatset ühendamist ei tehta.
