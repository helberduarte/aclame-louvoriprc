# Documentação Evolutiva — ACLAME

Registro das decisões e mudanças por fase. O guia operacional de deploy vive em
`NUVEM-PASSO-A-PASSO.md`; a memória de produto em `claudedoc.txt`.

---

## Fase 1 — Porte para a nuvem (08/07/2026, em produção)

- Migração SQLite → PostgreSQL (Supabase) com `pg-core.js` adaptando o driver
  `pg` à interface `db.prepare().run/get/all()`.
- Vercel: estáticos servidos de `public/`, API inteira em `api/[[...path]].js`.
- **Lição estrutural**: a Vercel "captura" como servidor único qualquer arquivo
  na raiz ou em `src/` que chame `.listen()` (e o preset "Node" exige isso).
  Por isso o bootstrap local vive em `scripts/dev.js`, o Framework Preset do
  projeto na Vercel é **"Other"** (config no painel, fora do repo) e o
  `vercel.json` tem `rewrites` de `/api/*` (a convenção `[[...path]]` sozinha
  não cobria rotas com 2+ segmentos). Detalhes: NUVEM-PASSO-A-PASSO.md,
  "Se algo der errado".

## Fase 2 — Redesign UX/UI (08/07/2026, branch `feature/ux-redesign-fase2`)

Kit de rollback: ver `ROLLBACK.md`. `main`/produção intocadas até merge aprovado.

### Etapa A — Navegação em 4 abas mestres (commit `f396db0`)
- `renderNav()` reescrita: 4 grupos com ícones Lucide embutidos como SVG inline
  (app permanece sem CDN) — Visão Geral, Escalas do Mês, Gestão de Voluntários,
  Ministério de Louvor.
- Telas antigas viraram sub-abas do grupo ativo (acordeão); rotas de detalhe
  (`#/culto/`, `#/musica/`, `#/voluntario/`) acendem o grupo via `prefixos`.
- Nenhuma das 21 rotas foi removida; `#/setlists` ganhou entrada no menu.
- Logo (`public/logo.png`) + "IPR Cáceres - MT" no topo da sidebar.
- Visibilidade por papel preservada (membro/líder/admin) — verificado por stub.

### Etapa B — Tema Midnight Blue + dourado (commit `3ac03c1`)
- Tema único e solene (removida a variante clara `prefers-color-scheme`):
  fundo `#0d1830`, feixe de luz cênica vertical (radial-gradients dourados),
  vidro flutuante (`backdrop-filter: blur` + borda 1px translúcida + leve
  `scale` no hover) em cartões, tabelas, KPIs, gráficos, modal e painéis.
- Acento violeta → dourado champagne (`--acento: #d7b56d`,
  `--acento-forte: #e7cd92`); texto sobre dourado usa `--acento-contraste`.
- **Acessibilidade**: 21 pares texto/fundo validados por ferramenta
  (script de razão de contraste WCAG 2.1) — todos ≥ 4.5:1 (texto normal) ou
  ≥ 3:1 (UI/ícones). O par "branco sobre #e57373" reprovou (2.99:1) e originou
  a variável `--critico-fundo: #9e3535` (6.97:1) para toast de erro e badge.

### Verificação desta fase
- `node --check public/app.js`: OK. Balanceamento do CSS: OK.
- Suíte de testes do backend não roda nesta máquina (exige PostgreSQL local em
  `127.0.0.1:5432`, inexistente aqui) — mudanças desta fase são exclusivamente
  de frontend (`public/`), sem alteração de lógica de negócio, schema ou API.
- Verificação visual/funcional via servidor estático local: login, sidebar
  admin, acordeão entre grupos, visão de membro sem vazamento de itens de
  gestão, zero erros de console.
