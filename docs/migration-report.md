# Ellington CRM v8 paranduste aruanne

Kuupäev: 05.11.2026. Lähtekood: `652ca0986f29fe6d65450843e4349408bfb1e389`.

## Kontrollitud lähteolukord

Kontrollisin ainult kohaliku `127.0.0.1:3306/ellington_dev` andmebaasi
`information_schema.columns` metadatat ning võrdlesin seda kõigi `server/routes`
failide ja `server/services/activity-workflow.js` päringutega. Olemas olid
`users`, `user_sessions`, `crm_clients`, `crm_contacts`, `crm_templates`,
`crm_activities`, `crm_activity_history`, `crm_budgets`.

Puudusid järgmised koodis kasutatud tabelid:

| Tabel | Kasutus |
| --- | --- |
| crm_imported_history | Kliendikaardi imporditud ajalugu |
| crm_activity_details | Eesmärk, juhis, pealkiri, mall ja järgmise sammu JSON |
| crm_v8_activity_events | Tegevuste tulemused ja töövoo audit |
| crm_v8_stop_reasons | Jälgimise lõpetamise põhjuste valik |
| crm_budget_change_log | Eelarve muutmise audit |
| crm_portfolio_transfers | Portfelli üleandmine |
| crm_portfolio_transfer_items | Üleantud klientide audit |
| crm_ionprint_sync_queue | Tulevase sünkroniseerimise järjekord |
| crm_email_outbox | Saatmisreservatsioon ja kirjaajalugu |
| crm_email_inbox | Vastused ning nende käsitlemine |

`crm_clients` tabelist puudusid `client_type`, `stop_reason`, `followup_count`,
`client_comment`, `our_comment`. `crm_templates` tabelist puudusid `purpose`,
`external_key`, `next_step_json`. Malli `subject` oli 255, kuid API lubab 500 märki;
`users.name` oli 100, kuid kasutajahalduse API lubab 150 märki.

## Parandused

Lisasin kaks versioonitud Knexi migratsiooni: senine baasskeem ning v8 täiendused.
Vana setup-käsk kasutab nüüd sama migratsioonirada. Olemasolevaid CRM-i andmeid ei
kustutata. Uued tabelid saavad päringutele vajalikud indeksid; tegevuse
saatmisreservatsioon on unikaalne ja inboxi sõnum on postkasti piires unikaalne.
JSON-tekstid jäävad TEXT-tüüpi, mida olemasolev kood parsib. Sündmuse activity_id
võib olla NULL, sest vastuse käsitlemine ei nõua alati seotud tegevust.

Lisasin kuus rakenduse vaikimisi lõpetamispõhjust, sünteetiliste andmete
korduskäivitatava looja, lokaalse andmebaasi kontrolli hoolduskäskudele,
DB_PORT seadistuse, `.env.example` faili ja testkeskkonna juhendi.
Sünteetilised kontod kasutavad `example.invalid` domeeni ning juhuslikke paroole.
Testide andmebaas on arendusandmebaasist eraldi, pordil 3307.

## Kontrollide tulemused

- Olemasoleva kaheksa tabeliga arendusskeemi täiendamine: edukas.
- Migratsioonid tühjal eraldatud MariaDB 11.4 andmebaasil: edukas.
- Korduskäivitus ja katkestatud DDL-i sammude uuestikäivitamise tee: edukas.
- Sünteetiliste andmete korduskäivitus ning olemasoleva kliendikirje säilimine: edukas.
- `DB_NAME=ellington_test DB_PORT=3307 npm test`: **6 läbitud, 0 ebaõnnestunud**.
- `git diff --check`: korras.

HTTP integratsioonitestid kontrollivad vale ja õiget parooli, Secure/HttpOnly
sessiooniküpsist, kaitstud lehti ja väljalogimist; otsingut ettevõtte ning kontakti
nime järgi; kliendikaardi kontakte ja imporditud ning lõpetatud tegevuste ajalugu;
kõne lõpetamise valideerimist ja korduspäringu idempotentsust; vaikimisi
järeltegevust ning selle asendamist kohtumisega; kohtumise tulemust, edasilükkamist
ja jälgimise lõpetamist; e-kirja lõpetamise ning saatmise keeldumist ilma
seadistuseta; eelarveauditit, kirjade ja vastuste lugemispäringuid, administraatori
õigusi, portfelli üleandmise auditit ja järjekorda ning omaniku muutmispiirangut.

## Piirid

Brauseri visuaalset kontrolli ei tehtud; HTML-lehtede ligipääsu kontrolliti HTTP-ga
ja töövooge API ning päris MariaDB kaudu. SMTP saatmist ja IMAP ühendust ei
käivitatud; tegelikku postivahetust ei valideeritud. Zone.ee tootmisserveri ega
pärisandmebaasiga ei ühendutud. Ionprinti järjekorra kirjed ei käivita ühendust.
Migratsioonide tagasipööramine nõuab varukoopiat, sest MySQL DDL ei ole
tehinguline. Suvalise eelnevalt loodud vigase v8 tabeli veerud vajavad eraldi
skeemivõrdlust; tuvastatud baasskeemi puudused on kaetud.
