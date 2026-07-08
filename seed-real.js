'use strict';
// Dados reais — Escala de Louvor, Julho de 2026 (planilha do grupo).
// Uso:  PGURL=postgres://... node seed-real.js [--force]
//   sem --force: recusa rodar se o banco já tiver dados (evita apagar por engano).
//   --force: apaga todas as tabelas de dados (schema_meta fica intacta) e recria
//            do zero — mas primeiro resgata as contas reais (não-demo) já
//            cadastradas no banco (senha, papel, indisponibilidades) para
//            recriá-las depois do reset, sem ninguém perder o próprio login.
const { abrir, agoraISO, estaVazio } = require('./db');

// Tabelas de dados na ordem que o CASCADE do TRUNCATE cobre sozinho
// (schema_meta fica de fora — controla a versão do schema, não é dado do app).
const TABELAS_DADOS = [
  'comentarios', 'convites', 'repertorio', 'setlist_musicas', 'setlists',
  'musica_versoes', 'musicas', 'feedback', 'avisos', 'trocas', 'escala',
  'oportunidades', 'ocorrencias', 'evento_necessidades', 'eventos',
  'ministerio_lideres', 'sessoes', 'usuarios', 'pontos', 'notificacoes',
  'bloqueios', 'disponibilidade', 'voluntario_funcoes', 'voluntarios',
  'funcoes', 'ministerios', 'locais',
];

async function main() {
  const forcar = process.argv.includes('--force');
  const db = await abrir(process.env.PGURL);

  if (!(await estaVazio(db)) && !forcar) {
    console.error('Banco já tem dados. Rode novamente com --force para substituir (contas reais são preservadas).');
    await db.close();
    process.exit(1);
  }

  // ---------- 1. resgata contas reais (não-demo) antes de apagar ----------
  const contasReais = forcar
    ? await db.prepare("SELECT * FROM usuarios WHERE email IS NULL OR email NOT LIKE '%@aclame.local'").all()
    : [];
  const volIds = contasReais.map((c) => c.voluntario_id).filter(Boolean);
  let bloqueiosReais = [];
  if (volIds.length) {
    bloqueiosReais = await db.prepare(
      `SELECT * FROM bloqueios WHERE voluntario_id IN (${volIds.map(() => '?').join(',')})`
    ).all(...volIds);
  }

  if (forcar) {
    await db.exec(`TRUNCATE ${TABELAS_DADOS.join(', ')} RESTART IDENTITY CASCADE`);
    console.log(`Banco limpo (--force). ${contasReais.length} conta(s) real(is) preservada(s) para recriação.`);
  }

  // ---------- 2. base: igreja, ministério, funções ----------
  const agora = agoraISO();
  const ins = async (sql, ...params) => Number((await db.prepare(sql).run(...params)).lastInsertRowid);

  const igreja = await ins("INSERT INTO locais (nome, tipo) VALUES ('Igreja', 'matriz')");
  const louvor = await ins("INSERT INTO ministerios (nome, cor) VALUES ('Louvor', '#7c5cd6')");

  const FUNCOES = ['Ministro', 'Voz', 'Guitarra', 'Baixo', 'Teclado', 'Bateria', 'Violão'];
  const f = {};
  for (const nome of FUNCOES) f[nome] = await ins('INSERT INTO funcoes (ministerio_id, nome) VALUES (?, ?)', louvor, nome);

  // Voluntários reais e suas funções (primeira = preferida).
  const GENTE = [
    ['Helber',     ['Guitarra'],                  '65996407005', 'helberduarte@gmail.com'],
    ['Gabriel',    ['Guitarra', 'Bateria'],       null, null],
    ['Robson',     ['Baixo'],                     null, null],
    ['Viviane',    ['Teclado', 'Ministro'],       null, null],
    ['Evelyn',     ['Violão'],                    null, null],
    ['Edna',       ['Voz', 'Ministro'],           null, null],
    ['Silvana',    ['Voz', 'Ministro'],           null, null],
    ['Kelly',      ['Voz', 'Ministro'],           null, null],
    ['Daniela',    ['Voz', 'Ministro'],           null, null],
    ['Clarianne',  ['Voz', 'Ministro'],           null, null],
    ['M. Eduarda', ['Voz'],                       null, null],
    ['Evandro',    ['Voz', 'Ministro', 'Bateria'], null, null],
    ['Gislainy',   ['Voz'],                       null, null],
    ['Davi',       ['Bateria'],                   null, null],
  ];
  const vol = {};
  for (const [nome, habilidades, tel, email] of GENTE) {
    vol[nome] = await ins('INSERT INTO voluntarios (nome, telefone, email, termo_aceito_em) VALUES (?, ?, ?, ?)', nome, tel, email, agora);
    for (let i = 0; i < habilidades.length; i++) {
      await db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id, preferencia) VALUES (?, ?, ?)')
        .run(vol[nome], f[habilidades[i]], i === 0 ? 1 : 0);
    }
  }

  // ---------- 3. recria as contas preservadas (mesma senha) ----------
  const mapaVolAntigoNovo = {}; // voluntario_id antigo -> novo
  let usuarioAdmin = null;
  for (const c of contasReais) {
    // Helber (dono do e-mail real) vira admin e assume o voluntário "Helber" da escala.
    const ehHelber = c.email === 'helberduarte@gmail.com';
    let voluntarioId;
    if (ehHelber) {
      voluntarioId = vol['Helber'];
    } else {
      voluntarioId = await ins('INSERT INTO voluntarios (nome, telefone, email, termo_aceito_em) VALUES (?, ?, ?, ?)', c.nome, c.telefone, c.email, c.criado_em);
    }
    if (c.voluntario_id) mapaVolAntigoNovo[c.voluntario_id] = voluntarioId;
    const novoId = await ins(
      'INSERT INTO usuarios (nome, telefone, email, senha_hash, sal, papel, voluntario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      c.nome, c.telefone, c.email, c.senha_hash, c.sal, ehHelber ? 'admin' : c.papel, voluntarioId, c.criado_em);
    if (ehHelber) {
      usuarioAdmin = novoId;
      await db.prepare('INSERT INTO ministerio_lideres (usuario_id, ministerio_id) VALUES (?, ?)').run(novoId, louvor);
    }
    console.log(`Conta preservada: ${c.nome} (${c.email || c.telefone})${ehHelber ? ' — agora admin e líder do Louvor' : ''}`);
  }
  for (const b of bloqueiosReais) {
    const novoVol = mapaVolAntigoNovo[b.voluntario_id];
    if (novoVol) await db.prepare('INSERT INTO bloqueios (voluntario_id, data, data_fim, periodo, motivo) VALUES (?, ?, ?, ?, ?)')
      .run(novoVol, b.data, b.data_fim, b.periodo, b.motivo);
  }

  // ---------- 4. celebrações de julho/2026 ----------
  const evento = async (nome, recorrente, diaSemana, data, hora, duracao = 120) => ins(
    'INSERT INTO eventos (nome, local_id, recorrente, dia_semana, data, hora_inicio, duracao_min, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nome, igreja, recorrente, diaSemana, data, hora, duracao, usuarioAdmin, agora);

  const ev = {
    sab:   await evento('Culto de Sábado', 1, 6, null, '19:30'),
    dom:   await evento('Culto de Domingo', 1, 0, null, '19:00'),
    qua:   await evento('Culto de Quarta', 1, 3, null, '20:00', 90),
    sex17: await evento('Culto Especial de Sexta', 0, null, '2026-07-17', '19:30'),
    sabM:  await evento('Culto da Manhã de Sábado', 0, null, '2026-07-18', '09:00'),
    domM:  await evento('Culto da Manhã de Domingo', 0, null, '2026-07-19', '09:00'),
  };
  // Necessidades padrão (usadas pelo gerador de escala).
  for (const e of Object.values(ev)) {
    const needs = { Ministro: 1, Voz: 3, Guitarra: 2, Baixo: 1, Teclado: 1, Bateria: 1, 'Violão': 1 };
    for (const [nomeF, q] of Object.entries(needs))
      await db.prepare('INSERT INTO evento_necessidades (evento_id, funcao_id, quantidade) VALUES (?, ?, ?)').run(e, f[nomeF], q);
  }

  // ---------- 5. escala de julho (planilha do grupo) ----------
  // Grafias corrigidas da planilha: "Helberl" = Helber, "Evandrol" = Evandro.
  const G = (...n) => ({ Guitarra: n });
  const base = { Baixo: ['Robson'], Teclado: ['Viviane'], 'Violão': ['Evelyn'] };
  const ESCALA = [
    { data: '2026-07-04', ev: 'sab', hora: '19:30', voz: ['Clarianne', 'Daniela'], ministro: 'Edna',
      mus: { ...base, ...G('Helber', 'Gabriel'), Bateria: ['Gabriel'] } },
    { data: '2026-07-05', ev: 'dom', hora: '19:00', voz: ['Daniela', 'Kelly', 'M. Eduarda'], ministro: 'Silvana',
      mus: { ...base, ...G('Helber', 'Gabriel'), Bateria: ['Gabriel'] } },
    { data: '2026-07-08', ev: 'qua', hora: '20:00', voz: ['Silvana'], ministro: 'Kelly',
      mus: { ...base, ...G('Helber'), Bateria: ['Gabriel'] } },
    { data: '2026-07-11', ev: 'sab', hora: '19:30', voz: ['M. Eduarda', 'Silvana'], ministro: 'Daniela',
      tema: 'Santa Ceia', obs: 'Devocional com o Louvor na igreja — Santa Ceia.',
      mus: { ...base, ...G('Helber'), Bateria: ['Gabriel'] } },
    { data: '2026-07-12', ev: 'dom', hora: '19:00', voz: ['Daniela', 'Edna', 'Kelly'], ministro: 'Evandro',
      mus: { ...base, ...G('Helber'), Bateria: ['Gabriel'] } },
    { data: '2026-07-15', ev: 'qua', hora: '20:00', voz: ['Evandro'], ministro: 'Silvana',
      mus: { ...base, ...G('Helber'), Bateria: ['Evandro'] } },
    { data: '2026-07-17', ev: 'sex17', hora: '19:30', voz: ['Gislainy', 'Kelly'], ministro: 'Silvana',
      mus: { ...base, ...G('Helber', 'Gabriel'), Bateria: ['Evandro'] } },
    { data: '2026-07-18', ev: 'sabM', hora: '09:00', voz: [], ministro: 'Viviane', mus: {} },
    { data: '2026-07-18', ev: 'sab', hora: '19:30', voz: ['Edna', 'Silvana'], ministro: 'Evandro',
      mus: { ...base, ...G('Helber'), Bateria: ['Davi'] } },
    { data: '2026-07-19', ev: 'domM', hora: '09:00', voz: ['M. Eduarda', 'Kelly'], ministro: 'Daniela',
      mus: { ...base, ...G('Helber', 'Gabriel'), Bateria: ['Evandro'] } },
    { data: '2026-07-19', ev: 'dom', hora: '19:00', voz: ['Clarianne', 'Daniela'], ministro: 'Kelly',
      mus: { ...base, ...G('Helber', 'Gabriel'), Bateria: ['Evandro'] } },
    { data: '2026-07-22', ev: 'qua', hora: '20:00', voz: ['Edna'], ministro: 'Clarianne',
      mus: { ...base, ...G('Helber'), Bateria: ['Evandro'] } },
    { data: '2026-07-25', ev: 'sab', hora: '19:30', voz: ['Clarianne', 'Silvana'], ministro: 'Daniela',
      mus: { ...base, ...G('Helber', 'Gabriel'), Bateria: ['Evandro'] } },
    { data: '2026-07-26', ev: 'dom', hora: '19:00', voz: ['Daniela', 'Kelly', 'M. Eduarda'], ministro: 'Evandro',
      mus: { ...base, ...G('Helber'), Bateria: ['Gabriel'] } },
    { data: '2026-07-29', ev: 'qua', hora: '20:00', voz: ['Silvana'], ministro: 'Kelly',
      mus: { ...base, ...G('Helber'), Bateria: ['Evandro'] } },
  ];

  let totalEscalados = 0;
  for (const c of ESCALA) {
    const oc = await ins(
      `INSERT INTO ocorrencias (evento_id, data, hora_inicio, duracao_min, tema, ministra, observacoes, publicada_em, publicada_por, criado_por, criado_em)
       VALUES (?, ?, ?, 120, ?, ?, ?, ?, ?, ?, ?)`,
      ev[c.ev], c.data, c.hora, c.tema || null, c.ministro, c.obs || null, agora, usuarioAdmin, usuarioAdmin, agora);
    const escalar = async (nome, funcao) => {
      await db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(oc, vol[nome], f[funcao]);
      totalEscalados++;
    };
    await escalar(c.ministro, 'Ministro');
    for (const nome of c.voz) await escalar(nome, 'Voz');
    for (const [funcao, nomes] of Object.entries(c.mus)) for (const nome of nomes) await escalar(nome, funcao);
  }

  // ---------- 6. aviso dos ensaios (texto da planilha) ----------
  await db.prepare('INSERT INTO avisos (ministerio_id, titulo, mensagem, criado_por, criado_em) VALUES (?, ?, ?, ?, ?)').run(
    louvor, 'Ensaios de julho',
    'Ensaios sábado — 17:30h. Ensaios domingo — 17:00h → ensaio de quarta-feira.',
    usuarioAdmin, agora);

  console.log(`OK: ${GENTE.length} voluntários, ${Object.keys(ev).length} celebrações, ${ESCALA.length} cultos, ${totalEscalados} escalações em julho/2026.`);
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
