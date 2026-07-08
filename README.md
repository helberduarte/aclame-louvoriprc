# 🙌 Aclame

App de **escalas, louvor e voluntariado** para a sua igreja. Nuvem 100% gratuita: banco **PostgreSQL no Supabase**, aplicação rodando como função serverless na **Vercel**.

## Rodando localmente (desenvolvimento)

Requer um PostgreSQL acessível (o mais simples é instalar localmente — veja `NUVEM-PASSO-A-PASSO.md` se preferir usar o Supabase já em dev).

```bash
npm install
npm test                 # roda os 56 testes num schema Postgres efêmero (autoisolado, some sozinho)
PORT=3000 node app-core.js # sobe o servidor em http://localhost:3000
```

Sem a variável `PGURL` definida, o servidor usa `postgres://aclame:aclame@127.0.0.1:5432/aclame` por padrão (veja `.env.example`).

**Dados de demonstração**: `ACLAME_SEED=1 node app-core.js` (só roda se o banco estiver vazio).

**Usuários de demonstração** (senha `1234`):

| Usuário | Login | Papel |
|---|---|---|
| Evandro Silva | `evandro@aclame.local` ou `11999990001` | Administrador |
| Viviane Costa | `viviane@aclame.local` | Líder do Louvor |
| Elielson Ramos | `elielson@aclame.local` | Líder da Mídia |
| Kelly Souza | `kelly@aclame.local` | Membro |
| Clarianne Dias | `clarianne@aclame.local` | Membro |

O primeiro usuário que se registrar num banco vazio vira administrador automaticamente.

**Dados reais**: `PGURL=... node seed-real.js --force` recria o banco com a escala real de julho/2026 — as contas reais (não-demo) já cadastradas são preservadas com as mesmas senhas antes do reset. Sem `--force`, o comando recusa rodar se o banco já tiver dados (proteção contra apagar por engano).

## Deploy na nuvem (Supabase + Vercel, gratuito)

Passo a passo completo para quem não é programador: **`NUVEM-PASSO-A-PASSO.md`**.

## Funcionalidades

### Conta e papéis
- Login com **telefone ou e-mail + senha**; papéis **admin / líder / membro**.
- **Autoria em tudo**: "Culto de Sábado — criado por Evandro", quem publicou e quando.
- Admin gerencia usuários, papéis e lideranças de ministério.

### Escalas
- **Disponibilidade self-service**: janelas semanais + calendário do mês; dia indisponível exige **justificativa obrigatória**.
- **Membro multi-setorial**: habilidades/dons por ministério (ex.: Louvor: Baixo, Viola · Mídia: Projeção · Diaconia) — e o motor **nunca escala a mesma pessoa em dois setores no mesmo culto**.
- **Escala mensal**: o líder escolhe ministério + mês e o motor preenche todos os cultos usando as disponibilidades, com balanceamento (quem serviu menos entra primeiro) e detecção de conflitos entre locais.
- **Confirmações gratuitas via WhatsApp**: botão 📲 abre o WhatsApp com a mensagem pronta (wa.me) + notificações internas no sininho.

### Trocas 2.0
- Troca **aberta** (colegas da função) ou **dirigida** ("pedir para a Clarianne ficar no lugar da Kelly").
- **Prazo** de resposta (até o dia do culto) com **expiração automática**.
- Status completo: aguardando → aceita / recusada / cancelada / expirada, com data da solicitação e da confirmação.
- Clareza de substituição: **"Clarianne fica no lugar de Kelly"**.

### Painel de trocas (v4)
- **Painel de controle** em tabela: pedido de troca · substituto · evento/culto · data do culto · status — com o texto do pedido e a data de criação.
- Status com semáforo: **🟡 Pendente · 🟢 Troca confirmada · 🔴 Troca indisponível** (recusada/cancelada/expirada) + filtro.
- **Solicitar** direto do painel, **editar** (motivo, prazo, substituto — o novo substituto é notificado) e **excluir** do histórico (pendente exige cancelar antes).
- Contadores: **minhas solicitações** por status e **quem assume** minhas trocas (nome × quantidade).

### Ranking da igreja (v4) — Servindo, referência e compromisso
- Status automático por membro: **🟢 Compromissado em servir · 🟡 Precisa melhorar · 🔴 Alerta negativo**.
- **Índice de compromisso 0–100** por métricas transparentes (confirmação, presença, faltas, trocas assumidas) com os critérios exibidos no app.
- **Nota geral da igreja 0–10 🥇** (proporção de 🟢) e **pódio 1º/2º/3º**; filtro de período (30/90/180/365 dias).
- Avaliação **gerada automaticamente, sem favoritismo** — incentivo a servir com excelência no Reino de Deus.

### Notificações e pendências (v4)
- **Alerta de cultos com pendências** (líder): vaga incompleta por função ("Violão: 0/1"), **louvores não informados**, escalados sem confirmar, indisponíveis, conflitos e culto não publicado — com a tratativa a um clique.
- **🎶 Setlist por WhatsApp**: texto da setlist aprovada com **tonalidade fixada** (a mesma para todos) + links de cifra e letra por música, e **link wa.me individual** para cada escalado (instrumentistas e vozes).

### Estante e convites (v5)
- **Convites com expiração** (7 dias, uso único), com **📋 copiar** e **📲 enviar por WhatsApp** — a mensagem pronta explica o objetivo do link.
- **Marcadores interativos** no cadastro da música: [INTRO] [VERSO] [PRÉ-REFRÃO] [REFRÃO] [SOLO] [FINAL] inserem na posição do cursor e removem ao clicar de novo (sem duplicar).
- **🔍 Buscar na internet** preenche a letra (lyrics.ovh) e os links de referência de letra, cifra, YouTube e Spotify de uma vez.
- **📋 Salvar em setlist** direto do cartão da música (lista existente ou nova).
- **Acordes coloridos** na cifra (estilo Cifra Club), com **cor configurável** pelo usuário (🎨 na barra da cifra).
- **🗂 Indicador de versões** no cartão e na página da música, com chips para navegar entre a original e as versões salvas.

### Feedbacks interativos (v4)
- Membro **avalia o culto** (nota + comentário) pela página do culto a partir do dia do culto, e pode **editar ou excluir** a própria avaliação.
- Painel do líder com **média, distribuição das notas** e ações: **🙏 Agradecer** (notifica o autor) e excluir.

### Mural & roteiro de culto
- Cultos publicados **ordenados por data** (próximos primeiro), com autor e hora da publicação.
- Roteiro completo por culto: **tema** (ex.: Ceia), **abertura**, **oportunidades** numeradas (1️⃣2️⃣3️⃣), dízimos, **louvores com tonalidade**, **pregador**, ministração e **responsabilidade** (ex.: Departamento Masculino).
- **Timeline visual** do roteiro + botão **"Copiar p/ WhatsApp"** que gera o texto no formato do grupo (🛑 CULTO DIA 28/07-Domingo…).
- **Clonar culto** para outra data (sem duplicar músicas).

### Culto (v3)
- **Comentários** da equipe em cada culto, **observações**, botão **📆 Google Agenda** (link gratuito, sem API).
- **Destacar ministro** por música ("min. Viviane" no roteiro e no texto do WhatsApp).
- **Registro de faltas** pós-culto pelo líder (reflete na Visão geral).

### Disponibilidade avançada (v3)
- Indisponibilidade por **período do dia** (dia inteiro 🚫 / matutino 🌅 / vespertino 🌤️ / noturno 🌙) e por **intervalo de datas**.
- O motor só bloqueia cultos no período marcado (plantão noturno não impede o culto da manhã).
- **Painel do líder**: indisponibilidades do ministério por mês, com nome, período e justificativa.

### Recorrência personalizada (v3)
- Celebrações que repetem **a cada N semanas**, com término **em data** ou **após N ocorrências** — e preview das próximas datas no formulário.

### Pessoas (v3)
- **🎂 Aniversariantes** no mural (com "daqui a N dias"); cada membro define o próprio aniversário.
- **🔗 Convite de membros** (admin): link de uso único que abre direto no cadastro.
- **Visão geral** com filtros de período (7 dias · mês atual · ±30 · 90 dias): escalações, membros escalados, confirmação, check-in, faltas, indisponibilidades e louvores usados.

### Estante musical
- **Transposição de cifra** por tom (sustenidos/bemóis, baixo invertido D/F#), preservando a letra.
- **Regiões navegáveis**: marcadores `[INTRO] [VERSO] [PRÉ-REFRÃO] [REFRÃO] [SOLO] [FINAL]` viram chips clicáveis.
- **Divisão vocal**: ao definir o tom, o modo Letra mostra as notas (tônica/3ª/5ª → tenor/contralto/soprano).
- **Editor de cifra** com negrito, cores e marcadores; salva versão editada + **versões/trechos nomeados** (banco de louvores editados).
- **Busca de letra na internet** (lyrics.ovh, gratuito) + links de busca no Cifra Club/Letras.
- **Sem duplicidade**: título+artista normalizados são únicos.
- **Setlists** e **estatísticas mensais**: louvores mais usados, tons mais usados, uso por mês.
- **Modo tela cheia** para o telão/ensaios.

### Gamificação e acompanhamento
- Pontos: escalado +5 · confirmou +5 · check-in +10 · sequência de 4 semanas +20; ranking.
- Feedback pós-culto (nota + comentário) e dashboard com KPIs.

## Técnica

- Node.js ≥ 22.5. Backend em `node:http` puro (sem framework) + `pg` como única dependência npm.
- **PostgreSQL (Supabase, plano gratuito)** — `pg-core.js` é um adaptador que dá ao driver `pg` a mesma interface de `db.prepare(sql).run/get/all()` do antigo `node:sqlite`, porém assíncrona.
- **Vercel (plano gratuito)** — `app-core.js` exporta `criarHandler(db)` (função HTTP pura, sem `.listen()`), usada por `api/[[...path]].js` como função serverless. `criarServidor(db)` continua existindo para uso local/testes (`http.createServer` de verdade). ⚠️ O arquivo NÃO se chama `server.js`/`server.mjs` de propósito: a Vercel reserva esse nome exato na raiz do projeto para uma convenção própria de "servidor capturado" que ignora a pasta `api/` — nomear com esse padrão quebra o deploy. Arquivos de `public/` são servidos diretamente pela Vercel, sem passar pela função.
- Senhas com scrypt + sal; sessão via cookie httpOnly (30 dias).
- Schema criado/migrado automaticamente na primeira conexão (`prepararSchema`, controlado pela tabela `schema_meta` — substitui o antigo `PRAGMA user_version` do SQLite).
- Backup: `GET /api/export` (admin) — dados sem credenciais.
- Testes: `node --test` (56 testes) — cada teste abre um **schema Postgres efêmero** (`abrirTeste()`, equivalente ao antigo `:memory:`), descartado sozinho no `db.close()`. Roda contra `PGURL_TESTE` (padrão: banco local `aclame_test`), nunca contra dados de produção.
- Atalho de teste: `http://localhost:3000/?entrar=evandro@aclame.local:1234#/dashboard` faz login automático.
