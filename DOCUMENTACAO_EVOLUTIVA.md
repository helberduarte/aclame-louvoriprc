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

**Status:** mergeado em `main` (commit `19aa568`) em 09/07/2026, após o
Helber confirmar visualmente os cards no preview, e eu confirmar via
smoke test em produção (`aclame-louvoriprc.vercel.app`): HTTP 200,
`styles.css`/`app.js` com versões novas (`v=9`/`v=10`), classes/funções do
Bloco 5 presentes no bundle servido, rewrite de `/api/*` intacto.

---

## Fim da Fase 2 (blocos ativos)

Blocos 1, 2 e 5 concluídos e em produção. Bloco 3 (menu) já estava pronto
antes desta rodada. Bloco 4 (seção devocional) segue **bloqueado** — não é
uma pendência de código: falta (1) confirmar os termos de uso da API
`api.midvash.com` para redistribuição de texto NAA (direitos da SBB) e
(2) autoria do conteúdo devocional/quiz, que ainda não existe. Não iniciar
a interface antes de resolver os dois pontos (ver `BRIEFING_FASE2_UX.md`,
Bloco 4).

### Bloco 4 — atualização em 09/07/2026: pendência (1) resolvida, (2) segue aberta, feature pausada por falta de escopo

- **Fonte bíblica resolvida por pesquisa**: a Almeida Revista e Corrigida
  de **1911** é a versão mais recente genuinamente em domínio público em
  português (confirmado em múltiplas fontes — ver busca desta sessão).
  Toda tradução posterior (ACF, ARC, NAA, NVI etc.) é protegida por
  direitos autorais. Existe um projeto open-source
  ([damarals/biblias](https://github.com/damarals/biblias)) que já
  disponibiliza a Almeida 1911 em JSON, marcada explicitamente como
  domínio público (†). Plano técnico (não implementado ainda): empacotar
  só os versículos usados como JSON estático em `public/` — sem chamada
  externa em tempo real, sem tocar em `api/`/backend.
- **YouVersion descartado como fonte de texto**: o Helber sugeriu capturar
  passagens do YouVersion/Bible.com — recusado, porque as traduções lá
  hospedadas são majoritariamente protegidas por direitos autorais e o
  scraping violaria os termos de uso deles. Ficou combinado usar a Almeida
  1911 para o texto, a partir da referência (livro/capítulo/versículo)
  que o Helber fornecer.
- **Pendência (2) ainda aberta**: o app registra `tema` (texto livre) por
  culto, mas **não existe campo para a passagem bíblica pregada**
  (livro/capítulo/versículo) — não é algo que dá pra inferir do `tema`
  sem arriscar incoerência com o que foi pregado de verdade. O Helber
  pediu que os devocionais sigam exatamente o tema/passagem pregada em
  cada culto, então dados reais (não genéricos) são necessários.
- **Decisão do Helber em 09/07/2026: deixar o Bloco 4 fora do projeto por
  enquanto** — ele não tem clareza ainda de que tema/passagem quer usar
  como amostra. Nenhum código ou conteúdo foi criado. Retomar quando ele
  trouxer tema + referência bíblica real de alguns cultos.

---

## Fora da Fase 2 — pedidos avulsos do Helber (09/07/2026)

Duas entregas que não fazem parte do briefing original, pedidas direto
pelo Helber depois que a Fase 2 já tinha encerrado.

### Celebrações: tipo "Vários dias" (retiros/acampamentos) — commit `09ecb2e`

- Motivação real: Helber tentou cadastrar o "Retiro Espiritual 2026 —
  Aviva-nos outra vez" (17 a 19/07, Chácara Betel) e só existia "Semanal"
  ou "Data única" (um dia só) — sem jeito de cobrir um retiro de vários
  dias direto pela tela.
- `formEvento` ganhou 3ª opção de Tipo: "Vários dias (retiro/acampamento)".
  Só aparece ao criar (não ao editar) porque não é um tipo persistente —
  ao salvar, gera N celebrações "Data única" (uma por dia), cada uma com
  escala/roteiro/vagas independentes, reaproveitando 100% o `POST
  /api/eventos` já existente. Nenhuma rota nova, nenhuma mudança de
  schema. Trava de segurança: máximo 14 dias por intervalo, com contagem
  real via aritmética de datas (não trunca a mensagem de erro).
- Chama `POST /api/ocorrencias/gerar` ao final — ocorrências já saem
  materializadas, sem passo manual extra.
- **O retiro real do Helber foi criado direto no banco de produção**
  (script pontual reaproveitando `db.js`/`engine.js`, mesma lógica de
  `seed-real.js`) enquanto a feature ainda estava em branch, porque o
  navegador conectado desta sessão não conseguiu abrir domínios
  `vercel.app` (mesma limitação recorrente). Local "Chácara Betel"
  criado (`locais`, tipo `capela`). As 3 ocorrências (sex 17/07, sáb
  18/07, dom 19/07) têm `tema = 'Aviva-nos outra vez'`, horário 08:00,
  duração 720 min (12h, "dia todo" — ajustável por dia em Editar).
  Vagas por função ficaram para o Helber configurar manualmente por dia
  (não dá pra automatizar sem saber as necessidades reais de cada dia).
- Achado que **não era bug real**: o Grep encontrou por 3 vezes nesta
  sessão trechos que pareciam `<\label>`/`<\span>`/`href="#\escalas"`
  (barra invertida em vez de normal) — todas eram artefato de exibição da
  ferramenta de busca, não do arquivo real (confirmado via `cat -A` byte
  a byte todas as vezes). Lição: nunca tratar como bug uma tag/URL
  suspeita sem confirmar com `sed`/`cat -A` primeiro.

### Ajuste global: dia da semana por extenso em toda data — commit `a5062dc`

- Pedido: sempre que houver informação de data, mostrar o dia da semana
  por extenso (ex.: "sábado - 18/07/2026 às 08:00h").
- `fmtData(iso)` (usado em 21 lugares) trocou de abreviado+vírgula
  ("sáb, 18/07/2026") para extenso+hífen, minúsculo ("sábado -
  18/07/2026") — o dia da semana se propagou pra todo lugar que já
  chamava essa função, sem editar cada um. `fmtDataHora(ts)` (timestamps
  de auditoria) ganhou o mesmo tratamento, reaproveitando `fmtData`
  internamente. Novo helper `fmtDataEHora(iso, hora)` unificou as 7
  concatenações manuais de data+hora que não tinham o sufixo "h"
  (Roteiro, Agenda, Trocas, Celebrações). As 2 faixas de horário sem data
  (disponibilidade semanal, "das X às Y") ficaram como estavam —
  não têm informação de data, fora do escopo do pedido.
- `DIAS_CURTOS` removida (ficou sem nenhum uso depois da mudança).
- Branch separada de propósito da `feature/celebracao-varios-dias` —
  mudanças independentes, aprovadas juntas pelo Helber mas sem
  dependência uma da outra.

**Status de ambas:** mergeadas em `main` (commits `09ecb2e`, `a5062dc`,
mais o bump de versão `36c4a7f` — as duas branches bumpavam
`app.js?v=` de forma independente e precisaram de um ajuste de versão
final pra não servir cache velho). Confirmadas em produção via smoke
test (HTTP 200, `app.js?v=12`, `MAX_DIAS_INTERVALO` e `fmtDataEHora`
presentes no bundle, rewrite de `/api/*` intacto). Branches deletadas
(local + GitHub) depois do merge.
