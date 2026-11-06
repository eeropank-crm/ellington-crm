# „Video tutvustus” e-kirja HTML-eelvaade

Video: https://www.youtube.com/watch?v=Hu6P50nQzbQ

Saatmisel genereeritakse kirja olemasolevast tekstist turvaline HTML-versioon.
Aktiivse malli/eesmärgi **Video tutvustus** korral asendub selle video esimene
HTTPS-tekstilink klikitava pisipildi ja selle all oleva punase **▶ Vaata videot
YouTube’is** nupuga. Nii pilt kui Play-nupp avavad sama YouTube'i video.
See pole kirja sisse ehitatud videopleier; saaja ei vaja JavaScripti, iframe'i
või HTML-video tuge. Teiste videote linke ega teiste mallide sisu eelvaateks ei muudeta.

Pildi avalik HTTPS-aadress on
https://i.ytimg.com/vi/Hu6P50nQzbQ/hqdefault.jpg . Toetatud on ka sama video
youtu.be link ja youtube.com/watch?v=… koos muude päringuparameetritega.
Eelvaade suunab alati ülaltoodud kanoonilisele videoaadressile.

## Vorming ja olemasolevad tegevused

- SMTP-kiri sisaldab **text/plain** ja **text/html** osi (multipart/alternative).
- Tekstiversioon säilitab algse kirja koos URL-iga. HTML-is säilivad lõigud,
  reavahetused ja Unicode; tekst põgenetakse HTML-süstimise vältimiseks.
- Eelvaate maksimaalne laius on 480 px; väiksemal ekraanil kahaneb pilt
  konteineri laiusele ja kõrgus säilitab proportsiooni.
- Kujundus kasutab esitlustabeleid, inline-stiile, pildi width-atribuuti ning
  klassikalise Outlooki jaoks MSO tingimuslikku 480 px ümbrist. Play on tavaline
  tekstilingiga tabelirida pildi all, mis toimib ka välispiltide blokeerimisel.
- Pilti ei lisata CID-manusena. Saaja meiliprogramm laadib selle YouTube'i
  avalikult pisipildiaadressilt; piltide keelamise korral võib olla vaja lubada
  nende kuvamine. Play-link ja tekstiversiooni videolink jäävad kasutatavaks.

Andmebaasi malle, juba loodud tegevuste juhiseid ja outbox'i teksti ei kirjutata
HTML-iks ümber. Ka olemasolevad „Video tutvustus” tegevused saavad uue HTML-kuju,
kui kasutaja saadab need pärast selle koodi paigaldamist ning kirja tekstis on
selle video link. Koostamisvormis ja tekstiajaloos on link endiselt tekstina.
Ilma selle videolingita mustandile pilti automaatselt ei lisata.

Saatja, saaja, Message-ID, reply-to, saatmise reservatsioon, topeltsaatmise tõke,
SMTP-tõrke uncertain-olek, tegevuse lõpetamine, 14-päevane järeltegevus ning
followup_count'i üks kord suurendamine kasutavad olemasolevat loogikat.
HTML-i genereerimine ei loo eraldi tegevusi ega tee HTTP-päringuid serverist.
Server/services/mail-content.js on lisatud paigaldaja nõutud failide kontrolli.

Uusi sõltuvusi, keskkonnamuutujaid ega migratsioone ei lisandu. Eraldi PR
tegevuse tüübi/malli vahetamiseks ei ole selle muudatuse eelduseks.
Tootmisse pole paigaldatud ega ühendatud; päris klientidele kirju ei saadetud.

## Kontrollid ja piirid

Node.js 24.22.1 ja kohalik MariaDB 11.4.13, ainult sünteetilised andmed:

```bash
node --test --test-concurrency=1 test/mail-content.test.js test/crm.test.js test/mailboxes.test.js test/work-modes.test.js test/work-queues.test.js
```

DB_* ja SESSION_SECRET peavad viitama eraldatud kohalikule ellington_test*
andmebaasile. Tulemused: **47 läbitud, 0 ebaõnnestunud, 0 vahele jäetud**.
Kuus uut renderdus-/MIME-testi ja üks uus saatmise integratsioonitest lisanduvad
40 seotud regressioonile. Saatmisintegratsioon kasutab võltsitud SMTP-d ning
MIME-test Nodemaileri kohalikku streamTransport'i, mis ei loo võrguühendust.
Kontrollitud on teksti säilimine, lingi asendamine, domeeni/video sobitamine,
HTML-põgenemine, mobiilisuuruse HTML, multipart/alternative, muutumatu outbox'i
tekst/Message-ID, lõpetamine/ajalugu, üks järeltegevus ning kordussaatmise tõke.

Chromiumi kontroll:

```bash
node scripts/check-video-email-browser.cjs
```

Vajab arenduskeskkonnas Playwrighti ja /usr/bin/chromium'i. Kontrollib 480 px
lauaarvuti vaadet, 390 px mobiili ilma horisontaalse ülevooluta, mõlema lingi
sihtaadressi ja piltide blokeerimisel alles jäävat Play-nuppu. 0 JS-viga;
kirju ei saadeta. Välispäringud on blokeeritud ning pisipilt on testis asendatud
selgelt märgistatud sünteetilise paigutuspildiga.

Testkeskkonna võrgupoliitika ei luba i.ytimg.com'i; tegelikku videokaadrit ega
pildi vastust ei õnnestunud siin kontrollida. Testides kasutatud sünteetiline
pilt ei kuulu saadetavasse kirja. Gmaili ja Outlooki tegelikes postkastides
kuvamist ei ole kontrollitud; HTML kasutab nende jaoks levinud tabelipõhist
lahendust ja võib sõltuda saaja piltide kuvamise seadistusest.

Sünteetilised ekraanipildid:

- [Töölauavaade](video-email-preview/desktop.png)
- [Mobiilivaade](video-email-preview/mobile.png)
- [Pildid blokeeritud](video-email-preview/images-blocked.png)
