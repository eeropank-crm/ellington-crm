# Ellington CRM: turvaline paigaldamine Zone.ee serveris

See juhend on serveri haldajale. Käske pole tootmises käivitatud. Tegeliku Zone.ee
skeemi sobivus selgub alloleva **muudatusteta eelkontrolliga**. Vastuolu korral
skript peatub; kontrolli ei tohi välja lülitada ega migratsioone käsitsi läbi suruda.

## 1. Eeldused ja teed

Vaja on Linuxi shelli, Node.js 22+ (soovitatavalt LTS), npm-i, Giti, tari ning
serveri andmebaasiga sobivat `mariadb-dump`/`mariadb` või `mysqldump`/`mysql` paari.
Andmebaas peab kasutama utf8mb4 ja InnoDB-d. Rakenduse kasutajal peavad olema
migratsioonide ning **täieliku dump'i**, sh rutiinide, sündmuste ja päästikute
varundamise õigused. MariaDB puhul võib rutiinide dump vajada `SELECT` õigust
`mysql.proc` tabelile. Vajalikud õigused määrab DBA; varundusvea korral migratsioonid
ei alga. Ära anna tootmiskontole kontrollimatult üldiseid administraatoriõigusi.

Käivita käsud senise rakenduse omanikuna, mitte root-kasutajana. Paigaldus- ja
varukoopiakaust peavad asuma **väljaspool veebist avaldatavat kataloogi**. Kontrolli
vaba kettaruumi: vaja on koodi varukoopiat, kogu andmebaasi SQL-dump'i ja uut
väljalaset. Varukoopiad sisaldavad pärisandmeid ja saladusi; hoia neid 700/600
õigustega ning kopeeri pärast kontrolli krüpteeritud eraldi hoiukohta.

Allolev protsessijuhtimise adapter sobib **olemasolevale ühele PM2 protsessile**.
Kui Zone'i rakendust juhib muu teenus, ei tohi PM2-ga teist koopiat käivitada.
Haldaja peab sel juhul tegema sama lepingu täitva Node.js adapteri ja selle enne
kasutamist läbi proovima: `status <kaust>` väljub 0-ga, kui täpselt see rakendus
käib, 3-ga, kui see on peatatud, muul juhul mitte-nulliga; `stop <kaust>` peatab
rakenduse ja kõik selle kirjutajad ning kinnitab püsiva peatamise ka taaskäivituse
korral; `start <kaust>` käivitab just selle väljalaske selles töökataloogis, säilitab
skripti edastatud keskkonnamuutujad ja salvestab uue käivitustee. Vigu ei tohi
peita. Adapter ei tohi logida keskkonnamuutujate väärtusi.

Ava Bash ja täida järgmistes väärtustes senise rakenduse **tegelik** asukoht,
andmebaasi host ja nimi ning PM2 protsessi nimi:

```bash
set -euo pipefail
umask 077
SOURCE="$HOME/ellington-deploy-src"
ROOT="$HOME/ellington-deploy"
CURRENT_APP='/asenda/senise/rakenduse/absoluutse/teega'
ENV_FILE="$CURRENT_APP/.env"
DB_HOST='asenda_tegeliku_hostiga'
DB_NAME='asenda_tegeliku_andmebaasinimega'
export ELLINGTON_PM2_NAME='asenda_senise_pm2_protsessi_nimega'
node --version
npm --version
pm2 --version
mariadb-dump --version
mariadb --version
```

`.env` peab juba olemas olema ja sisaldama `DB_HOST`, `DB_PORT` (vaikimisi 3306),
`DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET` ning vajadusel `PORT` väärtust.
Skript ei laadi hoidla näidiskonfiguratsiooni ega kirjuta `.env` faili üle.

```bash
test -f "$ENV_FILE"
chmod 600 "$ENV_FILE"
install -d -m 700 "$ROOT" "$ROOT/releases" "$ROOT/backups"
test -L "$ROOT/current" || ln -s "$CURRENT_APP" "$ROOT/current"
```

Säilita vana rakenduse kataloog: selle `.env` ja olemasolevad `uploads` ning
`private/uploads` kataloogid jäävad jagatud runtime-andmete asukohaks. Uued
väljalasked viitavad neile sümbollinkidega. Skript ei kustuta vanu väljalaskeid
ja neid ei tohi eemaldada enne jagatud failide eraldi ümberkorraldamist.

## 2. Võta kontrollitud kood ja tee ainult lugemisega eelkontroll

Pärast selle paigalduslahenduse PR-i ühendamist main-harusse:

```bash
test -d "$SOURCE/.git" || git clone https://github.com/eeropank-crm/ellington-crm.git "$SOURCE"
cd "$SOURCE"
git fetch origin main
git checkout --detach origin/main
REVISION="$(git rev-parse HEAD)"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
CONTROL="$SOURCE/ops/pm2-control.js"
node ops/deploy.js preflight \
  --env "$ENV_FILE" --host "$DB_HOST" --database "$DB_NAME" \
  --revision "$REVISION"
```

Väljundis peab olema `"ok": true`. Kontroll loeb ainult skeemimetaandmeid ja
migratsioonide ajalugu, ei loo isegi Knexi haldustabeleid ning ei käivita rakendust
või postitöid. Lisaks kontrollitakse Giti väljalaske failide terviklikkust ja
commit'imata muudatuste puudumist. `pending` näitab ootel migratsioone.

Eelkontroll peatub muu hulgas puuduliku olemasoleva tabeli, puuduva indeksi,
kitseneva veeru, tundmatu unikaalsus- või CHECK-piirangu, CRM-i välisvõtme või
päästiku, andmebaasirutiini, ajastatud andmebaasisündmuse, sobimatu märgistiku, mitte-InnoDB tabeli,
vaate või tundmatu/aktiivse migratsiooniajaloo korral. See on teadlikult
konservatiivne: tegeliku skeemi erisused vajavad enne uut paigalduskatset
ülevaatust ja vajadusel eraldi parandatud migratsiooni. Hoidla
`ops/schema-contract.json` on koodi ja testmigratsioonide kontrollitud võrdlusalus,
mitte tootmisandmebaasist loetud skeem.

## 3. Hoolduspaus, varukoopiad ja paigaldus

Peata enne järgmise käsu käivitamist Zone'i cron-tööd, välised importijad,
postitöötajad ja muud sama andmebaasi kirjutajad. Hoia veebirakendus hooldusrežiimis
ka taastamise ajal. `--maintenance-confirmed` tähendab, et haldaja on seda teinud;
see lipp ei peata väliseid teenuseid ise. Veebirakenduse peatab kontrolladapter.

```bash
node ops/deploy.js apply \
  --env "$ENV_FILE" --host "$DB_HOST" --database "$DB_NAME" \
  --revision "$REVISION" --root "$ROOT" --control "$CONTROL" \
  --dump-command mariadb-dump --maintenance-confirmed
```

MySQLi tööriistade korral kasuta `--dump-command mysqldump`. MySQLi dump keelab
GTID globaalse taastamise käsud (`--set-gtid-purged=OFF`). Kliendi
versioon kontrollitakse enne kasutamist; varundus ei loe kasutaja muid
MySQLi konfiguratsioonifaile (`--defaults-file`, MySQLil ka `--no-login-paths`). Andmebaasiparooli ei
panda käsureale: klienditööriist saab ajutise 600 õigustega konfiguratsioonifaili,
mis eemaldatakse pärast kasutamist.

Skript teeb järjekorras:

1. Kordab skeemi ja väljalaske eelkontrolli ning võtab paigaldusluku.
2. Peatab senise rakenduse, kinnitab peatamise ja kontrollib skeemi uuesti.
3. Varundab vana koodi (`code.tar.gz`), kogu andmebaasi (`database.sql`) ja
   `.env` sisu (`env.snapshot`). Koodi arhiivist jäävad välja `node_modules` ja
   `.git`; väliste sümbollinkide sihtandmeid arhiiv ei järgi.
4. Salvestab kontrollsummad, varasema skeemi ja tabelite kirjete arvud
   `backups/<ID>/manifest.json` faili ning kontrollib varukoopiate terviklikkust.
5. Pakib fikseeritud Giti commit'i uude väljalaskekausta, paigaldab lukufaili järgi
   sõltuvused ilma lifecycle-skriptideta ja loob viited olemasolevale `.env` ning
   runtime-kaustadele.
6. Käivitab ainult teadaolevad ootel migratsioonid, kontrollib lõppskeemi ja
   olemasolevate andmetabelite kirjete arvude säilimist.
7. Vahetab `current` sümbollingi aatomiliselt, käivitab uue versiooni ja kontrollib
   loopback-aadressil `/health` vastuses just selle commit'i tunnust, `/api/me`
   anonüümset 401 vastust ning kaitstud prototüübi 302 ümbersuunamist.

Skript ei käivita sünteetiliste andmete lisamist, kliendiimporti ega kirjasaatmist.
Migratsioon lisab vajadusel ainult rakenduse vaikimisi lõpetamispõhjused ning
puuduvad skeemielemendid. Seniseid kliendi- ja ajalookirjeid ei uuendata ega kustutata.
Tegevuste ja klientide sisulist terviklikkust kontrolliti lisaks sünteetiliste
säilitamismarkeritega isoleeritud testis; tootmise andmeväärtusi tervisekontroll ei loe.

**Salvesta eduka käsu väljundist varukoopia ID.** Kontrolli rakendust tavapärase
HTTPS aadressi kaudu ja ava hoolduspaus alles pärast edukat kontrolli. Proovikirja
pole vaja saata. PM2 adapter salvestab nii peatatud kui uue käivitatud protsessi
oleku, et masina taaskäivitus ei taastaks vana koodi muudetud skeemile.

## 4. Taastamine

Ära kasuta `knex migrate:rollback`: migratsioonid on ühesuunalised.

Määra **oma paigalduskäsu väljundist** salvestatud ID:

```bash
BACKUP_ID='asenda_varukoopia_IDga'
```

### Kui migratsioone ei alustatud

Käivitusvea korral taastab skript sel juhul vana koodi automaatselt. Vajadusel
saab sama kontrollitud varukoopia järgi vana koodi taastada ka käsuga:

```bash
node ops/deploy.js rollback \
  --env "$ENV_FILE" --host "$DB_HOST" --database "$DB_NAME" \
  --root "$ROOT" --control "$CONTROL" --backup "$BACKUP_ID" \
  --maintenance-confirmed
```

Skript lubab seda ainult muutumata konfiguratsiooni ja varasema skeemi korral.
Andmebaasi ei taastata ega tühjendata ning vahepealsed kliendikirjed säilivad.

### Kui migratsioone on alustatud, ka osalise vea korral

Skript jätab rakenduse peatatud olekusse ja keeldub vana koodi automaatsest
käivitamisest. Vajalik on hoolduspaus ning varukoopia taastamine **uude täiesti
tühja andmebaasi**. Algset tootmisandmebaasi ei kustutata ega kirjutata üle.

Loo Zone'i halduses/DBA abil uus tühi utf8mb4 andmebaas ja sellele vajalikud õigused.
Kopeeri vana konfiguratsioon **uude** faili ja muuda ainult `DB_*` ühendusvälju:

```bash
RESTORE_ENV="$ROOT/recovery.env"
test ! -e "$RESTORE_ENV"
cp "$ENV_FILE" "$RESTORE_ENV"
chmod 600 "$RESTORE_ENV"
vi "$RESTORE_ENV"
RESTORE_HOST='asenda_taastamisandmebaasi_hostiga'
RESTORE_DB='asenda_uue_tuhja_andmebaasi_nimega'
node ops/deploy.js restore-empty \
  --env "$RESTORE_ENV" --host "$RESTORE_HOST" --database "$RESTORE_DB" \
  --root "$ROOT" --backup "$BACKUP_ID" --client-command mariadb
```

MySQLi korral on `--client-command mysql`. Skript keeldub taastamast algsesse või
mitte-tühja andmebaasi. See kontrollib SQL-faili kontrollsummat, taastatud skeemi
ja kirjete arve ning salvestab taastamiskinnituse. Katkenud impordi järel kasuta
uut tühja sihtandmebaasi; skript ei tühjenda poolikut sihti sinu eest.

Kui taastamine on kinnitatud:

```bash
node ops/deploy.js rollback \
  --env "$RESTORE_ENV" --host "$RESTORE_HOST" --database "$RESTORE_DB" \
  --root "$ROOT" --control "$CONTROL" --backup "$BACKUP_ID" \
  --maintenance-confirmed --restored
```

Vana kood pakitakse varukoopiast uude taastamisväljalaskesse; selle `.env` viitab
uuele taastamiskonfiguratsioonile. Algne `.env` ja algne andmebaas jäävad alles.
Edaspidisel paigaldusel kasuta `ENV_FILE="$RESTORE_ENV"`, `DB_HOST="$RESTORE_HOST"`
ja `DB_NAME="$RESTORE_DB"`. Taastamise järel teenindab rakendus varundamise hetke
andmeid; hilisemad kirjed jäävad algsesse andmebaasi ning nende üleviimise otsustab
haldaja eraldi. Failide väliste sihtkaustade taastamine ja teiste teenuste
andmebaasiviidete ümberlülitamine vajab eraldi haldustoimingut.

## 5. Peatumise korral

Uuri konkreetse ID `manifest.json` faili ja rakenduse protsessihalduri logi.
Ära avalda `database.sql`, `env.snapshot`, PM2 keskkonda või konfiguratsioonifaile.
Osaline/mitte-terviklik varukoopia taastamiseks ei sobi. Allesjäänud
`$ROOT/.deploy-lock` kausta tohib eemaldada ainult pärast kinnitamist, et eelmine
paigaldusprotsess enam ei tööta; automaatset lukumurdmist pole.

Zone'i täpset protsessijuhtimise seadistust, võrgu-/TLS-ühendust ja tootmisskeemi
pole siin kinnitatud. Käesoleva PR-i aruanne kirjeldab tegelikult läbi proovitud
isoleeritud testi ja selle piire.
