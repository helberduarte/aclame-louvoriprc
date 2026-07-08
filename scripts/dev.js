'use strict';
// Sobe o servidor local (dev). NÃO roda na Vercel — lá quem atende é
// api/[[...path]].js. Fica fora da raiz do projeto de propósito: a Vercel
// varre a raiz e src/ procurando um arquivo que chame .listen() para
// "capturar" como servidor único (ver docs: vercel.com/docs/functions/
// runtimes/node-js#deploy-a-node.js-server) — isso sequestraria o deploy
// e ignoraria a função serverless em api/. Ver DOCUMENTACAO_EVOLUTIVA.md.
const path = require('node:path');
const { abrir, seedDemo, estaVazio, hojeISO } = require(path.join(__dirname, '..', 'db'));
const engine = require(path.join(__dirname, '..', 'engine'));
const { criarServidor } = require(path.join(__dirname, '..', 'app-core'));

(async () => {
  const db = await abrir(process.env.PGURL);
  if ((await estaVazio(db)) && (process.argv.includes('--seed') || process.env.ACLAME_SEED === '1')) {
    await seedDemo(db);
    await engine.gerarOcorrencias(db, hojeISO(28));
    console.log('Banco vazio: dados de demonstração criados (usuários com senha 1234).');
  }
  const porta = Number(process.env.PORT || 3000);
  criarServidor(db).listen(porta, () => {
    console.log(`Aclame rodando em http://localhost:${porta}`);
  });
})().catch((e) => { console.error(e); process.exit(1); });
