# Colocando o ACLAME na nuvem — passo a passo (gratuito)

Este guia assume que você vai rodar os comandos com a ajuda do Claude Code, direto
nesta pasta do projeto. Sempre que aparecer "peça ao Claude Code para...", é literal:
cole a frase para ele executar.

Tempo estimado: 20–30 minutos, a maior parte é esperar as páginas carregarem.

---

## Parte 1 — Criar o banco no Supabase

1. Acesse **https://supabase.com** e crie uma conta (pode ser com o Google).
2. Clique em **New Project**.
   - Nome: `aclame` (ou o que preferir).
   - Senha do banco: gere uma forte e **guarde num lugar seguro** — você vai precisar dela daqui a pouco.
   - Região: escolha a mais próxima do Brasil (ex.: `South America (São Paulo)`).
   - Plano: **Free**.
3. Aguarde alguns minutos até o projeto ficar pronto (barra de progresso na tela).
4. No menu lateral, vá em **Project Settings → Database**.
5. Procure a seção **Connection string** e escolha a aba **"Transaction pooler"** (⚠️ não é a "Session pooler" nem a "Direct connection" — é a que usa a **porta 6543**).
6. Copie a string. Ela se parece com:
   ```
   postgresql://postgres.abcdefghijk:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   ```
7. Substitua `[YOUR-PASSWORD]` pela senha que você criou no passo 2. Guarde essa string completa — é o seu `PGURL`.

---

## Parte 2 — Subir o projeto para o GitHub (se ainda não estiver lá)

Peça ao Claude Code: **"confirme se este projeto já está conectado a um repositório
no GitHub; se não estiver, me ajude a criar um repositório novo e enviar o código."**

(O `.gitignore` já está configurado para nunca enviar senhas, o `.env` ou o `node_modules`.)

---

## Parte 3 — Criar o projeto na Vercel

1. Acesse **https://vercel.com** e crie uma conta — o mais simples é **"Continue with GitHub"**, usando a mesma conta do passo anterior.
2. Clique em **Add New → Project**.
3. Selecione o repositório do ACLAME na lista e clique em **Import**.
4. Na tela de configuração, **antes de clicar em Deploy**:
   - Abra a seção **Environment Variables**.
   - Adicione uma variável:
     - Name: `PGURL`
     - Value: a string completa que você guardou na Parte 1 (com a senha já no lugar).
   - Não precisa mexer em mais nada — o `vercel.json` do projeto já diz à Vercel onde estão os arquivos estáticos, e a pasta `api/` já é reconhecida automaticamente.
5. Clique em **Deploy**. Aguarde 1–2 minutos.
6. Quando terminar, a Vercel mostra um link (algo como `aclame-xyz.vercel.app`) — **esse é o endereço do seu app**.

---

## Parte 4 — Colocar os dados reais no banco de produção

Isso só precisa ser feito **uma vez** (ou de novo, com `--force`, sempre que quiser
resetar para a escala real mais atualizada).

Peça ao Claude Code:

> "Rode `PGURL='<cole a string completa do Supabase aqui>' node seed-real.js`
> nesta pasta do projeto."

Se já havia dados no banco (por exemplo, você mesmo já se cadastrou testando o app),
peça para adicionar `--force` no final do comando — suas contas reais são preservadas
automaticamente (o script resgata quem não é usuário de demonstração antes de resetar).

---

## Parte 5 — Testar (⚠️ atenção à ordem)

**Importante — faça isso ANTES de compartilhar o link com qualquer pessoa:**
o `seed-real.js` cria os *voluntários* da escala (nomes, funções), mas não cria
login/senha para ninguém automaticamente na primeira vez. **O primeiro e-mail que
se cadastrar no app vira administrador** — não importa quem seja. Se você mandar o
link no grupo antes de se cadastrar, e alguém entrar primeiro, essa pessoa vira
administrador no seu lugar (e você precisaria corrigir isso manualmente no banco).

1. Abra o link da Vercel (`https://aclame-xyz.vercel.app`) **sozinho, antes de
   divulgar para o grupo**.
2. Clique em **Cadastrar** e crie sua conta com o e-mail `helberduarte@gmail.com`
   (mesmo e-mail usado no `seed-real.js`) e uma senha seguem sua. Você vira
   administrador automaticamente por ser o primeiro cadastro.
3. Confira se a escala de julho/2026 aparece certinha.
4. **Só depois disso**, compartilhe o link com o restante do ministério.

---

## Manutenção do dia a dia

- **Toda vez que o código mudar** (nova funcionalidade, correção): basta enviar (`git push`)
  para o GitHub — a Vercel refaz o deploy sozinha, automaticamente.
- **Para atualizar a escala do mês seguinte**: edite o array `ESCALA` dentro de
  `seed-real.js` com as novas datas/nomes e rode o comando da Parte 4 de novo com `--force`.
  (Isso é um processo manual por enquanto — automatizar isso é um passo futuro do produto,
  não algo que o app já resolve sozinho hoje.)
- **Custos**: com os dados de uma igreja de ~15 voluntários, você fica bem dentro dos
  limites gratuitos do Supabase (500MB de banco, 5GB de transferência/mês) e da Vercel
  (100GB de transferência/mês, funções serverless no plano Hobby). Não deve haver custo,
  mas vale acompanhar os painéis de uso de vez em quando.

---

## Se algo der errado

- **Erro de conexão ao banco** logo após o deploy: confira se copiou a string do
  **Transaction pooler** (porta `6543`), não a "Direct connection" (porta `5432`) — a
  conexão direta não aguenta o padrão de uma função serverless que abre/fecha conexões
  o tempo todo, e vai esgotar rápido.
- **Erro "tenant/user not found" ao conectar**: o host do pooler está errado na string.
  Não digite de memória — copie a string inteira do painel do Supabase (o prefixo
  `aws-1`/`aws-0` varia por projeto e um dígito errado cai em outro pooler).
- **Build falha com "No entrypoint found"**: o Framework Preset do projeto na Vercel
  está como "Node" (modo que exige um servidor com `.listen()` e ignora a pasta `api/`).
  Corrija em Project Settings → Build and Deployment → Framework Preset → **"Other"**,
  e depois faça Redeploy. Esta configuração vive no painel da Vercel, não no repositório.
- **Rotas `/api/algo/coisa` retornam 404 da Vercel** (mas `/api/algo` funciona): a
  convenção de arquivo `api/[[...path]].js` não cobre 2+ segmentos sozinha neste setup —
  o `vercel.json` precisa do bloco `rewrites` que já está no repositório. Não remova.
- **Login não funciona**: confira se rodou a Parte 4 (`seed-real.js`) apontando para o
  `PGURL` de produção — sem isso o banco do Supabase está vazio.
- Para qualquer outro erro, peça ao Claude Code: **"veja os logs da função na Vercel
  para este projeto e me diga o que está acontecendo"** (ou copie a mensagem de erro
  que aparece na tela e cole na conversa).
