# translate-locale

Översätter webbgränssnittets texter (`apps/web/locales/en.json`) till ett annat språk med en
OpenAI-kompatibel AI-modell, till exempel Kimi K3 på Modal.

```bash
node scripts/translate-locale/translate.mjs --lang sv
```

Resultatet skrivs till `apps/web/locales/<lang>.json`.

## Så fungerar det

- Texterna skickas i omgångar till modellen tillsammans med en ordlista (`glossary.<lang>.json`), så att
  samma begrepp används överallt.
- Varje svar kontrolleras: platshållare som `{{count}}`, `<1>…</1>` och `%s` måste finnas kvar exakt.
  Texter som inte klarar kontrollen skickas igen i mindre omgångar.
- Färdiga översättningar sparas i `cache/<lang>.json` tillsammans med den engelska källtexten. När du kör
  verktyget igen, till exempel efter en uppdatering av LearnHouse, översätts bara texter som är nya eller
  har ändrats på engelska.
- Texter som inte gick att översätta utelämnas och visas på engelska tills vidare.

## Modellinställningar

Läses i den här ordningen:

1. Miljövariablerna `TRANSLATE_BASE_URL`, `TRANSLATE_API_KEY` och `TRANSLATE_MODEL`.
2. En fil som anges med `--config`, med rader som `base_url=…`, `modal_api_key=…` och `model=…`.
3. `apps/api/.env`, alltså samma AI-inställningar som plattformen använder (`LEARNHOUSE_AI_BASE_URL`,
   `LEARNHOUSE_AI_API_KEY` och `LEARNHOUSE_AI_MODEL_STANDARD`).

## Flaggor

| Flagga | Standard | Beskrivning |
|---|---|---|
| `--lang <kod>` | `sv` | Målspråk. Ordlistan `glossary.<kod>.json` används om den finns. |
| `--source <fil>` | `apps/web/locales/en.json` | Källfil. |
| `--out <fil>` | `<källmapp>/<kod>.json` | Var resultatet skrivs. |
| `--config <fil>` | – | Fil med modellinställningar. |
| `--concurrency <n>` | `4` | Antal samtidiga anrop till modellen. |
| `--batch-chars <n>` | `5000` | Max antal tecken per anrop. |
| `--batch-keys <n>` | `80` | Max antal texter per anrop. |
| `--limit <n>` | – | Översätt bara de första n texterna, för att testa. |
| `--reasoning <nivå>` | `low` | Modellens tänkande (`low`, `high`, `max` eller `none`). |
| `--retranslate` | – | Ignorera cachen och översätt allt på nytt. |
| `--dry-run` | – | Visa hur mycket som skulle översättas, utan att anropa modellen. |
