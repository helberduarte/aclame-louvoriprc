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

**Status:** mergeado em `main` (commit `761ba88`) em 08/07/2026, aprovado
pelo Helber após revisão do preview. Produção confirmada no ar (HTTP 200,
tema/rewrite corretos). Tag de segurança `backup-pre-fase2-20260708-1503`
enviada ao GitHub (estava só local até então — lacuna fechada em 09/07/2026).

## Fase 2, Bloco 1 — Mural em grade de calendário (09/07/2026, branch `feature/mural`)

Base: `BRIEFING_FASE2_UX.md` (v2, commit `55beca7`), que documenta o estado
real pós Etapas A/B e corrige uma v1 desatualizada (sem essa v2, um
prompt anterior enviado por engano teria refeito o redesign do zero em
React — descartado; ver `helber-perfil`/`aclame-deploy-vercel` na memória).

- `#/mural`: cultos publicados saem da lista cronológica e viram uma grade
  de calendário mensal (reaproveita o padrão visual/estrutural de
  `renderDisponibilidade`), com navegação ← anterior / próximo → **sem
  refetch** — `/api/mural` já devolve tudo, filtro por mês é só client-side
  (`renderMuralCalendario`, `app.js`).
- Mais de um culto no mesmo dia: mostra o mais recentemente publicado como
  miniatura + selo vermelho circular "+N"; clique no dia abre modal
  (`abrirModalDiaMural`) com todos os cultos daquele dia, cada um clicável
  para `#/culto/:id`.
- Avisos passaram a renderizar **antes** da grade de cultos (era o
  contrário). Título da página: "Mural da igreja" → "Mural" (o subtítulo já
  estava correto, não mudou).
- CSS novo (`.tem-culto`, `.cal-culto-info`, `.cal-badge-mais`) reaproveita
  só variáveis do tema já existente — nenhuma cor nova.
- Nenhum arquivo de backend tocado (regra do briefing).

### Verificação deste bloco
- `node --check public/app.js` OK; CSS balanceado OK.
- `npm test`: mesma limitação de sempre (sem Postgres local) — mudança é só
  `public/`, sem risco de vazamento no backend.
- Preview estático local (stub de API, sem tocar produção): grade com
  múltiplos cultos/dia, badge "+N", modal, clique→navegação, troca de mês,
  visão de membro sem botões de gestão, responsividade da própria grade
  (7 colunas fluidas) — tudo com screenshot e zero erro de console.
- **Limitação encontrada**: a extensão do navegador conectada ficou
  bloqueada para navegar em domínios `vercel.app`/`vercel.com` nesta sessão
  (não é a primeira vez — mesma trava já tinha aparecido na Fase 2). Não foi
  possível confirmar visualmente a URL de preview real da Vercel por conta
  própria; pedido ao Helber para abrir e confirmar antes do Bloco 2. Build
  do preview (commit `91904b3`) confirmado **success** via API do GitHub.
- **Achado, não corrigido (fora de escopo)**: a sidebar (`.sidebar`, largura
  fixa 236px) não colapsa em mobile — em qualquer tela do app, não só no
  Mural. Pré-existente às Etapas A/B; a grade de calendário em si já é
  responsiva (colunas fluidas), o corte vem só da sidebar.
- **Achado no próprio briefing (não bloqueante para este bloco)**: o comando
  de rollback total documentado (`git revert --no-commit f396db0 3ac03c1
  7666d1b 761ba88`) vai falhar — `761ba88` é merge commit (2 pais), precisa
  de `-m 1`. Corrigir se algum dia for realmente executado.

**Status:** mergeado em `main` (commit `207352b`) em 09/07/2026, após o
Helber confirmar visualmente a grade de calendário no preview da Vercel
(login via GitHub — mesma conta de sempre) e eu confirmar via smoke test
direto em produção (`aclame-louvoriprc.vercel.app`): HTTP 200, `styles.css`
e `app.js` com as versões novas (`v=7`/`v=8`), classes/função do Bloco 1
presentes no bundle servido, rewrite de `/api/*` intacto.

## Fase 2, Bloco 2 — Agenda em grade + checklist do roteiro (09/07/2026, branch `feature/agenda`)

- `#/agenda`: mesma migração de lista cronológica → grade de calendário
  mensal (`renderAgendaCalendario`, reaproveitando o padrão do Bloco 1).
  Clique no dia abre modal (`abrirModalDiaAgenda`) com as escalas do dia e
  todas as ações que já existiam (Confirmar, Recusar, Check-in, Pedir
  troca, Avaliar, Roteiro) — migraram pra dentro do modal porque `#modal`
  fica fora do container onde a rota antiga delegava os cliques.
- `#/culto/:id` (timeline do roteiro): cada item ganhou checkbox
  "Concluído" + etiqueta de texto livre — recorte aprovado no briefing
  (sem quadros/colunas/drag-and-drop/anexos). Estado só em `localStorage`
  por ocorrência+item (`aclame_roteiro_<id>_<idx>`) — **pessoal, não
  sincroniza entre pessoas/dispositivos**, porque não foi criada tabela
  nem endpoint novo (regra do briefing: não tocar em `db.js`/`api/`/schema).
  Se no futuro isso precisar ser compartilhado entre a equipe, vai exigir
  uma migração de schema — está fora do escopo desta fase de propósito.
- CSS novo (`.rot-check`, `.rot-item.feito`) só variáveis do tema já existente.

### Verificação deste bloco
- `node --check public/app.js` OK; CSS balanceado OK.
- `npm test`: mesma limitação de sempre (sem Postgres local).
- Preview estático local: grade com dia único e com múltiplos itens (+1),
  modal com ações certas por status, clique em Confirmar fecha modal e
  atualiza a agenda, navegação de mês, checklist marca/desmarca + etiqueta
  persistindo e sobrevivendo à renavegação — tudo verificado via
  `preview_snapshot`/`preview_eval` (o `preview_screenshot` deu timeout
  nesta sessão por motivo à parte, não relacionado ao código) — zero erros
  de console em todo o fluxo.
- Build do preview (commit `8921e86`) confirmado **success** via API do GitHub.

**Status:** mergeado em `main` (commit `b5ad3b7`) em 09/07/2026, após o
Helber confirmar visualmente a grade da Agenda e o checklist do roteiro no
preview, e eu confirmar via smoke test em produção
(`aclame-louvoriprc.vercel.app`): HTTP 200, `styles.css`/`app.js` com
versões novas (`v=8`/`v=9`), funções/classes do Bloco 2 presentes no bundle
servido, rewrite de `/api/*` intacto.

## Fase 2, Bloco 5 — Cards de voluntários (09/07/2026, branch `feature/cards-voluntarios`)

- `#/voluntarios`: tabela virou grade de cards (`.grade-cartoes`, já
  existente desde o tema da Fase 2), padrão "toolbar-expandable" citado no
  briefing: botão "⋯" expande um toolbar (Editar, Ativar/Desativar) via
  transição de `max-height`/`opacity`, sem sair da lista. Clique no corpo
  do card continua abrindo o perfil completo, como a linha da tabela antes.
- "Editar" direto da lista é novo (antes só dava pra editar entrando no
  perfil) — reaproveita `formVoluntario(v)` já existente, sem mudança de
  API (campos batem com o que `GET /api/voluntarios` já devolve).
- Decisão consciente: **não** adicionei um botão de WhatsApp direto no
  card. O padrão do app sempre gera o link/telefone formatado no servidor
  (`data-zap` → `/api/escala/:id/whatsapp`); reproduzir isso client-side
  seria inventar lógica nova de formatação de telefone e, na prática,
  tocar em API — contra a regra do briefing.
- CSS novo (`.voluntario-card`, `.avatar-vol`, `.voluntario-toolbar` etc.)
  só variáveis do tema já existente.

### Verificação deste bloco
- `node --check public/app.js` OK; CSS balanceado OK.
- `npm test`: mesma limitação de sempre (sem Postgres local).
- Preview estático local com instrumentação das chamadas de API: grade com
  3 voluntários (ativo/inativo/termo pendente), toggle expande/recolhe,
  Editar abre modal com dados certos, Ativar/Desativar chama
  `PUT /api/voluntarios/:id` com body correto (`{ativo:0}`) e atualiza a
  lista, clique no corpo do card navega pro perfil — zero erros de console.
- Build do preview (commit `a0315c1`) confirmado **success** via API do GitHub.

**Status:** branch `feature/cards-voluntarios` enviada ao GitHub,
aguardando confirmação visual do Helber antes do merge.
