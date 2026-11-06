# Indreku ja Palme CRM-i postkastid

Sisselogimise aadress ja CRM-i postkast on eraldi:

| Kasutaja ID | CRM-i sisselogimine | CRM-i postkast |
| --- | --- | --- |
| 2 | indrek@ellington.ee | indrek.mae@ellington.ee |
| 3 | palme@ellington.ee | palme.kaggovere@ellington.ee |

SMTP: `smtp.zone.eu`, port 465, TLS. IMAP: `imap.zone.eu`, port 993, TLS.
Postkasti parool on Zone'i selle postkasti parool, mitte CRM-i parool. Paroole
sisestatakse ainult Zone.ee terminalis; neid ei tohi saata vestlusse ega lisada
GitHubi. Kood ja allolev seadistamine ei muuda CRM-i sisselogimisaadresse,
parooliräsisid, kasutaja ID-sid, kliendiomanikke ega kasutajate aktiivsust.

## Mida koodis parandati

Saatmine ja vastuste jälgimine kasutavad kasutaja ID-ga seotud postkasti.
Igal kasutajal võivad olla eraldi SMTP/IMAP host, port ning IMAP lubamise lipp.
Olemasolevad globaalsed seaded jäävad vaikimisi toeks: need ega kasutaja 1
postkast ei muutu seadistusutiliidi käivitamisel.

Vastuvõtt ei piirdu enam kasutajaga 1. Viie minuti järel vaadatakse läbi kõik
aktiivsed, lubatud ja seadistatud postkastid; esmane kontroll algab 15 sekundit
pärast rakenduse käivitumist. Ühe postkasti tõrge ei peata teisi. Sama postkasti
kahele aktiivsele kontole määramine blokeerib sünkroonimise, et vältida segiajamist.

CRM impordib **vastuseid CRM-ist saadetud kirjadele**, mitte kogu postkasti.
Vajalik on viide sama kasutaja saadetud kirjale ja oodatud saatja aadress.
Pealkirja järgi klienti ei oletata. Korraga kontrollitakse kuni 250 uusimat
sõnumit viimase 45 päeva seast. INBOX avatakse ainult lugemiseks ja kasutatakse
BODY.PEEK päringuid: kirju ei kustutata ega märgita loetuks. Olemasolevaid
CRM-i kirjeid ei impordita dubleeritult.

Vastus salvestub õige `mailbox_user_id` alla. Muutmata automaatse 14-päevase
järeltegevuse saab peatada ainult selle sama kasutaja ja kliendi juures.
Inimese muudetud järeltegevusi ning pärast portfelli üleandmist teise töötaja
tööd ei peatata. Saabuv vastus ei suurenda followup'ide arvu. Kliendi staatust
agent selle muudatusega ei liigita ega muuda.

Kasutajate vaates näidatakse saatmise seadistust ja vastuste jälgimise
seadistust eraldi. „Seadistatud” tähendab vajalike väljade olemasolu; see pole
pidev ühenduse tervisekontroll. Seadistusutiliit kontrollib päris ligipääsu enne
faili kirjutamist.

## Kasutuselevõtt Zone.ee-s

Kõigepealt tuleb ühendada ja tavapärase varundava paigaldajaga kasutusele võtta
seda parandust sisaldav main-versioon. Eraldi andmebaasimigratsiooni ei lisandu.
Seadistamine keeldub töötamast, kui käivitatav lähtekood pole `current` lingiga
aktiivne väljalase või --env ei viita selle väljalaske olemasolevale .env failile.
Vanas versioonis ainult .env väljade lisamisest vastuste jälgimiseks ei piisa.

Kontod ID 2 ja 3 peavad olema aktiivsed ning ülaltoodud sisselogimisaadressidega.
Paroolid kontrollitakse SMTP AUTH/verify ja IMAP-i read-only INBOX avamisega.
Testkirja ei saadeta ja kirjade sisu selle kontrolliga ei loeta.

Pärast paranduse paigaldamist käivita Zone.ee Bash-terminalis:

```bash
(
  set +x
  set -euo pipefail
  umask 077
  unset NODE_OPTIONS NODE_PATH NODE_DEBUG DEBUG
  cd "$HOME/ellington-deploy/current"
  ENV_FILE="$(readlink -f .env)"

  read -r -s -p 'Indreku postkasti indrek.mae@ellington.ee parool: ' ELLINGTON_SETUP_PASSWORD_2
  printf '\n'
  read -r -s -p 'Palme postkasti palme.kaggovere@ellington.ee parool: ' ELLINGTON_SETUP_PASSWORD_3
  printf '\n'
  export ELLINGTON_SETUP_PASSWORD_2 ELLINGTON_SETUP_PASSWORD_3

  node ops/configure-staff-mailboxes.js --env "$ENV_FILE"
  unset ELLINGTON_SETUP_PASSWORD_2 ELLINGTON_SETUP_PASSWORD_3

  node - "$ENV_FILE" <<'NODE'
const fs=require('fs'),{spawnSync}=require('child_process');
const config=require('dotenv').parse(fs.readFileSync(process.argv[2]));
const env={...process.env};
for(const key of Object.keys(env))if(/^(DB_|CRM_|SESSION_|ELLINGTON_SETUP_PASSWORD_)/.test(key))delete env[key];
Object.assign(env,config);
for(const args of [['restart','ellington-crm','--update-env'],['save','--force']]){
  const r=spawnSync('pm2',args,{env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  if(r.error||r.status!==0){console.error('PM2 seadete rakendamine ebaõnnestus; privaatseid väljundeid ei kuvata.');process.exit(1);}
}
console.log(JSON.stringify({ok:true,mailboxSettingsLoaded:true,testEmailSent:false}));
NODE
)
```

Utiliit kontrollib enne muudatusi kasutajakontosid ja mõlema postkasti
ligipääsu. Seejärel loob .env-st privaatse täpse varukoopia, kontrollib selle
SHA-256 ning lisab seaded aatomiliselt õigustega 600. Samaaegse failimuudatuse
korral töö peatub. Olemasolevad muud seaded säilivad. Varukoopiat ei kustutata.
PM2 restart toimub ainult pärast edukat seadistust ning loeb uued väärtused
failist, vältides varasemate PM2 keskkonnaväärtuste allesjäämist.

Olulisemad veakoodid: `ACCOUNT_NOT_READY` tähendab, et kontode ID-d,
sisselogimisaadressid või aktiivsus ei vasta kinnitatud jaotusele;
`SMTP_AUTH_2/3` või `IMAP_AUTH_2/3` tähendab vastava kasutaja ühenduse kontrolli
nurjumist. Nende vigade korral .env ei muutu. `ENV_CHANGED` tähendab samaaegset
muudatust; teise protsessi muudatust ei kirjutata üle. Faili kirjutamise või
PM2 vea korral säilita väljastatud varukoopia ja ära avalda selle sisu.

Pärast seadistamist värskenda Kasutajate vaadet. Saabuvate vastuste tegelik
sünkroonimine toimub järgneva tavapärase töö käigus. See pole automaatne
kirjade saatmine ega vastustele vastamine.

## Kontrollid

Ainult kohalik MariaDB 11.4.13, sünteetilised kontod/sõnumid, võltsitud SMTP-
ja IMAP-kliendid ning ajutised testkonfiguratsioonid. 12 sihitud testi
kontrollivad postkastide eraldatust, eri hostide eelistust, aktiivsust, ranget
vastuse seostamist, kordusimpordi tõket, inimese muudetud või üle antud töö
säilimist, Unicode'i salvestamist, ühe postkasti tõrke eraldamist,
administraatori õigusi, SMTP topeltsaatmise tõket ning konfiguratsiooni
privaatset varundamist ja kontrollimist enne kirjutamist.

Päris SMTP/IMAP-serveritega ei ühendutud, Zone.ee faile/protsesse/andmeid ei
muudetud ning päris kirju ei saadetud. Tegelikud postkastide paroolid ja nende
toimimine pole Codexis kontrollitud: selleks on ülaltoodud serveris käivitatav
verify-kontroll, mis ei saada kirja.
