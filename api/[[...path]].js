'use strict';
// Função serverless da Vercel: cobre todo /api/* (rota catch-all opcional).
// Os arquivos estáticos (public/index.html, app.js, styles.css) NÃO passam por
// aqui — a Vercel os serve diretamente da pasta public/ na raiz do domínio.
//
// A conexão com o Postgres (via pooler do Supabase) é aberta uma vez e mantida
// viva enquanto a instância da função estiver "quente" (reaproveitada entre
// requisições sequenciais) — evita reconectar ao pooler a cada chamada.
const { abrir } = require('../db');
const { criarHandler } = require('../server');

let promessaHandler = null;

function obterHandler() {
  if (!promessaHandler) {
    promessaHandler = abrir(process.env.PGURL)
      .then((db) => criarHandler(db))
      .catch((erro) => {
        promessaHandler = null; // não trava invocações futuras se esta falhar
        throw erro;
      });
  }
  return promessaHandler;
}

module.exports = async (req, res) => {
  try {
    const handler = await obterHandler();
    return handler(req, res);
  } catch (erro) {
    console.error('Falha ao conectar ao banco:', erro.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ erro: 'Serviço indisponível — banco de dados inacessível' }));
  }
};
