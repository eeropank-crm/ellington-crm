# MariaDB skeemi erinevuste turvaline uurimine ja parandamine

Alus: `14ff62782fa85c0ebc91946a2d2a01189060ac4e`, MariaDB 11.4.13.
Tootmisega pole ühendutud. Teada on tabelite/veerunimede ja kolme indeksi
vastuolud, kuid tegelikke veerukirjeldusi pole antud. Seetõttu ei saa väita, et
kõik loetletud tootmisveerud on valed või et kõik erinevused on esituslikud.

## Mida parandati

Senine võrdlus käsitles JavaScripti `null` ja MariaDB metaandmete SQL `NULL`
esitust erinevalt. Samas muutis see kõik vaikeväärtused ning kogu tüübistringi
väiketähtedeks: nii võis tegelik stringi- või ENUM-liikme erinevus märkamata jääda.
Uus võrdlus säilitab literalide tõstutundlikkuse ja arvestab veeru tüüpi.

| Erinevus | Uus käitumine |
| --- | --- |
| `int(11)` / `INTEGER` / `int` | Samaväärne kuvamislaius ja tüübinime alias |
| `boolean` / `tinyint(1)` | Samaväärne tüübinime esitus |
| `int` / `int unsigned`, ZEROFILL, eri täpsus või kitsam VARCHAR | Ei võrdsustata; ohtlik erinevus peatab töö |
| Nullable-veeru metaandmete `null` / jutumärkideta `NULL` | Samaväärne SQL NULL |
| SQL NULL / string `'NULL'` / string `'null'` | Erinevad; ei võrdsustata |
| Arvulise veeru `0`, `'0'`, `0.00` | Samaväärne arvuline vaikeväärtus, kui veerutüüp ise sobib |
| `CURRENT_TIMESTAMP`, `current_timestamp()`, `CURRENT_TIMESTAMP(0)` | Samaväärne ajalise veeru nulltäpsusega vaikeväärtus |
| `CURRENT_TIMESTAMP(6)` / nulltäpsus, `'ACTIVE'` / `'active'`, erinevad ENUM-liikmed | Erinevused säilivad ja jäävad kontrollitavaks |

`001_base.js`, `002_v8.js` ja olemasolev skeemileping jäid muutmata. Pole lisatud
veerutüüpide, NULL-piirangute ega äriliste vaikeväärtuste automaatset muutmist.

## 1. Kogu kõigepealt ainult lugemisega diagnostika

Kasuta selle PR-i kontrollitud checkout'i eraldi lähtekoodikaustas. Ära kirjuta
jooksva rakenduse faile üle ega käivita selleks migratsioone. Vajalikud teede ja
ühenduse muutujad on kirjeldatud [paigaldusjuhendis](zone-deployment.md).
Paigaldusallikas peab olema commit'itud ja `REVISION` selle täielik SHA.

```bash
umask 077
REVISION="$(git rev-parse HEAD)"
if node ops/deploy.js preflight \
  --env "$ENV_FILE" --host "$DB_HOST" --database "$DB_NAME" \
  --revision "$REVISION" --diagnostics > "$ROOT/schema-diagnostics.json"
then
  printf 'Eelkontroll läbitud; raport on salvestatud.\n'
else
  printf 'Paigaldus jääb peatatud olekusse; vaata raportit ja veateadet.\n'
fi
```

See käsk ei käivita rakendust, postitöötajaid, migratsioone, seemneandmeid ega
varundus-/taastamistoiminguid. Päringud loevad skeemimetaandmeid ja olemasolevat
Knexi migratsiooniajalugu; uusi haldustabeleid ei looda.

Raporti `diagnostics.columns` näitab iga erineva veeru kohta tabeli ja veeru nime,
erinevaid omadusi, eeldatud/tegelikku ohutut tüübi-, NULL-, märgistiku- ja
default-kirjeldust ning liigitust:

- `representation_only`: võrreldavad omadused on pärast kitsalt lubatud normaliseerimist samad.
- `requires_review`: erinevus vajab ülevaatust; vaata alati ka `ok` ja `errors` välju.
  Näiteks juba olemasolev laiem VARCHAR võib olla lubatud, kuid signedness'i
  erinevus ei ole automaatselt lubatud.
- `missing`: veerg/tabel puudub; otsuse määrab ootel migratsioonide kontroll.

`missingIndexes` näitab veerujärjestust, unikaalsust ning lubatud ootel paranduse
korral `plannedMigration` väärtust. Kui migratsioon on juba rakendatud, veerg
puudub või indeksi nimi põrkub, ei lubata puuduvat indeksit vaikimisi parandatuks lugeda.

Raport ei ekspordi kliendi- ega kasutajakirjeid, paroole, ühenduse hosti või
andmebaasinime, stringide vaikeväärtusi, ENUM/SET liikmeid ega tundmatuid avaldisi.
Stringide kohta näidatakse ainult liiki ja pikkust. Ära jaga `.env` faili,
`env.snapshot`, täielikku SQL-dump'i ega paigalduse sisemist `manifest.json` faili.

### Täpsed SQL-päringud, kui uut CLI-d ei saa serveris käivitada

Vali andmebaasikonsoolis õige andmebaas ja käivita **kogu** fail
[`ops/schema-diagnostics.sql`](../ops/schema-diagnostics.sql).

Fail sisaldab ainult SELECT-päringuid `information_schema` ja `VERSION()` vastu.
See ei sisalda DDL-i, DML-i, tehingute avamist/lõpetamist, ajutisi tabeleid ega
protseduure. `DATABASE()` valib konsoolis juba valitud skeemi ilma selle nime
väljundisse lisamata. Tabelite loend on fikseeritud CRM-i tabelitele.

Tagasta kõik kuus tulemust: serveri/märgistiku info, tabelid, veerud, indeksid,
piirangute liigid ja migratsioonide haldustabelite olemasolu. Veergude puhul on
stringide vaikeväärtused ning ENUM/SET liikmed peidetud; arvulised default'id,
NULL-i esitus, pikkused, täpsused ja märgistused jäävad nähtavaks. SQL annab
metaandmed; automaatne liigitus ja võrdlus toimub uue CLI-ga.

**Tootmise loetletud vastuolude lõplikuks otsustamiseks on vaja selle diagnostika
väljundit.** Ära kopeeri kogu `.env` ega `SHOW CREATE TABLE` väljundeid ilma
literalide ülevaatamiseta: need võivad sisaldada privaatseid vaikeväärtusi.

## 2. Kolme indeksi parandustee

Uus `003_v8_lookup_indexes.js` lisab vajadusel ainult järgmised **mitteunikaalsed**
indeksid:

| Tabel | Veerud, selles järjekorras |
| --- | --- |
| crm_v8_activity_events | activity_id, event_type |
| crm_budget_change_log | client_id, created_at |
| crm_ionprint_sync_queue | transfer_id |

Migratsioon kontrollib enne olemasolevaid indekseid nende veerujärjestuse järgi.
Sama vasakpoolse prefiksiga täielik indeks väldib dubleerimist; indeksi nimi võib
erineda. Veeruprefiksi indeks ei asenda täielikku veeruindeksit. Nimepõrge või
puuduv veerg peatab paranduse. Migratsioon on uuesti käivitatav ja ei loo PRIMARY
või UNIQUE piiranguid ega kirjuta ümber tabelikirjeid.

Ainult nende kolme indeksi puudumine võib olla eelkontrollis lubatud **ootel
parandusena**, kui `003` on ootel ja kõik vajalikud veerud olemas ning ülejäänud
kontrollid läbivad. Lõppkontroll nõuab indekseid endiselt füüsiliselt olemas.
Muude, sh unikaalsete indeksite puudumine blokeerib paigalduse edasi.

## 3. Millal võib paigaldust jätkata

1. Vaata diagnostika üle. Signedness'i, päris vaikeväärtuse, ENUM-i, NULL-piirangu,
   väiksema mahutavuse või muu kinnitamata erinevuse korral **peatu**. Vajalik on
   konkreetsete metaandmete põhjal eraldi üle vaadatud paranduskava; selles PR-is
   neid veerge automaatselt ei teisendata.
2. Kontrolli kinnitatud skeemi sarnast sünteetilist koopiat isoleeritud keskkonnas.
   Ära too päris klientide andmeid Codexi testidesse.
3. Pärast koodi ülevaatamist kasuta varundavat `ops/deploy.js apply` protsessi
   [paigaldusjuhendi](zone-deployment.md) järgi alles siis, kui eelkontroll tagastab
   `ok: true`. Teadaolev järjekord on nüüd `001_base.js`, `002_v8.js`,
   `003_v8_lookup_indexes.js`. Seniseid migratsiooniajaloo ridu ei kustutata ega
   märgita käsitsi rakendatuks.
4. Ka mitteunikaalse indeksi loomine võib vajada tabelilukku ja kettaruumi:
   säilita hoolduspaus ning kontrollitud varukoopiad. Ühesuunalise DDL-i taastamise
   reeglid jäävad kehtima. Ära käivita `003.up` ega ALTER-käske tootmises eraldi
   eelkontrollist ja varundusest mööda minnes.

## Testitulemused

MariaDB 11.4.13 isoleeritud konteineris, ainult sünteetiliste andmetega:

- Tüüpide ja default'ide esituslikud erinevused läbivad, päris semantilised erinevused jäävad blokeerituks.
- Diagnostikasse lisatud sünteetilised salajased stringid ei ilmu väljundisse.
- Nii CLI `--diagnostics` kui SQL-fail loetakse läbi ilma skeemi, andmete või `.env` muutmiseta.
- Kolme puudunud indeksi migratsioon säilitab kliendi-, konto-, tegevus-, sündmuse-, eelarveajaloo- ja järjekorrakirjed.
- Korduskäivitus ei dubleeri indekseid ega ajalugu.
- Senised paigalduse, varundusvea, ühesuunalise taastamise ja töörežiimide regressioonid läbivad.

Kogu komplekt: **27 läbitud, 0 ebaõnnestunud, 0 vahele jäetud**.
Tootmiskeskkonda pole midagi paigaldatud ega tootmise skeemi muudetud.
