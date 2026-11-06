# Päevaplaan ja olemasolevate klientide tööjärjekorrad

See muudatus rakendab kokkulepitud etapid 1 ja 2. Turunduse uute lead'ide
sisestamine, reserveeritud esmakontaktide maht ja administraatori ooteaja
analüütika (etapp 3) ning Ionprint, käibehoiatused ja agent (etapp 4) jäävad ootele.

## Kasutaja töölaud

Tavakasutaja näeb ainult enda klientide ja enda tegevuste järjekordi:

1. **Hilinenud tegevused:** aktiivsed tegevused tähtajaga enne tänast, vanim
   tähtaeg ees; sama kuupäeva korral väiksem tegevuse ID ees.
2. **Tänased tegevused:** aktiivsed tänase tähtajaga tegevused, ID järjekorras.
3. **Jätkamist ootavad kliendid:** varem suheldud avatud kliendid, kellel pole
   ühtegi aktiivset tegevust, ka mitte tulevikus. Esimesena teadmata viimase
   kontakti ajaga kliendid, seejärel kõige kauem kontaktita olnud kliendid;
   võrdse aja korral kliendi ID järjekorras. Viimane teadaolev kontakt on
   lõpetatud tegevuse aeg või imporditud ajaloo kuupäev. Varasemat suhtlust
   tõendab lõpetatud tegevus, imporditud ajalugu või säilinud positiivne
   followup'ide loendur; täiesti puuduvat ajalugu ei täideta oletatud kuupäevaga.

Kõigis järjekordades kuvatakse kuni 6 kirjet. `6/23` tähendab kuut hetkel
näidatud kirjet kokku 23-st sobivast kirjest, seega 17 on veel kuvamata.
Lõpetatud või edasi lükatud kirje eemaldub nähtavalt valikust ja sobivast
järjekorrast, aga selle asemele ei lisata automaatselt uut. Näiteks `6/23`
muutub ühe lõpetamise järel `5/22`, mitte uuesti `6/22`.

Päeva esimesel avamisel salvestatakse tänaste ja hilinenud tegevuste valik
serveris. Valik säilib lehe värskendamisel, teises brauseris ja režiimivahetusel.
Iga järjekorra praeguse valiku järel saab vajutada **Võta järgmised**, kui kõik
selle valiku tegevused on tehtud, edasi lükatud või muul põhjusel sellest
järjekorrast lahkunud. Järgmine valik sisaldab kuni kuut veel valimata tegevust.

Jätkamist ootavate klientide puhul on esialgu nähtav kuni kuue kliendi
ettepanek. Kasutaja valib olemasoleva tegevusmalli ja vajutab **Võta kuni 6
klienti päevaplaani**. Alles see toiming loob tegevused tänase tähtajaga.
Tegevus võib olla kõne, kohtumine või e-kiri vastavalt valitud mallile.
E-kirja tegevuse loomine **ei saada kirja**; saatmine käib olemasoleva
kasutajapoolse saatmisvormi ja kinnituste kaudu.

Sel päeval täidetakse loodud tegevused jätkamise järjekorras ning neid ei
kuvata samaaegselt tänaste tegevuste hulgas. Järgmisel päeval on tegemata
tegevus tavaline hilinenud tegevus sama ID ja sama tähtajaga. Tulevane
järeltegevus ilmub oma päeval tänaste tegevuste hulka. Ülejäänud kandidaadid
jäävad kuupäevata järjekorda, mitte ei muutu kõik korraga hilinenuks.

Peatamise/sulgemise tunnus on olemasolev `crm_clients.stop_reason`. Peatatud
kliendid ja vastutajata kliendid ei saa uut päevaplaani tegevust. Ka käsitlemata
kliendivastus välistab uue automaatse valiku: vastust saab käsitleda senise
vastuste töövooga. Olemasolevat aktiivset tegevust see reegel ära ei peida.

## Õigused ja andmete säilimine

Administraatori režiim on kõigi töötajate järjekordade lehitsetav ülevaade,
kuus kirjet lehel. Lugemine ei loo teiste kasutajate päevaplaane ega tegevusi.
Päevaplaani valimiseks tuleb minna tavakasutaja režiimi. Teiste töötajate
tegevuste lõpetamise, edasi lükkamise ja klientide muutmise piirangud säilivad.

Uus valik ei muuda olemasolevate klientide omanikke, tegevuste tähtaegu,
followup'ide arve ega varasemat ajalugu. Uute tegevuste selgesõnaline planeerimine
kasutab senist töövoogu ja salvestab vastava loomissündmuse. Loendur suureneb
endiselt üks kord tehtud tegevuse lõpetamisel; loomine, järjekorda valimine,
edasilükkamine ja korduv lõpetamise päring seda juurde ei loenda.

Valiku kirjutamine lukustab kasutaja rea; unikaalne tööpäevakirje
ja optimistlik versioon takistavad mitme brauseri topeltvalikuid. Uue tegevuse
loomisel lukustatakse klient ja kontrollitakse värske lukustava päringuga,
et samal ajal pole käsitsi uut tegevust planeeritud või kliendivastust lisatud.

## Migratsioon ja paigaldus

Lisandub `005_daily_work_queues.js`, mis loob ainult tabeli
`crm_work_queue_days`. Seal on kasutaja, Eesti kalendripäev, valiku versioon ja
valitud tegevuste ID-d. Migreerimine ei tõsta kliente töölauale ega lisa
tegevusi. Migratsioonid 001–004 jäävad muutmata, uusi kasutajakontosid ei looda.

Migratsioon on uuesti käivitatav. Skeemileping ja range preflight lubavad
puuduvat tabelit ainult siis, kui 005 on ootel. Poolik või sobimatu olemasolev
tabel blokeerib paigalduse. `down` ei kustuta andmeid; kehtib senine kontrollitud
varukoopiast taastamise kord. Päevaplaani tekstimaht on piiratud 60 000 baidiga;
täitumisel ei looda osalist tegevuste valikut.

Paigaldada tuleb kogu ühendatud väljalase koos migratsiooniga, mitte kopeerida
ainult HTML-i või käivitada 005 eraldi. Kasuta projekti varundavat paigaldajat,
kinnitatud hoolduspausi, uut fikseeritud SHA-d ja muutmiseta eelkontrolli.
Zone.ee jaoks tuleb enne järgmist paigaldust ühendada ka PR #7 tervisekontrolli
parandus ning kasutada `--health-host 127.0.135.83`. Käesolev PR ei paigalda
midagi tootmisse ega muuda sealset `.env` faili, postkaste või PM2 protsesse.

## Kontrollid

Kohalik MariaDB 11.4.13, Node.js 24.22.1, ainult sünteetilised kontod ja kirjed.
12 uut regressiooni kontrollivad järjekordi, kuue piirangut, 6/N loendureid,
Eesti aja järgi päevavahetust, stabiilset valikut, mitme brauseri ja käsitsi
planeerimise võidujookse, õigusi, followup'i ühekordset suurenemist, tulevaste ja
peatatud klientide välistamist, vigase plaani tõket ning migratsiooni sobivust.

Chromiumis kontrolliti sisselogimist, oma töölauda, lõpetamist ilma automaatse
juurdetäitmiseta, lehe värskendamist, mallipõhist kuue tegevuse loomist, senise
tegevusvormi avamist, administraatori lehitsemist, režiimivahetust ning mobiilset
vaadet. JavaScripti vigu ja horisontaalset ülevoolu ei olnud. Kõik välised
brauseripäringud ning saatmise ja IMAP sünkroonimise päringud olid blokeeritud;
päris e-kirju ei saadetud. Tegemist pole tootmises tehtud kontrolliga.

Ekraanipildid:

- [Tänased tegevused](work-queues/today.png)
- [Hilinenud pärast ühe tegevuse lõpetamist](work-queues/overdue.png)
- [Jätkamist ootavate klientide valitud tegevused](work-queues/continuation.png)
- [Administraatori ülevaade](work-queues/admin.png)
- [Mobiilne vaade](work-queues/mobile.png)


Koos seotud skeemi-, pärandskeemi ülemineku-, paigalduse/taastamise ja
kasutajaõiguste regressioonidega: **40 läbitud, 0 ebaõnnestunud, 0 vahele jäetud**,
väljumiskood 0. Varasemat 39 testi komplekti tervikuna ei korratud. Kontrolliti
ainult uue migratsiooni ja tööjärjekordadega seotud olemasolevaid komplekte ning
12 uut testi. Migratsioonid 001–004 ja sõltuvuste failid on muutmata.
