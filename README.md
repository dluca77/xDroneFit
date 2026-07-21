# xDroneFit

xDroneFit is een Nederlandstalige webapp voor het voorbereiden van vastgoed-inpassingen in dronefoto's. De applicatie combineert een projectlocatie, situatietekening, DJI-fotometadata, handmatig gekoppelde referentiepunten en woningankers tot een export voor Blender.

> **Status: werkend prototype, nog geen productieklare landmeetkundige oplossing.**
>
> De huidige cameramatch gebruikt een vlakke homografie. De uitkomst kan bruikbaar en reproduceerbaar zijn wanneer de invoer zorgvuldig wordt geplaatst, maar is niet automatisch landmeetkundig gecertificeerd. Lees vooral [Betrouwbaarheid en nauwkeurigheid](#betrouwbaarheid-en-nauwkeurigheid) en [Bekende beperkingen](#bekende-beperkingen).

## Inhoud

- [Doel en afbakening](#doel-en-afbakening)
- [Huidige functies](#huidige-functies)
- [Volledige gebruikersworkflow](#volledige-gebruikersworkflow)
- [Benodigde invoer](#benodigde-invoer)
- [Rekenkundige werking](#rekenkundige-werking)
- [Betrouwbaarheid en nauwkeurigheid](#betrouwbaarheid-en-nauwkeurigheid)
- [Blender-koppeling](#blender-koppeling)
- [Gegevensopslag en API](#gegevensopslag-en-api)
- [Architectuur](#architectuur)
- [Belangrijkste ontwerpbeslissingen](#belangrijkste-ontwerpbeslissingen)
- [Bekende beperkingen](#bekende-beperkingen)
- [Ontwikkelen en testen](#ontwikkelen-en-testen)
- [Implementatieroadmap](#implementatieroadmap)
- [Acceptatiecriteria voor productie](#acceptatiecriteria-voor-productie)

## Doel en afbakening

### Doel

Het beoogde eindproces is:

1. een SX-project aanmaken;
2. de locatie in Nederland selecteren;
3. een situatietekening aan de kaart koppelen;
4. een originele DJI-JPEG uitlezen;
5. de waarschijnlijke dronepositie en kijkrichting controleren;
6. woningblokken op RD-coördinaten plaatsen;
7. vaste punten tussen kaart en dronefoto koppelen;
8. de camera wiskundig oplossen;
9. camera- en plaatsingsdata naar Blender exporteren;
10. in Blender de definitieve render en fotocompositie maken.

### Wat xDroneFit momenteel wel is

- Een projectomgeving voor één dronefoto per project.
- Een 2D-kaart- en beeldregistratietool.
- Een planar camera-matching prototype.
- Een generator van een versie-2 `*.dronefit.json`-export.
- Een eerste Blender-importscript voor camera en collectie-instances.

### Wat xDroneFit momenteel niet is

- Geen fotogrammetriepakket.
- Geen automatische 3D-scan van bestaande bebouwing.
- Geen vervanging voor landmeting, RTK, grondcontrolepunten of een gecertificeerde survey.
- Geen volledige Blender-pipeline die met één klik een afgewerkte compositie rendert.
- Geen automatische herkenning van woningen uit een PDF of `.blend`-bestand.
- Geen multi-photo bundle adjustment.

## Huidige functies

### Projectbeheer

- Nieuwe projecten met een unieke code in formaat `SX` plus minimaal vier cijfers.
- Bestaande projecten zoeken op SX-code of projectnaam.
- Automatisch opslaan na wijzigingen.
- Project verwijderen inclusief opgeslagen kaart- en fotovoorvertoning.
- Projectnaam is achteraf aanpasbaar.

### Kaart en locatie

- PDOK actuele hoge-resolutie-luchtfoto als standaardondergrond.
- PDOK Kadastrale Kaart als overlay.
- OpenStreetMap als alternatieve ondergrond.
- Adreszoeker via de PDOK Locatieserver.
- Handmatig klikken of slepen van het projectanker.
- Weergave van RD New-coördinaten.
- Afzonderlijke zichtbaarheid voor projectanker, situatiekaart, drone/kijksector, woningen en referentiepunten.
- Een permanent kaartlagenpaneel; een verborgen laag kan altijd opnieuw worden aangezet.

### Situatietekening

- Upload van een PDF.
- Alleen de eerste PDF-pagina wordt in de browser gerasterd naar PNG.
- Registratie met twee overeenkomstige punten: eerst op de tekening, daarna op de kaart.
- Automatische berekening van positie, uniforme schaal en rotatie.
- Handmatige nacorrectie van breedte, rotatie en dekking.
- Sleepbaar situatie-anker voor een kleine positiecorrectie.

### DJI-dronefoto

- Upload van een originele JPEG.
- Uitlezen van EXIF en DJI-XMP met `exifr` en aanvullende tekstparsing.
- Ondersteunde velden voor zover aanwezig:
  - GPS-breedte- en lengtegraad;
  - relatieve en absolute hoogte;
  - gimbal yaw, pitch en roll;
  - flight yaw;
  - brandpuntsafstand;
  - 35mm-equivalente brandpuntsafstand;
  - beeldbreedte en -hoogte;
  - cameramerk en -model;
  - opnametijd.
- Dronepositie en richtpunt kunnen direct op de kaart worden versleept.
- Kijkrichting, gimbal pitch en vlieghoogte zijn met slider én numerieke invoer aanpasbaar.

### Woningblokken

- Meerdere woningankers op de kaart plaatsen.
- Per anker een Blender-collectienaam, rotatie en peilhoogte vastleggen.
- Woninganker verslepen of verwijderen.
- De collectienaam moet exact overeenkomen met een bestaande Blender-collectie.

### Camera-match

- Kaartpunt plaatsen en aan hetzelfde pixelpunt in de dronefoto koppelen.
- Minimaal zes complete punten vereist.
- Invoer van een terrein-/NAP-peil per punt.
- Berekening van homografie, cameramatrix, camerapositie en reprojicatiefout.
- Kwaliteitsindicatie op basis van RMS-pixelfout:
  - `<= 4 px`: zeer sterke numerieke match;
  - `> 4 en <= 10 px`: bruikbaar, visueel controleren;
  - `> 10 px`: punten opnieuw controleren.
- Maximumfout per oplossing wordt eveneens gerapporteerd.

### Bedieningsfuncties

- Alle vijf linker onderdelen zijn afzonderlijk in- en uitklapbaar.
- Ingeklapte status wordt per project opgeslagen.
- Sliders hebben gekoppelde numerieke velden.
- `Ctrl+Z`/`Cmd+Z` en de knop **Ongedaan** herstellen de vorige projectwijziging.
- Undo bewaart maximaal 50 stappen binnen de huidige browsersessie.
- Geen redo en geen undo-geschiedenis na pagina verversen.
- Desktop- en mobiele layout.

## Volledige gebruikersworkflow

### 1. Project aanmaken

1. Open xDroneFit.
2. Vul een unieke SX-code in, bijvoorbeeld `SX26259`.
3. Vul de project-/locatienaam in.
4. Open het nieuwe project.

### 2. Projectlocatie vastleggen

1. Zoek op adres, postcode of plaats, of klik rechtstreeks op de kaart.
2. Controleer het projectanker in de PDOK-luchtfoto.
3. Bevestig de locatie.
4. Controleer waar mogelijk de getoonde RD New-coördinaten tegen bekende projectgegevens.

De projectlocatie wordt ook de lokale oorsprong voor de Blender-export. Hierdoor blijven Blender-coördinaten numeriek klein en hanteerbaar.

### 3. Situatie-PDF registreren

1. Upload de situatie-PDF.
2. Kies op de PDF een goed herkenbaar punt, bij voorkeur een harde hoek of grens.
3. Klik hetzelfde punt op de kaart.
4. Herhaal dit met een tweede punt dat zo ver mogelijk van het eerste punt ligt.
5. Controleer de berekende schaal, rotatie en positie.
6. Gebruik breedte, rotatie, dekking en het sleepanker alleen voor een kleine nacorrectie.

Gebruik geen twee punten die dicht bij elkaar liggen. De solver weigert een beeldafstand kleiner dan `0,03` van de genormaliseerde tekening of een kaartafstand kleiner dan `2 m`.

### 4. Originele DJI-JPEG uploaden

1. Gebruik het originele bestand rechtstreeks uit de drone; exporteer het niet eerst via Photoshop of een berichtenapp.
2. Controleer camera, GPS, hoogte, lens en gimbalgegevens.
3. Versleep de drone op de kaart als de GPS slechts een indicatie is.
4. Versleep het richtpunt of voer kijkrichting/pitch/hoogte exact in.

De handmatige kaartinstelling is een startschatting. De uiteindelijke planar camera-match wordt bepaald door de gekoppelde referentiepunten.

### 5. Woningankers plaatsen

1. Vul exact de Blender-collectienaam in.
2. Klik **Plaats woningblok** en plaats het anker op de kaart.
3. Stel de rotatie met de slider of numerieke invoer in.
4. Vul de gewenste peilhoogte in.
5. Herhaal dit per collectie-instance.

### 6. Referentiepunten koppelen

Kies minimaal zes vaste, goed zichtbare grondpunten, verspreid over het volledige beeld:

- links én rechts;
- voorgrond, middengebied en achtergrond;
- harde hoeken van bestrating, wegmarkeringen, putdeksels of erfgrenzen;
- bij voorkeur punten waarvan de werkelijke positie niet ambigu is.

Vermijd:

- dakhoeken bij een vlakke solver;
- bomen, schaduwranden, voertuigen en tijdelijke objecten;
- punten die bijna op één lijn liggen;
- meerdere punten in een klein deel van het beeld;
- punten met sterk verschillende hoogtes.

Werkwijze per punt:

1. klik **Voeg referentiepunt toe**;
2. klik het grondpunt op de kaart;
3. klik exact hetzelfde pixelpunt in de dronefoto;
4. voer het NAP-/terreinpeil in;
5. controleer na zes of meer punten de verdeling opnieuw.

### 7. Cameramatch berekenen

1. Klik **Bereken cameramatch**.
2. Beoordeel RMS én maximumfout.
3. Controleer niet alleen het getal: inspecteer de visuele overlay over het hele beeld.
4. Vervang slechte of ambigue punten en bereken opnieuw.

Een lage RMS-fout bewijst alleen dat de gekozen punten intern goed bij het model passen. Systematische fouten in kaartpunten, hoogtes, lensparameters of een ongeschikt vlak model kunnen nog steeds een verkeerde echte camera opleveren.

### 8. Exporteren naar Blender

1. Bereken eerst een geldige camera-oplossing.
2. Klik **Exporteer voor Blender** om een `*.dronefit.json` te downloaden.
3. Gebruik het huidige Blender-script volgens [Huidige tijdelijke Blender-werkwijze](#huidige-tijdelijke-blender-werkwijze).

## Benodigde invoer

### Minimaal voor een proefmatch

- projectcode en naam;
- projectlocatie;
- situatie-PDF;
- originele DJI-JPEG met lens- en afbeeldingsgegevens;
- minimaal zes gekoppelde referentiepunten;
- Blender-bestand met correct benoemde collecties.

### Sterk aanbevolen voor een betrouwbare productie-inpassing

- bekende RD New-coördinaten van meerdere vaste punten;
- gevalideerde NAP-/terreinpeilen;
- dronefoto zonder crop, resize of lenscorrectie achteraf;
- lenscalibratie/vervormingsprofiel van de daadwerkelijke camera;
- RTK- of landmeetkundige controlepunten;
- terreinmodel of 3D-punten wanneer het terrein niet vlak is;
- een onafhankelijk controlepunt dat niet voor de berekening wordt gebruikt.

### Geteste voorbeeldcamera

De aangeleverde voorbeeldfoto heeft:

- DJI cameramodel `FC9313`;
- resolutie `8192 x 6144 px`;
- werkelijke brandpuntsafstand rond `9 mm` volgens de oorspronkelijke metadataweergave;
- 35mm-equivalent rond `24 mm` volgens de metadataweergave.

Deze waarden zijn geen harde globale instelling: xDroneFit leest per geüploade foto wat werkelijk aanwezig is.

## Rekenkundige werking

### Coördinatenstelsels

- Foto-/GPS-invoer: WGS84, `EPSG:4326`.
- Nederlandse kaart- en exportpositie: RD New, `EPSG:28992`.
- Verticale referentie: NAP, door de gebruiker aangeleverd.
- Blender: lokale metrische coördinaten relatief aan het RD-punt van de projectlocatie.

De conversie tussen WGS84 en RD New gebruikt `proj4` met een expliciete RD New stereografische projectiedefinitie en Bessel-ellipsoïde/transformatieparameters.

### Registratie van de situatiekaart

De PDF-punten worden opgeslagen als genormaliseerde beeldcoördinaten tussen `0` en `1`. De twee overeenkomstige kaartpunten worden naar RD New geconverteerd. Uit de twee vectoren berekent de solver:

1. de afstand op de kaart;
2. de afstand als fractie van de PDF-breedte;
3. de uniforme schaal/tekeningbreedte in meters;
4. het verschil tussen kaartbearing en tekeningbearing;
5. het midden van de tekening.

Dit is een 2D-similarityregistratie: translatie, uniforme schaal en rotatie. Er wordt geen perspectief-, affine- of rubber-sheet-vervorming van de tekening opgelost.

### Planar homography voor de camera

De huidige solver gaat ervan uit dat alle gebruikte referentiepunten op één horizontaal vlak liggen. De RD-coördinaten worden lokaal gemaakt door de project-RD-oorsprong af te trekken. Met minimaal zes puntparen wordt via lineaire least squares een `3 x 3` homografie berekend.

De interne cameraparameters worden geschat met:

- hoofd-/principal point in het midden van de foto;
- vierkante pixels (`fx = fy`);
- geen skew;
- horizontale brandpuntsafstand uit 35mm-equivalent en beeldbreedte;
- geschatte sensorbreedte: `focalLengthMm * 36 / focalLength35mm`.

Vervolgens wordt de homografie met de inverse intrinsieke matrix ontbonden naar:

- rotatie wereld-naar-camera;
- translatie wereld-naar-camera;
- lokale en absolute RD-camerapositie;
- camerahoogte boven het gemiddelde ingevoerde grondpeil.

De rotatie-assen worden genormaliseerd en georthogonaliseerd. Wanneer de berekende camera onder het vlak uitkomt, wordt het fysiek plausibele teken gekozen.

### Reprojicatiefout

Elk kaartpunt wordt met de gevonden homografie terug naar de foto geprojecteerd. xDroneFit bewaart:

- fout per punt in pixels;
- RMS-fout over alle punten;
- maximale individuele fout.

De tests reconstrueren een bekende synthetische camera en verwachten daarbij een RMS-fout kleiner dan `0,001 px` en een camerapositiefout kleiner dan `0,002 m`. Dit bewijst de algebra op ideale synthetische data; het zegt niet dat echte handmatig gekozen data dezelfde nauwkeurigheid haalt.

## Betrouwbaarheid en nauwkeurigheid

### Wat de foutscore betekent

| Score | Betekenis in de huidige interface | Vereiste actie |
| --- | --- | --- |
| RMS `<= 4 px` | Zeer sterke interne match | Toch over het volledige beeld en met onafhankelijke punten controleren |
| RMS `4-10 px` | Mogelijk bruikbaar | Puntselectie, hoogte en overlay zorgvuldig controleren |
| RMS `> 10 px` | Onvoldoende | Slechte punten vervangen en opnieuw oplossen |

### Wat de foutscore niet bewijst

Een lage pixelfout garandeert niet automatisch:

- correcte absolute RD-/NAP-positie;
- correcte lensvervorming;
- correcte schaal buiten het referentievlak;
- correcte aansluiting op daken of terrein met hoogteverschillen;
- centimeter- of decimeternauwkeurigheid;
- juridisch/landmeetkundig bruikbare plaatsing.

### Huidige vlakheidscontrole

De solver berekent het verschil tussen de hoogste en laagste ingevoerde referentiepunthoogte. Bij een verschil groter dan `0,25 m` weigert hij de oplossing. Dat voorkomt een deel van het verkeerd gebruik, maar maakt een terrein niet automatisch werkelijk vlak.

### Aanbevolen kwaliteitscontrole

1. Gebruik meer dan zes punten, breed verdeeld.
2. Houd ten minste één controlepunt buiten de solve-set.
3. Vergelijk daar de pixel- en wereldafwijking.
4. Controleer verticale lijnen, dakranden en wegvlakken in Blender.
5. Controleer schaduw, horizon en occlusie afzonderlijk; die worden niet door de huidige solve bepaald.
6. Laat productiebeelden met hoge financiële/juridische impact controleren door iemand met camera-match- en landmeetkundige expertise.

## Blender-koppeling

### JSON-export versie 2

De export gebruikt schema `nl.xdronefit.project`, versie `2`, en bevat:

- projectcode, naam en exporttijd;
- CRS-beschrijving;
- projectlocatie in WGS84 en RD New;
- situatiekaartregistratie;
- DJI-foto- en lensmetadata;
- woningblokken in WGS84 en RD New;
- referentiepunten inclusief foto- en RD-coördinaten;
- volledige camera-oplossing;
- kwaliteitsgegevens.

De lokale Blender-oorsprong is `site.rd`. Voor een woning geldt:

- Blender X = `woning RD X - oorsprong RD X`;
- Blender Y = `woning RD Y - oorsprong RD Y`;
- Blender Z = ingevoerd peil/hoogte.

### Wat het huidige script importeert

- Een cameraobject met naam `xDroneFit Camera`.
- Metrische scene units.
- Camera-rotatie en lokale camerapositie.
- Werkelijke brandpuntsafstand en geschatte sensorbreedte.
- Renderresolutie gelijk aan de originele fotoresolutie.
- PNG-output met transparante film.
- `scene['xDroneFit_RD_origin']` met de RD-oorsprong.
- Collection instances voor gevonden woningcollecties.

### Huidige tijdelijke Blender-werkwijze

> **Bekend probleem:** de huidige knop downloadt een los `xdronefit_blender_import.py` zonder `bl_info` en zonder Blender-extensionmanifest. Het is daarom geen correct installeerbare Blender 4.2+-add-on. De tekst in de interface die verwijst naar **Install from Disk** is op dit moment onjuist.

Tijdelijk uitvoeren:

1. Open Blender.
2. Open de werkruimte **Scripting**.
3. Kies in de Text Editor **Open**.
4. Selecteer `xdronefit_blender_import.py`.
5. Kies **Run Script** of druk `Alt+P`.
6. Open **File > Import > xDroneFit project (.json)**.
7. Selecteer de geëxporteerde `*.dronefit.json`.

Deze registratie geldt alleen voor de huidige Blender-sessie.

### Vereisten aan het `.blend`-bestand

- Scene units moeten uiteindelijk metrisch zijn; de importer zet dit ook in.
- Elke gebruikte `typeName` moet exact als Blender-collectienaam bestaan.
- Het logische collectie-anker/origin moet vooraf consistent zijn bepaald.
- Modellen moeten op ware schaal zijn.
- Z-richting is omhoog.
- Materiaal, belichting, bestaande omgeving en render-engine worden niet door xDroneFit beheerd.

### Nog niet door de Blender-koppeling uitgevoerd

- Geen echte installeerbare `.zip`-extension.
- Geen automatische selectie of inlading van de originele drone-JPEG.
- Geen camera background image.
- Geen compositor-nodeopbouw.
- Geen automatische schaduw-/shadow-catcher.
- Geen bestaande 3D-omgeving, BAG-gebouwen of AHN-terrein.
- Geen automatische occlusiemaskers.
- Geen lensdistortion nodes of ST-map.
- Geen kleurmatching, atmosfeer of lichtmatching.
- Geen controle of ontbrekende collecties foutloos zijn geplaatst; niet gevonden collecties worden nu overgeslagen.
- Geen één-klik eindrender.

## Gegevensopslag en API

### Cloudflare D1

Projectrecords staan in tabel `projects`:

| Veld | Functie |
| --- | --- |
| `id` | UUID, primaire sleutel |
| `code` | Unieke SX-code |
| `name` | Projectnaam |
| `state_json` | Volledige bewerkbare projectstatus als JSON |
| `created_at` | ISO-aanmaaktijd |
| `updated_at` | ISO-laatste wijziging |

### Cloudflare R2

Per project worden maximaal twee afgeleide assets opgeslagen:

- `projects/{id}/drawing.png` — gerasterde eerste PDF-pagina;
- `projects/{id}/photo.jpg` — verkleinde JPEG-voorvertoning.

De originele PDF en de volledige originele JPEG worden momenteel niet als origineel bestand in R2 bewaard. De foto wordt client-side verkleind tot maximaal `2400 px` breed en als JPEG-kwaliteit `0,9` opgeslagen. De originele dimensies en metadata blijven wel in de projectstatus staan.

### API-routes

| Route | Methode | Functie |
| --- | --- | --- |
| `/api/projects` | `GET` | Projectlijst, nieuwste eerst |
| `/api/projects` | `POST` | Project aanmaken en SX-code valideren |
| `/api/projects/{id}` | `GET` | Eén project ophalen |
| `/api/projects/{id}` | `PUT` | Projectnaam, code en status opslaan |
| `/api/projects/{id}` | `DELETE` | Project en R2-assets verwijderen |
| `/api/projects/{id}/assets/{drawing|photo}` | `GET` | Afgeleide asset ophalen |
| `/api/projects/{id}/assets/{drawing|photo}` | `PUT` | Afgeleide asset opslaan |

### Toegang en privacy

- De huidige productieomgeving wordt als private Sites-deployment gebruikt.
- De applicatie bevat zelf nog geen rollen-, projectleden- of objectniveau-autorisatie.
- De API vertrouwt op de toegangsbeveiliging van het hostingplatform.
- Maak de site niet publiek zolang projectlocaties en beelden niet voor openbare distributie zijn goedgekeurd.
- Geheimen, originele projectbestanden en tijdelijke build-archieven horen niet in Git.

## Architectuur

### Technologie

- React 19.
- Next.js 16 API-/app-structuur.
- vinext + Vite voor Cloudflare Workers/Sites.
- TypeScript.
- Leaflet voor de kaart.
- PDOK WMS en Locatieserver.
- `proj4` voor WGS84/RD New.
- `pdfjs-dist` voor client-side PDF-rendering.
- `exifr` voor EXIF/XMP.
- Cloudflare D1 voor records.
- Cloudflare R2 voor afbeeldingsvoorvertoningen.
- Drizzle voor schema/migratiebeheer.

### Belangrijkste bestanden

| Bestand | Verantwoordelijkheid |
| --- | --- |
| `app/ProjectPortal.tsx` | Homepage, project maken/openen/verwijderen |
| `app/DroneFitApp.tsx` | Volledige projectworkflow, kaart, uploads, UI en export |
| `app/cameraMath.ts` | RD-conversie, situatie-registratie en camera-solver |
| `app/api/projects/route.ts` | Projectlijst en aanmaken |
| `app/api/projects/[id]/route.ts` | Project lezen, opslaan en verwijderen |
| `app/api/projects/[id]/assets/[kind]/route.ts` | R2-assetopslag |
| `db/schema.ts` | D1/Drizzle-projectschema |
| `drizzle/0000_projects.sql` | Eerste database-migratie |
| `tests/camera-math.test.mjs` | Synthetische rekentests |
| `app/globals.css` | Huisstijl, responsive layout en bediening |
| `.openai/hosting.json` | Sites-project en logische D1/R2-bindings |

### Projectstatus

De projectstatus omvat onder meer:

- projectnaam en projectlocatie;
- status van locatiebevestiging;
- situatiekaartnaam, aspectratio, positie, schaal, rotatie en dekking;
- situatiecontrolepunten;
- DJI-metadata;
- woningankers;
- cameracontrolepunten;
- camera-oplossing;
- laagzichtbaarheid;
- ingeklapte UI-stappen.

## Belangrijkste ontwerpbeslissingen

Deze lijst beschrijft de beslissingen die tot en met de huidige prototypeversie bewust zijn genomen.

| Beslissing | Reden | Consequentie |
| --- | --- | --- |
| Alle tools dragen een naam die met `x` begint; productnaam `xDroneFit` | Aansluiting op Studio-X productfamilie | Naam en visuele identiteit consequent behouden |
| Nederlands als primaire interfacetaal | Gebruikers en projectworkflow zijn Nederlandstalig | Technische exports gebruiken waar nuttig Engelse veldnamen |
| SX-code als unieke projectsleutel voor gebruikers | Aansluiting op bestaande projectmappen | Database gebruikt intern daarnaast een UUID |
| PDOK als primaire Nederlandse kaartbron | Luchtfoto, kadaster en adressen passen bij NL-vastgoed | Externe beschikbaarheid en kaartvoorwaarden blijven afhankelijkheid |
| RD New als horizontaal werkstelsel | Praktische Nederlandse vastgoedcoördinaten | WGS84 wordt bij invoer/export expliciet geconverteerd |
| NAP door gebruiker laten invoeren | DJI-hoogte en kaartdata zijn niet automatisch hetzelfde verticale datum | Hoogtekwaliteit is verantwoordelijkheid van invoer en latere validatie |
| Lokaal Blender-nulpunt op projectlocatie | Voorkomt zeer grote scene-coördinaten | Absolute RD-oorsprong moet als metadata bewaard blijven |
| Twee punten voor situatiekaart | Snelle minimale bediening | Corrigeert geen PDF-vervorming; goede puntspreiding noodzakelijk |
| Handmatige correctie na automatische situatie-registratie | Praktische tekeningen zijn niet altijd schoon/gegeorefereerd | Resultaat moet visueel worden gecontroleerd |
| DJI-metadata als beginschatting, niet als eindmatch | GPS/gimbal is nuttig maar niet exact genoeg voor perfecte compositie | Referentiepunten blijven noodzakelijk |
| Minimaal zes camerareferentiepunten | Overbepaalde homografie en foutcontrole | Punten moeten breed en zorgvuldig worden verdeeld |
| Eerste solver is planair | Eenvoudig, uitlegbaar en testbaar MVP | Alleen geschikt voor vrijwel vlakke grondpunten |
| Hoogtespreiding groter dan `0,25 m` blokkeren | Verkeerd gebruik van planar solver beperken | Voor echte 3D-variatie is een volgende solver vereist |
| RMS en maximumfout tonen | Transparante kwaliteitscontrole | Lage fout mag niet worden verward met absolute survey-nauwkeurigheid |
| Collectienamen koppelen aan woningtypen | Eenvoudige integratie met bestaande `.blend`-bibliotheken | Exacte naamgeving en originconventie zijn vereist |
| Originele resolutie in Blender-renderinstellingen | Pixel-op-pixel compositie mogelijk maken | Rendering kan zwaar zijn bij `8192 x 6144` |
| Foto/PDF alleen als verkleinde/gerasterde preview opslaan | Snellere webweergave en lagere opslag | Originele bestanden moeten elders goed beheerd blijven |
| Automatisch opslaan met korte vertraging | Minder kans op verloren werk | Er is nog geen formele versiehistorie of conflictbehandeling |
| Undo alleen in huidige sessie, maximaal 50 stappen | Veilige, lichte correctie van invoer | Geen persistente audit trail en geen redo |
| Permanente kaartlagenbediening | Verborgen laag moet altijd opnieuw zichtbaar kunnen worden | Paneel blijft onafhankelijk van de linker kaarten |
| Inklapbare linker stappen | Meer kaart- en werkruimte op desktop en mobiel | Inklapstatus wordt per project opgeslagen |
| Private repository en private deployment | Projectdata en eigen rekenlogica beschermen tijdens ontwikkeling | Publicatie vereist later een bewuste securityreview |

## Bekende beperkingen

### Rekenkundig

1. Alleen vlakke homografie; geen volledige 3D-PnP/bundle adjustment.
2. Geen modellering of correctie van radiale/tangentiële lensvervorming.
3. Principal point wordt als exact beeldmidden aangenomen.
4. `fx = fy`; pixels worden vierkant aangenomen.
5. Sensorbreedte wordt uit 35mm-equivalent geschat.
6. Geen onzekerheidsinterval of covariance op de oplossing.
7. Geen robuuste outlierdetectie zoals RANSAC.
8. Geen apart onafhankelijke controlepuntworkflow.
9. Geen automatische correctie voor rolling shutter.
10. Geen controle op crop of nabewerking van de geüploade foto.

### Kaart en situatie

1. De kaart is 2D; BAG/AHN/3D-gebouwen zijn nog niet aangesloten.
2. De homepage noemt 3D BAG/AHN als beoogde bronnen, maar de projectsolver gebruikt ze nog niet.
3. Alleen PDF-pagina 1 wordt gebruikt.
4. PDF-overlay ondersteunt positie, uniforme schaal, rotatie en transparantie; geen vervormingsgrid.
5. Kadastrale grenzen zijn visuele referentie, niet automatisch een juridisch maatvaste projectbasis.

### Dronefoto

1. Eén foto per project.
2. Alleen JPEG-upload.
3. Metadata kan ontbreken of door software zijn gewijzigd.
4. De opgeslagen R2-foto is een preview, niet het originele bestand.
5. DPI (`96 x 96` of anders) is voor deze pixelgeometrie niet leidend; pixelafmetingen en lensparameters zijn relevant.

### Blender

1. De huidige `.py` is geen correct installeerbare add-on/extension.
2. Geen automatische originele foto, compositor of eindrender.
3. Geen 3D-omgeving of automatische occlusie.
4. Geen schaduw-, licht- of kleurmatching.
5. Geen controle op object-origin en modeloriëntatie.
6. Ontbrekende collecties worden niet duidelijk als harde importfout gerapporteerd.

### Product en beveiliging

1. Geen app-eigen gebruikersrollen of projectrechten.
2. Geen projectauditlog of persistente versiehistorie.
3. Geen gelijktijdige bewerkings-/conflictoplossing.
4. Geen formele backup-/restore-interface.
5. Undo is niet persistent en heeft geen redo.
6. Automatische opslag meldt wel succes/mislukking, maar heeft nog geen offline queue.

## Ontwikkelen en testen

### Vereisten

- Node.js `>= 22.13.0`.
- npm (lockfile aanwezig) of de binnen het project gekozen package manager consequent gebruiken.
- Voor volledige lokale D1/R2-functionaliteit: Cloudflare/vinext-omgeving volgens de projectconfiguratie.

### Installatie

```bash
npm install
npm run dev
```

### Productiebouw

```bash
npm run build
```

### Rekentests

```bash
node --experimental-strip-types --test tests/camera-math.test.mjs
```

De huidige rekentests controleren:

- herstel van positie, schaal en rotatie van een bekende situatiekaart;
- herstel van een bekende synthetische planar camerapositie met zes punten.

### Overige scripts

```bash
npm run lint
npm test
npm run db:generate
```

Controleer bij wijzigingen altijd minimaal:

1. `npm run build`;
2. `tests/camera-math.test.mjs`;
3. project aanmaken/openen/verwijderen;
4. PDF-upload en tweepuntsregistratie;
5. DJI-upload en metadataweergave;
6. slider én numerieke invoer;
7. inklappen/uitklappen;
8. laag uit- en opnieuw aanzetten;
9. Ctrl+Z na een numerieke en kaartwijziging;
10. JSON-export en Blender-import.

## Implementatieroadmap

### Prioriteit 1 — Blender-koppeling herstellen

- Echte Blender 4.2+-extension als `.zip` met `blender_manifest.toml` en `__init__.py`.
- Correcte installatie via **Install from Disk**.
- Add-onpaneel met versie en projectimport.
- Duidelijke foutmelding voor ontbrekende collecties.
- Originele dronefoto selecteren en als camerabackground/compositorbron instellen.
- Renderresolutie, transparantie, output en kleurbeheer controleerbaar instellen.

### Prioriteit 2 — Volledige 3D-camera-oplossing

- 3D-referentiepunten met RD X/Y en NAP Z.
- Perspective-n-Point/nonlinear optimization in plaats van alleen homografie.
- Lensdistortionparameters.
- Robuuste outlierdetectie.
- Onafhankelijke controlepunten.
- Onzekerheids-/kwaliteitsrapport per project.

### Prioriteit 3 — Omgevingsmodel

- BAG 3D voor bestaande gebouwen.
- AHN/DTM/DSM voor terrein en hoogte.
- Wireframe-overlay van bestaande bebouwing op de dronefoto.
- Zichtbaarheid/occlusie in Blender.
- Duidelijke bron-, datum- en nauwkeurigheidsmetadata.

### Prioriteit 4 — Eén-klik renderflow

- `.blend`-bestand of assetbibliotheek betrouwbaar koppelen.
- Collecties en origins valideren.
- Automatische camera, achtergrond, compositor en shadow catcher.
- Renderenginepreset.
- Previewrender terugkoppelen aan xDroneFit.
- Visuele kwaliteitscontrole vóór definitieve export.

### Prioriteit 5 — Productie en beheer

- Rollen en projecttoegang.
- Persistente revisiehistorie met undo/redo.
- Backups en herstel.
- Uploadlimieten en bestandsvalidatie.
- Monitoring en foutregistratie.
- Privacy-, bewaartermijn- en verwijderbeleid.

## Acceptatiecriteria voor productie

xDroneFit mag pas als “perfecte automatische inpassing” worden gepresenteerd wanneer minimaal is aangetoond dat:

1. de Blender-add-on normaal installeert in de ondersteunde Blender-versies;
2. een volledig project zonder handmatige Python-stappen kan worden geïmporteerd;
3. originele foto, camera, model, terrein en compositor correct worden gekoppeld;
4. een 3D-solver hoogteverschillen ondersteunt;
5. lensvervorming wordt gekalibreerd of aantoonbaar verwaarloosbaar is;
6. onafhankelijke controlepunten een vooraf vastgelegde tolerantie halen;
7. resultaten op meerdere echte projecten reproduceerbaar zijn;
8. fouten en ontbrekende gegevens expliciet worden geblokkeerd;
9. projectdata afdoende is beveiligd;
10. een mens het resultaat vóór de eindrender kan controleren en corrigeren.

## Deployment en repository

- GitHub: private repository `dluca77/xDroneFit`.
- Standaardbranch: `main`.
- Hosting: private OpenAI Sites/Cloudflare deployment.
- Logische bindings:
  - D1: `DB`;
  - R2: `STORAGE`.

Zet nooit tijdelijke `*.tar.gz`-deployarchives, originele klantbestanden, lokale databases, tokens of `.env`-geheimen in Git.

## Begrippen

| Begrip | Betekenis |
| --- | --- |
| WGS84 | Wereldwijd GPS-coördinatenstelsel, lengte-/breedtegraad |
| RD New | Nederlands horizontaal coördinatenstelsel, EPSG:28992 |
| NAP | Nederlandse verticale hoogtereferentie |
| EXIF/XMP | Metadata in of naast het fotobestand |
| Homografie | Projectieve transformatie tussen één vlak en de foto |
| Principal point | Optisch hoofdpunt in de foto; nu als beeldmidden aangenomen |
| Reprojicatiefout | Pixelafstand tussen gemeten en teruggerekend fotopunt |
| RMS | Wortel van gemiddelde gekwadrateerde fout |
| Camera pose | Positie en oriëntatie van de camera |
| Local origin | Project-RD-punt dat in Blender als `(0, 0)` wordt gebruikt |

---

Laatst inhoudelijk bijgewerkt: **20 juli 2026**. Werk deze README bij bij iedere wijziging aan invoer, rekenmodel, opslag, exportformaat, Blender-integratie, kwaliteitsdrempel of belangrijke productbeslissing.
