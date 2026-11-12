# Kontaktide haldamine kliendikaardil

Kliendikaardi **Kontaktisikud** jaotises saab lisada kontaktisiku või vajutada olemasoleva kontakti juures **Muuda kontakti**. Muudetavad väljad on nimi (kohustuslik, kuni 150 märki), üks e-posti aadress (valikuline, kuni 255 märki) ja telefon (valikuline, kuni 100 märki). Olemasolev ametinimetus säilib. Tühjaks tehtud e-posti või telefoni välja saab salvestada. Kontakte ei kustutata ega kirjutata uue kontakti lisamisel üle.

Tavakasutaja saab lisada ja muuta ainult oma portfelli klientide kontakte. Administraatori töörežiimis saab hallata kõigi klientide kontakte. Administraatori tavakasutaja režiim jääb oma portfelliga piiratuks. Õigusi kontrollitakse serveris ning kliendi omanik lukustatakse muudatuse tehingu ajaks. Samaaegse või sünkroonija tehtud kontaktimuudatuse järel lükatakse aegunud vorm tagasi: värskenda kliendikaarti ja ava kontakt uuesti. Klientide omanikke, ajalugu, tegevusi, kirjade salvestatud adressaate ega followupide arvu kontaktihaldus ei muuda.

Aktiivse enda tegevuse **Muuda tegevust** vormis saab valida sama kliendi kontaktisiku või valiku **Määramata**. Valik säilib sama tegevuse juures ning selle ID, tähtaeg, tööjärjekord ja followupide arv ei muutu. Muudatus lisatakse tegevuse muutmisajalukku koos kontaktide nimedega. Võõra kliendi kontakti kasutada ei saa. Tehtud või peatatud tegevust ning registreeritud saatmisega tegevust ei muudeta. Administraator ei saa teise töötaja tegevust muuta; oma tegevuse jaoks tuleb kasutada tavakasutaja režiimi. Vastuskirja adressaat jääb seotud saabunud kirja saatjaks, nagu varemgi. E-kirja koostaja kasutab salvestatud tegevuse kontaktivalikut; kasutaja saab koostajas endiselt valida kirja adressaadi.

Google Sheetsi integratsioon jääb samale kontaktikirjele seotuks. Muutmata tabeliväärtus ei kirjuta CRM-is tehtud muudatust üle. Kui hiljem muudetakse sama välja ka tabelis, jääb erinevus administraatorile konfliktina lahendada. Neid kontrolle ei mööda kontaktide muutmise API ega tegevuse kontaktivalik.

## Kontrollitulemused

- 142 sihitud rakenduse regressioonitesti läbitud, 0 ebaõnnestunud ja 0 vahele jäetud. Kontrolliti kontaktihaldust, tegevuse muutmist, CRM-i, töörežiime, Google Sheetsi, vastuskirju, mallide järeltegevusi, allkirju, postkaste ja tööjärjekordi.
- Kuus uut kontaktihalduse testi: lisamine/muutmine ja andmete säilimine; serveri õigused ja töörežiimid; valideerimine, aegunud/samaaegsed muudatused; tegevuse kontaktivalik; saadetud kirjade ja tehtud tegevuste säilimine; Google Sheetsi konfliktikaitse.
- Chromiumis läbisid oma kontakti lisamine/muutmine, tegevuse kontaktivalik, administraatori lisamine teise töötaja kliendile ning mobiilivorm. 0 JavaScripti viga ja 0 e-kirja saatmispäringut.
- Kasutati ainult kohalikku sünteetilist MariaDB 11.4.13 testandmebaasi. Testaadressid on `.invalid`; SMTP transport on brauserikontrollis keelatud. Zone.ee-ga ei ühendutud, pärisandmeid ei muudetud ega kirju saadetud. Uusi migratsioone ei ole ning olemasolevaid migratsioone ei muudetud.

Ekraanipildid:

- [Kontaktid kliendikaardil](client-contacts/client-card.png)
- [Tegevuse kontaktivalik](client-contacts/activity-contact.png)
- [Mobiilivorm](client-contacts/mobile-form.png)

Brauserikontrolli korratav skript: `scripts/check-client-contacts-browser.cjs`. Käivita see ainult eraldi kohaliku sünteetilise testandmebaasi konfiguratsiooniga; skript kontrollib andmebaasinime ja loopback-ühendust ning loob eraldi testkasutajad, kliendid ja kontaktid. Skript ei ole tootmises käivitamiseks.
