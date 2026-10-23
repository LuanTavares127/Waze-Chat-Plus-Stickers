#!/usr/bin/env node
/*
 * Stop hook (warns, never blocks): compares packs/ with the newest version tag.
 *  - a pack changed since the tag and HEAD is not tagged -> a new tag vX.Y.Z is needed to publish it (skill publish-packs);
 *  - a sticker id that the tag had is gone from the manifest -> ids are permanent (spec §7): a rename is a new sticker, so check it was on purpose.
 * Silent when there is no tag yet, nothing changed or git is not available.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const git        = (...args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });

const tag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');

if (tag.status !== 0)
    process.exit(0);

const lastTag  = tag.stdout.trim();
const changed  = git('status', '--porcelain', '--', 'packs').stdout.trim() || git('diff', '--name-only', lastTag, 'HEAD', '--', 'packs').stdout.trim();
const messages = [];

if (changed && git('describe', '--tags', '--exact-match', 'HEAD').status !== 0)
    messages.push(`packs/ changed since ${ lastTag }: publish it with a new tag (skill publish-packs); readers only see tagged versions.`);

const packsDir = join(projectDir, 'packs');

if (existsSync(packsDir))
    for (const pack of readdirSync(packsDir)) {
        const old = git('show', `${ lastTag }:packs/${ pack }/wcp-stickers.json`);

        if (old.status !== 0 || !existsSync(join(packsDir, pack, 'wcp-stickers.json')))
            continue;

        const before = new Set(JSON.parse(old.stdout).stickers.map(sticker => sticker.id));
        const now    = new Set(JSON.parse(readFileSync(join(packsDir, pack, 'wcp-stickers.json'), 'utf8')).stickers.map(sticker => sticker.id));
        const gone   = [...before].filter(id => !now.has(id));

        if (gone.length)
            messages.push(`${ pack }: ids from ${ lastTag } no longer in the manifest (${ gone.slice(0, 8).join(', ') }${ gone.length > 8 ? '…' : '' }). Ids are permanent; confirm this is a removal on purpose, not a rename.`);
    }

if (messages.length)
    console.log(JSON.stringify({ systemMessage: messages.join('\n') }));
