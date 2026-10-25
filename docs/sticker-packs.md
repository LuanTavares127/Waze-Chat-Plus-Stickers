# Waze Chat Plus — Sticker packs (format 1)

Waze Chat Plus shows stickers in the Waze chat: you pick one from a pack, it is sent as a short message, and everyone with the script
sees the sticker. Anyone can make a pack: it is a folder of WebP images plus a `wcp-stickers.json` file in a public GitHub
repository. People install it from its link, or from a sticker of that pack they received. Everything is free.

This page is the full contract for pack authors and for any program that reads Waze Chat Plus stickers.

- **Quick start:** make a pack in ten minutes.
- **Sections 1 to 7:** the reference (files, manifest, translations, images, links, messages, versions).
- **Sections 8 and 9:** safety, the block list and the official packs.

## Quick start

1. Create a **public** GitHub repository, for example `my-stickers`.
2. Put your images in `stickers/`, one WebP of 512×512 px per sticker, named after its id: `stickers/thumbs-up.webp`.
3. Put a 128×128 px copy of each one in `thumbs/`: `thumbs/thumbs-up.webp`.
4. Add `wcp-stickers.json` at the root of the repository:

```json
{
    "format": 1,
    "id": "my-stickers",
    "name": "My stickers",
    "author": "your_waze_nickname",
    "license": "CC-BY-4.0",
    "icon": "thumbs-up",
    "stickers": [
        { "id": "thumbs-up", "name": "Thumbs up", "keywords": ["ok", "yes", "like"], "emojis": ["👍"] },
        { "id": "facepalm", "name": "Facepalm", "keywords": ["oops", "really"], "emojis": ["🤦"] }
    ]
}
```

5. Check the pack with the validator (§10): `node validate.mjs path/to/my-stickers`.
6. Commit, create the tag `v1.0.0` and push it: `git tag v1.0.0 && git push origin v1.0.0`.
7. Share the link `https://github.com/<you>/my-stickers`. In Waze Chat Plus: Settings › Stickers › "Install from link".

## 1. Files of a pack

A pack is one folder of a public GitHub repository: the repository root or a subfolder (a repository may hold several packs, one per
folder). Inside that folder, the **pack root**:

```
<pack root>/
    wcp-stickers.json        manifest (required, §2)
    stickers/<id>.webp       one image per sticker (required, §4)
    thumbs/<id>.webp         one thumbnail per sticker (required, §4)
    i18n/<locale>.json       names and keywords in other languages (optional, §3)
```

- The paths are fixed: a sticker with the id `facepalm` is always `stickers/facepalm.webp` and `thumbs/facepalm.webp`.
- File names are case-sensitive. Other files in the folder are ignored.
- The pack root path may have at most 4 folders, each made of `A-Z a-z 0-9 . _ -` (never `.` or `..` alone).
- **Pack identity** = `gh:<user>/<repo>/<pack root>` in lower case, without the trailing slash (`gh:<user>/<repo>` for a pack at the
  repository root). Moving the folder or renaming the repository makes a different pack for everyone.

## 2. Manifest `wcp-stickers.json`

UTF-8 JSON, at most 256 KB. Unknown fields are ignored. Texts are plain text (no HTML, no Markdown); line breaks and control
characters are not allowed.

| Field | Type | Rules |
|---|---|---|
| `format` | number | Required. `1`. |
| `id` | string | Required. Short id of the pack: 1–40 characters `a-z 0-9`, words joined by single `-` (`^[a-z0-9]+(-[a-z0-9]+)*$`). Goes in every sticker message (§6). Never change it. |
| `name` | string | Required. Pack name in **English**, 1–40 characters. |
| `author` | string | Required. Who made it (a Waze nickname, a name), 1–60 characters. |
| `license` | string | Required. License of the images, 1–40 characters: an SPDX id (`CC-BY-4.0`, `CC0-1.0`…) or `All rights reserved`. |
| `description` | string | Optional. One sentence in English, at most 200 characters, shown before installing. |
| `icon` | string | Required. Id of the sticker whose thumbnail is the pack icon. |
| `animated` | boolean | Optional, default `false`. `true` when the pack has animated stickers. |
| `locales` | string[] | Optional. Languages that have an `i18n/<locale>.json` (§3). Only what's listed is downloaded. |
| `stickers` | object[] | Required. 1–120 stickers (about 50 is a good size), in the order shown in the picker. |

Each sticker:

| Field | Type | Rules |
|---|---|---|
| `id` | string | Required. Unique in the pack, 1–40 characters, same rule as the pack `id` (`114` and `chill-glasses` are both valid). **Permanent** (§7). |
| `name` | string | Required. Name in English, 1–40 characters. Shown on hover and in the message for people without the script. |
| `keywords` | string[] | Optional. Up to 10 search words in English, each 1–30 characters. |
| `emojis` | string[] | Required. 1–3 emojis that mean the same as the sticker. They make the sticker searchable in **every language** (the script searches the emoji names of the user's language). |

The pack is searched by sticker name, keywords and the words of its emojis, ignoring case and accents.

## 3. Translations `i18n/<locale>.json`

Optional. One file per language, UTF-8 JSON, at most 128 KB:

```json
{
    "name": "Minhas figurinhas",
    "description": "Figurinhas para o dia a dia da edição",
    "stickers": {
        "thumbs-up": { "name": "Joinha", "keywords": ["ok", "sim", "curti"] },
        "facepalm": { "name": "Mão na cara" }
    }
}
```

- Every field is optional. Same limits as the manifest. A sticker or field left out falls back (below).
- `<locale>` is one of the languages of Waze Chat Plus: `af ar bg ca cs da de el en-AU en-GB es es-419 et eu fa-IR fi fr gl he hi hr hu
  id it ja ka ko lt lv ms nl no pl pt-BR pt-PT ro ru sk sl sv th tr uk vi zh zh-TW`, or a base language (`pt`, `en`, `es`…) that
  serves all its variants. List each file in the manifest's `locales`.
- Fallback for each text: the user's language (`pt-BR`) → its base language (`pt`) → the manifest (English).
- Keywords of a translation replace the English ones for that language; the English ones and the emojis are searched as well.

## 4. Images

| | Sticker `stickers/<id>.webp` | Thumbnail `thumbs/<id>.webp` |
|---|---|---|
| Format | WebP (static or animated). Nothing else: no PNG, GIF, SVG. | WebP, static |
| Size | exactly 512×512 px | exactly 128×128 px |
| Bytes | static ≤ 100 KB; animated ≤ 500 KB | ≤ 20 KB |
| Animation | ≤ 120 frames, ≤ 10 s per loop, loops forever | the first frame of an animated sticker |

Recommended (the validator warns, readers don't check): transparent background, the drawing centered with a 16 px empty margin,
sRGB, quality about 90. A white outline keeps the drawing readable on the dark theme.

Readers check the WebP header (canvas size, animation and frame count) before drawing a sticker, and refuse anything outside these
limits: the message is then shown as a plain link.

## 5. Links

Waze Chat Plus reads packs and images **only** from jsDelivr's GitHub mirror, at a fixed version:

```
https://cdn.jsdelivr.net/gh/<user>/<repo>@<ref>/<pack root>/<file>
```

- `<ref>` is fixed: a full version tag (`v1.0.0` or `1.0.0`, three numbers) or a full 40-character commit id.
- **Never** a branch (`main`), `latest`, a short version (`@1`, `@1.2`) or a short commit id: jsDelivr resolves those to different
  files over time, so readers refuse them.
- `<user>`: a GitHub user or organization (`A-Z a-z 0-9 -`, up to 39 characters); `<repo>`: `A-Z a-z 0-9 . _ -`, up to 100.

Install links accepted by Waze Chat Plus:

| Link | Installs |
|---|---|
| `https://github.com/<user>/<repo>` | the pack at the repository root, newest version tag |
| `https://github.com/<user>/<repo>/tree/<ref>/<pack root>` | the pack in that folder; at that tag or commit, or the newest version tag when `<ref>` is a branch |
| `https://cdn.jsdelivr.net/gh/<user>/<repo>@<ref>/<pack root>/wcp-stickers.json` | that pack at that version |
| a sticker message (§6) | the pack of that sticker, newest version tag (or the message's version when it is newer or has no tags) |
| a shared pack message (§6b) | that pack, the same way |

"Newest version tag" = the highest version listed by `https://data.jsdelivr.com/v1/packages/gh/<user>/<repo>` (jsDelivr lists only
tags that are versions, without the `v`). A pack installed at a commit is never offered updates.

## 6. Sticker messages

The chat has no stickers: a sticker travels as text, so people without the script still see what it is. A sticker message is exactly
two lines:

```
🖼️ Sticker "Facepalm" (sent with Waze Chat Plus)
https://cdn.jsdelivr.net/gh/<user>/<repo>@<ref>/<pack root>/stickers/<sticker id>.webp#wcp-sticker=<pack id>/<sticker id>
```

- **Line 1** is for people without the script, in the sender's language, with the sticker name in that language. Readers ignore it.
- **Line 2** is the sticker: the image link of §5 at a fixed `<ref>`, plus the fragment `#wcp-sticker=<pack id>/<sticker id>`. The
  fragment is never sent to the server; it marks the link as a sticker. `<pack id>` must be the manifest `id` and `<sticker id>` the
  file name, or the link is not a sticker.
- The message is drawn as a sticker (without a balloon) only when it has nothing else: the two lines, or line 2 alone, with blank space
  around them. Any other text keeps it a normal message with a link.
- A reader needs nothing but the link to draw the sticker. It reads the manifest (for the name, the "Install pack" option, the block
  list) only when it needs to.

### 6b. Shared pack messages

"Share pack" sends a whole pack the same way, in two lines:

```
🧩 Sticker pack "Waze moods" (shared with Waze Chat Plus)
https://github.com/<user>/<repo>/tree/<ref>/<pack root>#wcp-pack=<pack id>
```

- **Line 1** is for people without the script (sender's language, pack name in that language). Readers ignore it, except as a name to
  show before the manifest is read.
- **Line 2** is the GitHub folder of the pack at a fixed `<ref>` (§5; `/tree/<ref>` with no `<pack root>` for a pack at the repository
  root), so people without the script land on the pack's page, plus the fragment `#wcp-pack=<pack id>` (the manifest `id`). Only links
  with that fragment become a pack card; the same link without it stays a normal link.
- Readers show a card (icon, name, author, sticker count, a few thumbnails) with "View pack" and "Install" or "Remove" once the
  manifest at that `<ref>` is read and its `id` matches. A manifest that can't be read or has another `id` shows the message as it is;
  a blocked pack (§8) shows no pictures and can't be installed from it. Installing follows §5 (newest version tag).
- The card replaces the message text only when the message is the two lines, or line 2 alone.

## 7. Versions and permanent ids

- A **sticker id is permanent**. Once a version with it is published, it always means that sticker: never rename it, never reuse it for
  another drawing. Messages, favorites and recently used stickers point to it.
- A new version may: add stickers, change names, keywords, emojis, order, the icon, translations, and redraw a sticker that stays the
  same idea. A sticker can be removed: old messages still show it (their link points to the old version), but it leaves the picker.
- Publish a version = push a new version tag higher than the last one (`v1.1.0`). Never move or delete a published tag: jsDelivr keeps
  the first files it served for that tag forever, so a moved tag shows different images to different people.
- The pack `id`, the repository and the pack root never change either (they are the pack identity, §1).
- **Format versions:** new optional fields may be added to format 1 at any time; readers ignore what they don't know. A change that old
  readers can't handle becomes `format: 2`; a reader refuses a format it doesn't know ("update Waze Chat Plus").

## 8. Safety

Readers and the author of Waze Chat Plus protect users this way:

- **Images only from jsDelivr's GitHub mirror at a fixed version** (§5), as WebP whose header was checked (§4). Never SVG, never a
  script, never HTML. Manifest and translation texts are cut to their limits and shown as plain text.
- **Privacy:** loading a sticker downloads it from jsDelivr, which sees the reader's IP address like any image on the web. The fragment
  `#wcp-sticker=…` never leaves the reader's computer.
- **Community packs:** before installing a pack that isn't official, Waze Chat Plus shows a preview and says it was made by the
  community. Anyone can block a pack on their own computer, and report a pack or a sticker from its menu.
- **Block list:** reports reach the maintainer as GitHub issues. A pack or sticker that breaks the rules goes into the public block list
  (`blocked.json` of the official stickers repository, read about once a day): blocked stickers are shown as a plain link and can't be
  installed. Serious cases are also reported to GitHub and jsDelivr for removal at the source.

Rules for every pack: only images you have the right to share; nothing illegal, sexual, violent, hateful, harassing or misleading;
no advertising or spam; no personal data of anyone.

Block list `blocked.json`:

```json
{
    "format": 1,
    "packs": [{ "pack": "gh:someone/some-repo/packs/bad", "reason": "hate", "at": "2026-11-01" }],
    "stickers": [{ "pack": "gh:someone/other-repo", "id": "bad-one", "reason": "sexual", "at": "2026-11-02" }]
}
```

`reason` is one of `illegal`, `sexual`, `violence`, `hate`, `harassment`, `spam`, `copyright`, `other`. An entry may add
`"refs": ["v1.0.0"]` to block only those versions.

## 9. Official packs and the showcase

The official packs (the Waze moods) live in the repository `LuanTavares127/waze-chat-plus-stickers`, one folder per pack under `packs/`, and follow
this same format. They come installed for everyone and can't be removed, only reordered. Their list is `showcase.json` in that
repository:

```json
{
    "format": 1,
    "official": [
        { "link": "https://github.com/LuanTavares127/waze-chat-plus-stickers/tree/v1.0.0/packs/feelings" }
    ],
    "community": []
}
```

- `official`: the packs installed for everyone, in their default order; a new link there reaches every user without a new script.
- `community`: packs shown in the "Showcase" of the settings, ready to install (empty for now; opening it to pull requests is planned).

Waze Chat Plus reads `showcase.json` and `blocked.json` through its author's server (cached for 5 minutes) and falls back to jsDelivr
when that server is down.

## 10. Validator

`tools/validate.mjs` of `LuanTavares127/waze-chat-plus-stickers` checks a pack folder against this page, with Node.js 20 or newer and
nothing else to install (download that one file, or clone the repository):

```
node validate.mjs path/to/pack-root
```

It reports errors (the pack would be refused) and warnings (file sizes close to the limits). With the `sharp` package installed it also
warns about margins and a background that isn't transparent. The official
repository runs it on every push and pull request.
