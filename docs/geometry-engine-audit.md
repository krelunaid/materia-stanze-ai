# Materia — Geometry Engine V2: audit del repository

Data audit: 2026-08-26 (Europe/Rome)

Repository: `krelunaid/materia-stanze-ai`

Branch: `main`
Commit analizzato: `34ee1856bef96dcc8fbada84fdf4365bf95feda3` (`Riconosci superfici dopo lo svuotamento`)

## 1. Esito esecutivo

La Milestone 0 è completata come audit, non come correzione funzionale. L'applicazione è compilabile per web e iOS, i test esistenti passano e il flusso Foto → Prepara → Prodotti → Render è presente. Tuttavia il motore attuale non è ancora un Geometry Engine affidabile: mantiene poligoni 2D normalizzati solo nello stato React, non possiede un modello di stanza persistente/versionato, non misura la qualità geometrica e permette alla fotografia generata dall'IA di produrre una nuova interpretazione delle superfici dopo “Svuota la stanza”.

Il punto più critico è stato individuato con precisione: `RoomStudio.emptyRoom()` invia la foto a `/api/empty-room`, accetta l'immagine generata tramite una debole similarità fotografica e poi richiama `detectSurfacesForPreview()` sull'immagine generata; il risultato viene passato a `mergeDetectedSurfaces()` e diventa la geometria elaborata. In questo modo l'IA generativa può indirettamente cambiare muri, pavimento, porte e finestre.

Conclusione: la base applicativa può essere riusata, ma la geometria deve diventare un dominio indipendente, persistente, validato e immutabile rispetto alle elaborazioni grafiche.

## 2. Architettura rilevata

### 2.1 Piattaforme e runtime

- Web: React 19.2.6, Next 16.2.6 con Vinext 1.0.0-beta.3 e Vite 8.0.13.
- Hosting/API: build Vinext su Cloudflare/OpenAI Sites; sei route server nello stesso repository.
- iOS/iPadOS: wrapper Capacitor 8.5.0 con `webDir: dist-native`; l'interfaccia nativa carica lo stesso componente React della versione web.
- Entry web: `app/page.tsx` → `RoomStudio`.
- Entry nativo: `native/main.tsx` → `RoomStudio`.
- Entry iOS: `SceneDelegate.swift` crea un `CAPBridgeViewController`.
- Non risultano moduli Android.

### 2.2 Componenti principali

- `app/components/room-studio.tsx`: componente monolitico che gestisce importazione, geometria, editor, IA, prodotti, Freeze e render.
- `app/domain/editor.ts`: tipi `Point`, `Surface`, validazione minima del poligono, spostamento vertici e nomi.
- `app/server/ai-provider.ts`: provider xAI/OpenAI, ricerca web dei materiali, riconoscimento superfici e generazione immagini.
- `app/lib/file-validation.ts`: validazione client dei file immagine, massimo 20 MB.
- `app/api/*/route.ts`: interfacce HTTP del client.
- `app/projects/page.tsx`: pagina illustrativa; non legge né salva progetti.
- `capacitor.config.ts`, `native/main.tsx`, `ios/App`: involucro iOS.

### 2.3 Flusso applicativo attuale

```text
Foto JPG/PNG/HEIC
  → validazione e object URL locale
  → riduzione JPEG (lato client, massimo 1024 px)
  → POST /api/detect-surfaces
  → due analisi vision parallele + eventuale recovery
  → euristiche di normalizzazione/riconciliazione
  → Surface[] nello stato React
  → correzione manuale / Freeze / materiale
  → POST /api/empty-room o /api/apply-product o /api/render-room
  → immagine generata
  → ripristino client dei soli poligoni Freeze
  → anteprima elaborata in memoria
```

I quattro passaggi visibili sono implementati nello stesso componente:

1. Foto: importazione foto o planimetria raster.
2. Prepara: riconoscimento, correzione vertici, aggiunta superfici, Freeze e stanza vuota.
3. Prodotti: catalogo locale, campione caricato, colore e ricerca online verificata.
4. Render: richiesta generativa con materiali/arredi/richieste testuali.

## 3. Modello dati e coordinate

### 3.1 Modello corrente

`Surface` contiene:

- `id`, `name`, `kind`;
- `points: {x, y}[]`;
- `frozen`;
- `materialId` opzionale.

Le coordinate sono normalizzate nello spazio immagine: origine in alto a sinistra, `x` e `y` tra 0 e 1. La visualizzazione SVG converte lo spazio in `1000 × 625`; canvas e maschere riconvertono i valori normalizzati nelle dimensioni dell'immagine di lavoro.

Mancano nel modello persistente:

- versione dello schema e della geometria;
- sorgente (`AI`, manuale, LiDAR, planimetria, importazione);
- confidenza per superficie e vertice;
- identificatori stabili di parete/piano/apertura;
- relazioni topologiche e adiacenze;
- visibilità, occlusione, stato proposto/approvato;
- coordinate pixel originali, coordinate metriche e trasformazioni;
- camera, intrinseche, profondità, piani 3D e scala reale;
- timestamp, autore, cronologia persistente e checksum dell'immagine.

`DetectedRoomSurface` contiene una confidenza temporanea, ma la conversione in `Surface` la elimina. L'app non può quindi spiegare o rivalutare in seguito una selezione incerta.

### 3.2 Validazione corrente

`isValidPolygon()` controlla solamente almeno tre vertici e area assoluta maggiore di `0.0005`. Non controlla:

- valori non finiti;
- vertici duplicati o lati quasi nulli;
- auto-intersezioni;
- winding coerente;
- poligoni fuori immagine prima del clamp;
- coerenza parete-pavimento-soffitto;
- aperture contenute nella parete;
- sovrapposizioni o buchi topologici.

L'undo/redo conserva al massimo 40 copie di `Surface[]`, solo durante la sessione.

### 3.3 Originale e stanza vuota

Non esiste un unico `RoomGeometry` approvato. Esistono:

- `surfaces` nello stato React;
- `originalSurfacesRef` per la foto originale;
- `processedSurfacesRef` per la foto elaborata;
- `processedPreview` come data URL/blob URL.

I due insiemi possono divergere e non hanno versione, validazione condivisa o persistenza. Ricaricare la pagina o terminare l'app perde tutto.

## 4. IA, API e punto di mutazione geometrica

### 4.1 Provider

- Provider prioritario: xAI tramite `AI_PROVIDER` e `XAI_API_KEY` server-side.
- Vision e ricerca: `grok-4.6`.
- Editing immagini: `grok-imagine-image-2.0`.
- Fallback configurabile: OpenAI (`gpt-5.4-mini`, `gpt-image-2`).
- La chiave non viene incorporata nel bundle client.

### 4.2 API esposte

| Route | Funzione | Limiti/gestione corrente |
|---|---|---|
| `/api/capabilities` | stato del provider | timeout client 10 s |
| `/api/detect-surfaces` | segmentazione architettonica | JPG/PNG, 20 MB; due richieste da 50 s, recovery 35 s |
| `/api/empty-room` | rimozione oggetti | 20 MB; timeout client 180 s |
| `/api/apply-product` | applicazione su una superficie | foto + maschera PNG; timeout client 180 s |
| `/api/render-room` | render finale | foto + maschera + richieste; timeout client 240 s |
| `/api/search-products` | ricerca web di prodotti | query max 300 caratteri; risultati normalizzati |

Le route consentono CORS `*`. Non risultano rate limiting, coda lavori, idempotenza, progress tracking, retry server coordinato o storage dei job. Le chiamate vision hanno `AbortController` server-side; ricerca prodotti, image edit e download immagini remote non hanno un timeout server esplicito. Il client ha timeout, ma il lavoro remoto può proseguire o occupare risorse dopo l'abbandono della richiesta.

### 4.3 Mutazione vietata individuata

Sequenza attuale di “Svuota la stanza”:

1. La geometria corrente diventa `baselineSurfaces`.
2. L'endpoint genera una nuova fotografia. Con Grok la maschera tecnica viene deliberatamente omessa (`mask: null`) per evitare ricomposizioni multi-immagine.
3. `protectAiResult()` ricopia dall'originale soltanto le superfici Freeze.
4. `framingSimilarity()` confronta miniature RGB `96 × 64` e accetta una soglia `0.64`; non misura registrazione, bordi o geometria.
5. `detectSurfacesForPreview()` rianalizza l'immagine generata.
6. `mergeDetectedSurfaces()` sostituisce/integra la geometria elaborata.

Questo è il punto nel quale una generazione IA può modificare indirettamente la geometria. Va rimosso dal flusso definitivo: “stanza vuota”, materiali e render devono essere consumatori di una geometria approvata, mai produttori di una nuova verità geometrica.

### 4.4 Freeze e fedeltà pixel

Freeze non protegge l'intera struttura: protegge soltanto i pixel dentro i poligoni marcati. Il risultato viene ricomposto su un canvas con lato massimo 1536 px, quindi non esiste una garanzia di identità all'immagine originale alla risoluzione nativa. Il render finale non applica nemmeno il controllo `framingSimilarity()` usato dalla stanza vuota.

“Preserva geometria” è oggi un'istruzione nel prompt, non un'invariante verificata dal software.

## 5. Materiali, misure e render

- La ricerca online usa la web search del provider e filtra fonti/URL/confidenza; non esiste un database materiali proprietario o una cache persistente.
- Il catalogo locale è statico e in-memory.
- Non esiste un motore di quantità: niente lunghezze, aree metriche, sfrido, confezioni o preventivi.
- Non esiste calibrazione metrica, omografia di piano, UV mapping o posa deterministica.
- “Scala reale”, fughe e direzione di posa sono richieste testuali al modello generativo, non calcoli geometrici.
- L'applicazione di un prodotto a una singola superficie usa una maschera ed è più confinata del render globale, ma manca un controllo pixel-diff automatico fuori maschera.
- Il render finale è generativo e non può garantire fedeltà geometrica senza registrazione e validazione indipendenti.

## 6. Persistenza, database e offline

Non sono stati trovati `localStorage`, `sessionStorage`, IndexedDB, SQLite, D1, R2 o un database remoto. Foto, blob, poligoni, materiali e cronologia vivono nella memoria della schermata. La pagina Progetti non elenca dati reali.

Offline l'app può inserire una tracciatura guidata locale se l'IA non risponde, ma non offre:

- salvataggio/ripristino del progetto;
- coda delle operazioni;
- ripresa di un job;
- sincronizzazione e gestione conflitti;
- migrazione di schema;
- conservazione sicura dell'originale.

## 7. Capacità native e limiti piattaforma

L'app iOS è al momento un web wrapper Capacitor. Non sono presenti:

- ARKit/ARSession;
- RoomPlan;
- LiDAR o scene depth;
- intrinseche camera;
- mesh, point cloud o plane anchors;
- modulo Swift custom o bridge Capacitor dedicato;
- accesso nativo a fotocamera/scansione stanza;
- database SQLite nativo.

La base minima iOS è 15.0. Una futura acquisizione metrica dovrà distinguere i dispositivi con RoomPlan/LiDAR da quelli senza sensore e mantenere un percorso foto/manuale compatibile. Il web non può assumere la disponibilità delle API native.

## 8. Test, build e CI esistenti

### 8.1 Copertura presente

- Vitest: dominio editor, validazione file, canvas/maschere, componente studio e provider IA.
- Playwright: apertura editor, riconoscimento demo/Freeze e pagina Progetti.
- Profili E2E: desktop e tablet.
- GitHub Actions: lint, typecheck e unit test su Node 22.

### 8.2 Copertura mancante

- dataset fotografico versionato con ground truth;
- metriche IoU/boundary error/vertex error per muri, pavimento, porte e finestre;
- test di auto-intersezione e topologia;
- test di identità dei pixel Freeze e delle aree fuori maschera;
- test di registrazione Originale ↔ Stanza vuota ↔ Render;
- test su foto reali difficili, occlusioni e stanze non ortogonali;
- test di persistenza, migrazioni, crash recovery e offline;
- test iPhone/iPad reali e UI/XCTest;
- test RoomPlan/LiDAR e fallback su dispositivi non compatibili;
- carico, rate limit, retry, idempotenza e timeout server;
- build web, E2E e build Xcode nella CI.

## 9. Baseline verificata

Comandi eseguiti sul commit dell'audit:

| Controllo | Esito | Baseline |
|---|---|---|
| `pnpm lint` | superato | 5.10 s |
| `pnpm typecheck` | superato | 3.38 s |
| `pnpm test` | superato | 5 file, 41/41 test, 3.95 s processo |
| `pnpm build` | superato | build Vinext completa, 2.76 s |
| `pnpm run build:ios` | superato | bundle Vite + `cap sync ios`, 1.09 s |
| `pnpm test:e2e` | superato | 4/4 test desktop/tablet, 8.07 s processo |
| `xcodebuild ... iphonesimulator ... CODE_SIGNING_ALLOWED=NO build` | superato | app iOS Debug simulator, 15.49 s |

Questa è una baseline di stabilità software, non una baseline di precisione geometrica. Nel repository non esiste ancora un dataset con annotazioni e quindi IoU, errore dei bordi, richiamo aperture, drift e pixel preservation sono **non misurabili**.

## 10. Problemi e rischi ordinati per priorità

### P0 — bloccanti per Geometry Engine V2

1. Geometria non persistente, non versionata e non separata dall'interfaccia.
2. L'immagine svuotata viene rianalizzata e può cambiare la geometria.
3. Nessun modello topologico o 3D; porte/finestre sono semplici poligoni sovrapposti.
4. Nessuna baseline geometrica o soglia di qualità verificabile.
5. Nessuna garanzia di identità dei pixel/struttura al di fuori delle regioni modificabili.

### P1 — alta priorità

1. Validazione poligoni insufficiente.
2. Confidenza persa dopo il riconoscimento.
3. Nessuna persistenza dell'originale e dei progetti.
4. Nessuna scala metrica o calibrazione.
5. Timeout server incompleti e assenza di job persistenti.
6. CORS aperto e assenza di rate limiting esplicito.

### P2 — debito e operatività

1. `RoomStudio` concentra interfaccia, dominio e orchestrazione IA.
2. CI incompleta per build, E2E e iOS.
3. Dipendenza da Vinext beta.
4. Pagina Progetti non collegata a dati reali.
5. Messaggi come “alta precisione” non sono supportati da metriche.

## 11. Architettura proposta, incrementale

La grafica e il flusso utente possono rimanere. La separazione minima proposta è:

```text
OriginalAsset (immutabile, checksum)
       │
       ├─ AcquisitionEvidence (foto / manuale / RoomPlan / profondità)
       │
       ▼
RoomGeometry vN (proposta → validata → approvata)
       │
       ├─ Surface / Plane / Opening / adjacency / confidence
       ├─ Image-space geometry + eventuale world-space geometry
       └─ revisioni, migrazioni, audit e metriche
       │
       ├──────────────┬──────────────┐
       ▼              ▼              ▼
Empty Room        Material Map    Final Render
(solo texture)    (UV/maschere)    (consumer)
```

Regole architetturali:

- `RoomGeometry` approvata è l'unica fonte di verità.
- Ogni immagine derivata conserva `geometryRevisionId` e trasformazione verso l'originale.
- Nessuna IA generativa può scrivere direttamente nella geometria approvata.
- Un nuovo riconoscimento crea una proposta/diff; l'utente o il validatore la approva esplicitamente.
- Freeze è una maschera/versione persistente, validata con pixel-diff.
- Il fallback manuale usa lo stesso modello e gli stessi validatori.
- Le capacità native sono adapter opzionali, non una seconda app separata.

## 12. Piano file

### Da preservare

- componenti visuali e stile corrente di `RoomStudio`;
- validazione upload e tutela della chiave server-side;
- adapter provider e ricerca prodotti verificata;
- API esistenti come facciata compatibile durante la migrazione;
- wrapper Capacitor e identificativo iOS;
- test correnti come rete anti-regressione.

### Da modificare gradualmente

- `app/components/room-studio.tsx`: trasformarlo in consumatore/orchestratore, non proprietario del modello.
- `app/domain/editor.ts`: migrare verso tipi versionati senza big-bang.
- `app/server/ai-provider.ts`: separare detection, image editing, timeout e telemetria.
- `/api/detect-surfaces`: restituire proposta, confidenze, versione e diagnostica.
- `/api/empty-room` e `/api/render-room`: richiedere un riferimento a geometria approvata e validare il risultato.
- CI: aggiungere build, E2E, Xcode e benchmark dataset.

### Da aggiungere nelle milestone successive

- `app/geometry/model.ts`, `validation.ts`, `topology.ts`, `transforms.ts`;
- schema serializzabile `RoomGeometry` con migrazioni;
- repository locale persistente e storage degli asset originali;
- dataset/manifest/annotazioni e runner metriche;
- servizio di registrazione e pixel-preservation;
- adapter `photo`, `manual`, `roomplan` e `depth`;
- bridge Capacitor/Swift per capacità native compatibili;
- job model per elaborazioni lunghe;
- test fixture e report di qualità versionati.

Nessun file applicativo viene rimosso in questa milestone.

## 13. Migrazione e rollback proposti

### Migrazione

1. Introdurre `RoomGeometryV1` accanto a `Surface[]`, con adapter bidirezionale e nessun cambio UI.
2. Persistire originale, progetto e revisioni in un repository locale; aggiungere schema/versione.
3. Impedire a `empty-room` e `render-room` di sostituire la geometria; conservare soltanto immagini derivate registrate.
4. Aggiungere validazione/topologia e stato proposto/approvato.
5. Solo dopo dataset e baseline, inserire nuovi detector o RoomPlan.

Gli utenti esistenti non hanno dati persistenti da migrare: la prima migrazione riguarda il formato in memoria e i nuovi progetti. Dovrà comunque essere prevista una strategia per dati parziali e versioni future.

### Rollback

- Ogni milestone deve essere un commit separato.
- L'adapter legacy permette di tornare a `Surface[]` finché il nuovo schema non diventa obbligatorio.
- Flag locali/server separano nuova persistenza, nuovo detector e validazione render.
- In caso di errore, tornare al commit precedente senza eliminare l'originale o le revisioni già salvate.
- Il rollback di questa Milestone 0 consiste nel revert del solo commit documentale.

## 14. Metriche da istituire prima di dichiarare precisione

Baseline minima per classe e aggregata:

- IoU poligoni;
- boundary F-score e distanza bordo P50/P95 in pixel normalizzati;
- errore vertici P50/P95;
- precision/recall di porte e finestre;
- validità topologica e tasso auto-intersezioni;
- drift Originale ↔ derivata tramite landmark/registrazione;
- percentuale pixel invariati fuori maschera e nelle aree Freeze;
- latenza P50/P95, timeout e fallback rate;
- crash-free sessions e recovery rate su iPhone/iPad.

Il dataset deve includere stanze vuote/arredate, aperture chiare e scure, occlusioni, più di quattro muri, pareti interne, soffitti inclinati, grandangolo, controluce, scarsa luce e dispositivi senza/con LiDAR.

## 15. Report Milestone 0

- **FASE:** Milestone 0 — Audit repository e baseline tecnica.
- **STATO:** completata.
- **RESPONSABILE:** Codex.
- **OBIETTIVO:** identificare architettura, flussi, dati, punto di mutazione IA, capacità piattaforma, test e rischi prima di modificare il prodotto.
- **ANALISI ESEGUITA:** repository web/iOS, dominio, UI, sei API, provider IA, maschere, stanza vuota, render, persistenza, CI e capacità native.
- **FILE MODIFICATI:** nessun file applicativo.
- **FILE AGGIUNTI:** `docs/geometry-engine-audit.md`.
- **FILE RIMOSSI:** nessuno.
- **DIPENDENZE:** nessuna nuova dipendenza.
- **RISCHI:** elencati nelle sezioni 4, 6, 7 e 10.
- **MIGRAZIONI DATI:** nessuna eseguita; percorso proposto nella sezione 13.
- **TEST ESEGUITI:** lint, typecheck, Vitest, build web, build Capacitor iOS, Playwright desktop/tablet, build Xcode simulator.
- **TEST SUPERATI:** tutti: 41 unit/component, 4 E2E e tutte le build.
- **TEST FALLITI:** zero.
- **BUILD:** web, bundle nativo e Xcode superati.
- **REGRESSIONI:** nessuna modifica funzionale; nessuna regressione rilevata.
- **METRICHE:** metriche software disponibili; metriche geometriche mancanti.
- **BASELINE:** tempi e risultati nella sezione 9; baseline di precisione da creare nella milestone successiva prevista dal piano.
- **DOCUMENTAZIONE AGGIORNATA:** questo documento.
- **COMMIT:** commit dedicato con titolo `Audit Geometry Engine V2 baseline`; identificativo registrato nella cronologia Git.
- **ROLLBACK:** revert del solo commit documentale.
- **PROBLEMI APERTI:** cinque P0, sei P1 e cinque P2 descritti sopra.
- **DECISIONI PENDENTI:** formato storage locale/remoto, schema definitivo, dataset e soglie di accettazione, supporto RoomPlan/LiDAR, strategia job.
- **PROSSIMO PASSO:** avviare esclusivamente la milestone successiva del piano vincolante, Dataset e Baseline, dopo il gate.
- **GATE:** **PASS** per la Milestone 0. Architettura, piattaforme, generazione stanza vuota, coordinate e punto di mutazione IA sono stati individuati; test e build sono spiegati e riproducibili. Il pass autorizza la fase successiva, non certifica l'accuratezza del prodotto.
