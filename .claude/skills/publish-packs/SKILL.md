---
name: publish-packs
description: Publish a new version of the official sticker packs — validate, choose the next vX.Y.Z tag, create it (never move an old one), update showcase.json and push. Use after changing anything in packs/, the curation or the build.
---

# Publish the official packs

Readers only load packs at a fixed ref (spec §5): a full version tag. jsDelivr keeps the first files it served for a tag forever, so **a tag is never moved or deleted** (spec §7).

1. `node tools/build.mjs` if the curation or the build changed (needs the art folder; `npm install` once), then `node tools/validate.mjs .`: zero errors, read the warnings.
2. Everything committed (`git status` clean; commit message in pt-BR). Only commit or push when the user asked.
3. Next tag: `git describe --tags --abbrev=0 --match "v[0-9]*"`. Patch (`v1.0.1`) for fixes/translations, minor (`v1.1.0`) for new stickers or packs. Ids stay permanent: if a sticker id vanished, stop and ask the user.
4. `showcase.json` links point at `tree/<tag>/packs/<id>`: change them to the new tag **in the commit that the tag points to**. Then validate again.
5. `git tag vX.Y.Z` on that commit; ask before `git push origin vX.Y.Z` (and the branch). After pushing, check with `curl -sI https://cdn.jsdelivr.net/gh/LuanTavares127/waze-chat-plus-stickers@vX.Y.Z/packs/<id>/wcp-stickers.json` (200, `immutable`).
6. Update `ROADMAP.md` (status of the phase) and tell the user the script needs nothing: official packs reach everyone through `showcase.json` (Worker cache 5 min).
