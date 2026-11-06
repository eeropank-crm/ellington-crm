# Mallist määratud järeltegevused

## Vea põhjus ja parandatud käitumine

Tegevuse lõpetamise serveriloogika eiras varem crm_activity_details.next_step_json
välja ja lõi alati 14 päeva pärast sama tüübi/sisuga tegevuse. Kasutajaliides
näitas samuti 14-päevast ooteaega ning palus kasutajal järgmise sammu valida.
Malli sisseehitatud järelkirjal ei olnud eraldi template_id-d ja tavaline
saatmisvorm nõudis uut eraldiseisvat malli.

Nüüd luuakse lõpetamisel üks järgmine tegevus malli ahela esimesest sõlmest:

- tüüp (E-kiri, Kõne või Kohtumine);
- eesmärk, uus pealkiri ja malli järeltegevuse sisu/juhis;
- tähtaeg: lõpetamise päevast mallis määratud tööpäevade võrra edasi;
- alles jääv ahel, mille järgmine sõlm võetakse selle tegevuse lõpetamisel.

Näiteks „Video tutvustus” → 2 tööpäeva pärast uue sisuga järelkiri →
1 tööpäev pärast selle järelkirja saatmist kõne. Reedel 06.11.2026 saadetud
esimene kiri loob teise kirja teisipäevaks 10.11.2026. Tööpäevad on E–R;
eraldi riigipühade kalendrit ei lisata. Tähtaeg lähtub tegelikust lõpetamise
päevast, mitte hilinenud ülesande esialgsest tähtajast.

Pärast lõpetamist näeb kasutaja valmis järgmise tegevuse tüüpi, tähtaega,
pealkirja ja sisu. Vormi võib sulgeda või vajutada **Valmis — jäta malli
järeltegevus alles**: planeering on juba andmebaasis. **Muuda järeltegevust**
võimaldab olemasoleva planeeringu asendada käsitsi valitud malli ja tähtajaga.
Teist paralleelset järeltegevust selle valikuga ei looda.

Malli sisse salvestatud järelkiri on oma tegevuse hetktõmmis (template_id=null).
Eraldi globaalset malli automaatselt ei tekitata. Saatmisvormis on vaikimisi
valitud „… · malli järeltegevus” ning laetud tema uus pealkiri/sisu. Kasutaja
saab teksti kohandada või valida teise aktiivse malli. Inline-järelkirja lubab
server ainult siis, kui selle päritolu tõendab serveri loodud sündmus ja
eesmärk vastab sama tegevuse salvestatud eesmärgile; suvalise template_id=null
sisendiga ei saa mallivalikut ega omanikukontrolli vahele jätta.

## Säilivad piirangud ja ühilduvus

- Kirju ei saadeta automaatselt. Iga kiri nõuab kasutajalt **Saada kiri** vajutust.
- Edukas päris saatmine lõpetab ühe tegevuse ja suurendab followup_count'i ühe
  võrra. Järeltegevuse loomine ise arvu ei suurenda. Korduskatse ei saada uut
  kirja ega loo teist järeltegevust. SMTP-tõrkel säilib uncertain-tõke.
- Saatmise kontrollid ja reservatsioon toimuvad enne SMTP-d. Vigane ahel
  peatatakse enne kirja saatmist. Kõiki sõlmi valideeritakse ka uue malli
  salvestamisel, mitte ainult esimest sõlme.
- Kliendi omanik, kasutajakonto, sisselogimine, portfellid ja senine ajalugu ei
  muutu. Järgmine tegevus hoiab tegelikult saadetud kirja kontaktisiku.
- Ahela järelejäänud sõlmed säilivad uues tegevuses. Järelkirja saatmine ei
  alusta vanema „Video tutvustus” malli ahelat uuesti, ka siis, kui administraator
  on vahepeal vanemat malli muutnud.
- Ilma järgmise sõlmeta säilib senine 14 kalendripäeva ooteaja käitumine.
  See kehtib ka ahela lõpus; midagi ei saadeta selle tähtaja saabumisel ise.
- Olemasolevad completed_default_followup / created_default_followup sündmused
  säilivad; lisatakse päritolu ja nähtava järgmise sammu andmed. Saabunud
  vastus peatab endiselt ainult sama omaniku puutumata automaatse järeltegevuse.
- Root-tegevuse e-kirja saatmisel kasutatakse valitud aktiivse malli praegust
  ahelat, mistõttu enne ahela lisamist loodud „Video tutvustus” tegevused ei
  vaja uuesti loomist. Kõne/kohtumise puhul kasutatakse salvestatud ahelat;
  kui see puudub, kontrollitakse seotud aktiivse malli ahelat.

Varem ekslikult loodud 14-päevaseid tegevusi ega juba toimunud kontakte ei
kirjutata selle koodiparandusega tagantjärele ümber. Nende võimalik parandamine
vajab konkreetsete tegevuste kontrolli ja eraldi andmete muutmise toimingut.
See PR ei käivita tootmises ühtegi käsku ega saada päris kirju.

Uusi migratsioone, sõltuvusi ega keskkonnamuutujaid ei ole. Paigaldamine toimub
pärast ülevaatust tavapärase varundava paigaldajaga, health-host 127.0.135.83.

## Kontroll

Node.js 24.22.1, kohalik MariaDB 11.4.13 ja ainult sünteetilised andmed.

```bash
node --test --test-concurrency=1 test/template-followups.test.js test/mail-content.test.js test/activity-edit.test.js test/crm.test.js test/mailboxes.test.js test/work-modes.test.js test/work-queues.test.js
```

Enne testimist peavad DB_* ja SESSION_SECRET viitama eraldatud kohalikule
ellington_test* andmebaasile. Võltsitud SMTP ei loo välisühendusi. Uued testid
kontrollivad sisseehitatud järelkirja, uue sisu ja tähtaja kasutamist, ülejäänud
ahelat, nädalavahetusi/DST-d, terminalset 14-päevast varuvarianti, vanema malli
hilisema muutmise eraldatust, käsitsi asendamist, päritolu/omaniku kontrolli,
vigase ahela tõrjet enne saatmist, SMTP-tõrget, kogu ahela valideerimist,
kohtumise ärajäämise loendurit, kliendi vastuse saabumist ning samaaegset
saatmist kahelt vormilt.

Chromiumi kontroll:

```bash
node scripts/check-template-followups-browser.cjs
```

Vajab kohalikku sünteetilist DB-d, Playwrighti ning /usr/bin/chromium'i.
Nodemaileri transport asendatakse enne rakenduse laadimist võltsitud SMTP-ga.
Kontroll näitab „Video tutvustus” saatmise järel valmis uue sisuga järelkirja,
„Valmis” nupuga sulgemist, selle järelkirja avamist eeltäidetud inline-malliga
ning teise käsitsi saatmise järel mallist planeeritud kõnet. 0 JavaScripti viga;
kaks selgesõnalist võltsitud saatmist, 0 päris kirja.

- [Esimese kirja järel valmis planeering](template-followups/planned-email.png)
- [Uue sisuga järelkirja saatmisvorm](template-followups/inline-email.png)
- [Teise kirja järel planeeritud kõne](template-followups/planned-call.png)

Lõpptulemus: **74 testi läbitud, 0 ebaõnnestunud, 0 vahele jäetud**
(14 uut testi + 60 seotud regressiooni), väljumiskood 0.
Chromiumi kirjeldatud voog läbis; JavaScripti süntaks ja git diff --check korras.
