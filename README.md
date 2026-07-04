# 🙌 Aclame

App local de **escalas, louvor e voluntariado** para a sua igreja. Sem nuvem, sem mensalidade: roda na sua máquina, com os dados num arquivo SQLite.

## Como usar

**Duplo clique em `iniciar.bat`.** O servidor sobe e o navegador abre em `http://localhost:3000`. Na primeira execução são criados dados de demonstração.

**Usuários de demonstração** (senha `1234`):

| Usuário | Login | Papel |
|---|---|---|
| Evandro Silva | `evandro@aclame.local` ou `11999990001` | Administrador |
| Viviane Costa | `viviane@aclame.local` | Líder do Louvor |
| Elielson Ramos | `elielson@aclame.local` | Líder da Mídia |
| Kelly Souza | `kelly@aclame.local` | Membro |
| Clarianne Dias | `clarianne@aclame.local` | Membro |

Para começar do zero, apague `voluts.db` (e remova `--seed` do `iniciar.bat` se não quiser a demo). O primeiro usuário que se registrar num banco vazio vira administrador.

**Dados reais**: `node seed-real.js` (com o servidor parado) recria o banco com a escala real de julho/2026 — o banco anterior é arquivado como `voluts.db.demo.bak` e as contas reais (não-demo) são preservadas com as mesmas senhas.

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

- Node.js ≥ 22.5, **zero dependências npm** (`node:http`, `node:sqlite`, `node:crypto`).
- Senhas com scrypt + sal; sessão via cookie httpOnly (30 dias).
- Banco `voluts.db` criado automaticamente; bancos de versões antigas são arquivados como `.bak`.
- Backup: `GET /api/export` (admin) — dados sem credenciais.
- Testes: `node --test` (56 testes: motor, trocas, painel de trocas, avaliação de compromisso, pendências, setlist, convites com expiração, roteiro, transposição, API/permissões, migração).
- Migração automática de schema: bancos v2 são atualizados no lugar, sem perder dados.
- Atalho de teste: `http://localhost:3000/?entrar=evandro@aclame.local:1234#/dashboard` faz login automático.
