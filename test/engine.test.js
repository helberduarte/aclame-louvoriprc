'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA } = require('../db');
const engine = require('../engine');

// Datas fixas (calendário real): 2026-07-05 e 2026-07-12 são domingos; 2026-07-08 é quarta.
const DOM1 = '2026-07-05', DOM2 = '2026-07-12', QUA = '2026-07-08';

function novoBanco() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function fixture(db) {
  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const matriz = ins("INSERT INTO locais (nome, tipo) VALUES ('Matriz','matriz')");
  const capela = ins("INSERT INTO locais (nome, tipo) VALUES ('Capela','capela')");
  const min = ins("INSERT INTO ministerios (nome) VALUES ('Louvor')");
  const funcao = ins('INSERT INTO funcoes (ministerio_id, nome) VALUES (?, ?)', min, 'Vocal');
  const ana = ins("INSERT INTO voluntarios (nome, telefone) VALUES ('Ana', '11988887777')");
  const beto = ins("INSERT INTO voluntarios (nome) VALUES ('Beto')");
  db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id) VALUES (?, ?)').run(ana, funcao);
  db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id) VALUES (?, ?)').run(beto, funcao);
  const evento = ins("INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, duracao_min) VALUES ('Culto', ?, 1, 0, '09:00', 120)", matriz);
  db.prepare('INSERT INTO evento_necessidades (evento_id, funcao_id, quantidade) VALUES (?, ?, 1)').run(evento, funcao);
  return { matriz, capela, min, funcao, ana, beto, evento };
}

function criarOcorrencia(db, eventoId, data, hora = '09:00', dur = 120) {
  return Number(db.prepare('INSERT INTO ocorrencias (evento_id, data, hora_inicio, duracao_min) VALUES (?, ?, ?, ?)')
    .run(eventoId, data, hora, dur).lastInsertRowid);
}

// ---------- disponibilidade e conflitos ----------

test('disponibilidade: sem janelas cadastradas = sempre disponível', () => {
  const db = novoBanco();
  const { ana } = fixture(db);
  assert.equal(engine.estaDisponivel(db, ana, DOM1, '09:00'), true);
  assert.equal(engine.estaDisponivel(db, ana, QUA, '19:30'), true);
});

test('disponibilidade: com janela, só o dia/horário da janela vale', () => {
  const db = novoBanco();
  const { ana } = fixture(db);
  db.prepare("INSERT INTO disponibilidade (voluntario_id, dia_semana, hora_inicio, hora_fim) VALUES (?, 0, '08:00', '12:00')").run(ana);
  assert.equal(engine.estaDisponivel(db, ana, DOM1, '09:00'), true);
  assert.equal(engine.estaDisponivel(db, ana, DOM1, '19:00'), false);
  assert.equal(engine.estaDisponivel(db, ana, QUA, '09:00'), false);
});

test('disponibilidade: bloqueio com justificativa impede a data', () => {
  const db = novoBanco();
  const { ana } = fixture(db);
  db.prepare("INSERT INTO bloqueios (voluntario_id, data, motivo) VALUES (?, ?, 'viagem')").run(ana, DOM1);
  assert.equal(engine.estaDisponivel(db, ana, DOM1, '09:00'), false);
  assert.equal(engine.estaDisponivel(db, ana, DOM2, '09:00'), true);
});

test('bloqueio sem justificativa é rejeitado pelo schema (motivo NOT NULL)', () => {
  const db = novoBanco();
  const { ana } = fixture(db);
  assert.throws(() => db.prepare('INSERT INTO bloqueios (voluntario_id, data) VALUES (?, ?)').run(ana, DOM1), /NOT NULL/i);
});

test('conflito: detecta sobreposição entre locais diferentes', () => {
  const db = novoBanco();
  const { capela, funcao, ana, evento } = fixture(db);
  Number(db.prepare(
    "INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, duracao_min) VALUES ('Missa', ?, 1, 0, '10:00', 90)"
  ).run(capela).lastInsertRowid);
  const ocMatriz = criarOcorrencia(db, evento, DOM1, '09:00', 120); // 09:00–11:00
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(ocMatriz, ana, funcao);
  assert.equal(engine.temConflito(db, ana, DOM1, '10:00', 90), true);
  assert.equal(engine.temConflito(db, ana, DOM1, '11:30', 90), false);
  assert.equal(engine.temConflito(db, ana, DOM2, '10:00', 90), false);
});

test('conflito de setor: estaNoCulto detecta escalado no mesmo culto', () => {
  const db = novoBanco();
  const { funcao, ana, beto, evento } = fixture(db);
  const oc = criarOcorrencia(db, evento, DOM1);
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, ana, funcao);
  assert.equal(engine.estaNoCulto(db, ana, oc), true);
  assert.equal(engine.estaNoCulto(db, beto, oc), false);
});

// ---------- geração ----------

test('gerarOcorrencias materializa apenas o dia da semana do evento e é idempotente', () => {
  const db = novoBanco();
  fixture(db);
  const criadas = engine.gerarOcorrencias(db, '2099-01-31');
  const linhas = db.prepare('SELECT data FROM ocorrencias ORDER BY data LIMIT 10').all();
  assert.ok(criadas >= 4);
  for (const l of linhas) assert.equal(engine.diaSemana(l.data), 0, `${l.data} deve ser domingo`);
  assert.equal(engine.gerarOcorrencias(db, '2099-01-31'), 0);
});

test('gerarEscala: balanceamento alterna quem serviu menos', () => {
  const db = novoBanco();
  const { ana, beto, evento } = fixture(db);
  const oc1 = criarOcorrencia(db, evento, DOM1);
  const oc2 = criarOcorrencia(db, evento, DOM2);
  assert.equal(engine.gerarEscala(db, oc1).preenchidas, 1);
  const v1 = db.prepare('SELECT voluntario_id FROM escala WHERE ocorrencia_id = ?').get(oc1).voluntario_id;
  assert.equal(engine.gerarEscala(db, oc2).preenchidas, 1);
  const v2 = db.prepare('SELECT voluntario_id FROM escala WHERE ocorrencia_id = ?').get(oc2).voluntario_id;
  assert.notEqual(v1, v2);
  assert.deepEqual(new Set([v1, v2]), new Set([ana, beto]));
});

test('gerarEscala: não escala a mesma pessoa duas vezes no mesmo culto (multi-setor)', () => {
  const db = novoBanco();
  const { min, funcao, ana, beto, evento } = fixture(db); // Vocal: Ana, Beto
  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const midia = ins("INSERT INTO ministerios (nome) VALUES ('Mídia')");
  const projecao = ins('INSERT INTO funcoes (ministerio_id, nome) VALUES (?, ?)', midia, 'Projeção');
  // Ana é multi-setorial: Vocal (preferida) e Projeção (única apta).
  db.prepare('UPDATE voluntario_funcoes SET preferencia = 1 WHERE voluntario_id = ? AND funcao_id = ?').run(ana, funcao);
  db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id) VALUES (?, ?)').run(ana, projecao);
  db.prepare('INSERT INTO evento_necessidades (evento_id, funcao_id, quantidade) VALUES (?, ?, 1)').run(evento, projecao);

  const oc = criarOcorrencia(db, evento, DOM1);
  const r = engine.gerarEscala(db, oc);
  // Ana pega Vocal (preferência); Projeção fica sem candidato porque Ana já está NESTE culto.
  const escalas = db.prepare('SELECT voluntario_id, funcao_id FROM escala WHERE ocorrencia_id = ?').all(oc);
  assert.equal(escalas.filter((e) => e.voluntario_id === ana).length, 1, 'Ana só pode aparecer uma vez no culto');
  assert.deepEqual(r.semCandidato, ['Projeção']);
  assert.equal(r.preenchidas, 1);
});

test('gerarEscala com ministerioId preenche só as funções daquele ministério', () => {
  const db = novoBanco();
  const { min, ana, beto, evento } = fixture(db);
  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const midia = ins("INSERT INTO ministerios (nome) VALUES ('Mídia')");
  const projecao = ins('INSERT INTO funcoes (ministerio_id, nome) VALUES (?, ?)', midia, 'Projeção');
  db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id) VALUES (?, ?)').run(beto, projecao);
  db.prepare('INSERT INTO evento_necessidades (evento_id, funcao_id, quantidade) VALUES (?, ?, 1)').run(evento, projecao);
  const oc = criarOcorrencia(db, evento, DOM1);
  engine.gerarEscala(db, oc, min); // só Louvor
  const funcoesEscaladas = db.prepare(
    'SELECT DISTINCT f.ministerio_id AS m FROM escala e JOIN funcoes f ON f.id = e.funcao_id WHERE e.ocorrencia_id = ?').all(oc);
  assert.deepEqual(funcoesEscaladas.map((x) => x.m), [min], 'apenas funções do Louvor');
});

test('gerarEscalaMensal preenche o mês inteiro do ministério com balanceamento', () => {
  const db = novoBanco();
  const { min, ana, beto } = fixture(db);
  // Mês futuro fixo: setembro/2026 tem domingos 6, 13, 20, 27.
  const resumo = engine.gerarEscalaMensal(db, min, 2026, 9);
  assert.equal(resumo.ocorrencias, 4, 'quatro domingos em setembro/2026');
  assert.equal(resumo.preenchidas, 4);
  const porVol = db.prepare(`
    SELECT e.voluntario_id AS v, COUNT(*) AS n FROM escala e
    JOIN ocorrencias o ON o.id = e.ocorrencia_id
    WHERE o.data BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY e.voluntario_id`).all();
  assert.deepEqual(porVol.map((x) => x.n).sort(), [2, 2], 'Ana e Beto servem 2x cada (balanceado)');
});

test('escalarManual avisa indisponível, conflito e mesmo culto — sem bloquear', () => {
  const db = novoBanco();
  const { min, funcao, ana, evento } = fixture(db);
  db.prepare("INSERT INTO bloqueios (voluntario_id, data, motivo) VALUES (?, ?, 'compromisso')").run(ana, DOM1);
  const teclado = Number(db.prepare('INSERT INTO funcoes (ministerio_id, nome) VALUES (?, ?)').run(min, 'Teclado').lastInsertRowid);
  const oc = criarOcorrencia(db, evento, DOM1);
  const r1 = engine.escalarManual(db, oc, ana, funcao);
  assert.ok(r1.avisos.includes('indisponivel'));
  const r2 = engine.escalarManual(db, oc, ana, teclado); // outra função, mas no mesmo culto
  assert.ok(r2.avisos.includes('mesmo_culto'));
});

// ---------- pontos e check-in ----------

test('confirmar e check-in creditam pontos (5 + 10); confirmar é idempotente', () => {
  const db = novoBanco();
  const { evento } = fixture(db);
  const oc = criarOcorrencia(db, evento, DOM1);
  engine.gerarEscala(db, oc);
  const e = db.prepare('SELECT * FROM escala WHERE ocorrencia_id = ?').get(oc);
  engine.confirmarEscala(db, e.id);
  engine.confirmarEscala(db, e.id);
  assert.equal(engine.fazerCheckin(db, e.id).jaFeito, false);
  assert.equal(engine.fazerCheckin(db, e.id).jaFeito, true);
  const pts = db.prepare('SELECT SUM(valor) AS s FROM pontos WHERE voluntario_id = ?').get(e.voluntario_id).s;
  assert.equal(pts, 5 + 5 + 10);
});

test('streak: check-in em 4 semanas consecutivas rende bônus único de 20', () => {
  const db = novoBanco();
  const { beto, evento } = fixture(db);
  db.prepare('UPDATE voluntarios SET ativo = 0 WHERE id = ?').run(beto);
  let bonus = false;
  for (const d of ['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26']) {
    const oc = criarOcorrencia(db, evento, d);
    engine.gerarEscala(db, oc);
    const e = db.prepare('SELECT * FROM escala WHERE ocorrencia_id = ?').get(oc);
    bonus = engine.fazerCheckin(db, e.id).streak || bonus;
  }
  assert.equal(bonus, true);
  const ana = db.prepare("SELECT id FROM voluntarios WHERE nome = 'Ana'").get().id;
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pontos WHERE voluntario_id = ? AND motivo = 'streak'").get(ana).n, 1);
});

// ---------- trocas 2.0 ----------

test('troca aberta: colegas notificados; aceite reatribui, confirma e registra datas', () => {
  const db = novoBanco();
  const { funcao, ana, beto, evento } = fixture(db);
  const oc = criarOcorrencia(db, evento, DOM1);
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, ana, funcao);
  const escala = db.prepare('SELECT * FROM escala WHERE ocorrencia_id = ?').get(oc);

  const { id: trocaId } = engine.solicitarTroca(db, escala.id, { motivo: 'imprevisto' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notificacoes WHERE voluntario_id = ?').get(beto).n, 1);
  assert.throws(() => engine.solicitarTroca(db, escala.id, {}), /aguardando/i);
  assert.throws(() => engine.aceitarTroca(db, trocaId, ana), /solicitante/i);

  engine.aceitarTroca(db, trocaId, beto);
  const depois = db.prepare('SELECT * FROM escala WHERE id = ?').get(escala.id);
  assert.equal(depois.voluntario_id, beto);
  assert.equal(depois.status, 'confirmado');
  const t = db.prepare('SELECT * FROM trocas WHERE id = ?').get(trocaId);
  assert.equal(t.status, 'aceita');
  assert.equal(t.aceitou_id, beto);
  assert.ok(t.criada_em && t.resolvida_em, 'datas de criação e resolução registradas');
  // Notificação deixa claro quem fica no lugar de quem.
  const msg = db.prepare('SELECT mensagem FROM notificacoes WHERE voluntario_id = ? ORDER BY id DESC').get(ana).mensagem;
  assert.match(msg, /Beto fica no seu lugar/);
});

test('troca dirigida: só o destinatário pode aceitar ou recusar', () => {
  const db = novoBanco();
  const { funcao, ana, beto, evento } = fixture(db);
  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const carla = ins("INSERT INTO voluntarios (nome) VALUES ('Carla')");
  db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id) VALUES (?, ?)').run(carla, funcao);
  const oc = criarOcorrencia(db, evento, DOM1);
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, ana, funcao);
  const escala = db.prepare('SELECT * FROM escala WHERE ocorrencia_id = ?').get(oc);

  const { id } = engine.solicitarTroca(db, escala.id, { destinatarioId: beto, motivo: 'viagem' });
  // Só Beto (destinatário) foi notificado — Carla não.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notificacoes WHERE voluntario_id = ?').get(beto).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notificacoes WHERE voluntario_id = ?').get(carla).n, 0);
  assert.throws(() => engine.aceitarTroca(db, id, carla), /dirigida a outra pessoa/i);
  assert.throws(() => engine.recusarTroca(db, id, carla), /destinatário/i);
  engine.recusarTroca(db, id, beto);
  assert.equal(db.prepare('SELECT status FROM trocas WHERE id = ?').get(id).status, 'recusada');
});

test('troca com prazo: expira ao vencer e não aceita mais', () => {
  const db = novoBanco();
  const { funcao, ana, beto, evento } = fixture(db);
  const oc = criarOcorrencia(db, evento, '2099-01-03'); // futuro distante (domingo? tanto faz p/ troca)
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, ana, funcao);
  const escala = db.prepare('SELECT * FROM escala WHERE ocorrencia_id = ?').get(oc);
  const { id } = engine.solicitarTroca(db, escala.id, { prazo: '2000-01-01' }); // prazo já vencido
  assert.equal(engine.expirarTrocas(db), 1);
  assert.equal(db.prepare('SELECT status FROM trocas WHERE id = ?').get(id).status, 'expirada');
  assert.throws(() => engine.aceitarTroca(db, id, beto), /expirada/i);
});

test('troca: prazo não pode passar da data do culto', () => {
  const db = novoBanco();
  const { funcao, ana, evento } = fixture(db);
  const oc = criarOcorrencia(db, evento, DOM1);
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, ana, funcao);
  const escala = db.prepare('SELECT * FROM escala WHERE ocorrencia_id = ?').get(oc);
  assert.throws(() => engine.solicitarTroca(db, escala.id, { prazo: '2099-12-31' }), /prazo/i);
});

test('troca: aceite bloqueado por conflito de horário e por estar no mesmo culto', () => {
  const db = novoBanco();
  const { funcao, ana, beto, evento, capela } = fixture(db);
  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const missa = ins("INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, duracao_min) VALUES ('Missa', ?, 1, 0, '10:00', 60)", capela);
  const ocMissa = criarOcorrencia(db, missa, DOM1, '10:00', 60);
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(ocMissa, beto, funcao);

  const oc = criarOcorrencia(db, evento, DOM1); // 09:00–11:00 sobrepõe a missa de Beto
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, ana, funcao);
  const escala = db.prepare('SELECT * FROM escala WHERE ocorrencia_id = ? AND voluntario_id = ?').get(oc, ana);
  const { id } = engine.solicitarTroca(db, escala.id, {});
  assert.throws(() => engine.aceitarTroca(db, id, beto), /outra celebração/i);
});

// ---------- roteiro, WhatsApp e clonagem ----------

test('gerarRoteiroWhatsApp monta o texto no formato do grupo', () => {
  const db = novoBanco();
  const { evento, funcao, ana } = fixture(db);
  const oc = criarOcorrencia(db, evento, DOM2, '19:00');
  db.prepare(`UPDATE ocorrencias SET tema = 'Ceia', pregador = 'Pr. Marciel',
    abertura = 'Viviane — Abertura e Louvor', responsavel = 'Departamento Masculino' WHERE id = ?`).run(oc);
  db.prepare("INSERT INTO oportunidades (ocorrencia_id, ordem, titulo, responsavel) VALUES (?, 1, 'Departamento Infantil', NULL)").run(oc);
  db.prepare("INSERT INTO oportunidades (ocorrencia_id, ordem, titulo, responsavel) VALUES (?, 2, 'Devocional', 'Elielson')").run(oc);
  const mus = Number(db.prepare("INSERT INTO musicas (titulo, artista) VALUES ('Não Há Deus Maior', 'CC')").run().lastInsertRowid);
  db.prepare("INSERT INTO repertorio (ocorrencia_id, musica_id, ordem, tom) VALUES (?, ?, 1, 'D')").run(oc, mus);
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, ana, funcao);

  const texto = engine.gerarRoteiroWhatsApp(db, oc);
  assert.match(texto, /^🛑 CULTO DIA 12\/07-Domingo/m);
  assert.match(texto, /✅ Viviane — Abertura e Louvor/);
  assert.match(texto, /Oportunidades para o Culto/);
  assert.match(texto, /1️⃣ Departamento Infantil/);
  assert.match(texto, /2️⃣ Elielson: Devocional/);
  assert.match(texto, /✅ Dízimos e Ofertas/);
  assert.match(texto, /✅ Louvor\n1️⃣ Não Há Deus Maior \(D\)/);
  assert.match(texto, /✅ Palavra: Pr\. Marciel/);
  assert.match(texto, /🎯 Responsabilidade: Departamento Masculino/);
  assert.match(texto, /• Vocal: Ana/);
});

test('conviteWhatsApp gera link wa.me com DDI 55 e texto pronto', () => {
  const db = novoBanco();
  const { evento, funcao, ana } = fixture(db);
  const oc = criarOcorrencia(db, evento, DOM1);
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, ana, funcao);
  const e = db.prepare('SELECT id FROM escala WHERE ocorrencia_id = ?').get(oc);
  const conv = engine.conviteWhatsApp(db, e.id);
  assert.match(conv.link, /^https:\/\/wa\.me\/5511988887777\?text=/);
  assert.match(conv.texto, /Vocal/);
  assert.match(conv.texto, /confirme/i);
  assert.equal(engine.linkWhatsApp('', 'oi'), null, 'sem telefone → sem link');
});

test('clonarOcorrencia copia roteiro/repertório sem duplicar músicas nem datas', () => {
  const db = novoBanco();
  const { evento } = fixture(db);
  const oc = criarOcorrencia(db, evento, DOM1);
  db.prepare("UPDATE ocorrencias SET tema = 'Ceia' WHERE id = ?").run(oc);
  db.prepare("INSERT INTO oportunidades (ocorrencia_id, ordem, titulo) VALUES (?, 1, 'Devocional')").run(oc);
  const mus = Number(db.prepare("INSERT INTO musicas (titulo) VALUES ('Oceanos')").run().lastInsertRowid);
  db.prepare("INSERT INTO repertorio (ocorrencia_id, musica_id, ordem, tom) VALUES (?, ?, 1, 'D')").run(oc, mus);

  const novo = engine.clonarOcorrencia(db, oc, DOM2);
  const clone = db.prepare('SELECT * FROM ocorrencias WHERE id = ?').get(novo);
  assert.equal(clone.tema, 'Ceia');
  assert.equal(clone.data, DOM2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM oportunidades WHERE ocorrencia_id = ?').get(novo).n, 1);
  assert.equal(db.prepare('SELECT musica_id FROM repertorio WHERE ocorrencia_id = ?').get(novo).musica_id, mus, 'música referenciada, não duplicada');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM musicas').get().n, 1);
  assert.throws(() => engine.clonarOcorrencia(db, oc, DOM2), /Já existe/i);
});
