# Päevaplaan ja olemasolevate klientide tööjärjekorrad

See muudatus rakendab kokkulepitud etapid 1 ja 2. Turunduse uute lead'ide
sisestamine, reserveeritud esmakontaktide maht ja administraatori ooteaja
analüütika (etapp 3) ning Ionprint, käibehoiatused ja agent (etapp 4) jäävad ootele.

## Kasutaja töölaud

Põhivaates säilivad kokkulepitud kolm kohta:

- **Käibehoiatused:** praegu reserveeritud koht tekstiga „Ootel / Vajab
  Ionprindi ühendust”. Näidisandmeid ega väljamõeldud käibehoiatusi ei kuvata.
- **Hilinenud tegevused:** kuni kuus aktiivset tegevust tähtajaga enne tänast,
  vanim tähtaeg ees; sama kuupäeva korral väiksem tegevuse ID ees.
- **Tänased tegevused:** kuni kuus aktiivset tänase tähtajaga tegevust, ID
  järjekorras. Kuupäevaga kokkulepped saavad eelisjärjekorra.

Eraldi „Jätkamist ootavate klientide” kaarti ega tööjärjekorda pole. Varem
suheldud, järgmise tegevuseta kliendid on **tänase plaani vabade kohtade
allikas**, mitte neljas või käibehoiatuste asemele pandud lahter.

Tegevusjärjekorra `6/23` tähendab kuut hetkel näidatud tegevust kokku 23-st
sobivast aktiivsest tegevusest. Veel 17 on kuvamata. Tegevuseta klientide arvu
näidatakse tänases vaates eraldi selgitava tekstina, mitte tegevuste 6/N
loenduri osana: neile pole veel ülesandeid loodud.

Päeva esimesel avamisel salvestatakse tänaste ja hilinenud tegevuste valik
serveris. Valik säilib lehe värskendamisel, teises brauseris ja režiimivahetusel.
Lõpetatud või edasi lükatud tegevuse asemele uut automaatselt ei lisata:
`6/23` muutub ühe lõpetamise järel `5/22`, mitte uuesti `6/22`. Praeguse valiku
käsitlemise järel saab vajutada **Võta järgmised**.

### Tänase plaani vabade kohtade täitmine

Kui kuupäevaga tegevused on valitud ja plaani esialgsest kuuest kohast jäi
kohti kasutamata, saab kasutaja samas tänases vaates valida olemasoleva malli
ja vajutada **Täida vabad kohad klientidega**. Näiteks nelja planeeritud
tegevuse kõrvale saab võtta kaks klienti, kokku kuus tegevust.

Kui kuupäevaga tegevusi on veel valimata, ei luba server ega kasutajaliides
neist klientide valikuga mööduda. Näiteks kümne tänase tegevuse korral tuleb
esmalt käsitleda esimest kuut ja võtta järgmised neli; alles siis saab nelja
kõrvale planeerida kuni kaks kliendikontakti.

Lõpetatud tegevus ei vabasta sama valiku kasutatud kohta uue kliendi jaoks.
Kui kõik praeguse valiku tegevused on käsitletud ja kuupäevaga töid enam ees
pole, saab kasutaja malli valides alustada järgmist kuni kuue kliendiga valikut.
Sama kuue piirang kehtib kõigile tänases lahtris näidatavatele tegevustele
kokku, mitte eraldi järeltegevustele ja klientidest loodud ülesannetele.

Klientide valikust jäävad välja peatatud ja vastutajata kliendid ning kõik,
kellel on juba aktiivne tegevus, ka tulevikus. Käsitlemata kliendivastus
välistab samuti uue ülesande; vastust saab käsitleda senise vastuste töövooga.
Varasemat suhtlust tõendab lõpetatud tegevus, imporditud ajalugu või säilinud
positiivne followup'ide loendur. Täiesti puutumata lead'id jäävad etappi 3.

Klientide järjestus on teadmata viimase kontakti ajaga kliendid esmalt,
seejärel vanim teadaolev kontakt ja võrdse aja korral kliendi ID. Viimane
kontakt on lõpetatud tegevuse aeg või imporditud ajaloo kuupäev. Puuduvat aega
ei täideta oletatud kuupäevaga.

Valik loob mallile vastavad kõned, kohtumised või e-kirja tegevused tänase
tähtajaga. Kirja tegevuse loomine **ei saada kirja**. Ülesanded ilmuvad kohe
samasse tänaste tegevuste loendisse. Järgmisel päeval on tegemata ülesanne
hilinenud tegevus sama ID ja tähtajaga; kuupäevata kandidaate see hilinenuks
ei muuda. Peatamise/sulgemise tunnus on olemasolev `crm_clients.stop_reason`.

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
13 uut regressiooni kontrollivad järjekordi, kuue piirangut, 6/N loendureid,
Eesti aja järgi päevavahetust, stabiilset valikut, mitme brauseri ja käsitsi
planeerimise võidujookse, õigusi, followup'i ühekordset suurenemist, tulevaste ja
peatatud klientide välistamist, vigase plaani tõket ning migratsiooni sobivust.

Chromiumis kontrolliti sisselogimist, oma töölauda, lõpetamist ilma automaatse
juurdetäitmiseta, lehe värskendamist, kuupäevaga tegevuste eelisjärjekorda, ainult vaba koha
täitmist ning senise tegevusvormi avamist, administraatori lehitsemist, režiimivahetust ning mobiilset
vaadet. JavaScripti vigu ja horisontaalset ülevoolu ei olnud. Kõik välised
brauseripäringud ning saatmise ja IMAP sünkroonimise päringud olid blokeeritud;
päris e-kirju ei saadetud. Tegemist pole tootmises tehtud kontrolliga.

Ekraanipildid:

- [Tänased tegevused](work-queues/today.png)
- [Hilinenud pärast ühe tegevuse lõpetamist](work-queues/overdue.png)
- [Tänane valik pärast ühe vaba koha täitmist](work-queues/today-filled.png)
- [Ionprindi jaoks reserveeritud käibehoiatuste koht](work-queues/warnings.png)
- [Administraatori ülevaade](work-queues/admin.png)
- [Mobiilne vaade](work-queues/mobile.png)

Koos seotud skeemi-, pärandskeemi ülemineku-, paigalduse/taastamise ja
kasutajaõiguste regressioonidega: **41 läbitud, 0 ebaõnnestunud, 0 vahele jäetud**,
väljumiskood 0. Kontroll hõlmas 13 tööjärjekorra testi ja 28 seotud olemasolevat
testi; kogu varasemat 39 testi komplekti ei korratud. Kontrolliti eraldi,
et kuupäevaga tegevused ei jää kliendivaliku taha, nelja olemasoleva tegevuse
kõrvale saab luua ainult kaks uut ning lõpetamine ei ava automaatselt kasutatud
kohta. Migratsioonid 001–004 ja sõltuvuste failid on muutmata.
