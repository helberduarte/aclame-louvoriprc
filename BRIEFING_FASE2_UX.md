# Briefing — ACLAME Fase 2 (UX/Visual)

**v2 — atualizado depois que Etapas A e B (navegação + tema) já foram feitas
e mergeadas em `main` por outra sessão.** Se você está lendo a v1 deste
documento, ela está desatualizada — o menu não é mais uma lista plana de
21 itens, e o tema Midnight Blue já está aplicado. Ler por completo antes
de tocar em qualquer arquivo.

## 0. Contexto do projeto

App: ACLAME — escalas, louvor e voluntariado, IPR Cáceres-MT.
Repo: `helberduarte/aclame-louvoriprc`, branch `main`. Deploy: Vercel + Supabase
(Postgres). Produção: `https://aclame-louvoriprc.vercel.app`.
Stack: **Node.js puro no backend (zero framework), HTML/CSS/JS vanilla no
frontend (zero build, zero bundler)**. `public/` servido estático pela
Vercel; `api/[[...path]].js` é a única função serverless.

**Dados de produção são descartáveis neste momento** — não precisa se
preocupar em preservar dados reais durante a Fase 2; eles são repopulados
depois com `seed-real.js --force` quando tudo estiver pronto.

## 1. Regras inegociáveis (custaram várias rodadas de bug pra aprender)

1. **Nunca** crie um arquivo `.js`/`.mjs`/`.ts` chamado `server.*` na raiz do
   projeto ou dentro de `src/`. **Nunca** deixe uma chamada `.listen()`
   sobrar em qualquer arquivo na raiz ou em `src/` — a Vercel varre esses
   dois locais procurando um "servidor" pra capturar como entrypoint único;
   se achar, ignora `api/` inteira e o deploy quebra com
   `FUNCTION_INVOCATION_FAILED`. Bootstrap de dev local mora em
   `scripts/dev.js` de propósito. Framework Preset do projeto na Vercel
   está fixado em **"Other"** no painel (fora do repo) — não mexer.
   `vercel.json` tem `rewrites` explícito de `/api/*` (a convenção
   `[[...path]]` sozinha não cobria rotas com 2+ segmentos).
2. **Uma migração por vez.** Este briefing é só sobre `public/` (frontend).
   Não toque em `db.js`, `engine.js`, `app-core.js`, `api/`, `seed-real.js`
   nem no schema do banco.
3. **Trabalhe em branch, nunca direto em `main`.** Isso não é sugestão —
   na última rodada da Fase 2, o merge final pra `main` aconteceu sem
   revisão, quebrando a própria promessa de segurança que o processo tinha
   criado. Abra `feature/<nome-do-bloco>`, empurre pra lá, e **só mergeie em
   `main` depois que o Helber (ou eu, revisando no navegador) confirmar.**
4. Existe uma tag de segurança real no GitHub, testada e confirmada:
   `backup-pre-fase2-20260708-1503` → commit `50d7190` (backend estável,
   56 testes verdes, zero mudança visual). Comando de reversão total, se
   algo desandar de verdade:
   ```bash
   git revert --no-commit f396db0 3ac03c1 7666d1b 761ba88
   git commit -m "Reverte Fase 2 (UX/visual) — volta ao estado estável 50d7190"
   git push
   ```
   (usa `revert`, não `reset --hard` — não reescreve histórico, não precisa
   de force-push, seguro mesmo com outras pessoas trabalhando no repo.)
5. Sempre `git status` antes de commitar. Depois do push, **confirme no site
   ao vivo** — já aconteceu de a Vercel marcar "Ready" e o site continuar
   quebrado, e também o oposto (marcado como funcionando e realmente estava).
   Não confie só no status do painel nem só na palavra de quem testou.

## 2. O que já existe hoje (estado real, pós-redesenho)

### Navegação (`renderNav()`, `app.js` linha ~201)
Não é mais lista plana. São **4 grupos** (`grupos[]`), cada um um objeto
`{ icone, rotulo, principal, prefixos, itens }`:
1. **Visão Geral** — Painel de indicadores, Mural da igreja, Notificações,
   Feedbacks.
2. **Escalas do Mês** — Escala do mês, Cultos & escalas, Minha agenda,
   Disponibilidade, Trocas, Indisponibilidades, Celebrações.
3. **Gestão de Voluntários** — Voluntários, Habilidades, Pontos,
   Ministérios, Usuários & papéis.
4. **Ministério de Louvor** — Estante musical, Setlists.

Cada grupo é um `<a class="aba-mestre">` sempre visível; os itens do grupo
ativo aparecem como `<div class="sub-abas">` (acordeão — só o grupo cujo
`prefixos` bate com o hash atual expande). Visibilidade por papel já é
respeitada por item (3º elemento do array = `true`/`ehLider()`/`ehAdmin()`).
Logo (`public/logo.png`) + "IPR Cáceres - MT" já estão no topo da sidebar
(`.sidebar-marca`).

### Tema (`styles.css`, variáveis no `:root`)
Já aplicado: fundo `--plano: #0d1830` (midnight blue), superfícies com
`--superficie-vidro: rgba(23,35,61,.66)` + `backdrop-filter: blur(...)`,
acento `--acento: #d7b56d` (dourado champagne) / `--acento-forte: #e7cd92`,
texto `--ink-1/2/mudo`. Contraste já validado (WCAG 2.1, ≥4.5:1 texto
normal / ≥3:1 UI) — ver `--critico-fundo: #9e3535`, criada especificamente
pra corrigir um par que reprovou. **Reaproveitar essas variáveis, não criar
uma paleta nova.**

### Calendário de grade mensal
Continua existindo em `#/disponibilidade` (`renderDisponibilidade`,
`app.js`) — é o componente a reaproveitar nos Blocos 1 e 2 abaixo.

### Mural (`#/mural`) e Agenda (`#/agenda`)
Ainda são listas cronológicas de cards, sem grade de calendário — os Blocos
1 e 2 deste briefing continuam válidos como estavam. O redesenho já feito
foi navegação + tema; a estrutura interna dessas duas telas **não mudou**.

### Roteiro do culto (`#/culto/:id`)
Continua sendo a timeline (abertura, oração, louvor, oportunidades,
consagração, palavra) — ponto de encaixe do recorte "tipo Trello" do
Bloco 2.

## 3. Blocos de trabalho (inalterados em escopo, só a base mudou)

### Bloco 1 — Mural (fazer primeiro)
- Trocar lista cronológica por grade de calendário mensal (reaproveitando
  `renderDisponibilidade`).
- Agrupar cultos por dia; mais de um no mesmo dia → miniatura do mais
  recente + selo vermelho circular "+N".
- Clique no dia abre modal com detalhamento do(s) culto(s).
- Avisos renderizam **antes** da lista/grade de cultos (hoje é o contrário).
- Título vira "Mural — Escalas publicadas e avisos — tudo num só lugar."
  (hoje o título é "Mural da igreja"; o subtítulo já tem esse texto).
- Usar as variáveis de tema existentes (`--acento`, `--superficie-vidro`
  etc.) — não inventar cor nova.

### Bloco 2 — Agenda + recorte pequeno tipo checklist
- Grade de calendário mensal com as escalas do voluntário logado (mesmo
  componente do Bloco 1).
- Clique no dia abre detalhamento com ações já existentes (Confirmar,
  Recusar, Pedir troca, Roteiro).
- Recorte aprovado **apenas neste tamanho**: itens da timeline de
  `#/culto/:id` ganham checkbox de concluído + etiqueta de texto livre.
  Sem quadros, sem colunas, sem arrastar-e-soltar, sem anexos.

### Bloco 3 — Menu — **já feito** (Etapa A, commit `f396db0`)
Nada a fazer aqui. Se quiser refinar o visual da dock/acordeão além do que
já existe, tratar como ajuste pontual, não como bloco novo.

### Bloco 4 — Seção inicial devocional — continua bloqueado
Duas pendências sem resolução ainda: (1) confirmar termos de uso da API
`api.midvash.com` pra redistribuição de texto NAA (direitos da SBB); (2)
autoria do conteúdo devocional/quiz — não existe hoje, é trabalho de
conteúdo, não só de código. Não iniciar a interface antes disso.

### Bloco 5 — Cards de voluntários — segue como antes
Referência: padrão `toolbar-expandable` do cult-ui, reproduzido em CSS/JS
puro dentro da paleta já estabelecida no tema atual.

### Bloco 6 — React vs. vanilla — resolvido na prática
A Etapa B/tema já foi feita em CSS/JS puro, dentro da arquitetura
zero-build existente, com resultado aprovado (contraste validado, sem
framework novo). Isso é evidência de que o caminho vanilla funciona bem
pra esse tipo de mudança — usar como referência de "como fazer" pros
Blocos 1, 2 e 5.

## 4. Ordem sugerida

1. Bloco 1 (Mural).
2. Bloco 2 (Agenda + checklist do roteiro).
3. Bloco 5 (cards de voluntários), se houver apetite.
4. Bloco 4 (devocional) só depois de resolver fonte bíblica + autoria.

## 5. Ao final de cada bloco

- Branch própria (regra 3), nunca commit direto em `main`.
- `npm test` (56 testes verdes — confirma que nada do backend vazou).
- `git status`, revisar com o Helber, commit, push **da branch**.
- Merge em `main` só depois de confirmação visual no site ao vivo.
- Atualizar `DOCUMENTACAO_EVOLUTIVA.md` com o que mudou.
