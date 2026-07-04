'use strict';
const { agoraISO, hojeISO } = require('./db');

// ---------- utilidades de tempo ----------

function minutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function diaSemana(dataISO) {
  const [a, m, d] = dataISO.split('-').map(Number);
  return new Date(a, m - 1, d).getDay();
}

function sobrepoe(inicio1, dur1, inicio2, dur2) {
  const a1 = minutos(inicio1), b1 = a1 + dur1;
  const a2 = minutos(inicio2), b2 = a2 + dur2;
  return a1 < b2 && a2 < b1;
}

const DIAS_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

// ---------- geração de ocorrências ----------

// Materializa ocorrências dos eventos ativos entre hoje e `ateData` (inclusive),
// respeitando a recorrência personalizada: a cada N semanas, término em data
// e/ou número máximo de ocorrências.
function gerarOcorrencias(db, ateData, deData = null) {
  const eventos = db.prepare('SELECT * FROM eventos WHERE ativo = 1').all();
  const inicio = deData || hojeISO();
  let criadas = 0;
  for (const ev of eventos) {
    if (ev.recorrente) {
      const limite = ev.termina_em && ev.termina_em < ateData ? ev.termina_em : ateData;
      const intervalo = Math.max(1, ev.intervalo_semanas || 1);
      let total = db.prepare('SELECT COUNT(*) AS n FROM ocorrencias WHERE evento_id = ?').get(ev.id).n;
      // Âncora do ciclo: primeira ocorrência já criada, senão data-base do evento.
      let ancora = null;
      if (intervalo > 1) {
        const base = db.prepare('SELECT MIN(data) AS d FROM ocorrencias WHERE evento_id = ?').get(ev.id).d
          || ev.data || (ev.criado_em || inicio).slice(0, 10);
        const a = new Date(base + 'T12:00:00');
        while (a.getDay() !== ev.dia_semana) a.setDate(a.getDate() + 1);
        ancora = a;
      }
      for (let d = new Date(inicio + 'T12:00:00'); ; d.setDate(d.getDate() + 1)) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (iso > limite) break;
        if (d.getDay() !== ev.dia_semana) continue;
        if (ancora) {
          const semanas = Math.round((d - ancora) / 604800000);
          if (((semanas % intervalo) + intervalo) % intervalo !== 0) continue;
        }
        if (ev.max_ocorrencias && total >= ev.max_ocorrencias) break;
        const r = db.prepare('INSERT OR IGNORE INTO ocorrencias (evento_id, data, hora_inicio, duracao_min, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
          .run(ev.id, iso, ev.hora_inicio, ev.duracao_min, ev.criado_por, agoraISO());
        criadas += r.changes;
        total += r.changes;
      }
    } else if (ev.data && ev.data >= inicio && ev.data <= ateData) {
      const r = db.prepare('INSERT OR IGNORE INTO ocorrencias (evento_id, data, hora_inicio, duracao_min, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
        .run(ev.id, ev.data, ev.hora_inicio, ev.duracao_min, ev.criado_por, agoraISO());
      criadas += r.changes;
    }
  }
  return criadas;
}

// Datas das próximas ocorrências que um evento geraria (preview no formulário).
function previewOcorrencias(db, evento, quantidade = 3) {
  const datas = [];
  if (!evento.recorrente) { if (evento.data) datas.push(evento.data); return datas; }
  const intervalo = Math.max(1, evento.intervalo_semanas || 1);
  const a = new Date(hojeISO() + 'T12:00:00');
  while (a.getDay() !== evento.dia_semana) a.setDate(a.getDate() + 1);
  for (let i = 0; datas.length < quantidade && i < quantidade * intervalo + 8; i++) {
    const d = new Date(a);
    d.setDate(d.getDate() + i * 7);
    if (i % intervalo !== 0) continue;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (evento.termina_em && iso > evento.termina_em) break;
    datas.push(iso);
  }
  return datas;
}

// ---------- disponibilidade e conflitos ----------

// Faixas de minutos de cada período do dia (indisponibilidades).
const PERIODOS = { dia: [0, 1440], matutino: [0, 720], vespertino: [720, 1080], noturno: [1080, 1440] };

// Sem janelas cadastradas = sempre disponível; com janelas, o início do serviço
// precisa cair numa janela do dia. Indisponibilidade (dia único ou intervalo,
// com período do dia e justificativa) impede quando cobre o horário do culto.
function estaDisponivel(db, voluntarioId, data, horaInicio) {
  const ini = minutos(horaInicio);
  const bloqueios = db.prepare(
    'SELECT periodo FROM bloqueios WHERE voluntario_id = ? AND data <= ? AND COALESCE(data_fim, data) >= ?'
  ).all(voluntarioId, data, data);
  for (const b of bloqueios) {
    const [de, ate] = PERIODOS[b.periodo] || PERIODOS.dia;
    if (ini >= de && ini < ate) return false;
  }
  const janelas = db.prepare('SELECT * FROM disponibilidade WHERE voluntario_id = ?').all(voluntarioId);
  if (janelas.length === 0) return true;
  const ds = diaSemana(data);
  return janelas.some((j) => j.dia_semana === ds && ini >= minutos(j.hora_inicio) && ini <= minutos(j.hora_fim));
}

// Conflito de horário: já escalado (não recusado) em ocorrência sobreposta na mesma data,
// em QUALQUER local (matriz/capela).
function temConflito(db, voluntarioId, data, horaInicio, duracaoMin, excetoOcorrenciaId = null) {
  const linhas = db.prepare(`
    SELECT o.hora_inicio, o.duracao_min, o.id AS ocorrencia_id
    FROM escala e JOIN ocorrencias o ON o.id = e.ocorrencia_id
    WHERE e.voluntario_id = ? AND o.data = ? AND e.status != 'recusado' AND o.status != 'cancelada'
  `).all(voluntarioId, data);
  return linhas.some((l) =>
    l.ocorrencia_id !== excetoOcorrenciaId && sobrepoe(horaInicio, duracaoMin, l.hora_inicio, l.duracao_min));
}

// Conflito de setor: já escalado NO MESMO culto em qualquer função/ministério.
function estaNoCulto(db, voluntarioId, ocorrenciaId) {
  return !!db.prepare(
    "SELECT 1 FROM escala WHERE ocorrencia_id = ? AND voluntario_id = ? AND status != 'recusado'"
  ).get(ocorrenciaId, voluntarioId);
}

function contarEscalasRecentes(db, voluntarioId, dataRef, dias = 60) {
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM escala e JOIN ocorrencias o ON o.id = e.ocorrencia_id
    WHERE e.voluntario_id = ? AND e.status != 'recusado'
      AND o.data <= ? AND o.data >= date(?, '-' || ? || ' days')
  `).get(voluntarioId, dataRef, dataRef, dias).n;
}

function ultimoServico(db, voluntarioId, dataRef) {
  const r = db.prepare(`
    SELECT MAX(o.data) AS d
    FROM escala e JOIN ocorrencias o ON o.id = e.ocorrencia_id
    WHERE e.voluntario_id = ? AND e.status != 'recusado' AND o.data < ?
  `).get(voluntarioId, dataRef);
  return r.d || '0000-00-00';
}

// ---------- notificações e pontos ----------

function notificar(db, voluntarioId, mensagem) {
  db.prepare('INSERT INTO notificacoes (voluntario_id, mensagem, criada_em) VALUES (?, ?, ?)').run(voluntarioId, mensagem, agoraISO());
}

function creditarPontos(db, voluntarioId, valor, motivo, ref = null) {
  db.prepare('INSERT INTO pontos (voluntario_id, valor, motivo, ref, criado_em) VALUES (?, ?, ?, ?, ?)').run(voluntarioId, valor, motivo, ref, agoraISO());
}

// ---------- motor de escala ----------

function descricaoOcorrencia(db, ocorrenciaId) {
  return db.prepare(`
    SELECT o.*, ev.nome AS evento_nome, ev.local_id, l.nome AS local_nome
    FROM ocorrencias o JOIN eventos ev ON ev.id = o.evento_id
    LEFT JOIN locais l ON l.id = ev.local_id
    WHERE o.id = ?
  `).get(ocorrenciaId);
}

// Preenche vagas em aberto da ocorrência (opcionalmente só as funções de um ministério).
// Balanceamento: menos escalas em 60 dias primeiro; empate por preferência e tempo sem servir.
// Exclui indisponíveis, conflitos de horário entre locais e quem JÁ está neste culto (conflito de setor).
function gerarEscala(db, ocorrenciaId, ministerioId = null) {
  const oc = descricaoOcorrencia(db, ocorrenciaId);
  if (!oc) throw new Error('Ocorrência não encontrada');
  let sqlNeeds = `
    SELECT n.funcao_id, n.quantidade, f.nome AS funcao_nome
    FROM evento_necessidades n JOIN funcoes f ON f.id = n.funcao_id
    WHERE n.evento_id = ?`;
  const params = [oc.evento_id];
  if (ministerioId) { sqlNeeds += ' AND f.ministerio_id = ?'; params.push(ministerioId); }
  const necessidades = db.prepare(sqlNeeds).all(...params);

  const resultado = { preenchidas: 0, semCandidato: [] };
  for (const need of necessidades) {
    const ocupadas = db.prepare(
      "SELECT COUNT(*) AS n FROM escala WHERE ocorrencia_id = ? AND funcao_id = ? AND status != 'recusado'"
    ).get(ocorrenciaId, need.funcao_id).n;

    for (let vaga = ocupadas; vaga < need.quantidade; vaga++) {
      const candidatos = db.prepare(`
        SELECT v.id, vf.preferencia
        FROM voluntarios v JOIN voluntario_funcoes vf ON vf.voluntario_id = v.id
        WHERE vf.funcao_id = ? AND v.ativo = 1
      `).all(need.funcao_id)
        .filter((c) => estaDisponivel(db, c.id, oc.data, oc.hora_inicio))
        .filter((c) => !estaNoCulto(db, c.id, ocorrenciaId))
        .filter((c) => !temConflito(db, c.id, oc.data, oc.hora_inicio, oc.duracao_min))
        .map((c) => ({
          ...c,
          recentes: contarEscalasRecentes(db, c.id, oc.data),
          ultimo: ultimoServico(db, c.id, oc.data),
        }))
        .sort((a, b) => a.recentes - b.recentes || b.preferencia - a.preferencia || (a.ultimo < b.ultimo ? -1 : a.ultimo > b.ultimo ? 1 : a.id - b.id));

      const escolhido = candidatos[0];
      if (!escolhido) {
        resultado.semCandidato.push(need.funcao_nome);
        break;
      }
      db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(ocorrenciaId, escolhido.id, need.funcao_id);
      creditarPontos(db, escolhido.id, 5, 'escalado', `ocorrencia:${ocorrenciaId}`);
      notificar(db, escolhido.id, `Você foi escalado(a) como ${need.funcao_nome} em ${oc.evento_nome} (${oc.local_nome || 'sem local'}) no dia ${oc.data} às ${oc.hora_inicio}. Confirme sua presença!`);
      resultado.preenchidas++;
    }
  }
  return resultado;
}

// Escala do MÊS de um ministério: materializa as ocorrências do mês e preenche
// as funções daquele ministério em todas elas, com balanceamento contínuo.
function gerarEscalaMensal(db, ministerioId, ano, mes) {
  const p = (n) => String(n).padStart(2, '0');
  const primeiro = `${ano}-${p(mes)}-01`;
  const ultimo = `${ano}-${p(mes)}-${p(new Date(ano, mes, 0).getDate())}`;
  const inicio = primeiro < hojeISO() ? hojeISO() : primeiro;
  gerarOcorrencias(db, ultimo, inicio);
  const ocorrencias = db.prepare(`
    SELECT id, data FROM ocorrencias
    WHERE data BETWEEN ? AND ? AND status != 'cancelada' ORDER BY data, hora_inicio
  `).all(inicio, ultimo);
  const resumo = { ocorrencias: ocorrencias.length, preenchidas: 0, semCandidato: [] };
  for (const oc of ocorrencias) {
    const r = gerarEscala(db, oc.id, ministerioId);
    resumo.preenchidas += r.preenchidas;
    for (const s of r.semCandidato) resumo.semCandidato.push(`${oc.data}: ${s}`);
  }
  return resumo;
}

// Escalação manual pelo líder — avisa (indisponível, conflito, mesmo culto) mas não bloqueia.
function escalarManual(db, ocorrenciaId, voluntarioId, funcaoId) {
  const oc = descricaoOcorrencia(db, ocorrenciaId);
  if (!oc) throw new Error('Ocorrência não encontrada');
  const avisos = [];
  if (!estaDisponivel(db, voluntarioId, oc.data, oc.hora_inicio)) avisos.push('indisponivel');
  if (estaNoCulto(db, voluntarioId, ocorrenciaId)) avisos.push('mesmo_culto');
  else if (temConflito(db, voluntarioId, oc.data, oc.hora_inicio, oc.duracao_min)) avisos.push('conflito');
  db.prepare('INSERT INTO escala (ocorrencia_id, voluntario_id, funcao_id) VALUES (?, ?, ?)').run(ocorrenciaId, voluntarioId, funcaoId);
  creditarPontos(db, voluntarioId, 5, 'escalado', `ocorrencia:${ocorrenciaId}`);
  const funcao = db.prepare('SELECT nome FROM funcoes WHERE id = ?').get(funcaoId);
  notificar(db, voluntarioId, `Você foi escalado(a) como ${funcao.nome} em ${oc.evento_nome} no dia ${oc.data} às ${oc.hora_inicio}. Confirme sua presença!`);
  return { avisos };
}

function confirmarEscala(db, escalaId) {
  const e = db.prepare('SELECT * FROM escala WHERE id = ?').get(escalaId);
  if (!e) throw new Error('Escala não encontrada');
  if (e.status === 'confirmado') return e;
  db.prepare("UPDATE escala SET status = 'confirmado' WHERE id = ?").run(escalaId);
  creditarPontos(db, e.voluntario_id, 5, 'confirmou', `escala:${escalaId}`);
  return db.prepare('SELECT * FROM escala WHERE id = ?').get(escalaId);
}

function recusarEscala(db, escalaId) {
  const e = db.prepare('SELECT * FROM escala WHERE id = ?').get(escalaId);
  if (!e) throw new Error('Escala não encontrada');
  db.prepare("UPDATE escala SET status = 'recusado' WHERE id = ?").run(escalaId);
  return db.prepare('SELECT * FROM escala WHERE id = ?').get(escalaId);
}

// Check-in: +10 pontos; streak de 4 semanas distintas consecutivas com check-in = +20.
function fazerCheckin(db, escalaId) {
  const e = db.prepare(`
    SELECT e.*, o.data FROM escala e JOIN ocorrencias o ON o.id = e.ocorrencia_id WHERE e.id = ?
  `).get(escalaId);
  if (!e) throw new Error('Escala não encontrada');
  if (e.checkin_em) return { jaFeito: true };
  db.prepare('UPDATE escala SET checkin_em = ? WHERE id = ?').run(agoraISO(), escalaId);
  creditarPontos(db, e.voluntario_id, 10, 'checkin', `escala:${escalaId}`);

  const semanas = db.prepare(`
    SELECT DISTINCT strftime('%Y-%W', o.data) AS sem
    FROM escala e JOIN ocorrencias o ON o.id = e.ocorrencia_id
    WHERE e.voluntario_id = ? AND e.checkin_em IS NOT NULL AND o.data <= ?
    ORDER BY sem DESC LIMIT 4
  `).all(e.voluntario_id, e.data).map((r) => r.sem);
  let streak = false;
  if (semanas.length === 4) {
    const idx = (s) => { const [a, w] = s.split('-').map(Number); return a * 53 + w; };
    streak = idx(semanas[0]) - idx(semanas[3]) === 3;
    const jaPremiado = db.prepare(
      "SELECT 1 FROM pontos WHERE voluntario_id = ? AND motivo = 'streak' AND criado_em >= datetime('now', 'localtime', '-21 days')"
    ).get(e.voluntario_id);
    if (streak && !jaPremiado) creditarPontos(db, e.voluntario_id, 20, 'streak', `escala:${escalaId}`);
    else streak = false;
  }
  return { jaFeito: false, streak };
}

// ---------- trocas 2.0 ----------

function dadosEscalaParaTroca(db, escalaId) {
  return db.prepare(`
    SELECT e.*, o.data, o.hora_inicio, o.duracao_min, f.nome AS funcao_nome, ev.nome AS evento_nome
    FROM escala e
    JOIN ocorrencias o ON o.id = e.ocorrencia_id
    JOIN funcoes f ON f.id = e.funcao_id
    JOIN eventos ev ON ev.id = o.evento_id
    WHERE e.id = ?
  `).get(escalaId);
}

// Marca como expiradas as trocas aguardando cujo prazo venceu (avaliado on-read).
function expirarTrocas(db) {
  return db.prepare(
    "UPDATE trocas SET status = 'expirada', resolvida_em = ? WHERE status = 'aguardando' AND prazo IS NOT NULL AND prazo < ?"
  ).run(agoraISO(), hojeISO()).changes;
}

// Solicita troca: aberta (colegas da função são avisados) ou dirigida a um substituto específico.
function solicitarTroca(db, escalaId, { motivo = '', destinatarioId = null, prazo = null } = {}) {
  const e = dadosEscalaParaTroca(db, escalaId);
  if (!e) throw new Error('Escala não encontrada');
  const aberta = db.prepare("SELECT 1 FROM trocas WHERE escala_id = ? AND status = 'aguardando'").get(escalaId);
  if (aberta) throw new Error('Já existe uma troca aguardando para esta escala');
  if (prazo && prazo > e.data) throw new Error('O prazo não pode passar da data do culto');
  if (destinatarioId) {
    if (destinatarioId === e.voluntario_id) throw new Error('Escolha outra pessoa para a troca');
    const exerce = db.prepare('SELECT 1 FROM voluntario_funcoes WHERE voluntario_id = ? AND funcao_id = ?').get(destinatarioId, e.funcao_id);
    if (!exerce) throw new Error('A pessoa escolhida não exerce esta função');
  }
  const id = Number(db.prepare(
    'INSERT INTO trocas (escala_id, solicitante_id, destinatario_id, motivo, prazo, criada_em) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(escalaId, e.voluntario_id, destinatarioId, motivo, prazo, agoraISO()).lastInsertRowid);

  const solicitante = db.prepare('SELECT nome FROM voluntarios WHERE id = ?').get(e.voluntario_id);
  const aviso = `${solicitante.nome} pediu troca: ${e.funcao_nome} em ${e.evento_nome}, ${e.data} às ${e.hora_inicio}` +
    (prazo ? ` (responder até ${prazo})` : '') + '. Veja na aba Trocas.';
  if (destinatarioId) {
    notificar(db, destinatarioId, aviso);
  } else {
    const colegas = db.prepare(`
      SELECT DISTINCT vf.voluntario_id FROM voluntario_funcoes vf
      JOIN voluntarios v ON v.id = vf.voluntario_id
      WHERE vf.funcao_id = ? AND vf.voluntario_id != ? AND v.ativo = 1
    `).all(e.funcao_id, e.voluntario_id);
    for (const c of colegas) notificar(db, c.voluntario_id, aviso);
  }
  return { id };
}

function aceitarTroca(db, trocaId, voluntarioId) {
  expirarTrocas(db);
  const t = db.prepare('SELECT * FROM trocas WHERE id = ?').get(trocaId);
  if (!t) throw new Error('Troca não encontrada');
  if (t.status !== 'aguardando') throw new Error(`Troca não está mais aguardando (status: ${t.status})`);
  if (t.destinatario_id && t.destinatario_id !== voluntarioId) throw new Error('Esta troca foi dirigida a outra pessoa');
  const e = dadosEscalaParaTroca(db, t.escala_id);
  if (voluntarioId === e.voluntario_id) throw new Error('Você é o solicitante desta troca');
  const exerce = db.prepare('SELECT 1 FROM voluntario_funcoes WHERE voluntario_id = ? AND funcao_id = ?').get(voluntarioId, e.funcao_id);
  if (!exerce) throw new Error('Você não exerce esta função');
  if (!estaDisponivel(db, voluntarioId, e.data, e.hora_inicio)) throw new Error('Você não está disponível neste horário');
  if (estaNoCulto(db, voluntarioId, e.ocorrencia_id)) throw new Error('Você já está escalado(a) neste culto em outro setor');
  if (temConflito(db, voluntarioId, e.data, e.hora_inicio, e.duracao_min)) throw new Error('Você já está escalado(a) em outra celebração neste horário');

  db.prepare("UPDATE escala SET voluntario_id = ?, status = 'confirmado', checkin_em = NULL WHERE id = ?").run(voluntarioId, t.escala_id);
  db.prepare("UPDATE trocas SET status = 'aceita', aceitou_id = ?, resolvida_em = ? WHERE id = ?").run(voluntarioId, agoraISO(), trocaId);
  creditarPontos(db, voluntarioId, 5, 'aceitou_troca', `troca:${trocaId}`);
  const quemEntra = db.prepare('SELECT nome FROM voluntarios WHERE id = ?').get(voluntarioId);
  const quemSai = db.prepare('SELECT nome FROM voluntarios WHERE id = ?').get(t.solicitante_id);
  notificar(db, t.solicitante_id, `Troca aceita: ${quemEntra.nome} fica no seu lugar em ${e.evento_nome} (${e.data}). Você foi liberado(a).`);
  notificar(db, voluntarioId, `Você assumiu ${e.funcao_nome} no lugar de ${quemSai.nome} em ${e.evento_nome}, ${e.data} às ${e.hora_inicio}.`);
  return db.prepare('SELECT * FROM trocas WHERE id = ?').get(trocaId);
}

// Destinatário de troca dirigida recusa o pedido.
function recusarTroca(db, trocaId, voluntarioId) {
  const t = db.prepare('SELECT * FROM trocas WHERE id = ?').get(trocaId);
  if (!t) throw new Error('Troca não encontrada');
  if (t.status !== 'aguardando') throw new Error('Troca não está mais aguardando');
  if (t.destinatario_id !== voluntarioId) throw new Error('Só o destinatário pode recusar esta troca');
  db.prepare("UPDATE trocas SET status = 'recusada', resolvida_em = ? WHERE id = ?").run(agoraISO(), trocaId);
  const quem = db.prepare('SELECT nome FROM voluntarios WHERE id = ?').get(voluntarioId);
  notificar(db, t.solicitante_id, `${quem.nome} não pôde assumir sua troca. O pedido foi encerrado — solicite novamente para outra pessoa.`);
  return db.prepare('SELECT * FROM trocas WHERE id = ?').get(trocaId);
}

// Edita uma troca ainda aguardando: motivo, prazo e/ou substituto (destinatário).
// `undefined` mantém o valor atual; `null` limpa (destinatário null = troca aberta).
function editarTroca(db, trocaId, { motivo, destinatarioId, prazo } = {}) {
  const t = db.prepare('SELECT * FROM trocas WHERE id = ?').get(trocaId);
  if (!t) throw new Error('Troca não encontrada');
  if (t.status !== 'aguardando') throw new Error('Só trocas pendentes podem ser editadas');
  const e = dadosEscalaParaTroca(db, t.escala_id);
  const novoPrazo = prazo === undefined ? t.prazo : prazo;
  if (novoPrazo && novoPrazo > e.data) throw new Error('O prazo não pode passar da data do culto');
  const novoDest = destinatarioId === undefined ? t.destinatario_id : destinatarioId;
  if (novoDest) {
    if (novoDest === t.solicitante_id) throw new Error('Escolha outra pessoa para a troca');
    const exerce = db.prepare('SELECT 1 FROM voluntario_funcoes WHERE voluntario_id = ? AND funcao_id = ?').get(novoDest, e.funcao_id);
    if (!exerce) throw new Error('A pessoa escolhida não exerce esta função');
  }
  db.prepare('UPDATE trocas SET motivo = ?, destinatario_id = ?, prazo = ? WHERE id = ?')
    .run(motivo === undefined ? t.motivo : motivo, novoDest, novoPrazo, trocaId);
  if (novoDest && novoDest !== t.destinatario_id) {
    const solicitante = db.prepare('SELECT nome FROM voluntarios WHERE id = ?').get(t.solicitante_id);
    notificar(db, novoDest, `${solicitante.nome} pediu troca: ${e.funcao_nome} em ${e.evento_nome}, ${e.data} às ${e.hora_inicio}` +
      (novoPrazo ? ` (responder até ${novoPrazo})` : '') + '. Veja na aba Trocas.');
  }
  return db.prepare('SELECT * FROM trocas WHERE id = ?').get(trocaId);
}

// Exclui uma troca do histórico. Pendentes precisam ser canceladas antes,
// para o substituto convidado não ficar sem resposta.
function excluirTroca(db, trocaId) {
  const t = db.prepare('SELECT * FROM trocas WHERE id = ?').get(trocaId);
  if (!t) throw new Error('Troca não encontrada');
  if (t.status === 'aguardando') throw new Error('Cancele a troca antes de excluí-la');
  db.prepare('DELETE FROM trocas WHERE id = ?').run(trocaId);
  return { ok: true };
}

// Resumo das trocas de um voluntário: quantidades por status e quem assume os pedidos dele.
function resumoTrocas(db, voluntarioId) {
  expirarTrocas(db);
  const minhas = db.prepare(`
    SELECT status, COUNT(*) AS n FROM trocas WHERE solicitante_id = ? GROUP BY status`).all(voluntarioId);
  const porStatus = { aguardando: 0, aceita: 0, recusada: 0, cancelada: 0, expirada: 0 };
  for (const r of minhas) porStatus[r.status] = r.n;
  const quemAssume = db.prepare(`
    SELECT v.id, v.nome, COUNT(*) AS vezes FROM trocas t
    JOIN voluntarios v ON v.id = t.aceitou_id
    WHERE t.solicitante_id = ? AND t.status = 'aceita'
    GROUP BY v.id ORDER BY vezes DESC, v.nome`).all(voluntarioId);
  return {
    total: Object.values(porStatus).reduce((a, b) => a + b, 0),
    pendentes: porStatus.aguardando,
    confirmadas: porStatus.aceita,
    indisponiveis: porStatus.recusada + porStatus.cancelada + porStatus.expirada,
    quem_assume: quemAssume,
  };
}

// ---------- roteiro do culto (formato do grupo do WhatsApp) ----------

const NUM_EMOJI = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const numEmoji = (n) => NUM_EMOJI[n] || `${n}.`;

function fmtDataBr(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function gerarRoteiroWhatsApp(db, ocorrenciaId) {
  const oc = descricaoOcorrencia(db, ocorrenciaId);
  if (!oc) throw new Error('Ocorrência não encontrada');
  const oportunidades = db.prepare('SELECT * FROM oportunidades WHERE ocorrencia_id = ? ORDER BY ordem').all(ocorrenciaId);
  const louvores = db.prepare(`
    SELECT r.tom, m.titulo, m.artista, v.nome AS ministro
    FROM repertorio r JOIN musicas m ON m.id = r.musica_id
    LEFT JOIN voluntarios v ON v.id = r.ministro_voluntario_id
    WHERE r.ocorrencia_id = ? ORDER BY r.ordem`).all(ocorrenciaId);
  const escalados = db.prepare(`
    SELECT f.nome AS funcao, v.nome AS voluntario, mi.nome AS ministerio
    FROM escala e JOIN voluntarios v ON v.id = e.voluntario_id
    JOIN funcoes f ON f.id = e.funcao_id JOIN ministerios mi ON mi.id = f.ministerio_id
    WHERE e.ocorrencia_id = ? AND e.status != 'recusado' ORDER BY mi.nome, f.nome, v.nome`).all(ocorrenciaId);

  const linhas = [];
  linhas.push(`🛑 CULTO DIA ${fmtDataBr(oc.data)}-${DIAS_PT[diaSemana(oc.data)]}`);
  linhas.push(`📍 ${oc.local_nome || 'Igreja'} · ${oc.hora_inicio}`);
  if (oc.tema) linhas.push(`🙏 Tema: ${oc.tema}`);
  linhas.push('');
  if (oc.abertura) { linhas.push(`✅ ${oc.abertura}`); linhas.push(''); }
  if (oportunidades.length) {
    linhas.push('Oportunidades para o Culto');
    oportunidades.forEach((op, i) =>
      linhas.push(`${numEmoji(i + 1)} ${op.responsavel ? op.responsavel + ': ' : ''}${op.titulo}`));
    linhas.push('');
  }
  linhas.push('✅ Dízimos e Ofertas');
  linhas.push('');
  if (louvores.length) {
    linhas.push('✅ Louvor');
    louvores.forEach((l, i) =>
      linhas.push(`${numEmoji(i + 1)} ${l.titulo}${l.tom ? ` (${l.tom})` : ''}${l.ministro ? ` — min. ${l.ministro.split(' ')[0]}` : ''}`));
    linhas.push('');
  }
  if (oc.pregador) { linhas.push(`✅ Palavra: ${oc.pregador}`); linhas.push(''); }
  if (oc.ministra) { linhas.push(`🎤 Ministração: ${oc.ministra}`); linhas.push(''); }
  if (oc.responsavel) { linhas.push(`🎯 Responsabilidade: ${oc.responsavel}`); linhas.push(''); }
  if (escalados.length) {
    linhas.push('👥 Escalados');
    let ministerioAtual = '';
    for (const e of escalados) {
      if (e.ministerio !== ministerioAtual) { ministerioAtual = e.ministerio; linhas.push(`— ${e.ministerio}`); }
      linhas.push(`• ${e.funcao}: ${e.voluntario}`);
    }
  }
  return linhas.join('\n').trim();
}

// ---------- WhatsApp (canal gratuito) ----------

function linkWhatsApp(telefone, texto) {
  let digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.length <= 11 && !digitos.startsWith('55')) digitos = '55' + digitos;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`;
}

function conviteWhatsApp(db, escalaId) {
  const e = db.prepare(`
    SELECT e.*, v.nome, v.telefone, o.data, o.hora_inicio, f.nome AS funcao_nome,
           ev.nome AS evento_nome, l.nome AS local_nome
    FROM escala e
    JOIN voluntarios v ON v.id = e.voluntario_id
    JOIN ocorrencias o ON o.id = e.ocorrencia_id
    JOIN eventos ev ON ev.id = o.evento_id
    LEFT JOIN locais l ON l.id = ev.local_id
    JOIN funcoes f ON f.id = e.funcao_id
    WHERE e.id = ?
  `).get(escalaId);
  if (!e) throw new Error('Escala não encontrada');
  const texto = `Olá, ${e.nome.split(' ')[0]}! 🙌 Você está escalado(a) como *${e.funcao_nome}* no *${e.evento_nome}* ` +
    `(${e.local_nome || 'igreja'}) em *${fmtDataBr(e.data)}-${DIAS_PT[diaSemana(e.data)]}* às *${e.hora_inicio}*. ` +
    `Por favor, confirme sua presença no Aclame. Deus abençoe!`;
  return { link: linkWhatsApp(e.telefone, texto), texto, telefone: e.telefone };
}

// Setlist aprovada por WhatsApp: texto com os louvores em tonalidade fixada
// (a mesma para todos, por coerência) + links de cifra e letra, e um link
// wa.me individual para cada escalado do culto (instrumentistas e vozes).
function setlistWhatsApp(db, ocorrenciaId) {
  const oc = descricaoOcorrencia(db, ocorrenciaId);
  if (!oc) throw new Error('Ocorrência não encontrada');
  const louvores = db.prepare(`
    SELECT COALESCE(r.tom, m.tom) AS tom, m.titulo, m.artista, m.link_cifraclub, m.link_letra, m.link_youtube
    FROM repertorio r JOIN musicas m ON m.id = r.musica_id
    WHERE r.ocorrencia_id = ? ORDER BY r.ordem`).all(ocorrenciaId);
  if (!louvores.length) throw new Error('Este culto ainda não tem louvores definidos');

  const linhas = [];
  linhas.push(`🎶 *Setlist aprovada* — ${oc.evento_nome}, ${fmtDataBr(oc.data)}-${DIAS_PT[diaSemana(oc.data)]} às ${oc.hora_inicio}`);
  linhas.push('Estudem no tom marcado (tonalidade fixada para todos, por coerência):');
  linhas.push('');
  louvores.forEach((l, i) => {
    const busca = encodeURIComponent(`${l.titulo} ${l.artista || ''}`.trim());
    linhas.push(`${numEmoji(i + 1)} *${l.titulo}*${l.artista ? ` — ${l.artista}` : ''}${l.tom ? ` · Tom: *${l.tom}*` : ''}`);
    linhas.push(`   🎸 Cifra: ${l.link_cifraclub || 'https://www.cifraclub.com.br/?q=' + busca}`);
    linhas.push(`   📝 Letra: ${l.link_letra || 'https://www.letras.mus.br/?q=' + busca}`);
    if (l.link_youtube) linhas.push(`   ▶️ Áudio: ${l.link_youtube}`);
  });
  linhas.push('');
  linhas.push('🙌 Instrumentistas e vozes: preparem com carinho. Deus abençoe!');
  const texto = linhas.join('\n');

  const destinatarios = db.prepare(`
    SELECT v.id AS voluntario_id, v.nome, v.telefone, GROUP_CONCAT(f.nome, ', ') AS funcoes
    FROM escala e JOIN voluntarios v ON v.id = e.voluntario_id JOIN funcoes f ON f.id = e.funcao_id
    WHERE e.ocorrencia_id = ? AND e.status != 'recusado'
    GROUP BY v.id ORDER BY v.nome`).all(ocorrenciaId)
    .map((d) => ({ ...d, link: linkWhatsApp(d.telefone, `Olá, ${d.nome.split(' ')[0]}! ` + texto) }));
  return { texto, destinatarios };
}

// ---------- faltas ----------

function registrarFalta(db, escalaId) {
  const e = db.prepare('SELECT * FROM escala WHERE id = ?').get(escalaId);
  if (!e) throw new Error('Escala não encontrada');
  db.prepare('UPDATE escala SET faltou = 1, checkin_em = NULL WHERE id = ?').run(escalaId);
  return db.prepare('SELECT * FROM escala WHERE id = ?').get(escalaId);
}

function desmarcarFalta(db, escalaId) {
  db.prepare('UPDATE escala SET faltou = 0 WHERE id = ?').run(escalaId);
  return db.prepare('SELECT * FROM escala WHERE id = ?').get(escalaId);
}

// ---------- avaliação de compromisso (ranking da igreja) ----------

// Critérios exibidos ao lado do ranking — a avaliação é 100% automática,
// calculada só a partir dos registros de escala (sem favoritismo).
const CRITERIOS_AVALIACAO = [
  'Entradas por membro no período: escalações (E), confirmações (C), cultos já realizados em que foi escalado (R), check-ins/presenças (P), faltas registradas (F) e trocas assumidas no lugar de colegas (T).',
  'Índice de compromisso (0–100) = média ponderada da taxa de confirmação C÷E (peso 2) e da taxa de presença P÷R (peso 3), + 5 pontos por troca assumida (máx. +10), − 25 pontos por falta.',
  '🟢 Compromissado em servir: pelo menos 1 escalação, nenhuma falta e índice ≥ 70.',
  '🔴 Alerta negativo: 2 ou mais faltas, ou índice abaixo de 40 com 2+ escalações e ao menos um culto já realizado.',
  '🟡 Precisa melhorar: os demais casos com escalação no período.',
  'Nota geral da igreja (0–10) = proporção de membros 🟢 entre os avaliados no período.',
  'Posição no ranking: 1º, 2º e 3º lugares entre os 🟢, ordenados por índice e pontos.',
];

// Avalia todos os voluntários ativos no período [de, ate]: métricas, índice,
// status (🟢/🟡/🔴), nota geral da igreja e pódio.
function avaliacaoServico(db, de, ate) {
  const hoje = hojeISO();
  const membros = db.prepare('SELECT id, nome FROM voluntarios WHERE ativo = 1 ORDER BY nome').all().map((v) => {
    const m = db.prepare(`
      SELECT COUNT(*) AS escalacoes,
             SUM(CASE WHEN e.status = 'confirmado' THEN 1 ELSE 0 END) AS confirmacoes,
             SUM(CASE WHEN o.data < ? THEN 1 ELSE 0 END) AS realizadas,
             SUM(CASE WHEN o.data < ? AND e.checkin_em IS NOT NULL THEN 1 ELSE 0 END) AS presencas,
             SUM(CASE WHEN e.faltou = 1 THEN 1 ELSE 0 END) AS faltas
      FROM escala e JOIN ocorrencias o ON o.id = e.ocorrencia_id
      WHERE e.voluntario_id = ? AND e.status != 'recusado' AND o.status != 'cancelada'
        AND o.data BETWEEN ? AND ?`).get(hoje, hoje, v.id, de, ate);
    const trocasAssumidas = db.prepare(`
      SELECT COUNT(*) AS n FROM trocas t
      JOIN escala e ON e.id = t.escala_id JOIN ocorrencias o ON o.id = e.ocorrencia_id
      WHERE t.aceitou_id = ? AND t.status = 'aceita' AND o.data BETWEEN ? AND ?`).get(v.id, de, ate).n;
    const pontos = db.prepare(
      'SELECT COALESCE(SUM(valor),0) AS t FROM pontos WHERE voluntario_id = ? AND date(criado_em) BETWEEN ? AND ?').get(v.id, de, ate).t;

    const E = m.escalacoes, C = m.confirmacoes || 0, R = m.realizadas || 0, P = m.presencas || 0, F = m.faltas || 0;
    let indice = null, status = 'sem_escala';
    if (E > 0) {
      const taxaConf = C / E;
      const taxaPres = R > 0 ? P / R : null;
      const base = taxaPres === null ? taxaConf * 100 : ((2 * taxaConf + 3 * taxaPres) / 5) * 100;
      indice = Math.max(0, Math.min(100, Math.round(base + Math.min(trocasAssumidas * 5, 10) - F * 25)));
      // Índice baixo só vira alerta depois de haver culto realizado no período —
      // ninguém entra no vermelho apenas por confirmações futuras pendentes.
      if (F >= 2 || (E >= 2 && R >= 1 && indice < 40)) status = 'alerta';
      else if (F === 0 && indice >= 70) status = 'compromissado';
      else status = 'precisa_melhorar';
    }
    return {
      voluntario_id: v.id, nome: v.nome,
      escalacoes: E, confirmacoes: C, realizadas: R, presencas: P, faltas: F,
      trocas_assumidas: trocasAssumidas, pontos, indice, status,
      taxa_confirmacao: E ? Math.round((C / E) * 100) : null,
      taxa_presenca: R ? Math.round((P / R) * 100) : null,
    };
  });

  const avaliados = membros.filter((m) => m.status !== 'sem_escala');
  const compromissados = avaliados.filter((m) => m.status === 'compromissado');
  const ordenados = [...avaliados].sort((a, b) =>
    (b.status === 'compromissado') - (a.status === 'compromissado') ||
    (b.indice ?? 0) - (a.indice ?? 0) || b.pontos - a.pontos || a.nome.localeCompare(b.nome));
  ordenados.forEach((m, i) => { m.posicao = i + 1; });
  return {
    periodo: { de, ate },
    criterios: CRITERIOS_AVALIACAO,
    membros: ordenados.concat(membros.filter((m) => m.status === 'sem_escala')),
    avaliados: avaliados.length,
    compromissados: compromissados.length,
    nota_geral: avaliados.length ? Math.round((compromissados.length / avaliados.length) * 100) / 10 : null,
    podio: ordenados.filter((m) => m.status === 'compromissado').slice(0, 3),
  };
}

// ---------- pendências de culto ----------

// Inconsistências de uma ocorrência: vagas em aberto por função, louvores não
// informados, escalados sem confirmar, indisponíveis/conflitos e não publicado.
function pendenciasOcorrencia(db, ocorrenciaId) {
  const oc = descricaoOcorrencia(db, ocorrenciaId);
  if (!oc) throw new Error('Ocorrência não encontrada');
  const p = [];
  const needs = db.prepare(`
    SELECT n.funcao_id, n.quantidade, f.nome AS funcao_nome,
      (SELECT COUNT(*) FROM escala e WHERE e.ocorrencia_id = ? AND e.funcao_id = n.funcao_id AND e.status != 'recusado') AS preenchidas
    FROM evento_necessidades n JOIN funcoes f ON f.id = n.funcao_id
    WHERE n.evento_id = ?`).all(ocorrenciaId, oc.evento_id);
  for (const n of needs) {
    if (n.preenchidas < n.quantidade)
      p.push({ tipo: 'vaga', texto: `Vaga de ${n.funcao_nome}: ${n.preenchidas}/${n.quantidade} (incompleto)` });
  }
  const louvores = db.prepare('SELECT COUNT(*) AS n FROM repertorio WHERE ocorrencia_id = ?').get(ocorrenciaId).n;
  if (!louvores) p.push({ tipo: 'louvores', texto: 'Louvores: não informado' });
  const semConfirmar = db.prepare(
    "SELECT COUNT(*) AS n FROM escala WHERE ocorrencia_id = ? AND status = 'convidado'").get(ocorrenciaId).n;
  if (semConfirmar) p.push({ tipo: 'confirmacao', texto: `${semConfirmar} escalado(s) ainda sem confirmar presença` });
  const escalados = db.prepare(`
    SELECT e.voluntario_id, v.nome FROM escala e JOIN voluntarios v ON v.id = e.voluntario_id
    WHERE e.ocorrencia_id = ? AND e.status != 'recusado' GROUP BY e.voluntario_id`).all(ocorrenciaId);
  for (const esc of escalados) {
    if (!estaDisponivel(db, esc.voluntario_id, oc.data, oc.hora_inicio))
      p.push({ tipo: 'indisponivel', texto: `${esc.nome} está indisponível neste dia/horário` });
    else if (temConflito(db, esc.voluntario_id, oc.data, oc.hora_inicio, oc.duracao_min, oc.id))
      p.push({ tipo: 'conflito', texto: `${esc.nome} tem conflito de horário com outra celebração` });
  }
  if (!oc.publicada_em) p.push({ tipo: 'publicacao', texto: 'Culto ainda não publicado no mural' });
  return p;
}

// Cultos do período que têm pendências (para o painel de alertas do líder).
function listarPendencias(db, de, ate) {
  const ocorrencias = db.prepare(`
    SELECT o.id, o.data, o.hora_inicio, ev.nome AS evento_nome
    FROM ocorrencias o JOIN eventos ev ON ev.id = o.evento_id
    WHERE o.data BETWEEN ? AND ? AND o.status != 'cancelada'
    ORDER BY o.data, o.hora_inicio`).all(de, ate);
  return ocorrencias
    .map((oc) => ({ ...oc, pendencias: pendenciasOcorrencia(db, oc.id) }))
    .filter((oc) => oc.pendencias.length);
}

// ---------- Google Agenda (gratuito, sem API) ----------

function linkGoogleAgenda(db, ocorrenciaId) {
  const oc = descricaoOcorrencia(db, ocorrenciaId);
  if (!oc) throw new Error('Ocorrência não encontrada');
  const compacta = (dataIso, hhmm) => dataIso.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00';
  const [h, m] = oc.hora_inicio.split(':').map(Number);
  const [a, me, di] = oc.data.split('-').map(Number);
  const fim = new Date(a, me - 1, di, h, m + (oc.duracao_min || 120));
  const p = (n) => String(n).padStart(2, '0');
  const fimHm = `${p(fim.getHours())}:${p(fim.getMinutes())}`;
  const fimIso = `${fim.getFullYear()}-${p(fim.getMonth() + 1)}-${p(fim.getDate())}`;
  const detalhes = [oc.tema && `Tema: ${oc.tema}`, oc.pregador && `Palavra: ${oc.pregador}`, 'Escala no Aclame: http://localhost:3000/#/culto/' + oc.id]
    .filter(Boolean).join('\n');
  const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(oc.evento_nome + (oc.tema ? ' — ' + oc.tema : '')) +
    '&dates=' + compacta(oc.data, oc.hora_inicio) + '/' + compacta(fimIso, fimHm) +
    '&details=' + encodeURIComponent(detalhes) +
    '&location=' + encodeURIComponent(oc.local_nome || 'Igreja');
  return { url };
}

// ---------- aniversariantes ----------

// Lista aniversariantes (nascimento MM-DD ou AAAA-MM-DD). Sem `mes`, ordena por
// proximidade a partir de hoje; com `mes` (1-12), lista o mês em ordem de dia.
function aniversariantes(db, mes = null) {
  const hoje = hojeISO();
  const lista = db.prepare("SELECT id, nome, nascimento FROM voluntarios WHERE ativo = 1 AND nascimento IS NOT NULL AND nascimento != ''").all()
    .map((v) => {
      const mmdd = v.nascimento.slice(-5);
      const [mm, dd] = mmdd.split('-').map(Number);
      if (!mm || !dd) return null;
      const anoAtual = Number(hoje.slice(0, 4));
      let proxima = `${anoAtual}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      if (proxima < hoje) proxima = `${anoAtual + 1}-${proxima.slice(5)}`;
      const diasAte = Math.round((new Date(proxima + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
      return { id: v.id, nome: v.nome, mes: mm, dia: dd, proxima, dias_ate: diasAte };
    })
    .filter(Boolean);
  if (mes) return lista.filter((x) => x.mes === Number(mes)).sort((a, b) => a.dia - b.dia);
  return lista.sort((a, b) => a.dias_ate - b.dias_ate);
}

// Clona um culto (dados do roteiro + oportunidades + repertório) para outra data.
// As músicas são referenciadas, nunca duplicadas.
function clonarOcorrencia(db, ocorrenciaId, novaData, usuarioId = null) {
  const oc = db.prepare('SELECT * FROM ocorrencias WHERE id = ?').get(ocorrenciaId);
  if (!oc) throw new Error('Ocorrência não encontrada');
  const existe = db.prepare('SELECT id FROM ocorrencias WHERE evento_id = ? AND data = ?').get(oc.evento_id, novaData);
  if (existe) throw new Error('Já existe uma ocorrência deste evento nesta data');
  const novo = Number(db.prepare(`
    INSERT INTO ocorrencias (evento_id, data, hora_inicio, duracao_min, tema, pregador, ministra, responsavel, abertura, observacoes, criado_por, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(oc.evento_id, novaData, oc.hora_inicio, oc.duracao_min, oc.tema, oc.pregador, oc.ministra, oc.responsavel, oc.abertura, oc.observacoes, usuarioId, agoraISO()).lastInsertRowid);
  for (const op of db.prepare('SELECT * FROM oportunidades WHERE ocorrencia_id = ? ORDER BY ordem').all(ocorrenciaId)) {
    db.prepare('INSERT INTO oportunidades (ocorrencia_id, ordem, titulo, responsavel) VALUES (?, ?, ?, ?)').run(novo, op.ordem, op.titulo, op.responsavel);
  }
  for (const r of db.prepare('SELECT * FROM repertorio WHERE ocorrencia_id = ? ORDER BY ordem').all(ocorrenciaId)) {
    db.prepare('INSERT INTO repertorio (ocorrencia_id, musica_id, ordem, tom, ministro_voluntario_id) VALUES (?, ?, ?, ?, ?)').run(novo, r.musica_id, r.ordem, r.tom, r.ministro_voluntario_id);
  }
  return novo;
}

module.exports = {
  minutos, diaSemana, sobrepoe, DIAS_PT, PERIODOS,
  gerarOcorrencias, previewOcorrencias, estaDisponivel, temConflito, estaNoCulto, contarEscalasRecentes, ultimoServico,
  gerarEscala, gerarEscalaMensal, escalarManual, confirmarEscala, recusarEscala, fazerCheckin,
  registrarFalta, desmarcarFalta, linkGoogleAgenda, aniversariantes,
  solicitarTroca, aceitarTroca, recusarTroca, expirarTrocas, editarTroca, excluirTroca, resumoTrocas,
  avaliacaoServico, CRITERIOS_AVALIACAO, pendenciasOcorrencia, listarPendencias,
  gerarRoteiroWhatsApp, conviteWhatsApp, linkWhatsApp, setlistWhatsApp, clonarOcorrencia,
  notificar, creditarPontos, descricaoOcorrencia,
};
