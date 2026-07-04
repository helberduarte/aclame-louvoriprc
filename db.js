'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const crypto = require('node:crypto');

const VERSAO_SCHEMA = 3;

// Migrações incrementais aplicadas em bancos existentes (chave = versão de origem).
const MIGRACOES = {
  2: [
    "ALTER TABLE musicas ADD COLUMN bpm INTEGER",
    "ALTER TABLE musicas ADD COLUMN duracao TEXT",
    "ALTER TABLE musicas ADD COLUMN classificacao TEXT",
    "ALTER TABLE musicas ADD COLUMN link_letra TEXT",
    "ALTER TABLE musicas ADD COLUMN link_youtube TEXT",
    "ALTER TABLE musicas ADD COLUMN observacoes TEXT",
    "ALTER TABLE repertorio ADD COLUMN ministro_voluntario_id INTEGER REFERENCES voluntarios(id) ON DELETE SET NULL",
    "ALTER TABLE ocorrencias ADD COLUMN observacoes TEXT",
    "ALTER TABLE escala ADD COLUMN faltou INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE bloqueios ADD COLUMN data_fim TEXT",
    "ALTER TABLE bloqueios ADD COLUMN periodo TEXT NOT NULL DEFAULT 'dia'",
    "ALTER TABLE eventos ADD COLUMN intervalo_semanas INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE eventos ADD COLUMN termina_em TEXT",
    "ALTER TABLE eventos ADD COLUMN max_ocorrencias INTEGER",
    "ALTER TABLE voluntarios ADD COLUMN nascimento TEXT",
  ],
};

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  telefone TEXT UNIQUE,
  email TEXT UNIQUE,
  senha_hash TEXT NOT NULL,
  sal TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'membro' CHECK (papel IN ('admin','lider','membro')),
  voluntario_id INTEGER REFERENCES voluntarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criada_em TEXT NOT NULL,
  expira_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ministerio_lideres (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ministerio_id INTEGER NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, ministerio_id)
);

CREATE TABLE IF NOT EXISTS locais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'matriz' CHECK (tipo IN ('matriz','capela'))
);

CREATE TABLE IF NOT EXISTS ministerios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cor TEXT NOT NULL DEFAULT '#7c5cd6'
);

CREATE TABLE IF NOT EXISTS funcoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ministerio_id INTEGER NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  nome TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voluntarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  nascimento TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  termo_aceito_em TEXT
);

CREATE TABLE IF NOT EXISTS voluntario_funcoes (
  voluntario_id INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  funcao_id INTEGER NOT NULL REFERENCES funcoes(id) ON DELETE CASCADE,
  preferencia INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (voluntario_id, funcao_id)
);

-- Janelas semanais em que o voluntário PODE servir. Sem nenhuma linha = sempre disponível.
CREATE TABLE IF NOT EXISTS disponibilidade (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voluntario_id INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio TEXT NOT NULL DEFAULT '00:00',
  hora_fim TEXT NOT NULL DEFAULT '23:59'
);

-- Indisponibilidades: dia único ou intervalo (data..data_fim), com período do dia
-- e justificativa obrigatória (visível só para líderes/admin e para o próprio membro).
CREATE TABLE IF NOT EXISTS bloqueios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voluntario_id INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  data_fim TEXT,
  periodo TEXT NOT NULL DEFAULT 'dia' CHECK (periodo IN ('dia','matutino','vespertino','noturno')),
  motivo TEXT NOT NULL,
  UNIQUE (voluntario_id, data)
);

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  local_id INTEGER REFERENCES locais(id) ON DELETE SET NULL,
  recorrente INTEGER NOT NULL DEFAULT 1,
  dia_semana INTEGER,
  data TEXT,
  hora_inicio TEXT NOT NULL,
  duracao_min INTEGER NOT NULL DEFAULT 120,
  intervalo_semanas INTEGER NOT NULL DEFAULT 1,
  termina_em TEXT,
  max_ocorrencias INTEGER,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS evento_necessidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  funcao_id INTEGER NOT NULL REFERENCES funcoes(id) ON DELETE CASCADE,
  quantidade INTEGER NOT NULL DEFAULT 1,
  UNIQUE (evento_id, funcao_id)
);

-- Instância do evento numa data = o culto em si, com roteiro.
CREATE TABLE IF NOT EXISTS ocorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  duracao_min INTEGER NOT NULL DEFAULT 120,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','encerrada','cancelada')),
  tema TEXT,
  pregador TEXT,
  ministra TEXT,
  responsavel TEXT,
  abertura TEXT,
  observacoes TEXT,
  publicada_em TEXT,
  publicada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT,
  UNIQUE (evento_id, data)
);

-- Itens do roteiro/programa do culto (oportunidades), ordenados.
CREATE TABLE IF NOT EXISTS oportunidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ocorrencia_id INTEGER NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 0,
  titulo TEXT NOT NULL,
  responsavel TEXT
);

CREATE TABLE IF NOT EXISTS escala (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ocorrencia_id INTEGER NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  voluntario_id INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  funcao_id INTEGER NOT NULL REFERENCES funcoes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'convidado' CHECK (status IN ('convidado','confirmado','recusado')),
  checkin_em TEXT,
  faltou INTEGER NOT NULL DEFAULT 0,
  UNIQUE (ocorrencia_id, voluntario_id, funcao_id)
);

CREATE TABLE IF NOT EXISTS trocas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escala_id INTEGER NOT NULL REFERENCES escala(id) ON DELETE CASCADE,
  solicitante_id INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  destinatario_id INTEGER REFERENCES voluntarios(id) ON DELETE SET NULL,
  aceitou_id INTEGER REFERENCES voluntarios(id) ON DELETE SET NULL,
  motivo TEXT,
  prazo TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','aceita','recusada','cancelada','expirada')),
  criada_em TEXT NOT NULL,
  resolvida_em TEXT
);

CREATE TABLE IF NOT EXISTS avisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ministerio_id INTEGER REFERENCES ministerios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  mensagem TEXT,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notificacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voluntario_id INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  mensagem TEXT NOT NULL,
  lida INTEGER NOT NULL DEFAULT 0,
  criada_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ocorrencia_id INTEGER NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  voluntario_id INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario TEXT,
  criado_em TEXT NOT NULL,
  UNIQUE (ocorrencia_id, voluntario_id)
);

CREATE TABLE IF NOT EXISTS pontos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voluntario_id INTEGER NOT NULL REFERENCES voluntarios(id) ON DELETE CASCADE,
  valor INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  ref TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS musicas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  artista TEXT,
  tom TEXT,
  bpm INTEGER,
  duracao TEXT,
  classificacao TEXT,
  observacoes TEXT,
  letra TEXT,
  cifra TEXT,
  cifra_html TEXT,
  link_spotify TEXT,
  link_deezer TEXT,
  link_cifraclub TEXT,
  link_letra TEXT,
  link_youtube TEXT,
  chave_dedupe TEXT UNIQUE,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS musica_versoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  musica_id INTEGER NOT NULL REFERENCES musicas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  letra TEXT,
  cifra_html TEXT,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS setlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS setlist_musicas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setlist_id INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
  musica_id INTEGER NOT NULL REFERENCES musicas(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 0,
  tom TEXT,
  UNIQUE (setlist_id, musica_id)
);

-- Louvores de um culto, com a tonalidade escolhida PARA aquele culto e o
-- ministro em destaque (quem puxa a música).
CREATE TABLE IF NOT EXISTS repertorio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ocorrencia_id INTEGER NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  musica_id INTEGER NOT NULL REFERENCES musicas(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 0,
  tom TEXT,
  ministro_voluntario_id INTEGER REFERENCES voluntarios(id) ON DELETE SET NULL,
  UNIQUE (ocorrencia_id, musica_id)
);

-- Comentários dos membros em cada culto/escala.
CREATE TABLE IF NOT EXISTS comentarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ocorrencia_id INTEGER NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

-- Convites de onboarding gerados pelo admin (URL com token, uso único).
CREATE TABLE IF NOT EXISTS convites (
  token TEXT PRIMARY KEY,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL,
  usado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usado_em TEXT
);
`;

function agoraISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function hojeISO(desloc = 0) {
  const d = new Date();
  d.setDate(d.getDate() + desloc);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Abre o banco. Bancos v2+ são migrados no lugar (sem perder dados);
// anteriores à v2 são arquivados como .bak e recomeça-se do zero.
function abrir(caminho = 'voluts.db') {
  if (caminho !== ':memory:' && fs.existsSync(caminho)) {
    const sonda = new DatabaseSync(caminho);
    const versao = sonda.prepare('PRAGMA user_version').get().user_version;
    const temTabelas = sonda.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n > 0;
    sonda.close();
    if (temTabelas && versao < 2) {
      fs.renameSync(caminho, caminho + '.v' + versao + '.bak');
      console.log(`Banco antigo arquivado em ${caminho}.v${versao}.bak — criando schema v${VERSAO_SCHEMA}.`);
    }
  }
  const db = new DatabaseSync(caminho);
  migrar(db);
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${VERSAO_SCHEMA}`);
  return db;
}

// Aplica migrações incrementais em bancos já populados (v2 em diante).
function migrar(db) {
  const versao = db.prepare('PRAGMA user_version').get().user_version;
  const temTabelas = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n > 0;
  if (!temTabelas || versao < 2 || versao >= VERSAO_SCHEMA) return;
  for (let v = versao; v < VERSAO_SCHEMA; v++) {
    for (const sql of MIGRACOES[v] || []) {
      try { db.exec(sql); } catch (e) {
        if (!/duplicate column/i.test(e.message)) throw e;
      }
    }
    console.log(`Migração v${v} → v${v + 1} aplicada.`);
  }
}

function estaVazio(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM ministerios').get().n === 0;
}

// ---------- senhas ----------
function gerarSal() { return crypto.randomBytes(16).toString('hex'); }
function hashSenha(senha, sal) { return crypto.scryptSync(String(senha), sal, 64).toString('hex'); }
function conferirSenha(senha, sal, hash) {
  const calc = Buffer.from(hashSenha(senha, sal), 'hex');
  const alvo = Buffer.from(hash, 'hex');
  return calc.length === alvo.length && crypto.timingSafeEqual(calc, alvo);
}

function criarUsuario(db, { nome, telefone, email, senha, papel = 'membro', voluntario_id = null }) {
  const sal = gerarSal();
  const r = db.prepare(
    'INSERT INTO usuarios (nome, telefone, email, senha_hash, sal, papel, voluntario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(nome, telefone || null, email || null, hashSenha(senha, sal), sal, papel, voluntario_id, agoraISO());
  return Number(r.lastInsertRowid);
}

// ---------- seed de demonstração ----------
function seedDemo(db) {
  const ins = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid);
  const agora = agoraISO();

  const matriz = ins("INSERT INTO locais (nome, tipo) VALUES ('Matriz', 'matriz')");
  const capela = ins("INSERT INTO locais (nome, tipo) VALUES ('Capela São José', 'capela')");

  const louvor = ins("INSERT INTO ministerios (nome, cor) VALUES ('Louvor', '#7c5cd6')");
  const midia = ins("INSERT INTO ministerios (nome, cor) VALUES ('Mídia', '#d97706')");
  const recepcao = ins("INSERT INTO ministerios (nome, cor) VALUES ('Recepção', '#0284c7')");
  const diaconia = ins("INSERT INTO ministerios (nome, cor) VALUES ('Diaconia', '#059669')");

  const f = {};
  const funcao = (min, nome) => { f[nome] = ins('INSERT INTO funcoes (ministerio_id, nome) VALUES (?, ?)', min, nome); return f[nome]; };
  funcao(louvor, 'Vocal'); funcao(louvor, 'Violão'); funcao(louvor, 'Teclado');
  funcao(louvor, 'Baixo'); funcao(louvor, 'Viola'); funcao(louvor, 'Bateria');
  funcao(midia, 'Projeção'); funcao(midia, 'Operador de Som');
  funcao(recepcao, 'Porta principal'); funcao(recepcao, 'Acolhida');
  funcao(diaconia, 'Diácono');

  // Voluntários — vários multi-setoriais (habilidades em mais de um ministério).
  const gente = [
    ['Evandro Silva', ['Violão', 'Operador de Som', 'Diácono']],
    ['Viviane Costa', ['Vocal', 'Acolhida']],
    ['Elielson Ramos', ['Projeção', 'Diácono']],
    ['Kelly Souza', ['Vocal', 'Viola']],
    ['Clarianne Dias', ['Vocal', 'Teclado']],
    ['Ana Souza', ['Vocal', 'Acolhida']],
    ['Bruno Lima', ['Baixo', 'Violão']],
    ['Carla Dias', ['Vocal', 'Projeção']],
    ['Daniel Rocha', ['Teclado', 'Operador de Som']],
    ['Elisa Martins', ['Porta principal', 'Acolhida']],
    ['Felipe Nunes', ['Operador de Som', 'Projeção']],
    ['Gabriela Pinto', ['Vocal', 'Viola']],
    ['Heitor Alves', ['Porta principal', 'Diácono']],
    ['Iara Campos', ['Acolhida']],
    ['João Pereira', ['Violão', 'Bateria', 'Vocal']],
    ['Karina Lopes', ['Projeção']],
    ['Lucas Ferreira', ['Operador de Som', 'Bateria']],
  ];
  const vol = {};
  let fone = 11999990001;
  for (const [nome, habilidades] of gente) {
    const id = ins('INSERT INTO voluntarios (nome, telefone, email, termo_aceito_em) VALUES (?, ?, ?, ?)',
      nome, String(fone++), nome.toLowerCase().split(' ')[0] + '@aclame.local', agora);
    vol[nome] = id;
    habilidades.forEach((h, i) =>
      db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id, preferencia) VALUES (?, ?, ?)').run(id, f[h], i === 0 ? 1 : 0));
  }

  // Usuários (senha 1234): admin, líderes e membros de exemplo.
  const uEvandro = criarUsuario(db, { nome: 'Evandro Silva', telefone: '11999990001', email: 'evandro@aclame.local', senha: '1234', papel: 'admin', voluntario_id: vol['Evandro Silva'] });
  const uViviane = criarUsuario(db, { nome: 'Viviane Costa', telefone: '11999990002', email: 'viviane@aclame.local', senha: '1234', papel: 'lider', voluntario_id: vol['Viviane Costa'] });
  const uElielson = criarUsuario(db, { nome: 'Elielson Ramos', telefone: '11999990003', email: 'elielson@aclame.local', senha: '1234', papel: 'lider', voluntario_id: vol['Elielson Ramos'] });
  criarUsuario(db, { nome: 'Kelly Souza', telefone: '11999990004', email: 'kelly@aclame.local', senha: '1234', papel: 'membro', voluntario_id: vol['Kelly Souza'] });
  criarUsuario(db, { nome: 'Clarianne Dias', telefone: '11999990005', email: 'clarianne@aclame.local', senha: '1234', papel: 'membro', voluntario_id: vol['Clarianne Dias'] });
  db.prepare('INSERT INTO ministerio_lideres (usuario_id, ministerio_id) VALUES (?, ?)').run(uViviane, louvor);
  db.prepare('INSERT INTO ministerio_lideres (usuario_id, ministerio_id) VALUES (?, ?)').run(uElielson, midia);
  db.prepare('INSERT INTO ministerio_lideres (usuario_id, ministerio_id) VALUES (?, ?)').run(uEvandro, recepcao);
  db.prepare('INSERT INTO ministerio_lideres (usuario_id, ministerio_id) VALUES (?, ?)').run(uEvandro, diaconia);

  // Disponibilidades de exemplo: alguns só domingo; um bloqueio justificado.
  const dom = 0, qua = 3;
  for (const n of ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Elisa Martins']) {
    db.prepare('INSERT INTO disponibilidade (voluntario_id, dia_semana) VALUES (?, ?)').run(vol[n], dom);
  }
  for (const n of ['Daniel Rocha', 'Felipe Nunes', 'Gabriela Pinto', 'João Pereira', 'Kelly Souza', 'Clarianne Dias']) {
    db.prepare('INSERT INTO disponibilidade (voluntario_id, dia_semana) VALUES (?, ?)').run(vol[n], dom);
    db.prepare("INSERT INTO disponibilidade (voluntario_id, dia_semana, hora_inicio) VALUES (?, ?, '18:00')").run(vol[n], qua);
  }
  db.prepare('INSERT INTO bloqueios (voluntario_id, data, motivo) VALUES (?, ?, ?)').run(vol['Iara Campos'], hojeISO(14), 'Viagem de trabalho');

  // Celebrações.
  const cultoDom = ins("INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, duracao_min, criado_por, criado_em) VALUES ('Culto de Domingo', ?, 1, 0, '19:00', 120, ?, ?)", matriz, uEvandro, agora);
  const cultoQua = ins("INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, duracao_min, criado_por, criado_em) VALUES ('Culto de Doutrina', ?, 1, 3, '19:30', 90, ?, ?)", matriz, uEvandro, agora);
  ins("INSERT INTO eventos (nome, local_id, recorrente, dia_semana, hora_inicio, duracao_min, criado_por, criado_em) VALUES ('Celebração na Capela', ?, 1, 0, '09:00', 90, ?, ?)", capela, uEvandro, agora);

  const needs = [
    [cultoDom, 'Vocal', 3], [cultoDom, 'Violão', 1], [cultoDom, 'Teclado', 1], [cultoDom, 'Baixo', 1], [cultoDom, 'Bateria', 1],
    [cultoDom, 'Projeção', 1], [cultoDom, 'Operador de Som', 1], [cultoDom, 'Porta principal', 1], [cultoDom, 'Acolhida', 2], [cultoDom, 'Diácono', 2],
    [cultoQua, 'Vocal', 1], [cultoQua, 'Violão', 1], [cultoQua, 'Projeção', 1], [cultoQua, 'Operador de Som', 1], [cultoQua, 'Diácono', 1],
  ];
  for (const [e, nomeF, q] of needs) db.prepare('INSERT INTO evento_necessidades (evento_id, funcao_id, quantidade) VALUES (?, ?, ?)').run(e, f[nomeF], q);

  // Aniversários de demonstração (MM-DD).
  const nascimentos = {
    'Clarianne Dias': '10-30', 'Kelly Souza': '03-15', 'Viviane Costa': '07-08',
    'Evandro Silva': '12-01', 'Ana Souza': '07-21', 'Bruno Lima': '08-05', 'Elielson Ramos': '07-28',
  };
  for (const [nome, nasc] of Object.entries(nascimentos)) {
    db.prepare('UPDATE voluntarios SET nascimento = ? WHERE id = ?').run(nasc, vol[nome]);
  }

  // Estante musical com regiões marcadas, tons, BPM, duração e classificação.
  const musicas = [
    ['Atrai o Meu Coração', 'Nathanael', 'E', 72, '5:48', 'Adoração'],
    ['Para que Entre o Rei da Glória', 'Comunidade Carisma', 'G', 128, '4:10', 'Louvor'],
    ['Jesus em Tua Presença', 'Ministério Koinonya', 'D', 76, '6:02', 'Adoração'],
    ['Não Há Deus Maior', 'Adoração e Adoradores', 'D', 82, '5:15', 'Adoração'],
    ['Grandes Coisas', 'Fernandinho', 'G', 138, '4:32', 'Louvor'],
    ['Oceanos', 'Hillsong United', 'D', 66, '8:56', 'Adoração'],
    ['Lugar Secreto', 'Gabriela Rocha', 'C', 70, '5:37', 'Adoração'],
  ];
  const musIds = {};
  for (const [t, a, tom, bpm, dur, classif] of musicas) {
    musIds[t] = ins(
      'INSERT INTO musicas (titulo, artista, tom, bpm, duracao, classificacao, letra, cifra, link_spotify, link_cifraclub, link_youtube, link_letra, chave_dedupe, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      t, a, tom, bpm, dur, classif,
      `[INTRO]\n(instrumental)\n\n[VERSO]\nLetra de exemplo do verso de ${t}\nSegunda linha do verso\n\n[PRÉ-REFRÃO]\nPreparando o refrão\n\n[REFRÃO]\nRefrão de exemplo de ${t}\nCantado com todo o coração\n\n[FINAL]\nEncerramento suave`,
      `[INTRO]\n${tom}  ${tom}4  ${tom}\n\n[VERSO]\n${tom}        ${tom}4\nLetra de exemplo do verso\n${relativaMenor(tom)}       ${tom}\nSegunda linha do verso\n\n[PRÉ-REFRÃO]\n${subdominante(tom)}   ${dominante(tom)}\nPreparando o refrão\n\n[REFRÃO]\n${tom}      ${subdominante(tom)}\nRefrão de exemplo\n${relativaMenor(tom)}      ${dominante(tom)}\nCantado com todo o coração\n\n[FINAL]\n${subdominante(tom)}  ${tom}`,
      'https://open.spotify.com/search/' + encodeURIComponent(t),
      'https://www.cifraclub.com.br/?q=' + encodeURIComponent(t + ' ' + a),
      'https://www.youtube.com/results?search_query=' + encodeURIComponent(t + ' ' + a),
      'https://www.letras.mus.br/?q=' + encodeURIComponent(t),
      normalizarChave(t, a), uViviane, agora);
  }

  // Um culto de exemplo já publicado no mural, com roteiro completo (estilo grupo do WhatsApp).
  const proxDomingo = proximoDia(0);
  const oc = ins(`INSERT INTO ocorrencias (evento_id, data, hora_inicio, duracao_min, tema, pregador, ministra, responsavel, abertura, publicada_em, publicada_por, criado_por, criado_em)
    VALUES (?, ?, '19:00', 120, 'Ceia do Senhor', 'Pr. Marciel', 'Viviane', 'Departamento Masculino', 'Viviane — Abertura e Louvor (hino: Atrai o Meu Coração — Nathanael)', ?, ?, ?, ?)`,
    cultoDom, proxDomingo, agora, uEvandro, uEvandro, agora);
  const ops = [
    ['Departamento Infantil', null],
    ['Devocional', 'Elielson'],
    ['Departamento Feminino', null],
  ];
  ops.forEach(([titulo, resp], i) =>
    db.prepare('INSERT INTO oportunidades (ocorrencia_id, ordem, titulo, responsavel) VALUES (?, ?, ?, ?)').run(oc, i + 1, titulo, resp));
  const setDom = [['Para que Entre o Rei da Glória', 'G'], ['Jesus em Tua Presença', 'D'], ['Não Há Deus Maior', 'D']];
  setDom.forEach(([t, tom], i) =>
    db.prepare('INSERT INTO repertorio (ocorrencia_id, musica_id, ordem, tom) VALUES (?, ?, ?, ?)').run(oc, musIds[t], i + 1, tom));

  db.prepare('INSERT INTO avisos (ministerio_id, titulo, mensagem, criado_por, criado_em) VALUES (?, ?, ?, ?, ?)').run(
    louvor, 'Ensaio geral sábado 17h', 'Ensaio do repertório de domingo. Chegar 15 min antes.', uViviane, agora);
  db.prepare('INSERT INTO avisos (ministerio_id, titulo, mensagem, criado_por, criado_em) VALUES (?, ?, ?, ?, ?)').run(
    null, 'Bem-vindos ao Aclame!', 'Confirmem as escalas pelo app e mantenham suas disponibilidades em dia.', uEvandro, agora);
}

// Auxiliares musicais simples para o seed (I, IV, V, vi do campo harmônico maior).
const CROMATICA = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function transporNota(nota, semitons) {
  const i = CROMATICA.indexOf(nota);
  return CROMATICA[((i + semitons) % 12 + 12) % 12];
}
function subdominante(tom) { return transporNota(tom, 5); }
function dominante(tom) { return transporNota(tom, 7); }
function relativaMenor(tom) { return transporNota(tom, 9) + 'm'; }

function normalizarChave(titulo, artista) {
  return (String(titulo) + '|' + String(artista || ''))
    .toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^a-z0-9|]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function proximoDia(diaSemana) {
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== diaSemana);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = {
  abrir, seedDemo, estaVazio, agoraISO, hojeISO, SCHEMA, VERSAO_SCHEMA,
  criarUsuario, conferirSenha, hashSenha, gerarSal, normalizarChave, proximoDia,
};
