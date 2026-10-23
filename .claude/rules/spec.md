---
paths:
  - "docs/sticker-packs.md"
---

# The specification is a contract

- `docs/sticker-packs.md` is read by the script Waze Chat Plus (`../WME Não sei que nome dar ainda/`): any change to it updates the §8c summary in that project's `AGENTS.md` (and its code once Phase 48f+ exist) **in the same task**, and `tools/validate.mjs` if a rule changed.
- New optional fields keep `format: 1`; anything old readers can't handle is `format: 2`.
- Public text: nothing about mass messaging or private extensions, no map sites that aren't open data allowed for Waze editing.
