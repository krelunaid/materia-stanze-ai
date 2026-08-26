# Materia — Milestone 1: Dataset e Baseline

Data: 2026-08-26

Baseline software di confronto: Milestone 0, commit `4de1df3`
Codice misurato dalla snapshot geometrica: commit `34ee1856bef96dcc8fbada84fdf4365bf95feda3`

## Esito

È stata creata una pipeline deterministica e versionata, ma la Milestone 1 non può essere dichiarata completata. Il registro contiene tutti i 43 scenari obbligatori; soltanto `empty-room` dispone di una fixture originale, annotazione geometrica, predizione e metriche riproducibili. Gli altri 42 casi non hanno ancora immagini/evidenze annotate e sono marcati `registered-unmeasured`.

La pipeline evita esplicitamente di trasformare un caso registrato in un successo fittizio. Il gate resta quindi **BLOCCATO** e non autorizza la Milestone 2.

## Artefatti versionati

- Manifest dataset `materia-geometry-dataset-v1`, versione `1.0.0`.
- 43 scenari obbligatori con annotazioni risolte da default + override.
- Fixture misurata `public/demo-room.jpg`, 1600 × 1000, SHA-256 `0051b9311255de851cd60ee3c6451b457667e0b7b62bf35026634c16e99f8ec7`.
- Ground truth e predizione della stanza demo.
- Configurazione `geometry-config-v1`.
- Risultati immutabili `geometry-baseline-34ee185-v1`.
- Motore metrico per IoU, errore bordi e delta dimensioni di porte/finestre.
- Test di completezza del manifest, checksum, serializzazione, deserializzazione e riproducibilità.

## Metriche baseline disponibili

| Metrica | Valore | Interpretazione |
|---|---:|---|
| `segmentationIoU` | 1 | Solo geometria deterministica della demo; non misura Grok live |
| `edgeErrorPx` | 0 | Predizione demo coincidente con la ground truth demo |
| `windowWidthDeltaPx` | 0 | Una finestra demo |
| `windowHeightDeltaPx` | 0 | Una finestra demo |
| metriche porte | `null` | Nessuna porta nella fixture |
| metriche 3D/depth/calibrazione | `null` | Capacità non presenti |
| preservazione/registrazione/render | `null` | Pipeline non ancora implementata |
| tempi/memoria live | `null` | Snapshot offline, nessuna chiamata live riproducibile |

Copertura: **1 caso misurato su 43 registrati (2,33%)**. Non è una baseline rappresentativa della precisione del prodotto.

## Test di caricamento

La suite verifica:

- JPEG valido e JPEG minimo;
- PNG, incluso input capace di alpha;
- HEIC con MIME mancante;
- JPEG con intestazione EXIF;
- file oltre 20 MB;
- file vuoto;
- PDF;
- formato non supportato.

Il test EXIF verifica l'accettazione, non la corretta rotazione pixel: oggi questa è delegata al decoder del browser e richiede fixture fotografiche reali per una verifica completa.

## Test non eseguibili con gli artefatti disponibili

- precisione su stanze arredate, irregolari, porte/finestre occluse e condizioni fotografiche difficili;
- rete lenta/assente, timeout, risposta API non valida e ripresa del job;
- progetto corrotto/parzialmente salvato, perché non esiste persistenza;
- tracking, depth, LiDAR e calibrazione, perché non esistono moduli nativi;
- stanza vuota/render con confronto strutturale e pixel preservation;
- memoria e latenza su dispositivo reale.

Questi casi sono classificati nel manifest; nessun crash è stato osservato nei test eseguiti, ma l'assenza di esecuzione non viene considerata “assenza di crash”.

## Confronto con la baseline software della Milestone 0

| Controllo | Milestone 0 | Milestone 1 |
|---|---:|---:|
| unit/component test | 41/41 | 48/48 |
| test E2E desktop/tablet | 4/4 | 4/4 |
| lint | pass | pass |
| TypeScript | pass | pass |
| build web | pass | pass |
| build Capacitor iOS | pass | pass |
| build Xcode simulator | pass | pass |

Nessuna regressione software rilevata. L'interfaccia e il comportamento applicativo non sono stati modificati.

## Report obbligatorio

- **FASE:** Milestone 1 — Dataset e Baseline.
- **STATO:** BLOCCATA.
- **RESPONSABILE:** Codex per pipeline e registrazione; proprietario prodotto per disponibilità/approvazione delle fixture reali e ground truth.
- **OBIETTIVO:** creare una base di test riproducibile prima delle modifiche al Geometry Engine.
- **ANALISI ESEGUITA:** requisiti dataset, formati upload, fixture disponibili, test, build, capacità rete/persistenza/native e metriche applicabili.
- **FILE MODIFICATI:** `.gitignore`, `package.json`, `app/lib/file-validation.test.ts`.
- **FILE AGGIUNTI:** `app/benchmark/*`, `benchmark/*`, `docs/geometry-baseline-v1.md`.
- **FILE RIMOSSI:** nessuno.
- **DIPENDENZE:** nessuna nuova dipendenza.
- **RISCHI:** baseline demo sovrastima la precisione; dataset reale insufficiente; metriche live non disponibili.
- **MIGRAZIONI DATI:** nessuna; formati dataset/baseline nuovi e versionati.
- **TEST ESEGUITI:** `pnpm lint`, `pnpm typecheck`, `pnpm baseline`, `pnpm test`, `pnpm build`, `pnpm run build:ios`, `pnpm test:e2e`, build Xcode simulator.
- **TEST SUPERATI:** 5/5 test pipeline, 48/48 test totali, 4/4 E2E; tutte le build.
- **TEST FALLITI:** zero nei casi eseguiti.
- **BUILD:** web, Capacitor iOS e Xcode simulator superate.
- **REGRESSIONI:** nessuna rilevata rispetto alla Milestone 0.
- **METRICHE:** 6 metriche 2D registrate per una fixture; metriche non applicabili archiviate come `null`.
- **BASELINE:** `geometry-baseline-34ee185-v1`, copertura 1/43.
- **DOCUMENTAZIONE AGGIORNATA:** `benchmark/README.md`, questo report.
- **COMMIT:** commit dedicato con titolo `Add versioned geometry dataset baseline`.
- **ROLLBACK DISPONIBILE:** sì; revert del commit rimuove soltanto pipeline, dataset e test, senza toccare l'app.
- **PROBLEMI APERTI:** 42 casi senza fixture annotate; rete/persistenza/native non testabili; nessuna baseline detector IA live.
- **DECISIONI PENDENTI:** provenienza/licenza dataset, processo di annotazione e revisione, soglie di accettazione, dispositivi di prova.
- **PROSSIMO PASSO:** acquisire e annotare fixture reali per tutti i casi obbligatori, rieseguire la pipeline e aggiornare una nuova baseline senza sovrascrivere questa.
- **GATE:** **BLOCCATO**. Dataset, annotazioni, metriche e pipeline sono versionati e riproducibili per la demo, ma il dataset minimo non è realmente eseguito e non consente un confronto rappresentativo.

### MOTIVO

Mancano 42 fixture originali annotate e gli ambienti necessari per rete, persistenza, tracking, depth/LiDAR e recovery.

### TEST O CONTROLLI FALLITI

Controllo di copertura del dataset: 1/43 casi misurati. Nessun test tecnico ha avuto crash o errore.

### IMPATTO

Non è possibile quantificare né migliorare in modo sicuro il riconoscimento reale di pavimenti, muri, porte e finestre. La Milestone 2 non deve iniziare.

### AZIONE NECESSARIA

Fornire o acquisire fotografie rappresentative con diritti d'uso, annotarle con revisione umana e predisporre ambienti/simulatori per i casi non fotografici.

### CONDIZIONE PER LO SBLOCCO

Tutti i casi obbligatori hanno fixture/evidenze, annotazioni complete, esecuzione classificata, metriche applicabili e risultati riproducibili; nessun crash rimane non classificato.
