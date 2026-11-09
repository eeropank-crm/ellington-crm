# Kliendinimi avab kliendikaardi

Töölaua tegevuste juures on kliendi nimi nüüd allajoonitud link. Sellele
vajutamine avab sama olemasoleva kliendikaardi nagu Kliendid → otsing → klient:
„Kliendi andmed” sisaldab follow-up'ide arvu ja „Varasemad tegevused” ajalugu.
„Ava tegevus” jääb praeguse ülesande avamiseks. Eraldi kliendikaardi nuppu ei
lisata; administraatori senine dubleeriv „Vaata kliendikaarti” nupp eemaldati.

Kasutatakse olemasolevat kliendikaardi laadimist ja serveri õiguste kontrolli.
Nimi jääb HTML-põgenetuks, link on klaviatuuriga aktiveeritav ja nähtava
fookusega. Salvestamise/saatmise ajal link ei navigeeri. Avatud kirjamustandi
olekut ei kustutata. Andmebaasi, migratsioone, sõltuvusi ega konfiguratsiooni
ei muudeta; tootmisse pole paigaldatud.

Chromiumis kohalike sünteetiliste andmetega kontrollitud: hiireklõps ja Enter,
sama kaart nagu otsingust, ajalugu ja loendur, poolelioleva mustandi säilimine,
administraatori teise omaniku kaart ainult vaatamiseks ning mobiil ilma
horisontaalse ülevooluta. Äriread jäid muutumatuks; 0 saatmispäringut ja 0
JavaScripti viga. JavaScripti süntaks ja git diff --check korras. Serveri
89 regressiooni selle kasutajaliidese navigatsioonimuudatuse pärast ei korratud.

- [Klikitav nimi töölaual](clickable-clients/dashboard.png)
- [Sama kliendikaart](clickable-clients/client-card.png)
- [Mobiilivaade](clickable-clients/mobile.png)
