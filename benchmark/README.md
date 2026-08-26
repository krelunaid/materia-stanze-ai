# Materia Geometry Benchmark

Questa cartella contiene la baseline riproducibile introdotta nella Milestone 1.

## Struttura

- `dataset-v1/manifest.json`: registro dei 43 scenari obbligatori e annotazioni effettive ottenute da default + override.
- `dataset-v1/annotations/`: ground truth disponibili.
- `baselines/<commit>/`: predizioni e metriche archiviate; i risultati precedenti non vanno sovrascritti.
- `config/`: coordinate, risoluzione metrica, ambiente e checksum delle fixture.
- `app/benchmark/`: validazione del manifest e calcolo deterministico delle metriche.

## Riproduzione

Da `apps/web`:

```bash
pnpm install --frozen-lockfile
pnpm baseline
```

Il comando fallisce se:

- manca uno scenario obbligatorio;
- manca un campo di annotazione;
- una fixture misurata non esiste più o cambia checksum;
- serializzazione/deserializzazione perdono dati;
- le metriche ricalcolate non coincidono con quelle archiviate;
- un caso registrato ma non misurato viene presentato come misurato.

## Aggiungere un caso misurato

1. Aggiungere una fixture originale con licenza/provenienza documentata e checksum.
2. Compilare tutte le annotazioni applicabili senza inventare valori mancanti.
3. Salvare la ground truth e la predizione del commit da misurare.
4. Creare una nuova cartella baseline; non modificare quelle precedenti.
5. Registrare modello, API, configurazione, dispositivo, sistema operativo, timestamp e risoluzione.
6. Eseguire `pnpm baseline`, l'intera suite, le build e confrontare il report.

## Limite della baseline corrente

La sola fixture misurata è `public/demo-room.jpg`, con geometria deterministica usata dal flusso demo. Il valore IoU 1 non misura il detector IA su fotografie reali. Gli altri 42 casi restano `registered-unmeasured`: questa distinzione è parte del gate e non deve essere rimossa finché non esistono fixture realmente annotate.
