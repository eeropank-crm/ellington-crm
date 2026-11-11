# Kliendi vastamine ja kirjade ajalugu

## Kasutaja töövoog

Töölaua vastuseteavituses ja kliendikaardil on **Vasta kliendile**. See avab vastamise tegevuse ning kirja koostamise vormi, kus on nähtav kliendi vastus ja vaikimisi tekst **Tänud tagasiside eest**. Teksti, pealkirja ja kirjamalli saab enne saatmist muuta. Saaja on kliendi vastuse saatja; vastus saadetakse selle kasutaja CRM-postkastist, kellele sissetulnud kiri kuulus.

Kui Mallide all leidub aktiivne e-kirjamall nime või eesmärgiga **Tänud tagasiside eest**, võetakse esialgne sisu sellest. Kui sellist malli veel pole, kasutatakse sisseehitatud lühikest tänuteksti. Administraator saab ühise teksti muutmiseks luua või muuta vastava nimega e-kirjamalli. Sisu on igas kirjas muudetav. Vastuskirja järeltegevus valitakse pärast saatmist; selle jaoks ei rakendata valitud kirjamalli automaatset järeltegevuste ahelat.

Avamine ega sulgemine ei saada kirja, ei suurenda järeltegevuste arvu ega märgi vastust käsitletuks. Avamisel luuakse tänase tähtajaga vastamise tegevus. Sama vastuse uuesti või samaaegsel avamisel kasutatakse sama tegevust. Salvestamata tekstimuudatused ei säili vormi sulgemisel; tegevus ja algse vastuse seos säilivad.

Pärast SMTP edukat kinnitust salvestatakse saatmine, lõpetatakse vastamise tegevus, suurendatakse järeltegevuste arvu üks kord ja märgitakse käsitletuks ainult see kliendi vastus. Vastuskiri sisaldab algsele vastusele viitavaid `In-Reply-To` ja `References` päiseid.

Seejärel saab valida:

- **Jäta 14 päevaks ootele** — vaikimisi luuakse 14 kalendripäeva pärast kontrollkõne, ilma tänukirja teksti kopeerimata;
- **Muuda järeltegevust** — määrata kõne, e-kiri või kohtumine olemasoleva planeerimise vormiga;
- **Lõpeta jälgimine** — valida lõpetamise põhjus.

Tehniliselt salvestatakse vaikimisi ooteaja järeltegevus saatmisega samas andmebaasitehingus. Kui kasutaja sulgeb pärast saatmist vormi, jääb 14-päevane ooteaeg alles. Muu valik muudab seda sama järeltegevust, mitte ei loo teist.

SMTP vea või ebaselge vastuse korral jääb kliendi vastus käsitlemata. Uut ooteaega ega loenduri kasvu ei teki ning topeltsaatmise kaitse keelab automaatse kordussaatmise. Kui SMTP võttis kirja vastu, aga CRM-i salvestamine ebaõnnestus, tuleb saatmisreservatsiooni kontrollida; kirja ei tohi lihtsalt uuesti saata.

Varasem kokkuvõttega käsitletuks märkimise API tagastab nüüd 409 koos suunisega kasutada vastamist. Ka muu tegevuse planeerimine või lõpetamine ei saa saatmata kliendivastust varjatult käsitletuks märkida. Teise kasutaja või postkasti vastamise tegevust avada ega saata ei saa. Portfelli üleandmise järel vajab vana postkasti vastus eraldi korraldamist; seda ei saadeta vaikimisi uuest postkastist.

## Ajaloo kuvamine

Saadetud kirja täissisu kuvatakse kirjade jaotises. Tegevuste ajalukku jäävad saatmise aeg, tegija, eesmärk, pealkiri, saaja ja viide kirjale; sama kirja teksti ei korrata algse juhise ja tulemuse all.

Kui kliendi vastus tühistas automaatse järeltegevuse, näidatakse **Järeltegevus tühistatud: klient vastas**. Selle olemasolev sündmus ei ole enam ekslikult puuduva lõpetamissündmusena märgistatud.

Saabunud ja saadetud kirjade tuvastatav tsiteeritud varasem vestlus kuvatakse suletava jaotise **Tsiteeritud varasem kirjavahetus** all. Tuvastus põhineb teksti selgetel tsitaadi- ja päisemarkeritel; kõik vormingud ei ole tuvastatavad. Ka tsitaadi sees olevad vahele kirjutatud vastused jäävad avatavas osas alles. HTML-i ei renderdata otse: tekst on paomärkidega kaitstud.

## Andmete ja paigalduse ohutus

Muudatus ei vaja uut andmebaasimigratsiooni. Migratsioonid 001–005 ja skeemileping jäävad muutmata. Olemasolevate kirjade, algsete juhiste, tulemuste ja sündmuste sisu ei kirjutata ümber ega kustutata. Korrastatakse kuvamist ja uute vastamiste töövoogu. Tavapärane range eelkontroll, täielik varundamine ja taastamise võimalus säilivad.

Parandus on tehtud main-haru pealt ja ei sisalda ootel allkirjade PR #16 muudatusi. Zone.ee serveriga ühendust ei loodud ning päris kirju ei saadetud.

## Kontrollimine

Uued regressioonid asuvad `test/customer-replies.test.js`. Need katavad ühe ja samaaegse avamise, saatmise, niidipäised, kasutaja/postkasti õigused, adressaadi, vaikimisi ooteaja ja selle muutmise, SMTP ebaselguse, topeltsaatmise, vana käsitlemise tee tõkestamise ning andmete säilimise.

Chromiumis kontrolliti päris rakenduse kasutajaliidest sünteetiliste andmetega ning IMAP/SMTP testasendustega: algse kirja ühekordne nähtav kuvamine, tsitaadi avamine, tühistamise põhjus, vaikimisi tänukiri, avamine/sulgemine/jätkamine, saatmine, järgmise sammu valikud ja mobiilivaade. Ekraanipildid: `docs/customer-replies/`. Päris võrgupäringud postkastidele on asendatud testkoodiga ja välised brauseripäringud blokeeritud.

Rakenduse regressioonid: 102 testi läbitud, 0 ebaõnnestunud ja 0 vahele jäetud. Chromiumi arvuti- ja mobiilikontrollid läbitud, 0 JavaScripti viga. Lisaks läbisid 33 paigalduse, taastamise, pärandskeemi, skeemiühilduvuse, tervisekontrolli ja SQL-režiimi testi. Kokku kõik 135 automaattesti läbitud: 0 ebaõnnestunud ja 0 vahele jäetud. Viimase tsitaadituvastuse täienduse järel läbisid uuesti kõik 13 sihitud vastamistesti. Testandmebaas: MariaDB 11.4.13, isoleeritud kohalikud sünteetilised andmed.
