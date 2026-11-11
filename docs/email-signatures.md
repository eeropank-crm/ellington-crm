# Kasutajapõhised e-posti allkirjad

E-kirja koostamisel lisatakse saatja salvestatud allkiri eraldi väljale kirja sisu alla. Saatmisel ühendatakse sisu ja allkiri üheks tekst- ja HTML-kirjaks. Allkirja saab selle kirja jaoks muuta või eemaldada. Nupp **Salvesta minu allkirjaks** salvestab muudatuse järgmisteks kirjadeks.

Administraator saab administraatori töörežiimis avada **Kasutajad → Muuda allkirja** ja salvestada iga töötaja teksti. Kasutaja saab muuta ainult oma allkirja; administraatori õigusi kontrollitakse ka serveris. Samaaegne vananenud salvestus tagastab konflikti, mitte ei kirjuta uuemat teksti üle.

Allkirjad tuleb pärast paigaldamist kasutajatele salvestada. Migratsioon ei sisalda töötajate kontaktandmeid ega vaikeallkirju. Allkirja e-posti tekst võib erineda saatva postkasti aadressist; funktsioon ei muuda sisselogimist ega SMTP/IMAP-seadeid.

## Andmed ja paigaldus

Migratsioon `006_user_mail_signatures.js` lisab ainult tabeli `crm_user_mail_settings` (kasutaja ID, tekst, versioon ja ajatemplid). Olemasolevaid migratsioone 001–005, kliendiandmeid ja ajalugu ei muudeta. Paigaldaja skeemileping ja lähtekoodi inventuur hõlmavad uut tabelit ning faile. Kasuta tavapärast range eelkontrolli ja kontrollitud täieliku varundamisega paigaldust; ühesuunalise migratsiooni korral kehtib olemasolev taastamisjuhend `docs/zone-deployment.md`.

Saadetud kirja täielik tekst koos allkirjaga jääb väljuvate kirjade tabelisse ja lõpetamise ajalukku. Tegevuse alusjuhis ja järelkirja mall jäävad allkirjata. Tegevuse lõpetamine, järeltegevuste loendur ning saatmise kordamise kaitse säilivad. Allkirja piir on 3000 märki ja kogu saadetava teksti piir 10 000 märki. HTML-is kuvatakse allkirja tekst turvaliselt paomärkidega.

## Kontrollimine

Automaatkontroll: `test/mail-signatures.test.js` kontrollib koostamist, kasutajate eraldatust, õigusi, salvestamise konflikte, tekst/HTML-saatmist, ajalugu, järelkirja ja mahupiiranguid. SMTP on asendatud kohaliku mälus töötava testasendusega; päris kirju ei saadeta.

Sünteetilise MariaDB 11.4.13 keskkonna tulemus: 99 meili-, tegevuse-, töörežiimi- ja järjekorratesti läbitud. Chromiumis kontrolliti allkirja kuvamist kirja all, oma allkirja salvestamist ning administraatori allkirjahaldust. JavaScripti vigu ega saatmispäringuid ei tekkinud. Ekraanipildid asuvad kataloogis `docs/email-signatures/`.
