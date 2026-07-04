'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA, abrir, hojeISO } = require('../db');
const engine = require('../engine');
const { criarServidor } = require('../server');

const DOM1 = '2026-07-05'; // domingo (calendário real)

function novoBanco() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function fixture(db) {
  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const matriz = ins("INSERT INTO locais (nome, tipo) VALUES ('Matriz','matriz')");
  const min = ins("INSERT INTO ministerios (nome) VALUES ('Louvor')");
  const funcao = ins('INSERT INTO funcoes (ministerio_id, nome) VALUES (?, ?)', min, 'Vocal');
  const ana = ins("INSERT INTO voluntarios (nome, telefone) VALUES ('Ana', '11988887777')");
  db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id) VALUES (?, ?)').run(ana, funcao);
  const evento = ins("INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, duracao_min) VALUES ('Culto', ?, 1, 0, '09:00', 120)", matriz);
  db.prepare('INSERT INTO evento_necessidades (evento_id, funcao_id, quantidade) VALUES (?, ?, 1)').run(evento, funcao);
  return { matriz, min, funcao, ana, evento };
}

// ---------- migração v2 → v3 ----------

test('migração v2→v3 preserva dados e adiciona colunas novas', () => {
  const caminho = path.join(os.tmpdir(), `aclame-mig-${Date.now()}.db`);
  const v2 = new DatabaseSync(caminho);
  // Schema v2 mínimo das tabelas alteradas na v3.
  v2.exec(`
    CREATE TABLE musicas (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, artista TEXT, tom TEXT,
      letra TEXT, cifra TEXT, cifra_html TEXT, link_spotify TEXT, link_deezer TEXT, link_cifraclub TEXT,
      chave_dedupe TEXT UNIQUE, criado_por INTEGER, criado_em TEXT);
    CREATE TABLE voluntarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, telefone TEXT, email TEXT,
      ativo INTEGER NOT NULL DEFAULT 1, termo_aceito_em TEXT);
    CREATE TABLE bloqueios (id INTEGER PRIMARY KEY AUTOINCREMENT, voluntario_id INTEGER NOT NULL, data TEXT NOT NULL,
      motivo TEXT NOT NULL, UNIQUE (voluntario_id, data));
    CREATE TABLE eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, local_id INTEGER,
      recorrente INTEGER NOT NULL DEFAULT 1, dia_semana INTEGER, data TEXT, hora_inicio TEXT NOT NULL,
      duracao_min INTEGER NOT NULL DEFAULT 120, ativo INTEGER NOT NULL DEFAULT 1, criado_por INTEGER, criado_em TEXT);
    CREATE TABLE ocorrencias (id INTEGER PRIMARY KEY AUTOINCREMENT, evento_id INTEGER NOT NULL, data TEXT NOT NULL,
      hora_inicio TEXT NOT NULL, duracao_min INTEGER NOT NULL DEFAULT 120, status TEXT NOT NULL DEFAULT 'aberta',
      tema TEXT, pregador TEXT, ministra TEXT, responsavel TEXT, abertura TEXT, publicada_em TEXT,
      publicada_por INTEGER, criado_por INTEGER, criado_em TEXT, UNIQUE (evento_id, data));
    CREATE TABLE escala (id INTEGER PRIMARY KEY AUTOINCREMENT, ocorrencia_id INTEGER NOT NULL,
      voluntario_id INTEGER NOT NULL, funcao_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'convidado',
      checkin_em TEXT, UNIQUE (ocorrencia_id, voluntario_id, funcao_id));
    CREATE TABLE repertorio (id INTEGER PRIMARY KEY AUTOINCREMENT, ocorrencia_id INTEGER NOT NULL,
      musica_id INTEGER NOT NULL, ordem INTEGER NOT NULL DEFAULT 0, tom TEXT, UNIQUE (ocorrencia_id, musica_id));
    PRAGMA user_version = 2;
  `);
  v2.prepare("INSERT INTO musicas (titulo, artista) VALUES ('Oceanos', 'Hillsong')").run();
  v2.prepare("INSERT INTO voluntarios (nome) VALUES ('Kelly')").run();
  v2.close();

  const db = abrir(caminho);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(db.prepare('SELECT titulo FROM musicas WHERE id = 1').get().titulo, 'Oceanos', 'dados preservados');
  // Colunas novas utilizáveis:
  db.prepare("UPDATE musicas SET bpm = 66, duracao = '8:56', classificacao = 'Adoração' WHERE id = 1").run();
  db.prepare("UPDATE voluntarios SET nascimento = '10-30' WHERE id = 1").run();
  db.prepare("INSERT INTO bloqueios (voluntario_id, data, data_fim, periodo, motivo) VALUES (1, '2026-08-01', '2026-08-05', 'noturno', 'viagem')").run();
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'comentarios'").get(), 'tabela comentarios criada');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'convites'").get(), 'tabela convites criada');
  db.close();
  fs.rmSync(caminho, { force: true });
});

// ---------- disponibilidade: intervalo e período ----------

test('bloqueio por intervalo de datas cobre todos os dias do intervalo', () => {
  const db = novoBanco();
  const { ana } = fixture(db);
  db.prepare("INSERT INTO bloqueios (voluntario_id, data, data_fim, motivo) VALUES (?, '2026-07-05', '2026-07-12', 'férias')").run(ana);
  assert.equal(engine.estaDisponivel(db, ana, '2026-07-05', '09:00'), false);
  assert.equal(engine.estaDisponivel(db, ana, '2026-07-08', '19:30'), false);
  assert.equal(engine.estaDisponivel(db, ana, '2026-07-12', '09:00'), false);
  assert.equal(engine.estaDisponivel(db, ana, '2026-07-13', '09:00'), true, 'depois do intervalo volta a estar livre');
});

test('bloqueio por período do dia só afeta cultos naquele período', () => {
  const db = novoBanco();
  const { ana } = fixture(db);
  db.prepare("INSERT INTO bloqueios (voluntario_id, data, periodo, motivo) VALUES (?, ?, 'matutino', 'consulta médica')").run(ana, DOM1);
  assert.equal(engine.estaDisponivel(db, ana, DOM1, '09:00'), false, 'culto da manhã bloqueado');
  assert.equal(engine.estaDisponivel(db, ana, DOM1, '15:00'), true, 'tarde livre');
  assert.equal(engine.estaDisponivel(db, ana, DOM1, '19:00'), true, 'noite livre');
  db.prepare("INSERT INTO bloqueios (voluntario_id, data, periodo, motivo) VALUES (?, '2026-07-12', 'noturno', 'trabalho')").run(ana);
  assert.equal(engine.estaDisponivel(db, ana, '2026-07-12', '19:00'), false, 'culto da noite bloqueado');
  assert.equal(engine.estaDisponivel(db, ana, '2026-07-12', '09:00'), true, 'manhã livre');
});

// ---------- recorrência personalizada ----------

test('evento quinzenal gera ocorrências semana sim, semana não', () => {
  const db = novoBanco();
  const { matriz } = fixture(db);
  const ev = Number(db.prepare(
    "INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, intervalo_semanas, data) VALUES ('Quinzenal', ?, 1, 0, '09:00', 2, '2026-07-05')"
  ).run(matriz).lastInsertRowid);
  engine.gerarOcorrencias(db, '2026-08-31', '2026-07-05');
  const datas = db.prepare('SELECT data FROM ocorrencias WHERE evento_id = ? ORDER BY data').all(ev).map((r) => r.data);
  assert.deepEqual(datas, ['2026-07-05', '2026-07-19', '2026-08-02', '2026-08-16', '2026-08-30']);
});

test('término em data e máximo de ocorrências param a geração', () => {
  const db = novoBanco();
  const { matriz } = fixture(db);
  const evData = Number(db.prepare(
    "INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, termina_em) VALUES ('Com término', ?, 1, 0, '09:00', '2026-07-19')"
  ).run(matriz).lastInsertRowid);
  const evMax = Number(db.prepare(
    "INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, max_ocorrencias) VALUES ('Com máximo', ?, 1, 0, '09:00', 2)"
  ).run(matriz).lastInsertRowid);
  engine.gerarOcorrencias(db, '2026-09-30', '2026-07-05');
  const doTermino = db.prepare('SELECT data FROM ocorrencias WHERE evento_id = ? ORDER BY data').all(evData).map((r) => r.data);
  assert.deepEqual(doTermino, ['2026-07-05', '2026-07-12', '2026-07-19'], 'para na data de término');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ocorrencias WHERE evento_id = ?').get(evMax).n, 2, 'respeita o máximo');
});

test('previewOcorrencias mostra as próximas datas respeitando o intervalo', () => {
  const db = novoBanco();
  const datas = engine.previewOcorrencias(db, { recorrente: 1, dia_semana: 0, intervalo_semanas: 2 }, 3);
  assert.equal(datas.length, 3);
  for (const d of datas) assert.equal(engine.diaSemana(d), 0);
  const diff = (new Date(datas[1]) - new Date(datas[0])) / 86400000;
  assert.equal(diff, 14, 'espaçadas de 14 dias');
});

// ---------- faltas, ministro, Google Agenda, aniversariantes ----------

test('registrar e desmarcar falta', () => {
  const db = novoBanco();
  const { funcao, ana, evento } = fixture(db);
  const oc = Number(db.prepare("INSERT INTO ocorrencias (evento_id, data, hora_inicio) VALUES (?, ?, '09:00')").run(evento, DOM1).lastInsertRowid);
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, ana, funcao);
  const e = db.prepare('SELECT id FROM escala WHERE ocorrencia_id = ?').get(oc);
  assert.equal(engine.registrarFalta(db, e.id).faltou, 1);
  assert.equal(engine.desmarcarFalta(db, e.id).faltou, 0);
});

test('roteiro WhatsApp inclui o ministro da música', () => {
  const db = novoBanco();
  const { ana, evento } = fixture(db);
  const oc = Number(db.prepare("INSERT INTO ocorrencias (evento_id, data, hora_inicio) VALUES (?, ?, '19:00')").run(evento, DOM1).lastInsertRowid);
  const mus = Number(db.prepare("INSERT INTO musicas (titulo) VALUES ('Oceanos')").run().lastInsertRowid);
  db.prepare("INSERT INTO repertorio (ocorrencia_id, musica_id, ordem, tom, ministro_voluntario_id) VALUES (?, ?, 1, 'D', ?)").run(oc, mus, ana);
  assert.match(engine.gerarRoteiroWhatsApp(db, oc), /1️⃣ Oceanos \(D\) — min\. Ana/);
});

test('linkGoogleAgenda monta URL com datas locais e detalhes', () => {
  const db = novoBanco();
  const { evento } = fixture(db);
  const oc = Number(db.prepare(
    "INSERT INTO ocorrencias (evento_id, data, hora_inicio, duracao_min, tema) VALUES (?, '2026-07-05', '19:00', 120, 'Ceia')"
  ).run(evento).lastInsertRowid);
  const { url } = engine.linkGoogleAgenda(db, oc);
  assert.match(url, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.match(url, /dates=20260705T190000%2F20260705T210000|dates=20260705T190000\/20260705T210000/);
  assert.match(url, /text=Culto/);
  assert.match(url, /location=Matriz/);
});

test('aniversariantes ordena por proximidade e filtra por mês', () => {
  const db = novoBanco();
  fixture(db);
  const hoje = hojeISO();
  const mesAtual = Number(hoje.slice(5, 7));
  const amanha = hojeISO(1).slice(5); // MM-DD de amanhã
  db.prepare("INSERT INTO voluntarios (nome, nascimento) VALUES ('Aniversariante Amanhã', ?)").run(amanha);
  db.prepare("INSERT INTO voluntarios (nome, nascimento) VALUES ('Clarianne', '1990-10-30')").run();
  const todos = engine.aniversariantes(db);
  assert.equal(todos[0].nome, 'Aniversariante Amanhã');
  assert.equal(todos[0].dias_ate, 1);
  const clari = todos.find((x) => x.nome === 'Clarianne');
  assert.equal(clari.mes, 10);
  assert.equal(clari.dia, 30);
  const doMes = engine.aniversariantes(db, mesAtual);
  assert.ok(doMes.every((x) => x.mes === mesAtual));
});

// ---------- API: comentários, convites, dashboard filtrado ----------

let servidor, base;
before(async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  servidor = criarServidor(db);
  await new Promise((ok) => servidor.listen(0, ok));
  base = `http://localhost:${servidor.address().port}`;
});
after(() => servidor.close());

async function api(metodo, caminho, corpo, cookie) {
  const res = await fetch(base + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `aclame_sessao=${cookie}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  const setCookie = res.headers.get('set-cookie');
  const token = setCookie ? (setCookie.match(/aclame_sessao=([^;]+)/) || [])[1] : null;
  return { status: res.status, json, token };
}

async function login(identificador, senha = '1234') {
  const r = await api('POST', '/api/auth/login', { identificador, senha });
  assert.equal(r.status, 200);
  return { cookie: r.token, me: r.json };
}

test('API v3: comentários, faltas, convites, indisponibilidades do ministério e dashboard filtrado', async () => {
  assert.equal((await api('POST', '/api/seed-demo')).status, 200);
  const adm = await login('evandro@aclame.local');
  const viv = await login('viviane@aclame.local');
  const kelly = await login('kelly@aclame.local');

  // Comentários: qualquer autenticado comenta; só autor/líder exclui.
  const c1 = await api('POST', '/api/ocorrencias/1/comentarios', { texto: 'Chego 30min antes para passar o som!' }, kelly.cookie);
  assert.equal(c1.status, 200);
  assert.equal(c1.json.usuario_nome, 'Kelly Souza');
  const c2 = await api('POST', '/api/ocorrencias/1/comentarios', { texto: 'Combinado!' }, viv.cookie);
  assert.equal((await api('DELETE', `/api/comentarios/${c2.json.id}`, null, kelly.cookie)).status, 403, 'membro não exclui comentário alheio');
  assert.equal((await api('DELETE', `/api/comentarios/${c2.json.id}`, null, viv.cookie)).status, 200);
  const det = await api('GET', '/api/ocorrencias/1', null, kelly.cookie);
  assert.equal(det.json.comentarios.length, 1);

  // Observações do culto + ministro da música.
  assert.equal((await api('PUT', '/api/ocorrencias/1', { observacoes: 'Ceia — chegar cedo' }, viv.cookie)).status, 200);
  const rep = det.json.repertorio[0];
  assert.equal((await api('PUT', `/api/repertorio/${rep.repertorio_id}`, { ministro_voluntario_id: viv.me.voluntario_id }, viv.cookie)).status, 200);
  const rot = await api('GET', '/api/ocorrencias/1/whatsapp-roteiro', null, viv.cookie);
  assert.match(rot.json.texto, /— min\. Viviane/);

  // Google Agenda.
  const ga = await api('GET', '/api/ocorrencias/1/google-agenda', null, kelly.cookie);
  assert.match(ga.json.url, /calendar\.google\.com/);

  // Falta (líder registra; membro não pode).
  await api('POST', '/api/ocorrencias/1/escalar', { voluntario_id: kelly.me.voluntario_id, funcao_id: det.json.necessidades[0].funcao_id }, viv.cookie);
  const det2 = await api('GET', '/api/ocorrencias/1', null, viv.cookie);
  const linha = det2.json.escala.find((e) => e.voluntario_id === kelly.me.voluntario_id);
  assert.equal((await api('POST', `/api/escala/${linha.id}/falta`, {}, kelly.cookie)).status, 403);
  const falta = await api('POST', `/api/escala/${linha.id}/falta`, {}, viv.cookie);
  assert.equal(falta.json.faltou, 1);

  // Bloqueio com intervalo/período via API; visão do líder por ministério.
  const bloq = await api('POST', '/api/bloqueios', {
    data: hojeISO(3), data_fim: hojeISO(6), periodo: 'noturno', motivo: 'Plantão à noite',
  }, kelly.cookie);
  assert.equal(bloq.status, 200);
  assert.equal((await api('POST', '/api/bloqueios', { data: hojeISO(9), data_fim: hojeISO(8), motivo: 'x' }, kelly.cookie)).status, 400, 'fim antes do início');
  const ministerios = await api('GET', '/api/ministerios', null, adm.cookie);
  const louvor = ministerios.json.find((m) => m.nome === 'Louvor');
  const indis = await api('GET', `/api/ministerios/${louvor.id}/indisponibilidades?mes=${hojeISO(3).slice(0, 7)}`, null, viv.cookie);
  assert.equal(indis.status, 200);
  assert.ok(indis.json.some((b) => b.voluntario_nome === 'Kelly Souza' && b.periodo === 'noturno'));
  assert.equal((await api('GET', `/api/ministerios/${louvor.id}/indisponibilidades`, null, kelly.cookie)).status, 403, 'membro não vê o painel do ministério');

  // Aniversariantes (seed tem Viviane em 07-08 e Clarianne em 10-30).
  const anivs = await api('GET', '/api/aniversariantes?mes=10', null, kelly.cookie);
  assert.ok(anivs.json.some((a) => a.nome === 'Clarianne Dias' && a.dia === 30));

  // Convites: admin gera; registro usa; token não se reutiliza.
  assert.equal((await api('POST', '/api/convites', {}, viv.cookie)).status, 403);
  const conv = await api('POST', '/api/convites', {}, adm.cookie);
  assert.equal(conv.status, 200);
  assert.match(conv.json.url, /\?convite=/);
  const reg = await api('POST', '/api/auth/registrar', { nome: 'Convidado Novo', telefone: '11977776666', senha: 'abcd', convite: conv.json.token });
  assert.equal(reg.status, 200);
  const reg2 = await api('POST', '/api/auth/registrar', { nome: 'Outro', telefone: '11966665555', senha: 'abcd', convite: conv.json.token });
  assert.equal(reg2.status, 400, 'convite é de uso único');
  assert.match(reg2.json.erro, /já foi utilizado/i);

  // Dashboard filtrado: período sem nada zera contagens; período atual conta a falta.
  const dashVazio = await api('GET', '/api/dashboard?de=2000-01-01&ate=2000-01-31', null, adm.cookie);
  assert.equal(dashVazio.json.kpis.total_escalacoes, 0);
  assert.equal(dashVazio.json.kpis.faltas, 0);
  const dashAtual = await api('GET', `/api/dashboard?de=${hojeISO(-1)}&ate=${hojeISO(30)}`, null, adm.cookie);
  assert.ok(dashAtual.json.kpis.total_escalacoes >= 1);
  assert.equal(dashAtual.json.kpis.faltas, 1);
  assert.ok(dashAtual.json.kpis.indisponibilidades >= 1);
  assert.ok(dashAtual.json.kpis.musicas_selecionadas >= 3, 'seed tem 3 louvores no culto publicado');
});
