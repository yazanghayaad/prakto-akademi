# course-thumbnails

Gör en kursbild per kurs i stil med `Pkratoxacademy.png`: ett nedladdat foto, suddat, med PRKTO-loggan i
mitten och "x \<företagets logga\>" nere till höger. Kör från repots rot med API:ts Python:

```bash
apps/api/.venv/Scripts/python.exe scripts/course-thumbnails/make_thumbnails.py \
  --contact <din e-post eller webbadress> \
  --prakto-logo apps/api/content/orgs/<org>/logos/<PRKTO-logga>.png \
  --apply
```

Utan `--apply` hamnar bilderna bara i `out/`, så att du kan titta på dem först.

## Så fungerar det

- **Foton:** hämtas från Wikimedia Commons, bara bilder med CC0 eller public domain, så ingen
  namnangivelse krävs. Källorna listas ändå i `credits.tsv`. Varje kurs har tre ämnesord i `COURSES`
  som ska finnas i fotots titel, och de provas i tur och ordning. Ingen bild används av två kurser.
- **Loggor:** IBM, Microsoft, Google, Meta, Adobe, Python, Anthropic och Vanderbilt hämtas från Commons
  och görs vita. MathWorks, DeepLearning.AI och UC Davis har ingen logga där och skrivs därför i
  Palatino, som "x Academy" i förlagan.
- **Läsbarhet:** på mörka foton läggs en mjuk ljus gloria bakom PRKTO, och på ljusa foton en mjuk skugga
  bakom "x \<företag\>" i hörnet.
- **Kontaktuppgift:** Wikimedia kräver en kontaktuppgift i varje anrop. Den anges med `--contact`.
- **Cache:** nedladdningar sparas i `cache/`, så en ny körning hämtar bara det som är nytt.
- **Nya kurser:** lägg till kursens id i `COURSES` med företag och ämnesord, och kör igen. Kurser som
  saknas i listan skrivs ut som en varning.
- **Byta bild:** ändra kursens ämnesord och kör igen med `--apply`. Den gamla bildfilen ligger kvar i
  kursens `thumbnails`-mapp, men används inte längre.
