---
paths:
  - "packs/**/wcp-stickers.json"
  - "packs/**/i18n/*.json"
  - "curation/stickers-curation.json"
---

# Official pack manifests and translations

- `packs/` is **generated** by `node tools/build.mjs` from the art folder + `curation/stickers-curation.json`. Change the curation (or the build) and rebuild; hand edits to a manifest are lost on the next build. `i18n/<locale>.json` other than `pt-BR` are written by Phase 48d, not by the build (it only lists them in `locales`).
- **Sticker ids are permanent** (spec §7, user decision 2026-10-22): never rename or reuse one; a new version only changes the shown names, keywords, emojis and order. A removed sticker leaves the picker but old messages still show it.
- Limits of the spec §2–§4: names ≤ 40 characters, ≤ 10 keywords of ≤ 30, 1–3 emojis, ≤ 120 stickers per pack, 512×512 stickers ≤ 100 KB, 128×128 thumbnails ≤ 20 KB, plain text only.
- The curation field `note` (franchise) never goes into a manifest.
- After any change run `node tools/validate.mjs .` (the PostToolUse hook does it) and publish through the skill `publish-packs` (a new tag; never move an old one).
