# translate-captions

Översätter undertexterna till kursvideorna (WebVTT) till ett annat språk med en OpenAI-kompatibel
AI-modell, till exempel Kimi K3 på Modal. Kör från repots rot med API:ts Python:

```bash
apps/api/.venv/Scripts/python.exe scripts/translate-captions/translate_captions.py
```

## Så fungerar det

- Varje video som har färdiga undertexter i källspråket (till exempel engelska från en Coursera-import)
  får en ny fil `captions/<lang>.vtt` bredvid originalet.
- Modellen får bara texten, aldrig tidsstämplarna. Tidsstämplarna kopieras från originalet, så den
  översatta filen har alltid samma rader och samma tider.
- Raderna skickas i omgångar tillsammans med de närmast föregående raderna, eftersom en mening ofta
  delas mellan flera rader.
- Språket registreras sedan på lektionen som färdigt. Det läggs först i listan, så att det visas
  överst i videospelarens undertextmeny.
- Videor som redan har målspråket hoppas över. Du kan avbryta när som helst och köra igen. Även nya
  kursimporter fångas upp på det sättet.
- Videor som inte gick att översätta skrivs till `logs/failures.<lang>.tsv`. Kör skriptet igen för att
  försöka med dem.

## Modellinställningar

Läses i den här ordningen:

1. Miljövariablerna `TRANSLATE_BASE_URL`, `TRANSLATE_API_KEY` och `TRANSLATE_MODEL`.
2. En fil som anges med `--config`. Standard är `../ai_model_översätt` (bredvid `learnhouse/`), med
   raderna `modal_api_url=…`, `modal_api_key=…` och `modal_api_model=…`.

## Flaggor

| Flagga | Standard | Beskrivning |
|---|---|---|
| `--lang <kod>` | `sv` | Målspråk. |
| `--label <namn>` | `Svenska` | Namnet i spelarens undertextmeny. |
| `--concurrency <n>` | `4` | Antal videor som översätts samtidigt. |
| `--limit <n>` | `0` | Översätt högst så här många videor (`0` = alla). |
| `--course <uuid>` | – | Bara en kurs (`course_…`). |
| `--activity <uuid>` | – | Bara en lektion (`activity_…`). |
| `--retranslate` | av | Översätt även videor som redan har målspråket. |
| `--dry-run` | av | Visa vad som skulle översättas, utan att anropa modellen. |
| `--batch-cues <n>` / `--batch-chars <n>` | `60` / `3500` | Storlek på varje omgång till modellen. |
| `--reasoning <nivå>` | `low` | `reasoning_effort` till modellen (`none` = skickas inte). |
