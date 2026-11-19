# Vastamine pärast kliendi üleandmist

Probleem: kliendi ja aktiivsete tegevuste omanik muutus portfelli üleandmisega, kuid vastuse avamine ning saatmine nõudsid endiselt, et kasutaja oleks saabunud kirja algse postkasti omanik. Nii nägi uus omanik vastuseteadet, aga sai avamisel vea „Vastus kuulub teise kasutaja postkasti”.

Parandus kasutab vastamise õiguse alusena kliendi praegust omanikku ning aktiivse vastamistegevuse omanikku. Algset kirja, postkasti seost ega saadetud kirja ajalugu ümber ei kirjutata. Algse saadetud kirja seost kontrollitakse jätkuvalt: outbox ID, kliendi ID, algse tegevuse ID, postkasti kasutaja ID ja edukas saatmisolek peavad kokku sobima. Sama kontroll tehakse nii avamisel kui saatmise reserveerimisel. Vigane või teise kliendi algne kirjavahetus ei anna vastamise õigust.

Uus omanik saab avada üleantud kliendi vastuse või jätkata enne üleandmist loodud aktiivset mustandit sama tegevuse ID-ga. Saatmisel kasutatakse uue omaniku seadistatud SMTP postkasti, Reply-To aadressi ja salvestatud allkirja. Saaja on endiselt kliendi vastuse saatja ja In-Reply-To viitab algsele kliendi vastusele. Järgnev tegevus kuulub uuele omanikule. Edukas saatmine käsitleb vastuse ja suurendab followupide arvu ühe korra senise töövoo järgi.

Endine omanik ja teised kasutajad ei saa üleantud kliendile vastata ega teiste postkastide kirju üldiselt lugeda. Ligipääs jääb kliendi ja tegevusega piiratuks; üldist postkastide ligipääsu ei lisata. Administraatori konto ei saa selle parandusega vastata teise omaniku eest. Peatatud ja juba käsitletud vastuste ning reserveeritud/ebakindla saatmise kaitsed säilivad. Kui kliendi omanik muudeti väljaspool üleandmise töövoogu ja vana mustandit ei antud üle, jääb see vastuolu veana kontrollimiseks.

Uuendus ei vaja andmeparandust ega migratsiooni. Juba üleantud kliendi vastuse saab pärast uuendust uuesti avada uue omaniku kontoga. Kui vanal vastamistegevusel on registreeritud saatmine või puuduva kontakti/algse kirja viga, tuleb seda eraldi kontrollida; parandus ei tee automaatset kordussaatmist ega asenda ajalugu.

## Kontrollid

Kõik 84 sihitud vastamise, CRM-i, töörežiimide, postkastide, allkirjade, mallide järeltegevuste ja tööjärjekordade testi läbitud; 0 ebaõnnestunud ja 0 vahele jäetud. Lisatud on tegeliku portfelli üleandmise API-ga regressioonid: uus vastus, olemasoleva mustandi jätkamine, uue omaniku saatja ja allkiri, algne kirjavahetus ja endise omaniku keeld, ühekordne käsitlemine/loendur, üleantud ebakindla saatmise korduskatse keeld ja katkise algse sõnumi seose keeld.

Chromiumis läbiti vana omaniku vastuse avamine, tegelik portfelli üleandmine, vana omaniku keeld, uue omaniku sisselogimine ja sama mustandi jätkamine, uue omaniku allkiri ning üks testtransporti saadetud vastus uue postkasti aadressilt. Algne inbox/outbox seos ja kirjade sisu säilisid ning järeltegevus kuulus uuele omanikule. 0 JavaScripti viga ja 0 päris e-kirja. Ainult kohalik sünteetiline MariaDB 11.4.13 ning SMTP/IMAP testiasendused; Zone.ee-ga ei ühendutud ega tootmisandmeid muudetud.

Korratav brauserikontroll: `scripts/check-transferred-replies-browser.cjs` (ainult kohaliku sünteetilise testandmebaasiga).

Ekraanipildid:

- [Üleantud vastuse mustand uue omaniku vaates](transferred-client-replies/draft.png)
- [Edukas testsaatmine ja järgmine samm](transferred-client-replies/sent.png)
