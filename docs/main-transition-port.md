# PR #5 paranduste toomine main-harusse

PR #5 ühendati harusse `fix/mariadb-schema-compatibility` pärast seda, kui
PR #4 oli juba ühendatud main-harusse. Seetõttu puudusid main-versioonist
`afac6fb1e0585279267a9f60309356a7d923b80b` PR #5 üleminekumigratsioon ja kaitsed.

Uus haru algab sellest main-versioonist ning toob PR #5 neli commit'i
(`aec272f`, `0656d25`, `5d9ac4f`, `0786d8b`) tavapäraste uute commit'idena selle
peale. Main-haru ajalugu ei kirjutata ümber. Enne käesoleva aruande lisamist
kattus kogu failipuu täpselt PR #5 testitud versiooniga
`0786d8bba723d39a67b0857723d4cac961848f83`.

## Kaasatud parandused

- Andmeid säilitav `004_legacy_v8_transition.js`, teadaoleva pärandskeemi profiil
  ning 27 ohukontrolli täieliku lähteprofiili jaoks. Tundmatud skeemierinevused
  ja ohtlikud andmed peatavad töö.
- Paigaldaja füüsiliste ühenduste range SESSION SQL-režiim, olemasolevate
  lippude säilitamine ja algrežiimi taastamine. Globaalset režiimi ei muudeta.
- Olemasolevate CRM- ja autentimiskirjete sisuaudit enne ja pärast migratsioone,
  lisaks varundamisele, skeemikontrollile ning kirjete arvude kontrollile.
- PR #5 dokumentatsioon, ainult lugemisega SQL-päringud ja regressioonitestid.

PR #1–#4 muudatused säilivad. Migratsioonid `001_base.js`, `002_v8.js` ja
`003_v8_lookup_indexes.js`, rakenduse serveri- ja kasutajaliidesefailid ning
sõltuvuste failid on alus-main'iga võrreldes muutmata.

## Kontroll 2026-11-05

Kogu `npm test` komplekt käivitati Node.js 24.22.1 ja MariaDB 11.4.13-ga,
ainult loopback-aadressidel ning sünteetiliste testandmetega. Postiühendused
olid testides keelatud. Paigaldus-, varundus- ja taastamiskatsed toimusid ainult
kohalikes testkaustades ja testandmebaasides.

**39 testi läbitud, 0 ebaõnnestunud, 0 vahele jäetud; väljumiskood 0.**

Komplekt hõlmab sisselogimist, kliendiotsingut ja kliendikaarti, tegevuste
töövooge, töörežiimide õigusi, skeemivõrdlust, muutmatut preflight'i,
varundamise ja taastamise tõkkeid, teadaoleva 52 veeruerinevusega sünteetilist
pärandskeemi, migratsiooni 004 andmete säilimist, negatiivsete/NULL/nullkuupäevade
tõkkeid ning mitterangest algrežiimist SESSION-režiimi lisamist ja taastamist.

Kõikide jälgitavate JavaScripti failide süntaksikontroll ja
`git diff --check` läbivad. Alus-main on uue haru esivanem.

Zone.ee tootmisserveriga ega pärisandmebaasiga ei ühendutud ning päris e-kirju
ei saadetud. PR-i ei ühendata automaatselt. Testide läbimine ei kinnita algse
tootmisrakenduse kohalike kohanduste, protsessiseadete või kõigi püsifailide
sobivust; esmakordse paigalduse inventuur ja lõpliku ühendatud SHA kontroll
jäävad vajalikuks.
