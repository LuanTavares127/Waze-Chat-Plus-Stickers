# AGENTS.md — Waze Chat Plus Stickers

**Public** repository (GitHub `LuanTavares127/waze-chat-plus-stickers`, assumed until the user creates it) with the sticker pack
format, the official sticker packs (the Waze moods), the tools that build and validate packs, the showcase and block list, and the
code of the author's Cloudflare Worker. Author: luan_tavares_127 (Luan Tavares).

The reader of the packs is the public userscript **Waze Chat Plus**, in the sibling folder `../WME Não sei que nome dar ainda/` (its
`AGENTS.md` §8c summarizes what the script follows; its `ROADMAP.md` Phase 48 is the plan of the whole feature). This repository holds
no userscript code.

Status and phases: `ROADMAP.md` (pt-BR).

## 1. Repo layout

| Path | Purpose |
|---|---|
| `docs/sticker-packs.md` | **The contract** (format 1): files, manifest, translations, image limits, links, messages, permanent ids, safety, block list, official packs, validator. Public, for pack authors and readers; the script cites its `§` numbers. |
| `curation/stickers-curation.json` | Approved curation of the official packs (Phase 48a, 2026-10-22): 6 packs, per mood `id`, `file` (name in the art folder), `nameSource` (`file` = the art file's original name, `official` = named by the user on 2026-10-24, official or invented; no `number` left since `v1.1.0`; the art file is named after `name.en`), en + pt-BR `name`/`keywords`, 1–3 `emojis`, `note` (franchise). Source of the official manifests built in 48c; not published as a pack. |
| `packs/<pack id>/` | One official pack each, in the format of the spec: `wcp-stickers.json`, `stickers/`, `thumbs/`, `i18n/`. |
| `showcase.json`, `blocked.json` | (48c) Official pack list and block list (spec §8–§9), edited by commit; served by the Worker. |
| `tools/build.mjs` | Official packs: art folder + curation → `packs/` (renamed to the ids, art fitted in a 480 px box and centered on a 512 px transparent canvas, 128 px thumbnails, manifests, `i18n/pt-BR.json`; other `i18n/` files are kept and listed in `locales`). `node tools/build.mjs [--art <folder>]`, ~25 min on the Drive folder. Uses `sharp` (`package.json`). |
| `tools/validate.mjs` | The validator of spec §10: one file, Node.js 20+, no dependency (pixel checks only when `sharp` is there). |
| `.github/workflows/validate.yml` | Runs the validator on every push and pull request. |
| `.claude/` | Hooks (`validate-packs`: validates after editing `packs/**`, showcase or block list; `check-pack-versions`: warns about changes without a new tag and about vanished ids), rules, skill `publish-packs`. `settings.json` (wiring) is created by the user. |
| `worker/` | (48e) Code of the Cloudflare Worker (GIF proxy + sticker routes + `GET /preview?url=&lang=`, the link previews of the Waze Chat Plus script since its 1.13.8: the page is read here so the reader's IP never reaches the site; its link rules are a port of the script's `isLinkPreviewAllowed`, keep both in sync): `worker.js` + `wrangler.toml`, published with `npx wrangler deploy` in that folder (pasting in the Cloudflare editor afterwards keeps the bindings). Secrets (`KLIPY_KEY`, the GitHub token, which expires: renew it) live only in Cloudflare. Abuse brakes (2026-10-23): Rate Limiting bindings per IP and minute (GIFs 30, sticker lists 10, reports 2, link previews 30) and the KV `REPORTS` with daily report caps (5 per IP, hashed, 30 in all, UTC); the per-minute ones are approximate in production (Cloudflare syncs the counts in the background; the in-memory count of the instance is a second brake: either one over = 429), the daily KV caps are the firm ones. |

## 2. Rules

- **The spec is a contract with the script.** Any change to `docs/sticker-packs.md` checks the reader rules in the script's
  `AGENTS.md` §8c in the same task (and its code once 48f+ exist). New optional fields keep `format: 1`; anything old readers can't
  handle is `format: 2`.
- **Sticker ids are permanent** (user decision 2026-10-22): never rename or reuse one; a new version only changes shown names.
- **Fixed refs only:** packs are published by full version tags (`v1.0.0`), never moved or deleted (spec §5, §7). The official packs
  share the repository's tags.
- Official art: `G:\Meu Drive\Waze\Moods\Images (WEBP)\With Border (Com Borda)` (512×512 WebP, outside the repository).
- Everything here is public: nothing about mass messaging or private extensions, no secrets, no map sites that aren't allowed for Waze
  editing (same rule as the script).
- Docs and code in English; `ROADMAP.md` and commit messages in pt-BR. CRLF.
