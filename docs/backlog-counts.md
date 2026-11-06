# Töölaud: töölaual / järjekorras kokku

Tänaste tegevuste kaardi ja jaotise teine arv sisaldab nüüd kõiki tänase
kuupäevaga aktiivseid tegevusi **ning** sama kasutaja sobivaid planeerimist
ootavaid kliente. Näiteks 6 tänast tegevust + 23 planeerimata klienti annab
**6/29**, mitte 6/6. „Veel järjekorras” näitab kokkuarvust praegu kuvatavate
tegevuste mahaarvamist. Jaotises on ka eraldi tegevuste/klientide jaotus.

Hilinenud tegevused jäävad eraldi: nende teine arv sisaldab hilinenud tegevusi,
mitte sama planeerimata klientide järjekorda teist korda. Käibehoiatused jäävad
Ionprindi ühenduse ootele. Tulevase tähtajaga tegevusi, peatatud kliente,
käsitlemata vastustega kliente ja varasema suhtluseta uusi leade tänaste
tegevuste koguarvu ei lisata; sobivuse valik kasutab olemasolevat serveriloogikat.

Tavakasutaja näeb enda portfelli, administraator kasutajateülest ülevaadet.
Muudatus puudutab ainult kuvamist. API today.total jääb tänaste tegevuste arvuks;
kasutajaliides liidab sellele unplanned.total väärtuse. Päevavalik, kuue koha
piir, „Võta järgmised” käitumine, mallivalik, kliendiomanikud, tegevused,
followup_count ja ajalugu ei muutu. Uusi migratsioone ega seadistusi pole.

Chromiumis kontrollitud sünteetilise kohaliku MariaDB andmetega:
6/29 näit, 23 ootel klienti, eraldi 3/3 hilinenud tegevust, tulevaste/peatatud/
uute leadide väljajäämine, lehe värskendamine, kasutaja/administraatori vaade,
muutumatud kliendiandmed lugemisel ning ühe lõpetamise järel 5/28.
Mobiilis horisontaalset ülevoolu ega JavaScripti vigu ei olnud. E-kirju ei saadetud
ja tootmisega ei ühendutud. JavaScripti süntaks ja git diff --check korras.
Varasemat andmebaasi-/paigaldustestide komplekti selle kuvamismuudatuse pärast
ei korratud.

- [6/29 töölauavaade](backlog-counts/user.png)
- [Mobiilivaade](backlog-counts/mobile.png)
