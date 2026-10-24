# ROADMAP — Waze Chat Plus Stickers

Parte da Fase 48 do Waze Chat Plus (plano completo, decisões do usuário e as fases do script em `../WME Não sei que nome dar ainda/ROADMAP.md`). Aqui ficam só as fases deste repositório.

| Fase | O quê | Modelo | Esforço | Status |
|---|---|---|---|---|
| 48a | Curadoria dos 259 moods em 6 pacotes | Opus 5.5 (visão) + usuário | médio | ✅ Aprovada em 2026-10-22 (`curation/stickers-curation.json`) |
| 48b | Especificação pública `docs/sticker-packs.md` (formato 1) | Opus 5.5 | médio | 🧪 Escrita em 2026-10-22, aguardando revisão do usuário |
| 48c | Pacotes oficiais em `packs/`, `showcase.json`, `blocked.json`, `tools/build.mjs`, `tools/validate.mjs`, GitHub Action, tag `v1.0.0` | Sonnet 5.5 | médio | ✅ Concluída em 2026-10-23: tag `v1.0.0` (commit 4825a69) publicada, jsDelivr responde 200 `immutable` nos 6 pacotes |
| 48d | Nomes e palavras-chave dos pacotes oficiais nos 46 idiomas | Sonnet 5.5 | médio | 🧪 Implementada em 2026-10-22: 43 idiomas × 6 pacotes em `i18n/<locale>.json` (sem `en-AU`/`en-GB`, que caem no manifesto em inglês), `locales` dos manifestos atualizados, validador sem erros; sem revisão por falantes nativos; publicada na tag `v1.0.0` (2026-10-23) |
| 48e | Worker: `/stickers/showcase`, `/stickers/blocked` (cache 5 min) e `/stickers/report` (issue no GitHub); código em `worker/` | Sonnet 5.5 | baixo | ✅ Concluída em 2026-10-23: `worker/worker.js` no ar, testado ao vivo (showcase, blocked, GIFs e denúncia que abriu issue) |
| 48l | Nomes de todos os moods (oficiais quando achados, inventados quando não) e tag `v1.1.0` | Opus 5.5 + usuário | médio | ✅ Concluída em 2026-10-24: os 95 numerados ganharam nome e id por nome (o script ainda não foi publicado, então quebrar os ids da `v1.0.0` foi decisão do usuário; a partir do lançamento os ids ficam fixos); nomes novos nos 43 idiomas (sem revisão por falantes nativos); arquivos da pasta de arte renomeados para o nome em inglês; Red Fraggle reconstruída da `v1.0.0` (o arquivo original foi sobrescrito); 223 (Vulcan Salute) passou de vibes para crossovers |

**Legenda:** ⏳ Pendente · 🚧 Em andamento · 🧪 Implementada, aguardando teste · ✅ Concluída · ⏸️ Adiada · ⛔ Bloqueada.

## 48b — o que a especificação decidiu (2026-10-22)

- Caminhos fixos `stickers/<id>.webp` e `thumbs/<id>.webp` (sem os campos `file`/`thumb` no manifesto): assim a raiz do pacote sai de qualquer link de figurinha.
- Ref = tag de versão completa (`v1.0.0`) ou commit de 40 caracteres. Conferido com curl: `@1`/`@1.2` e commit curto são resolvidos de novo pelo jsDelivr (cache de 12 h); só tag completa ou commit inteiro é `immutable`. Por isso a tag é `v1.0.0`, não `v1`.
- Atualizações: maior versão listada em `data.jsdelivr.com/v1/packages/gh/<user>/<repo>`.
- `emojis` obrigatório (1–3); `keywords` opcional (≤ 10); `description` opcional; miniatura obrigatória (128 px, ≤ 20 KB); animado ≤ 120 quadros e ≤ 10 s.
- A mensagem vira figurinha só quando não tem mais nada além das duas linhas (ou só o link).
- Pacotes oficiais em `packs/<id>/` (identidade `gh:luantavares127/waze-chat-plus-stickers/packs/<id>`).

## 48c — Pacotes oficiais e ferramentas (Sonnet 5.5)

Antes: o usuário cria o repositório público `waze-chat-plus-stickers` no GitHub (dono `LuanTavares127`; se for outro nome ou dono, trocar na especificação §9–§10, no AGENTS.md daqui e na §8c do script) e escolhe a licença do repositório (código) e o texto de `license` dos pacotes oficiais (arte dos moods do Waze).

- `tools/build.mjs` (`package.json` com `sharp`): lê a arte de `G:\Meu Drive\Waze\Moods\Images (WEBP)\With Border (Com Borda)` + `curation/stickers-curation.json` → `packs/<pack id>/` com `stickers/<id>.webp` (renomeados para o id), `thumbs/<id>.webp` (128 px), `wcp-stickers.json` (nomes e palavras-chave em inglês, `emojis`, `icon`) e `i18n/pt-BR.json`; confere 512×512, ≤ 100 KB, transparência e margem de 16 px.
- `tools/validate.mjs`: um arquivo só, Node 20+, sem dependências (checagens de pixel só com `sharp` instalado); erros e avisos da especificação §1–§7; roda em uma pasta de pacote ou em todas as de `packs/`.
- `showcase.json` com os 6 oficiais na ordem da curadoria; `blocked.json` vazio (`{ "format": 1, "packs": [], "stickers": [] }`).
- `.github/workflows/validate.yml`: valida cada push e PR.
- Tag `v1.0.0` depois do primeiro commit com os pacotes.
- O campo `note` (franquia) da curadoria não vai para o manifesto.
- Configuração do Claude Code em `.claude/` (como no projeto do script), junto com o validador:
  - hook PostToolUse: `node tools/validate.mjs` ao editar `packs/**`, `showcase.json` ou `blocked.json`;
  - hook Stop: avisa quando um manifesto mudou sem tag nova, ou quando um id de figurinha sumiu ou foi renomeado (ids permanentes);
  - rule para `wcp-stickers.json`/`i18n/*.json` (ids permanentes, limites da especificação, sem `note`) e para `docs/sticker-packs.md` (contrato: atualizar a §8c do AGENTS.md do script na mesma tarefa);
  - skill `publish-packs`: validar, criar a tag `vX.Y.Z` nova (nunca mover uma antiga), atualizar o `showcase.json`.

### Pendências da 48c

- **Feito:** `tools/build.mjs` (259 figurinhas em 6 pacotes, 7,7 MB; a arte original é recortada rente ao desenho, então o build a reduz para uma caixa de 480 px e a centraliza num canvas transparente de 512 px, margem de 16 px; leva ~25 min por ler a pasta do Drive), `tools/validate.mjs` (0 erros e 0 avisos nos 6 pacotes, com `sharp`; testado com um pacote quebrado), `showcase.json` (links em `tree/v1.0.0`), `blocked.json` vazio, `.github/workflows/validate.yml`, hooks/rules/skill em `.claude/`.
- **Licença dos pacotes:** o build escreve `All rights reserved` (a arte dos moods é da Waze) e o autor `luan_tavares_127`; trocar em `tools/build.mjs` (`AUTHOR`, `LICENSE`) se o usuário quiser outro texto. Ainda sem arquivo `LICENSE` de código: o usuário escolhe.
- **`.claude/settings.json`** (liga os hooks e as permissões) foi negado pelo classificador de permissões ao ser criado: os hooks existem em `.claude/hooks/` mas não estão ligados até o usuário criar/autorizar esse arquivo.
- **Feito (2026-10-23):** tag `v1.0.0` criada no commit 4825a69 e enviada; os 6 manifestos respondem 200 `immutable` no jsDelivr (antes da tag o script recebia 404). O repositório no GitHub é `Waze-Chat-Plus-Stickers` (maiúsculas); a identidade dos pacotes fica em minúsculas (especificação §1) e GitHub/jsDelivr não diferenciam (conferido com curl em 2026-10-22: as duas grafias respondem 200 em `github.com/…` e em `cdn.jsdelivr.net/gh/…@main/README.md`), então nada precisa mudar.

## 48d — Idiomas dos pacotes oficiais (Sonnet 5.5)

Nomes, palavras-chave e nome do pacote nos 46 idiomas do script: um `i18n/<locale>.json` por pacote (especificação §3) e os códigos em `locales` do manifesto. O agente `i18n-translator` do script trabalha com `scripts/i18n.mjs` de lá, então aqui ele recebe a tarefa com a instrução de escrever esses JSON direto (ids iguais, nomes numéricos ficam o número). Nova tag de versão depois. Antes: um agente de tradução próprio em `.claude/agents/` (ou o `i18n-translator` adaptado) que escreve os `i18n/<locale>.json` direto.

## 48e — Worker (Sonnet 5.5)

O código do Worker atual (proxy de GIFs da KLIPY) passa a ficar em `worker/`, colado à mão no editor da Cloudflare, com as rotas novas:
- `GET /stickers/showcase` e `GET /stickers/blocked`: cópia de `showcase.json`/`blocked.json` deste repositório (lidos do jsDelivr na branch padrão ou da API do GitHub), cache de 5 min;
- se fizer falta, um hook que confere o código de `worker/` ao editar;
- `POST /stickers/report`: `{ pack, sticker?, reason, details? }` validado (os `reason` da especificação §8), limite por IP, vira issue aqui por um token *fine-grained* só de issues (segredo do Worker).

### Pendências da 48e

- **Feito:** `worker/worker.js` = o proxy de GIFs que já estava no ar (lido da Cloudflare, comportamento igual) + `GET /stickers/showcase` e `/stickers/blocked` (lidos da branch `main` pelo `raw.githubusercontent.com`, JSON de formato 1 conferido, cache de 5 min) + `POST /stickers/report` (valida `pack`, `sticker?`, `reason` da especificação §8 e `details` ≤ 500; 5 por hora por IP; texto limpo de menções e crases; abre issue pela API do GitHub; nunca devolve o corpo de erro deles). Fallback para o jsDelivr fica no script (48g).
- **Feito pelo usuário (2026-10-23):** token *fine-grained* só de Issues, segredos `GITHUB_TOKEN` e `KLIPY_KEY` (recriada como Secret) e deploy; teste ao vivo abriu a issue #1 (fechada).
- **Atenção:** na Cloudflare, `KLIPY_KEY` está como *Text* (texto visível no painel e na API), não *Secret*. Convém recriá-la como Secret (e, por ter ficado exposta, considerar trocar a chave na KLIPY).

- **Depois (2026-10-23, pedido do usuário):** freios contra abuso: bindings de Rate Limiting por IP e minuto (GIFs 30, listas 10, denúncias 2, folgados para CGNAT) e KV `REPORTS` com teto diário de denúncias (5 por IP com hash, 30 no total, UTC); `worker/wrangler.toml` + `npx wrangler deploy` (os bindings não se configuram pelo painel). Publicado em 2026-10-23 (KV `REPORTS` criado, mesma compatibility date 2026-10-14, Preview URLs desligadas): GIFs, vitrine e bloqueadas respondem normalmente; os limites por minuto da Cloudflare são aproximados (um teste com limite 5 deixou passar ~70% de 60 pedidos), então o Worker barra quando o binding ou o contador em memória passa do limite; o teto diário de denúncias no KV é o freio firme (testado localmente, não ao vivo para não abrir issues).

## Depois da 48

- Skill `add-official-sticker`: mood novo → curadoria, build, i18n, nova versão do pacote.
