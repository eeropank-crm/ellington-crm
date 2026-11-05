# Ellington CRM v8 testkeskkond

Kõik hoolduskäsud lubavad ainult loopback-hostiga `ellington_dev` või
`ellington_test` andmebaase (lubatud ka alakriipsuga sufiks). Need ei ole tootmise
paigalduskäsud. Ära kasuta pärisandmeid ega SMTP/IMAP ligipääse.

1. Seadista kohalik MySQL/MariaDB, kasutaja õigused ja `.env` vastavalt `.env.example` failile.
2. Käivita `npm ci` ja `npm run db:migrate` (ka `node scripts/setup-crm.js` käivitab nüüd migratsioonid).
3. Käivita `npm run db:seed:test`. See lisab sünteetilise kliendi, kontakti, ajalookirje,
   kolm malli ja kaks kontot `example.invalid` domeenis. Korduskäivitus ei dubleeri neid.
   Kontodel on juhuslikud paroolid; avalikku vaikimisi parooli ei looda.
4. Loo **eraldi** `ellington_test` andmebaas ja käivita näiteks
   `DB_NAME=ellington_test DB_PORT=3307 npm test`. Testid vajavad kohalikku
   MariaDB/MySQL serverit ja muudavad selle sünteetilisi andmeid. Kasuta ainult
   testidele eraldatud andmebaasi. Testid lülitavad SMTP/IMAP seadistused välja.

Migratsioonid kasutavad Knexi migratsioonilukku ja versioonitabelit. Baasmigratsioon
sobib nii olemasoleva setup-crm skeemi kui ka tühja andmebaasiga. V8 migratsioon lisab
puuduvad veerud ja tabelid, laiendab malli pealkirja 500 ning kasutajanime 150 märgini.
MySQL DDL ei ole tehinguline: iga loomissamm kontrollib olemasolu, mistõttu pooleli
jäänud migratsiooni saab uuesti käivitada. Olemasolevate v8 tabelite suvalist vigast
skeemi see automaatselt ei paranda. Tagasipööramine toimub kontrollitud varukoopiast;
`down` keeldub andmeid kustutamast.

HTTP testid kasutavad loopback-päringul `X-Forwarded-Proto: https`, et kontrollida
rakenduse olemasolevat Secure-sessiooniküpsist. Brauseriga sisselogimine vajab HTTPS
pöördproksit; tootmise küpsise turvaseadistust ei lõdvendata.
