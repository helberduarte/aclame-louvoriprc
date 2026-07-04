'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA } = require('../db');
const { criarServidor } = require('../server');

let servidor, base, db;

before(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  servidor = criarServidor(db);
  await new Promise((ok) => servidor.listen(0, ok));
  base = `http://localhost:${servidor.address().port}`;
});
after(() => servidor.close());

async function http(metodo, caminho, corpo, cookie) {
  const res = await fetch(base + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `aclame_sessao=${cookie}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, token: setCookie ? (setCookie.match(/aclame_sessao=([^;]+)/) || [])[1] : null };
}

test('API v5: convite expira em 7 dias, com URL e validade expostas', async () => {
  assert.equal((await http('POST', '/api/seed-demo')).status, 200);
  const adm = await http('POST', '/api/auth/login', { identificador: 'evandro@aclame.local', senha: '1234' });

  // Geração devolve validade e expiração calculadas.
  const c1 = await http('POST', '/api/convites', {}, adm.token);
  assert.equal(c1.status, 200);
  assert.equal(c1.json.validade_dias, 7);
  assert.match(c1.json.expira_em, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(c1.json.expira_em > c1.json.expira_em.slice(0, 4) && c1.json.url.includes(c1.json.token));

  // Lista marca disponíveis e expirados, e expõe a URL para copiar/WhatsApp.
  const c2 = await http('POST', '/api/convites', {}, adm.token);
  db.prepare("UPDATE convites SET criado_em = '2026-01-01 10:00:00' WHERE token = ?").run(c2.json.token);
  const lista = await http('GET', '/api/convites', null, adm.token);
  const l1 = lista.json.find((c) => c.token === c1.json.token);
  const l2 = lista.json.find((c) => c.token === c2.json.token);
  assert.equal(l1.expirado, false);
  assert.equal(l2.expirado, true, 'convite antigo aparece como expirado');
  assert.ok(l1.url.includes(l1.token));

  // Registrar com convite expirado é recusado; com convite válido funciona.
  const regExp = await http('POST', '/api/auth/registrar',
    { nome: 'Fulano', telefone: '11911112222', senha: 'abcd', convite: c2.json.token });
  assert.equal(regExp.status, 400);
  assert.match(regExp.json.erro, /expirou/);
  const regOk = await http('POST', '/api/auth/registrar',
    { nome: 'Beltrano', telefone: '11933334444', senha: 'abcd', convite: c1.json.token });
  assert.equal(regOk.status, 200);
  const lista2 = await http('GET', '/api/convites', null, adm.token);
  assert.ok(lista2.json.find((c) => c.token === c1.json.token).usado_em, 'convite usado fica marcado');
});

test('API v5: /api/musicas expõe a contagem de versões salvas', async () => {
  const adm = await http('POST', '/api/auth/login', { identificador: 'evandro@aclame.local', senha: '1234' });
  const musicas = await http('GET', '/api/musicas', null, adm.token);
  const alvo = musicas.json[0];
  assert.equal(alvo.versoes, 0, 'sem versões salvas ainda');
  const v = await http('POST', `/api/musicas/${alvo.id}/versoes`,
    { nome: 'Versão acústica', cifra_html: '<b>G</b>  C' }, adm.token);
  assert.equal(v.status, 200);
  const depois = await http('GET', '/api/musicas', null, adm.token);
  assert.equal(depois.json.find((m) => m.id === alvo.id).versoes, 1, 'contagem reflete a versão criada');
});
