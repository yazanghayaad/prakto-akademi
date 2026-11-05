<p align="center">
  <a href="https://prakto.se/docs">
    <img alt="Prakto Akademi" src=".github/images/prakto-academy.png" width="600" />
  </a>
</p>

<p align="center">
  <strong>Prakto Akademi – dokumentation</strong>
</p>

<p align="center">
  Hjälp och guider för elever, lärare och administratörer på <a href="https://prakto.se">Prakto Akademi</a>.
  Publiceras på <a href="https://prakto.se/docs">prakto.se/docs</a>.
</p>

---

## Köra lokalt

Kräver [Bun](https://bun.sh).

```bash
bun install
bun run dev -- -p 3002
```

Öppna sedan http://localhost:3002/docs.

## Bygga

```bash
bun run build
bun run start
```

Sajten ligger under `basePath: '/docs'` (se `next.config.mjs`), så bilder i innehållet
skrivs som `/docs/img/...`.
