'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA, hojeISO } = require('../db');
const engine = require('../engine');
const { criarServidor } = require('../server');

function novoBanco() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

// Fixture: Louvor com Vocal/Violão, quatro voluntários e um culto futuro.
function fixture(db) {
  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const matriz = ins("INSERT INTO locais (nome, tipo) VALUES ('Matriz','matriz')");
  const min = ins("INSERT INTO ministerios (nome) VALUES ('Louvor')");
  const vocal = ins('INSERT INTO funcoes (ministerio_id, nome) VALUES (?, ?)', min, 'Vocal');
  const violao = ins('INSERT INTO funcoes (ministerio_id, nome) VALUES (?, ?)', min, 'Violão');
  const vol = {};
  for (const [nome, tel] of [['Ana', '11988887777'], ['Bia', '11977776666'], ['Caio', null], ['Dora', null]]) {
    vol[nome] = ins('INSERT INTO voluntarios (nome, telefone) VALUES (?, ?)', nome, tel);
    db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id) VALUES (?, ?)').run(vol[nome], vocal);
  }
  const evento = ins("INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, duracao_min) VALUES ('Culto', ?, 1, 0, '19:00', 120)", matriz);
  db.prepare('INSERT INTO evento_necessidades (evento_id, funcao_id, quantidade) VALUES (?, ?, 2)').run(evento, vocal);
  db.prepare('INSERT INTO evento_necessidades (evento_id, funcao_id, quantidade) VALUES (?, ?, 1)').run(evento, violao);
  const oc = ins("INSERT INTO ocorrencias (evento_id, data, hora_inicio, duracao_min) VALUES (?, ?, '19:00', 120)", evento, hojeISO(7));
  return { ins, matriz, min, vocal, violao, vol, evento, oc };
}

function escalar(db, oc, volId, funcaoId, status = 'convidado') {
  const r = db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id, status) VALUES (?, ?, ?, ?)')
    .run(oc, volId, funcaoId, status);
  return Number(r.lastInsertRowid);
}

// ---------- trocas: editar, excluir e resumo ----------

test('editarTroca altera substituto, prazo e motivo — e notifica o novo destinatário', () => {
  const db = novoBanco();
  const { vol, vocal, oc } = fixture(db);
  const esc = escalar(db, oc, vol.Ana, vocal);
  const { id } = engine.solicitarTroca(db, esc, { motivo: 'viagem' });

  const antes = db.prepare('SELECT COUNT(*) AS n FROM notificacoes WHERE voluntario_id = ?').get(vol.Bia).n;
  const t = engine.editarTroca(db, id, { motivo: 'consulta médica', destinatarioId: vol.Bia, prazo: hojeISO(5) });
  assert.equal(t.motivo, 'consulta médica');
  assert.equal(t.destinatario_id, vol.Bia);
  assert.equal(t.prazo, hojeISO(5));
  const depois = db.prepare('SELECT COUNT(*) AS n FROM notificacoes WHERE voluntario_id = ?').get(vol.Bia).n;
  assert.equal(depois, antes + 1, 'novo destinatário é notificado');

  // Prazo depois do culto é rejeitado; edição mantém campos não informados.
  assert.throws(() => engine.editarTroca(db, id, { prazo: hojeISO(10) }), /prazo não pode passar/);
  const t2 = engine.editarTroca(db, id, { motivo: 'só o motivo mudou' });
  assert.equal(t2.destinatario_id, vol.Bia, 'destinatário preservado quando não informado');

  // Voltar para aberta (destinatário null) e travar edição após aceite.
  const t3 = engine.editarTroca(db, id, { destinatarioId: null });
  assert.equal(t3.destinatario_id, null);
  engine.aceitarTroca(db, id, vol.Bia);
  assert.throws(() => engine.editarTroca(db, id, { motivo: 'x' }), /pendentes/);
});

test('excluirTroca: pendente exige cancelar antes; resolvida sai do histórico', () => {
  const db = novoBanco();
  const { vol, vocal, oc } = fixture(db);
  const esc = escalar(db, oc, vol.Ana, vocal);
  const { id } = engine.solicitarTroca(db, esc, {});
  assert.throws(() => engine.excluirTroca(db, id), /Cancele/);
  db.prepare("UPDATE trocas SET status = 'cancelada' WHERE id = ?").run(id);
  engine.excluirTroca(db, id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trocas').get().n, 0);
});

test('resumoTrocas conta minhas solicitações e quem as assume', () => {
  const db = novoBanco();
  const { vol, vocal, oc, evento, ins } = fixture(db);
  const oc2 = ins("INSERT INTO ocorrencias (evento_id, data, hora_inicio) VALUES (?, ?, '19:00')", evento, hojeISO(14));
  const e1 = escalar(db, oc, vol.Ana, vocal);
  const e2 = escalar(db, oc2, vol.Ana, vocal);
  const t1 = engine.solicitarTroca(db, e1, {});
  engine.solicitarTroca(db, e2, {});
  engine.aceitarTroca(db, t1.id, vol.Bia);

  const r = engine.resumoTrocas(db, vol.Ana);
  assert.equal(r.total, 2);
  assert.equal(r.pendentes, 1);
  assert.equal(r.confirmadas, 1);
  assert.equal(r.indisponiveis, 0);
  assert.deepEqual(r.quem_assume.map((q) => [q.nome, q.vezes]), [['Bia', 1]]);
});

// ---------- avaliação de compromisso ----------

test('avaliacaoServico classifica 🟢/🟡/🔴, calcula nota geral e pódio', () => {
  const db = novoBanco();
  const { vol, vocal, evento, ins } = fixture(db);
  const ocA = ins("INSERT INTO ocorrencias (evento_id, data, hora_inicio) VALUES (?, ?, '19:00')", evento, hojeISO(-14));
  const ocB = ins("INSERT INTO ocorrencias (evento_id, data, hora_inicio) VALUES (?, ?, '19:00')", evento, hojeISO(-7));

  // Ana: confirmou e esteve presente nos dois cultos → 🟢 (índice 100).
  for (const o of [ocA, ocB]) {
    const e = escalar(db, o, vol.Ana, vocal, 'confirmado');
    db.prepare("UPDATE escala SET checkin_em = '2026-01-01 19:00:00' WHERE id = ?").run(e);
  }
  // Bia: nunca confirmou nem apareceu → 🔴 (índice 0 com 2 escalações).
  escalar(db, ocA, vol.Bia, vocal);
  escalar(db, ocB, vol.Bia, vocal);
  // Caio: confirmou metade e presença em 1 de 2 → 🟡.
  escalar(db, ocA, vol.Caio, vocal, 'confirmado');
  const eC = escalar(db, ocB, vol.Caio, vocal);
  db.prepare("UPDATE escala SET checkin_em = '2026-01-01 19:00:00' WHERE id = ?").run(
    db.prepare('SELECT id FROM escala WHERE ocorrencia_id = ? AND voluntario_id = ?').get(ocA, vol.Caio).id);
  // Dora: duas faltas registradas → 🔴 mesmo com confirmação.
  const eD1 = escalar(db, ocA, vol.Dora, vocal, 'confirmado');
  const eD2 = escalar(db, ocB, vol.Dora, vocal, 'confirmado');
  db.prepare('UPDATE escala SET faltou = 1 WHERE id IN (?, ?)').run(eD1, eD2);

  // Eli: só escalações futuras, sem confirmar — não pode ir para o vermelho.
  const eli = ins("INSERT INTO voluntarios (nome) VALUES ('Eli')");
  db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id) VALUES (?, ?)').run(eli, vocal);
  const ocFut = ins("INSERT INTO ocorrencias (evento_id, data, hora_inicio) VALUES (?, ?, '19:00')", evento, hojeISO(9));
  const ocFut2 = ins("INSERT INTO ocorrencias (evento_id, data, hora_inicio) VALUES (?, ?, '19:00')", evento, hojeISO(16));
  escalar(db, ocFut, eli, vocal);
  escalar(db, ocFut2, eli, vocal);

  const av = engine.avaliacaoServico(db, hojeISO(-30), hojeISO(30));
  const por = Object.fromEntries(av.membros.map((m) => [m.nome, m]));
  assert.equal(por.Eli.status, 'precisa_melhorar', 'sem culto realizado ainda → 🟡, nunca 🔴');
  assert.equal(por.Ana.status, 'compromissado');
  assert.equal(por.Ana.indice, 100);
  assert.equal(por.Bia.status, 'alerta', 'sem confirmar e sem presença → alerta');
  assert.equal(por.Caio.status, 'precisa_melhorar');
  assert.equal(por.Dora.status, 'alerta', '2 faltas → alerta mesmo confirmando');
  assert.equal(av.avaliados, 5);
  assert.equal(av.compromissados, 1);
  assert.equal(av.nota_geral, 2, 'nota geral = 10 × 1/5 compromissados');
  assert.equal(av.podio.length, 1, 'pódio só com 🟢');
  assert.equal(av.podio[0].nome, 'Ana');
  assert.equal(por.Ana.posicao, 1);
  assert.ok(Array.isArray(av.criterios) && av.criterios.length >= 5, 'critérios expostos para transparência');
  void eC;
});

// ---------- pendências de culto ----------

test('pendenciasOcorrencia aponta vaga incompleta, louvores e confirmações — e some quando tratado', () => {
  const db = novoBanco();
  const { vol, vocal, oc } = fixture(db);
  escalar(db, oc, vol.Ana, vocal); // 1 de 2 vagas de Vocal; Violão 0 de 1

  const p = engine.pendenciasOcorrencia(db, oc);
  const textos = p.map((x) => x.texto).join(' | ');
  assert.match(textos, /Vocal: 1\/2/);
  assert.match(textos, /Violão: 0\/1/);
  assert.match(textos, /Louvores: não informado/);
  assert.match(textos, /1 escalado\(s\) ainda sem confirmar/);
  assert.match(textos, /não publicado no mural/);

  // Tratativas: completa a escala, confirma, adiciona louvor e publica.
  escalar(db, oc, vol.Bia, vocal, 'confirmado');
  const violaoId = db.prepare("SELECT id FROM funcoes WHERE nome = 'Violão'").get().id;
  escalar(db, oc, vol.Caio, violaoId, 'confirmado');
  db.prepare("UPDATE escala SET status = 'confirmado' WHERE ocorrencia_id = ?").run(oc);
  const mus = Number(db.prepare("INSERT INTO musicas (titulo, tom) VALUES ('Oceanos', 'D')").run().lastInsertRowid);
  db.prepare('INSERT INTO repertorio (ocorrencia_id, musica_id, ordem) VALUES (?, ?, 1)').run(oc, mus);
  db.prepare("UPDATE ocorrencias SET publicada_em = '2026-01-01 10:00:00' WHERE id = ?").run(oc);
  assert.equal(engine.pendenciasOcorrencia(db, oc).length, 0, 'tudo tratado → sem pendências');

  // listarPendencias devolve só cultos com pendência no período.
  const lista = engine.listarPendencias(db, hojeISO(), hojeISO(30));
  assert.equal(lista.length, 0);
});

test('listarPendencias inclui escalado indisponível como inconsistência', () => {
  const db = novoBanco();
  const { vol, vocal, oc } = fixture(db);
  escalar(db, oc, vol.Ana, vocal);
  db.prepare("INSERT INTO bloqueios (voluntario_id, data, motivo) VALUES (?, ?, 'viagem')").run(vol.Ana, hojeISO(7));
  const lista = engine.listarPendencias(db, hojeISO(), hojeISO(30));
  assert.equal(lista.length, 1);
  assert.ok(lista[0].pendencias.some((x) => x.tipo === 'indisponivel' && /Ana/.test(x.texto)));
});

// ---------- setlist por WhatsApp ----------

test('setlistWhatsApp: tom fixado, links de cifra/letra e um wa.me por escalado com telefone', () => {
  const db = novoBanco();
  const { vol, vocal, oc } = fixture(db);
  assert.throws(() => engine.setlistWhatsApp(db, oc), /não tem louvores/);

  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const m1 = ins("INSERT INTO musicas (titulo, artista, tom, link_cifraclub) VALUES ('Oceanos', 'Hillsong', 'D', 'https://www.cifraclub.com.br/hillsong/oceans/')");
  const m2 = ins("INSERT INTO musicas (titulo, artista, tom) VALUES ('Lugar Secreto', 'Gabriela Rocha', 'C')");
  db.prepare("INSERT INTO repertorio (ocorrencia_id, musica_id, ordem, tom) VALUES (?, ?, 1, 'E')").run(oc, m1);
  db.prepare('INSERT INTO repertorio (ocorrencia_id, musica_id, ordem) VALUES (?, ?, 2)').run(oc, m2);
  escalar(db, oc, vol.Ana, vocal, 'confirmado'); // tem telefone
  escalar(db, oc, vol.Caio, vocal);              // sem telefone

  const r = engine.setlistWhatsApp(db, oc);
  assert.match(r.texto, /Setlist aprovada/);
  assert.match(r.texto, /Oceanos.*Tom: \*E\*/, 'tom do culto (fixado) vence o tom original');
  assert.match(r.texto, /Lugar Secreto.*Tom: \*C\*/, 'sem tom no culto, usa o da estante');
  assert.match(r.texto, /cifraclub\.com\.br\/hillsong\/oceans/, 'usa o link salvo quando existe');
  assert.match(r.texto, /letras\.mus\.br/, 'gera link de letra quando não há salvo');
  assert.equal(r.destinatarios.length, 2);
  const ana = r.destinatarios.find((d) => d.nome === 'Ana');
  const caio = r.destinatarios.find((d) => d.nome === 'Caio');
  assert.match(ana.link, /^https:\/\/wa\.me\/5511988887777\?text=/);
  assert.match(decodeURIComponent(ana.link), /Olá, Ana!/);
  assert.equal(caio.link, null, 'sem telefone → sem link, mas aparece na lista');
});

// ---------- API: permissões e fluxo ponta a ponta ----------

let servidor, base;
before(async () => {
  const db = new DatabaseSync(':memory:');
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

test('API v4: painel de trocas, avaliação, pendências, setlist e feedback interativo', async () => {
  assert.equal((await http('POST', '/api/seed-demo')).status, 200);
  const adm = await http('POST', '/api/auth/login', { identificador: 'evandro@aclame.local', senha: '1234' });
  const kelly = await http('POST', '/api/auth/login', { identificador: 'kelly@aclame.local', senha: '1234' });
  const clari = await http('POST', '/api/auth/login', { identificador: 'clarianne@aclame.local', senha: '1234' });

  // Avaliação: qualquer autenticado; pendências: só líder/admin.
  const av = await http('GET', '/api/avaliacao', null, kelly.token);
  assert.equal(av.status, 200);
  assert.ok(Array.isArray(av.json.criterios) && av.json.criterios.length);
  assert.equal((await http('GET', '/api/pendencias', null, kelly.token)).status, 403, 'pendências é visão de líder');
  const pend = await http('GET', '/api/pendencias', null, adm.token);
  assert.equal(pend.status, 200);
  assert.ok(pend.json.length >= 1, 'culto demo tem vagas em aberto → pendência');
  assert.ok(pend.json.some((o) => o.pendencias.some((p) => p.tipo === 'vaga')), 'algum culto acusa vaga em aberto');

  // Escala a Kelly no culto demo (o publicado no mural, que tem repertório).
  const mural = await http('GET', '/api/mural', null, adm.token);
  const oc = mural.json.cultos[0];
  const funcoes = await http('GET', '/api/funcoes', null, adm.token);
  const vocal = funcoes.json.find((f) => f.nome === 'Vocal');
  assert.equal((await http('POST', `/api/ocorrencias/${oc.id}/escalar`,
    { voluntario_id: kelly.json.voluntario_id, funcao_id: vocal.id }, adm.token)).status, 200);
  const det = await http('GET', `/api/ocorrencias/${oc.id}`, null, kelly.token);
  const minhaEscala = det.json.escala.find((e) => e.voluntario_id === kelly.json.voluntario_id);
  const troca = await http('POST', `/api/escala/${minhaEscala.id}/solicitar-troca`, { motivo: 'compromisso' }, kelly.token);
  assert.equal(troca.status, 200);

  // Editar: só o solicitante (ou líder); excluir pendente é bloqueado.
  assert.equal((await http('PUT', `/api/trocas/${troca.json.id}`, { motivo: 'não posso' }, clari.token)).status, 403);
  assert.equal((await http('PUT', `/api/trocas/${troca.json.id}`, { motivo: 'não posso' }, kelly.token)).status, 200);
  assert.equal((await http('DELETE', `/api/trocas/${troca.json.id}`, null, kelly.token)).status, 400, 'pendente: cancelar antes de excluir');
  const resumo = await http('GET', '/api/trocas/resumo', null, kelly.token);
  assert.equal(resumo.status, 200);
  assert.equal(resumo.json.pendentes, 1);
  assert.equal((await http('POST', `/api/trocas/${troca.json.id}/cancelar`, {}, kelly.token)).status, 200);
  assert.equal((await http('DELETE', `/api/trocas/${troca.json.id}`, null, kelly.token)).status, 200);

  // Setlist: culto demo tem repertório do seed.
  const setlist = await http('GET', `/api/ocorrencias/${oc.id}/whatsapp-setlist`, null, kelly.token);
  assert.equal(setlist.status, 200);
  assert.match(setlist.json.texto, /Setlist aprovada/);
  assert.ok(setlist.json.destinatarios.some((d) => d.link));

  // Feedback interativo: enviar, líder agradece (notifica) e autor exclui.
  const fb = await http('POST', '/api/feedback', { ocorrencia_id: oc.id, nota: 5, comentario: 'Culto abençoado!' }, kelly.token);
  assert.equal(fb.status, 200);
  const lista = await http('GET', `/api/feedback?ocorrencia_id=${oc.id}`, null, adm.token);
  const meuFb = lista.json.find((f) => f.voluntario_id === kelly.json.voluntario_id);
  assert.equal((await http('POST', `/api/feedback/${meuFb.id}/agradecer`, {}, kelly.token)).status, 403, 'agradecer é ação de líder');
  assert.equal((await http('POST', `/api/feedback/${meuFb.id}/agradecer`, {}, adm.token)).status, 200);
  const notifs = await http('GET', `/api/voluntarios/${kelly.json.voluntario_id}/notificacoes`, null, kelly.token);
  assert.ok(notifs.json.some((n) => /agradeceu seu feedback/.test(n.mensagem)));
  assert.equal((await http('DELETE', `/api/feedback/${meuFb.id}`, null, clari.token)).status, 403, 'outro membro não exclui');
  assert.equal((await http('DELETE', `/api/feedback/${meuFb.id}`, null, kelly.token)).status, 200, 'autor exclui o próprio');

  // Detalhe do culto expõe pendências e meu_feedback para a página do culto.
  const det2 = await http('GET', `/api/ocorrencias/${oc.id}`, null, kelly.token);
  assert.ok(Array.isArray(det2.json.pendencias));
  assert.equal(det2.json.meu_feedback, null, 'feedback excluído → null');
});
