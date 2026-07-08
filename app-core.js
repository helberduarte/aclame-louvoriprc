'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { abrir, seedDemo, estaVazio, agoraISO, hojeISO, criarUsuario, conferirSenha, normalizarChave } = require('./db');
const engine = require('./engine');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const COOKIE = 'aclame_sessao';
const SESSAO_DIAS = 30;

// Recursos com CRUD genérico. escrita: 'lider' = líder/admin; leitura é sempre autenticada.
const RECURSOS = {
  locais: { colunas: ['nome', 'tipo'], escrita: 'lider' },
  ministerios: { colunas: ['nome', 'cor'], escrita: 'lider' },
  funcoes: { colunas: ['ministerio_id', 'nome'], escrita: 'lider' },
  voluntarios: { colunas: ['nome', 'telefone', 'email', 'nascimento', 'ativo', 'termo_aceito_em'], escrita: 'lider' },
  eventos: { colunas: ['nome', 'local_id', 'recorrente', 'dia_semana', 'data', 'hora_inicio', 'duracao_min', 'intervalo_semanas', 'termina_em', 'max_ocorrencias', 'ativo'], escrita: 'lider', autoria: true },
  avisos: { colunas: ['ministerio_id', 'titulo', 'mensagem'], escrita: 'lider', autoria: true },
  setlists: { colunas: ['nome'], escrita: 'lider', autoria: true },
};

// Handler HTTP puro (req, res) — sem http.createServer, para reuso na Vercel.
function criarHandler(db) {
  const rotas = [];
  // opts: { publico: true } | { papel: 'lider'|'admin' } — sem opts = qualquer autenticado.
  const rota = (metodo, padrao, fn, opts = {}) => rotas.push({ metodo, padrao, fn, opts });

  // ---------- helpers de autorização ----------
  const ehAdmin = (u) => u && u.papel === 'admin';
  const ehLider = (u) => u && (u.papel === 'admin' || u.papel === 'lider');
  const lideraMinisterio = async (u, ministerioId) =>
    ehAdmin(u) || (ehLider(u) && !!(await db.prepare('SELECT 1 FROM ministerio_lideres WHERE usuario_id = ? AND ministerio_id = ?').get(u.id, Number(ministerioId))));
  const proprioVoluntario = (u, voluntarioId) => u.voluntario_id != null && u.voluntario_id === Number(voluntarioId);

  function exigir(cond, msg = 'Sem permissão para esta ação', status = 403) {
    if (!cond) { const e = new Error(msg); e.status = status; throw e; }
  }

  async function donoDaEscala(req, escalaId) {
    const e = (await db.prepare('SELECT voluntario_id FROM escala WHERE id = ?').get(Number(escalaId)));
    exigir(e, 'Escala não encontrada', 404);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, e.voluntario_id));
    return e;
  }

  // ---------- autenticação ----------
  rota('POST', '/api/auth/registrar', async (req) => {
    const { nome, telefone, email, senha, convite } = req.body;
    exigir(nome && nome.trim(), 'Informe seu nome', 400);
    exigir(telefone || email, 'Informe telefone ou e-mail', 400);
    exigir(senha && String(senha).length >= 4, 'Senha deve ter ao menos 4 caracteres', 400);
    if (telefone) exigir(!(await db.prepare('SELECT 1 FROM usuarios WHERE telefone = ?').get(String(telefone))), 'Telefone já cadastrado', 400);
    if (email) exigir(!(await db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(String(email))), 'E-mail já cadastrado', 400);
    let conviteRow = null;
    if (convite) {
      conviteRow = (await db.prepare('SELECT * FROM convites WHERE token = ?').get(String(convite)));
      exigir(conviteRow, 'Convite inválido', 400);
      exigir(!conviteRow.usado_em, 'Este convite já foi utilizado', 400);
      exigir(!conviteExpirado(conviteRow.criado_em), 'Este convite expirou — peça um novo link ao administrador', 400);
    }
    const primeiro = (await db.prepare('SELECT COUNT(*) AS n FROM usuarios').get()).n === 0;
    // Todo usuário é também um voluntário (perfil de escala).
    const volId = Number((await db.prepare('INSERT INTO voluntarios (nome, telefone, email) VALUES (?, ?, ?)')
      .run(nome.trim(), telefone || null, email || null)).lastInsertRowid);
    const id = (await criarUsuario(db, {
      nome: nome.trim(), telefone: telefone || null, email: email || null,
      senha, papel: primeiro ? 'admin' : 'membro', voluntario_id: volId,
    }));
    if (conviteRow) (await db.prepare('UPDATE convites SET usado_por = ?, usado_em = ? WHERE token = ?').run(id, agoraISO(), conviteRow.token));
    return (await criarSessao(id));
  }, { publico: true });

  rota('POST', '/api/auth/login', async (req) => {
    const { identificador, senha } = req.body;
    exigir(identificador && senha, 'Informe telefone/e-mail e senha', 400);
    const u = (await db.prepare('SELECT * FROM usuarios WHERE telefone = ? OR email = ?').get(String(identificador).trim(), String(identificador).trim().toLowerCase()));
    exigir(u && conferirSenha(senha, u.sal, u.senha_hash), 'Credenciais inválidas', 401);
    return (await criarSessao(u.id));
  }, { publico: true });

  rota('POST', '/api/auth/logout', async (req) => {
    if (req.token) (await db.prepare('DELETE FROM sessoes WHERE token = ?').run(req.token));
    req.cookieLimpar = true;
    return { ok: true };
  }, { publico: true });

  rota('GET', '/api/auth/me', (req) => dadosMe(req.usuario));

  async function criarSessao(usuarioId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + SESSAO_DIAS * 86400000);
    (await db.prepare('INSERT INTO sessoes (token, usuario_id, criada_em, expira_em) VALUES (?, ?, ?, ?)')
      .run(token, usuarioId, agoraISO(), expira.toISOString()));
    const u = (await carregarUsuario(usuarioId));
    return { setCookie: token, me: dadosMe(u) };
  }

  async function carregarUsuario(id) {
    const u = (await db.prepare('SELECT id, nome, telefone, email, papel, voluntario_id FROM usuarios WHERE id = ?').get(id));
    if (!u) return null;
    u.ministerios_liderados = (await db.prepare('SELECT ministerio_id FROM ministerio_lideres WHERE usuario_id = ?').all(id)).map((r) => r.ministerio_id);
    return u;
  }

  function dadosMe(u) {
    return {
      id: u.id, nome: u.nome, telefone: u.telefone, email: u.email,
      papel: u.papel, voluntario_id: u.voluntario_id,
      ministerios_liderados: u.ministerios_liderados,
    };
  }

  // ---------- gestão de usuários (admin) ----------
  rota('GET', '/api/usuarios', async () => {
    const usuarios = await db.prepare(`
      SELECT u.id, u.nome, u.telefone, u.email, u.papel, u.voluntario_id, u.criado_em
      FROM usuarios u ORDER BY u.nome`).all();
    for (const u of usuarios) {
      u.ministerios_liderados = await db.prepare(`
          SELECT ml.ministerio_id, m.nome FROM ministerio_lideres ml JOIN ministerios m ON m.id = ml.ministerio_id
          WHERE ml.usuario_id = ?`).all(u.id);
    }
    return usuarios;
  }, { papel: 'admin' });

  rota('PUT', '/api/usuarios/:id', async (req) => {
    const u = (await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id));
    exigir(u, 'Usuário não encontrado', 404);
    const { papel, voluntario_id, senha, nome } = req.body;
    if (papel) (await db.prepare('UPDATE usuarios SET papel = ? WHERE id = ?').run(papel, u.id));
    if (nome) (await db.prepare('UPDATE usuarios SET nome = ? WHERE id = ?').run(nome, u.id));
    if (voluntario_id !== undefined) (await db.prepare('UPDATE usuarios SET voluntario_id = ? WHERE id = ?').run(voluntario_id, u.id));
    if (senha) {
      const { gerarSal, hashSenha } = require('./db');
      const sal = gerarSal();
      (await db.prepare('UPDATE usuarios SET sal = ?, senha_hash = ? WHERE id = ?').run(sal, hashSenha(senha, sal), u.id));
    }
    return (await carregarUsuario(u.id));
  }, { papel: 'admin' });

  rota('POST', '/api/usuarios/:id/lideranca', async (req) => {
    (await db.prepare('INSERT INTO ministerio_lideres (usuario_id, ministerio_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.params.id, req.body.ministerio_id));
    (await db.prepare("UPDATE usuarios SET papel = 'lider' WHERE id = ? AND papel = 'membro'").run(req.params.id));
    return { ok: true };
  }, { papel: 'admin' });

  rota('DELETE', '/api/usuarios/:id/lideranca/:ministerioId', async (req) => {
    (await db.prepare('DELETE FROM ministerio_lideres WHERE usuario_id = ? AND ministerio_id = ?').run(req.params.id, req.params.ministerioId));
    return { ok: true };
  }, { papel: 'admin' });

  // ---------- CRUD genérico ----------
  for (const [nome, cfg] of Object.entries(RECURSOS)) {
    const { colunas } = cfg;
    rota('GET', `/api/${nome}`, async (req) => {
      let sql = `SELECT t.*${cfg.autoria ? ', u.nome AS criado_por_nome' : ''} FROM ${nome} t` +
        (cfg.autoria ? ' LEFT JOIN usuarios u ON u.id = t.criado_por' : '');
      const params = [];
      const filtros = [];
      for (const col of ['ministerio_id', 'voluntario_id', 'evento_id']) {
        if (colunas.includes(col) && req.query[col]) { filtros.push(`t.${col} = ?`); params.push(Number(req.query[col])); }
      }
      if (filtros.length) sql += ' WHERE ' + filtros.join(' AND ');
      sql += ' ORDER BY t.id';
      return (await db.prepare(sql).all(...params));
    });
    rota('POST', `/api/${nome}`, async (req) => {
      const cols = colunas.filter((c) => req.body[c] !== undefined);
      exigir(cols.length, 'Nenhum campo válido informado', 400);
      const extras = cfg.autoria ? ['criado_por', 'criado_em'] : [];
      const sql = `INSERT INTO ${nome} (${cols.concat(extras).join(',')}) VALUES (${cols.concat(extras).map(() => '?').join(',')})`;
      const vals = cols.map((c) => req.body[c]);
      if (cfg.autoria) vals.push(req.usuario.id, agoraISO());
      const r = (await db.prepare(sql).run(...vals));
      return (await db.prepare(`SELECT * FROM ${nome} WHERE id = ?`).get(Number(r.lastInsertRowid)));
    }, { papel: cfg.escrita });
    rota('PUT', `/api/${nome}/:id`, async (req) => {
      const cols = colunas.filter((c) => req.body[c] !== undefined);
      exigir(cols.length, 'Nenhum campo válido informado', 400);
      (await db.prepare(`UPDATE ${nome} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((c) => req.body[c]), req.params.id));
      return (await db.prepare(`SELECT * FROM ${nome} WHERE id = ?`).get(req.params.id));
    }, { papel: cfg.escrita });
    rota('DELETE', `/api/${nome}/:id`, async (req) => {
      (await db.prepare(`DELETE FROM ${nome} WHERE id = ?`).run(req.params.id));
      return { ok: true };
    }, { papel: cfg.escrita });
  }

  // ---------- disponibilidade e bloqueios (self-service com justificativa obrigatória) ----------
  rota('GET', '/api/disponibilidade', async (req) => {
    const vol = req.query.voluntario_id ? Number(req.query.voluntario_id) : req.usuario.voluntario_id;
    return (await db.prepare('SELECT * FROM disponibilidade WHERE voluntario_id = ? ORDER BY dia_semana, hora_inicio').all(vol));
  });
  rota('POST', '/api/disponibilidade', async (req) => {
    const vol = Number(req.body.voluntario_id || req.usuario.voluntario_id);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, vol));
    const r = (await db.prepare('INSERT INTO disponibilidade (voluntario_id, dia_semana, hora_inicio, hora_fim) VALUES (?, ?, ?, ?)')
      .run(vol, req.body.dia_semana, req.body.hora_inicio || '00:00', req.body.hora_fim || '23:59'));
    return (await db.prepare('SELECT * FROM disponibilidade WHERE id = ?').get(Number(r.lastInsertRowid)));
  });
  rota('DELETE', '/api/disponibilidade/:id', async (req) => {
    const d = (await db.prepare('SELECT voluntario_id FROM disponibilidade WHERE id = ?').get(req.params.id));
    exigir(d, 'Não encontrado', 404);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, d.voluntario_id));
    (await db.prepare('DELETE FROM disponibilidade WHERE id = ?').run(req.params.id));
    return { ok: true };
  });
  rota('GET', '/api/bloqueios', async (req) => {
    const vol = req.query.voluntario_id ? Number(req.query.voluntario_id) : req.usuario.voluntario_id;
    return (await db.prepare('SELECT * FROM bloqueios WHERE voluntario_id = ? ORDER BY data').all(vol));
  });
  rota('POST', '/api/bloqueios', async (req) => {
    const vol = Number(req.body.voluntario_id || req.usuario.voluntario_id);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, vol));
    exigir(req.body.data, 'Informe a data', 400);
    exigir(req.body.motivo && String(req.body.motivo).trim().length >= 3, 'A justificativa é obrigatória', 400);
    const periodo = req.body.periodo || 'dia';
    exigir(['dia', 'matutino', 'vespertino', 'noturno'].includes(periodo), 'Período inválido', 400);
    const dataFim = req.body.data_fim || null;
    if (dataFim) exigir(dataFim >= req.body.data, 'O término deve ser igual ou depois do início', 400);
    const r = (await db.prepare('INSERT INTO bloqueios (voluntario_id, data, data_fim, periodo, motivo) VALUES (?, ?, ?, ?, ?) ON CONFLICT (voluntario_id, data) DO UPDATE SET data_fim = EXCLUDED.data_fim, periodo = EXCLUDED.periodo, motivo = EXCLUDED.motivo')
      .run(vol, req.body.data, dataFim, periodo, String(req.body.motivo).trim()));
    return (await db.prepare('SELECT * FROM bloqueios WHERE id = ?').get(Number(r.lastInsertRowid)));
  });

  // Indisponibilidades dos voluntários de um ministério (visão do líder), por mês.
  rota('GET', '/api/ministerios/:id/indisponibilidades', async (req) => {
    exigir((await lideraMinisterio(req.usuario, req.params.id)), 'Você não lidera este ministério');
    const mes = req.query.mes || hojeISO().slice(0, 7); // AAAA-MM
    const inicioMes = mes + '-01';
    const fimMes = mes + '-31';
    return (await db.prepare(`
      SELECT b.*, v.nome AS voluntario_nome
      FROM bloqueios b
      JOIN voluntarios v ON v.id = b.voluntario_id
      WHERE v.ativo = 1
        AND b.data <= ? AND COALESCE(b.data_fim, b.data) >= ?
        AND b.voluntario_id IN (
          SELECT DISTINCT vf.voluntario_id FROM voluntario_funcoes vf
          JOIN funcoes f ON f.id = vf.funcao_id WHERE f.ministerio_id = ?)
      ORDER BY b.data, v.nome`).all(fimMes, inicioMes, req.params.id));
  });
  rota('DELETE', '/api/bloqueios/:id', async (req) => {
    const b = (await db.prepare('SELECT voluntario_id FROM bloqueios WHERE id = ?').get(req.params.id));
    exigir(b, 'Não encontrado', 404);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, b.voluntario_id));
    (await db.prepare('DELETE FROM bloqueios WHERE id = ?').run(req.params.id));
    return { ok: true };
  });

  // ---------- voluntários: detalhe, funções, agenda, pontos, notificações ----------
  rota('GET', '/api/voluntarios/:id/detalhe', async (req) => {
    const v = (await db.prepare('SELECT * FROM voluntarios WHERE id = ?').get(req.params.id));
    exigir(v, 'Não encontrado', 404);
    v.funcoes = (await db.prepare(`
      SELECT f.id, f.nome, f.ministerio_id, m.nome AS ministerio_nome, m.cor, vf.preferencia
      FROM voluntario_funcoes vf JOIN funcoes f ON f.id = vf.funcao_id JOIN ministerios m ON m.id = f.ministerio_id
      WHERE vf.voluntario_id = ? ORDER BY m.nome, f.nome`).all(v.id));
    v.disponibilidade = (await db.prepare('SELECT * FROM disponibilidade WHERE voluntario_id = ?').all(v.id));
    v.bloqueios = (await db.prepare('SELECT * FROM bloqueios WHERE voluntario_id = ? ORDER BY data').all(v.id));
    v.pontos = (await db.prepare('SELECT COALESCE(SUM(valor),0) AS total FROM pontos WHERE voluntario_id = ?').get(v.id)).total;
    return v;
  });
  rota('POST', '/api/voluntarios/:id/funcoes', async (req) => {
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, req.params.id));
    (await db.prepare('INSERT INTO voluntario_funcoes (voluntario_id, funcao_id, preferencia) VALUES (?, ?, ?) ON CONFLICT (voluntario_id, funcao_id) DO UPDATE SET preferencia = EXCLUDED.preferencia')
      .run(req.params.id, req.body.funcao_id, req.body.preferencia ? 1 : 0));
    return { ok: true };
  });
  rota('DELETE', '/api/voluntarios/:id/funcoes/:funcaoId', async (req) => {
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, req.params.id));
    (await db.prepare('DELETE FROM voluntario_funcoes WHERE voluntario_id = ? AND funcao_id = ?').run(req.params.id, req.params.funcaoId));
    return { ok: true };
  });
  rota('POST', '/api/voluntarios/:id/nascimento', async (req) => {
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, req.params.id));
    (await db.prepare('UPDATE voluntarios SET nascimento = ? WHERE id = ?').run(req.body.nascimento || null, req.params.id));
    return (await db.prepare('SELECT * FROM voluntarios WHERE id = ?').get(req.params.id));
  });
  rota('POST', '/api/voluntarios/:id/termo', async (req) => {
    exigir(ehAdmin(req.usuario) || proprioVoluntario(req.usuario, req.params.id));
    (await db.prepare('UPDATE voluntarios SET termo_aceito_em = ? WHERE id = ?').run(agoraISO(), req.params.id));
    return (await db.prepare('SELECT * FROM voluntarios WHERE id = ?').get(req.params.id));
  });
  rota('GET', '/api/voluntarios/:id/agenda', async (req) => {
    return (await db.prepare(`
      SELECT e.id AS escala_id, e.status, e.checkin_em, o.id AS ocorrencia_id, o.data, o.hora_inicio, o.duracao_min,
             ev.nome AS evento_nome, l.nome AS local_nome, f.nome AS funcao_nome, f.id AS funcao_id,
             m.nome AS ministerio_nome, m.cor,
             (SELECT COUNT(*) FROM trocas t WHERE t.escala_id = e.id AND t.status = 'aguardando') AS troca_aberta
      FROM escala e
      JOIN ocorrencias o ON o.id = e.ocorrencia_id
      JOIN eventos ev ON ev.id = o.evento_id
      LEFT JOIN locais l ON l.id = ev.local_id
      JOIN funcoes f ON f.id = e.funcao_id
      JOIN ministerios m ON m.id = f.ministerio_id
      WHERE e.voluntario_id = ? AND o.data >= ? AND o.status != 'cancelada'
      ORDER BY o.data, o.hora_inicio`).all(req.params.id, hojeISO()));
  });
  rota('GET', '/api/voluntarios/:id/pontos', async (req) => {
    return {
      total: (await db.prepare('SELECT COALESCE(SUM(valor),0) AS t FROM pontos WHERE voluntario_id = ?').get(req.params.id)).t,
      historico: (await db.prepare('SELECT * FROM pontos WHERE voluntario_id = ? ORDER BY id DESC LIMIT 50').all(req.params.id)),
    };
  });
  rota('GET', '/api/voluntarios/:id/notificacoes', async (req) => {
    return (await db.prepare('SELECT * FROM notificacoes WHERE voluntario_id = ? ORDER BY id DESC LIMIT 50').all(req.params.id));
  });
  rota('POST', '/api/voluntarios/:id/notificacoes/ler', async (req) => {
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, req.params.id));
    (await db.prepare('UPDATE notificacoes SET lida = 1 WHERE voluntario_id = ?').run(req.params.id));
    return { ok: true };
  });

  // ---------- eventos: necessidades ----------
  rota('GET', '/api/eventos/:id/necessidades', async (req) => {
    return (await db.prepare(`
      SELECT n.*, f.nome AS funcao_nome, f.ministerio_id, m.nome AS ministerio_nome, m.cor
      FROM evento_necessidades n JOIN funcoes f ON f.id = n.funcao_id JOIN ministerios m ON m.id = f.ministerio_id
      WHERE n.evento_id = ? ORDER BY m.nome, f.nome`).all(req.params.id));
  });
  rota('POST', '/api/eventos/:id/necessidades', async (req) => {
    (await db.prepare('INSERT INTO evento_necessidades (evento_id, funcao_id, quantidade) VALUES (?, ?, ?) ON CONFLICT (evento_id, funcao_id) DO UPDATE SET quantidade = EXCLUDED.quantidade')
      .run(req.params.id, req.body.funcao_id, req.body.quantidade || 1));
    return { ok: true };
  }, { papel: 'lider' });
  rota('DELETE', '/api/eventos/:id/necessidades/:funcaoId', async (req) => {
    (await db.prepare('DELETE FROM evento_necessidades WHERE evento_id = ? AND funcao_id = ?').run(req.params.id, req.params.funcaoId));
    return { ok: true };
  }, { papel: 'lider' });

  // ---------- ocorrências, escala e escala mensal ----------
  rota('POST', '/api/ocorrencias/gerar', async (req) => {
    const ate = req.body.ate || hojeISO(28);
    return { criadas: (await engine.gerarOcorrencias(db, ate)) };
  }, { papel: 'lider' });

  rota('POST', '/api/escala-mensal', async (req) => {
    const { ministerio_id, ano, mes } = req.body;
    exigir(ministerio_id && ano && mes, 'Informe ministério, ano e mês', 400);
    exigir((await lideraMinisterio(req.usuario, ministerio_id)), 'Você não lidera este ministério');
    return (await engine.gerarEscalaMensal(db, Number(ministerio_id), Number(ano), Number(mes)));
  }, { papel: 'lider' });

  rota('GET', '/api/ocorrencias', async (req) => {
    const de = req.query.de || hojeISO();
    const ate = req.query.ate || hojeISO(60);
    return (await db.prepare(`
      SELECT o.*, ev.nome AS evento_nome, l.nome AS local_nome, l.tipo AS local_tipo, u.nome AS criado_por_nome,
        (SELECT COALESCE(SUM(n.quantidade),0) FROM evento_necessidades n WHERE n.evento_id = o.evento_id) AS vagas,
        (SELECT COUNT(*) FROM escala e WHERE e.ocorrencia_id = o.id AND e.status != 'recusado') AS preenchidas,
        (SELECT COUNT(*) FROM escala e WHERE e.ocorrencia_id = o.id AND e.status = 'confirmado') AS confirmadas
      FROM ocorrencias o
      JOIN eventos ev ON ev.id = o.evento_id
      LEFT JOIN locais l ON l.id = ev.local_id
      LEFT JOIN usuarios u ON u.id = o.criado_por
      WHERE o.data BETWEEN ? AND ? AND o.status != 'cancelada'
      ORDER BY o.data, o.hora_inicio`).all(de, ate));
  });

  rota('GET', '/api/ocorrencias/:id', async (req) => {
    const oc = (await db.prepare(`
      SELECT o.*, ev.nome AS evento_nome, ev.local_id, l.nome AS local_nome,
             u.nome AS criado_por_nome, up.nome AS publicada_por_nome
      FROM ocorrencias o JOIN eventos ev ON ev.id = o.evento_id
      LEFT JOIN locais l ON l.id = ev.local_id
      LEFT JOIN usuarios u ON u.id = o.criado_por
      LEFT JOIN usuarios up ON up.id = o.publicada_por
      WHERE o.id = ?`).get(Number(req.params.id)));
    exigir(oc, 'Não encontrado', 404);
    oc.necessidades = (await db.prepare(`
      SELECT n.funcao_id, n.quantidade, f.nome AS funcao_nome, f.ministerio_id, m.nome AS ministerio_nome, m.cor
      FROM evento_necessidades n JOIN funcoes f ON f.id = n.funcao_id JOIN ministerios m ON m.id = f.ministerio_id
      WHERE n.evento_id = ? ORDER BY m.nome, f.nome`).all(oc.evento_id));
    oc.escala = (await db.prepare(`
      SELECT e.*, v.nome AS voluntario_nome, v.telefone, f.nome AS funcao_nome, f.ministerio_id,
        (SELECT COUNT(*) FROM trocas t WHERE t.escala_id = e.id AND t.status = 'aguardando') AS troca_aberta
      FROM escala e JOIN voluntarios v ON v.id = e.voluntario_id JOIN funcoes f ON f.id = e.funcao_id
      WHERE e.ocorrencia_id = ? ORDER BY f.nome, v.nome`).all(oc.id));
    for (const linha of oc.escala) {
      linha.conflito = (await engine.temConflito(db, linha.voluntario_id, oc.data, oc.hora_inicio, oc.duracao_min, oc.id));
      linha.indisponivel = !(await engine.estaDisponivel(db, linha.voluntario_id, oc.data, oc.hora_inicio));
    }
    oc.oportunidades = (await db.prepare('SELECT * FROM oportunidades WHERE ocorrencia_id = ? ORDER BY ordem').all(oc.id));
    oc.repertorio = (await db.prepare(`
      SELECT r.id AS repertorio_id, r.ordem, r.tom AS tom_execucao, r.ministro_voluntario_id,
             vm.nome AS ministro_nome, m.*
      FROM repertorio r JOIN musicas m ON m.id = r.musica_id
      LEFT JOIN voluntarios vm ON vm.id = r.ministro_voluntario_id
      WHERE r.ocorrencia_id = ? ORDER BY r.ordem`).all(oc.id));
    oc.comentarios = (await db.prepare(`
      SELECT c.*, u.nome AS usuario_nome FROM comentarios c
      JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.ocorrencia_id = ? ORDER BY c.id`).all(oc.id));
    oc.pendencias = (await engine.pendenciasOcorrencia(db, oc.id));
    oc.meu_feedback = req.usuario.voluntario_id
      ? (await db.prepare('SELECT nota, comentario FROM feedback WHERE ocorrencia_id = ? AND voluntario_id = ?').get(oc.id, req.usuario.voluntario_id)) || null
      : null;
    return oc;
  });

  rota('PUT', '/api/ocorrencias/:id', async (req) => {
    const cols = ['tema', 'pregador', 'ministra', 'responsavel', 'abertura', 'observacoes', 'hora_inicio', 'duracao_min', 'status']
      .filter((c) => req.body[c] !== undefined);
    exigir(cols.length, 'Nenhum campo válido', 400);
    (await db.prepare(`UPDATE ocorrencias SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => req.body[c]), req.params.id));
    return (await db.prepare('SELECT * FROM ocorrencias WHERE id = ?').get(req.params.id));
  }, { papel: 'lider' });

  rota('POST', '/api/ocorrencias/:id/publicar', async (req) => {
    (await db.prepare('UPDATE ocorrencias SET publicada_em = ?, publicada_por = ? WHERE id = ?').run(agoraISO(), req.usuario.id, req.params.id));
    return { ok: true };
  }, { papel: 'lider' });
  rota('POST', '/api/ocorrencias/:id/despublicar', async (req) => {
    (await db.prepare('UPDATE ocorrencias SET publicada_em = NULL, publicada_por = NULL WHERE id = ?').run(req.params.id));
    return { ok: true };
  }, { papel: 'lider' });

  rota('POST', '/api/ocorrencias/:id/clonar', async (req) => {
    exigir(req.body.data, 'Informe a nova data', 400);
    const novo = (await engine.clonarOcorrencia(db, Number(req.params.id), req.body.data, req.usuario.id));
    return { id: novo };
  }, { papel: 'lider' });

  rota('GET', '/api/ocorrencias/:id/whatsapp-roteiro', async (req) => {
    return { texto: (await engine.gerarRoteiroWhatsApp(db, Number(req.params.id))) };
  });

  rota('GET', '/api/ocorrencias/:id/google-agenda', async (req) => (await engine.linkGoogleAgenda(db, Number(req.params.id))));

  // Comentários do culto.
  rota('POST', '/api/ocorrencias/:id/comentarios', async (req) => {
    exigir(req.body.texto && String(req.body.texto).trim(), 'Escreva o comentário', 400);
    const r = (await db.prepare('INSERT INTO comentarios (ocorrencia_id, usuario_id, texto, criado_em) VALUES (?, ?, ?, ?)')
      .run(req.params.id, req.usuario.id, String(req.body.texto).trim(), agoraISO()));
    return (await db.prepare('SELECT c.*, u.nome AS usuario_nome FROM comentarios c JOIN usuarios u ON u.id = c.usuario_id WHERE c.id = ?')
      .get(Number(r.lastInsertRowid)));
  });
  rota('DELETE', '/api/comentarios/:id', async (req) => {
    const c = (await db.prepare('SELECT * FROM comentarios WHERE id = ?').get(req.params.id));
    exigir(c, 'Não encontrado', 404);
    exigir(ehLider(req.usuario) || c.usuario_id === req.usuario.id, 'Só o autor ou um líder pode excluir');
    (await db.prepare('DELETE FROM comentarios WHERE id = ?').run(req.params.id));
    return { ok: true };
  });

  // Preview das próximas datas de um evento (formulário de celebração).
  rota('POST', '/api/eventos/preview-ocorrencias', async (req) => {
    return { datas: (await engine.previewOcorrencias(db, req.body, 3)) };
  }, { papel: 'lider' });

  rota('POST', '/api/ocorrencias/:id/gerar-escala', async (req) => {
    const ministerioId = req.body.ministerio_id ? Number(req.body.ministerio_id) : null;
    if (ministerioId) exigir((await lideraMinisterio(req.usuario, ministerioId)), 'Você não lidera este ministério');
    else exigir(ehAdmin(req.usuario), 'Somente o administrador gera a escala de todos os ministérios de uma vez');
    return (await engine.gerarEscala(db, Number(req.params.id), ministerioId));
  }, { papel: 'lider' });

  rota('POST', '/api/ocorrencias/:id/escalar', async (req) =>
    (await engine.escalarManual(db, Number(req.params.id), req.body.voluntario_id, req.body.funcao_id)), { papel: 'lider' });

  rota('GET', '/api/ocorrencias/:id/candidatos', async (req) => {
    const oc = (await engine.descricaoOcorrencia(db, Number(req.params.id)));
    exigir(oc, 'Não encontrado', 404);
    const funcaoId = Number(req.query.funcao_id);
    const lista = await db.prepare(`
      SELECT v.id, v.nome, vf.preferencia FROM voluntarios v
      JOIN voluntario_funcoes vf ON vf.voluntario_id = v.id
      WHERE vf.funcao_id = ? AND v.ativo = 1 ORDER BY v.nome`).all(funcaoId);
    const saida = [];
    for (const c of lista) {
      saida.push({
        ...c,
        disponivel: await engine.estaDisponivel(db, c.id, oc.data, oc.hora_inicio),
        conflito: await engine.temConflito(db, c.id, oc.data, oc.hora_inicio, oc.duracao_min),
        mesmo_culto: await engine.estaNoCulto(db, c.id, oc.id),
        recentes: await engine.contarEscalasRecentes(db, c.id, oc.data),
      });
    }
    return saida;
  });

  // ---------- oportunidades (roteiro do culto) ----------
  rota('POST', '/api/ocorrencias/:id/oportunidades', async (req) => {
    exigir(req.body.titulo, 'Informe o título', 400);
    const ordem = req.body.ordem ?? (await db.prepare('SELECT COALESCE(MAX(ordem),0)+1 AS o FROM oportunidades WHERE ocorrencia_id = ?').get(req.params.id)).o;
    const r = (await db.prepare('INSERT INTO oportunidades (ocorrencia_id, ordem, titulo, responsavel) VALUES (?, ?, ?, ?)')
      .run(req.params.id, ordem, req.body.titulo, req.body.responsavel || null));
    return (await db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(Number(r.lastInsertRowid)));
  }, { papel: 'lider' });
  rota('PUT', '/api/oportunidades/:id', async (req) => {
    const cols = ['ordem', 'titulo', 'responsavel'].filter((c) => req.body[c] !== undefined);
    exigir(cols.length, 'Nenhum campo válido', 400);
    (await db.prepare(`UPDATE oportunidades SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => req.body[c]), req.params.id));
    return (await db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(req.params.id));
  }, { papel: 'lider' });
  rota('DELETE', '/api/oportunidades/:id', async (req) => {
    (await db.prepare('DELETE FROM oportunidades WHERE id = ?').run(req.params.id));
    return { ok: true };
  }, { papel: 'lider' });

  // ---------- mural ----------
  rota('GET', '/api/mural', async (req) => {
    const hoje = hojeISO();
    // Próximos cultos primeiro (mais perto → mais distante), depois os passados (mais recente primeiro).
    const cultos = (await db.prepare(`
      SELECT o.*, ev.nome AS evento_nome, l.nome AS local_nome, u.nome AS publicada_por_nome,
        (SELECT COUNT(*) FROM escala e WHERE e.ocorrencia_id = o.id AND e.status != 'recusado') AS escalados
      FROM ocorrencias o
      JOIN eventos ev ON ev.id = o.evento_id
      LEFT JOIN locais l ON l.id = ev.local_id
      LEFT JOIN usuarios u ON u.id = o.publicada_por
      WHERE o.publicada_em IS NOT NULL AND o.status != 'cancelada'
      ORDER BY (o.data < ?) ASC,
               CASE WHEN o.data >= ? THEN o.data END ASC,
               CASE WHEN o.data < ? THEN o.data END DESC`).all(hoje, hoje, hoje));
    const avisos = (await db.prepare(`
      SELECT a.*, u.nome AS criado_por_nome, m.nome AS ministerio_nome
      FROM avisos a LEFT JOIN usuarios u ON u.id = a.criado_por LEFT JOIN ministerios m ON m.id = a.ministerio_id
      ORDER BY a.id DESC LIMIT 50`).all());
    return { cultos, avisos };
  });

  // ---------- escala: ações do voluntário ----------
  rota('DELETE', '/api/escala/:id', async (req) => {
    (await db.prepare('DELETE FROM escala WHERE id = ?').run(req.params.id));
    return { ok: true };
  }, { papel: 'lider' });
  rota('POST', '/api/escala/:id/confirmar', async (req) => {
    (await donoDaEscala(req, req.params.id));
    return (await engine.confirmarEscala(db, Number(req.params.id)));
  });
  rota('POST', '/api/escala/:id/recusar', async (req) => {
    (await donoDaEscala(req, req.params.id));
    return (await engine.recusarEscala(db, Number(req.params.id)));
  });
  rota('POST', '/api/escala/:id/checkin', async (req) => {
    (await donoDaEscala(req, req.params.id));
    return (await engine.fazerCheckin(db, Number(req.params.id)));
  });
  rota('GET', '/api/escala/:id/whatsapp', async (req) => (await engine.conviteWhatsApp(db, Number(req.params.id))));
  rota('POST', '/api/escala/:id/falta', async (req) => (await engine.registrarFalta(db, Number(req.params.id))), { papel: 'lider' });
  rota('POST', '/api/escala/:id/desmarcar-falta', async (req) => (await engine.desmarcarFalta(db, Number(req.params.id))), { papel: 'lider' });

  // ---------- trocas 2.0 ----------
  rota('POST', '/api/escala/:id/solicitar-troca', async (req) => {
    (await donoDaEscala(req, req.params.id));
    return (await engine.solicitarTroca(db, Number(req.params.id), {
      motivo: req.body.motivo || '',
      destinatarioId: req.body.destinatario_id ? Number(req.body.destinatario_id) : null,
      prazo: req.body.prazo || null,
    }));
  });
  rota('GET', '/api/trocas', async (req) => {
    (await engine.expirarTrocas(db));
    const status = req.query.status || null;
    let sql = `
      SELECT t.*, vs.nome AS solicitante_nome, vd.nome AS destinatario_nome, va.nome AS aceitou_nome,
             o.data, o.hora_inicio, ev.nome AS evento_nome, f.nome AS funcao_nome, f.id AS funcao_id,
             l.nome AS local_nome, e.ocorrencia_id
      FROM trocas t
      JOIN escala e ON e.id = t.escala_id
      JOIN ocorrencias o ON o.id = e.ocorrencia_id
      JOIN eventos ev ON ev.id = o.evento_id
      LEFT JOIN locais l ON l.id = ev.local_id
      JOIN funcoes f ON f.id = e.funcao_id
      JOIN voluntarios vs ON vs.id = t.solicitante_id
      LEFT JOIN voluntarios vd ON vd.id = t.destinatario_id
      LEFT JOIN voluntarios va ON va.id = t.aceitou_id`;
    const params = [];
    if (status) { sql += ' WHERE t.status = ?'; params.push(status); }
    sql += ' ORDER BY t.id DESC';
    return (await db.prepare(sql).all(...params));
  });
  rota('POST', '/api/trocas/:id/aceitar', async (req) => {
    const vol = ehLider(req.usuario) && req.body.voluntario_id ? Number(req.body.voluntario_id) : req.usuario.voluntario_id;
    exigir(vol, 'Seu usuário não tem perfil de voluntário', 400);
    return (await engine.aceitarTroca(db, Number(req.params.id), vol));
  });
  rota('POST', '/api/trocas/:id/recusar', async (req) => {
    return (await engine.recusarTroca(db, Number(req.params.id), req.usuario.voluntario_id));
  });
  rota('POST', '/api/trocas/:id/cancelar', async (req) => {
    const t = (await db.prepare('SELECT * FROM trocas WHERE id = ?').get(req.params.id));
    exigir(t, 'Não encontrada', 404);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, t.solicitante_id));
    (await db.prepare("UPDATE trocas SET status = 'cancelada', resolvida_em = ? WHERE id = ? AND status = 'aguardando'").run(agoraISO(), req.params.id));
    return { ok: true };
  });
  // Painel de trocas: editar (motivo/prazo/substituto), excluir e resumo.
  rota('PUT', '/api/trocas/:id', async (req) => {
    const t = (await db.prepare('SELECT * FROM trocas WHERE id = ?').get(req.params.id));
    exigir(t, 'Não encontrada', 404);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, t.solicitante_id), 'Só quem pediu a troca (ou um líder) pode editá-la');
    return (await engine.editarTroca(db, Number(req.params.id), {
      motivo: req.body.motivo,
      destinatarioId: req.body.destinatario_id === undefined ? undefined : (req.body.destinatario_id ? Number(req.body.destinatario_id) : null),
      prazo: req.body.prazo,
    }));
  });
  rota('DELETE', '/api/trocas/:id', async (req) => {
    const t = (await db.prepare('SELECT * FROM trocas WHERE id = ?').get(req.params.id));
    exigir(t, 'Não encontrada', 404);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, t.solicitante_id), 'Só quem pediu a troca (ou um líder) pode excluí-la');
    exigir(t.status !== 'aguardando', 'Cancele a troca antes de excluí-la', 400);
    return (await engine.excluirTroca(db, Number(req.params.id)));
  });
  rota('GET', '/api/trocas/resumo', async (req) => {
    const vol = req.query.voluntario_id ? Number(req.query.voluntario_id) : req.usuario.voluntario_id;
    exigir(vol, 'Seu usuário não tem perfil de voluntário', 400);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, vol));
    return (await engine.resumoTrocas(db, vol));
  });

  // ---------- feedback ----------
  rota('POST', '/api/feedback', async (req) => {
    const vol = Number(req.body.voluntario_id || req.usuario.voluntario_id);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, vol));
    (await db.prepare('INSERT INTO feedback (ocorrencia_id, voluntario_id, nota, comentario, criado_em) VALUES (?, ?, ?, ?, ?) ON CONFLICT (ocorrencia_id, voluntario_id) DO UPDATE SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario, criado_em = EXCLUDED.criado_em')
      .run(req.body.ocorrencia_id, vol, req.body.nota, req.body.comentario || '', agoraISO()));
    return { ok: true };
  });
  rota('GET', '/api/feedback', async (req) => {
    let sql = `
      SELECT fb.*, v.nome AS voluntario_nome, ev.nome AS evento_nome, o.data
      FROM feedback fb
      JOIN voluntarios v ON v.id = fb.voluntario_id
      JOIN ocorrencias o ON o.id = fb.ocorrencia_id
      JOIN eventos ev ON ev.id = o.evento_id`;
    const params = [];
    if (req.query.ocorrencia_id) { sql += ' WHERE fb.ocorrencia_id = ?'; params.push(Number(req.query.ocorrencia_id)); }
    sql += ' ORDER BY fb.id DESC LIMIT 100';
    return (await db.prepare(sql).all(...params));
  });
  // Interação: o líder agradece (notifica o autor) e autor/líder podem excluir.
  rota('POST', '/api/feedback/:id/agradecer', async (req) => {
    const fb = (await db.prepare(`
      SELECT fb.*, ev.nome AS evento_nome, o.data FROM feedback fb
      JOIN ocorrencias o ON o.id = fb.ocorrencia_id JOIN eventos ev ON ev.id = o.evento_id
      WHERE fb.id = ?`).get(req.params.id));
    exigir(fb, 'Não encontrado', 404);
    (await engine.notificar(db, fb.voluntario_id,
      `🙏 ${req.usuario.nome.split(' ')[0]} agradeceu seu feedback do ${fb.evento_nome} (${fb.data}). Sua opinião ajuda a equipe a crescer!`));
    return { ok: true };
  }, { papel: 'lider' });
  rota('DELETE', '/api/feedback/:id', async (req) => {
    const fb = (await db.prepare('SELECT * FROM feedback WHERE id = ?').get(req.params.id));
    exigir(fb, 'Não encontrado', 404);
    exigir(ehLider(req.usuario) || proprioVoluntario(req.usuario, fb.voluntario_id), 'Só o autor ou um líder pode excluir');
    (await db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id));
    return { ok: true };
  });

  // ---------- estante musical ----------
  rota('GET', '/api/musicas', async (req) => {
    let sql = `
      SELECT m.*, u.nome AS criado_por_nome,
        (SELECT COUNT(*) FROM repertorio r WHERE r.musica_id = m.id) AS vezes_usada,
        (SELECT COUNT(*) FROM musica_versoes mv WHERE mv.musica_id = m.id) AS versoes
      FROM musicas m LEFT JOIN usuarios u ON u.id = m.criado_por`;
    const params = [];
    if (req.query.q) {
      sql += ' WHERE m.titulo ILIKE ? OR m.artista ILIKE ?';
      params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    sql += ' ORDER BY m.titulo';
    return (await db.prepare(sql).all(...params));
  });
  rota('POST', '/api/musicas', async (req) => {
    exigir(req.body.titulo, 'Informe o título', 400);
    const chave = normalizarChave(req.body.titulo, req.body.artista);
    const dup = (await db.prepare('SELECT id, titulo FROM musicas WHERE chave_dedupe = ?').get(chave));
    exigir(!dup, `Esta música já está na estante (“${dup?.titulo}”)`, 400);
    const cols = ['titulo', 'artista', 'tom', 'bpm', 'duracao', 'classificacao', 'observacoes', 'letra', 'cifra', 'cifra_html', 'link_spotify', 'link_deezer', 'link_cifraclub', 'link_letra', 'link_youtube'];
    const usar = cols.filter((c) => req.body[c] !== undefined);
    const r = (await db.prepare(
      `INSERT INTO musicas (${usar.join(',')}, chave_dedupe, criado_por, criado_em) VALUES (${usar.map(() => '?').join(',')}, ?, ?, ?)`
    ).run(...usar.map((c) => req.body[c]), chave, req.usuario.id, agoraISO()));
    return (await db.prepare('SELECT * FROM musicas WHERE id = ?').get(Number(r.lastInsertRowid)));
  }, { papel: 'lider' });
  rota('PUT', '/api/musicas/:id', async (req) => {
    const cols = ['titulo', 'artista', 'tom', 'bpm', 'duracao', 'classificacao', 'observacoes', 'letra', 'cifra', 'cifra_html', 'link_spotify', 'link_deezer', 'link_cifraclub', 'link_letra', 'link_youtube']
      .filter((c) => req.body[c] !== undefined);
    exigir(cols.length, 'Nenhum campo válido', 400);
    (await db.prepare(`UPDATE musicas SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => req.body[c]), req.params.id));
    const m = (await db.prepare('SELECT * FROM musicas WHERE id = ?').get(req.params.id));
    (await db.prepare('UPDATE musicas SET chave_dedupe = ? WHERE id = ?').run(normalizarChave(m.titulo, m.artista), m.id));
    return m;
  }, { papel: 'lider' });
  rota('DELETE', '/api/musicas/:id', async (req) => {
    (await db.prepare('DELETE FROM musicas WHERE id = ?').run(req.params.id));
    return { ok: true };
  }, { papel: 'lider' });
  rota('GET', '/api/musicas/:id/versoes', async (req) => {
    return (await db.prepare(`
      SELECT mv.*, u.nome AS criado_por_nome FROM musica_versoes mv
      LEFT JOIN usuarios u ON u.id = mv.criado_por WHERE mv.musica_id = ? ORDER BY mv.id`).all(req.params.id));
  });
  rota('POST', '/api/musicas/:id/versoes', async (req) => {
    exigir(req.body.nome, 'Dê um nome à versão', 400);
    const r = (await db.prepare('INSERT INTO musica_versoes (musica_id, nome, letra, cifra_html, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.params.id, req.body.nome, req.body.letra || null, req.body.cifra_html || null, req.usuario.id, agoraISO()));
    return (await db.prepare('SELECT * FROM musica_versoes WHERE id = ?').get(Number(r.lastInsertRowid)));
  }, { papel: 'lider' });
  rota('DELETE', '/api/versoes/:id', async (req) => {
    (await db.prepare('DELETE FROM musica_versoes WHERE id = ?').run(req.params.id));
    return { ok: true };
  }, { papel: 'lider' });

  // Estatísticas da estante: uso mensal e tons mais usados.
  rota('GET', '/api/estante/estatisticas', async () => {
    const usoMensal = (await db.prepare(`
      SELECT substr(o.data, 1, 7) AS mes, m.id, m.titulo, COUNT(*) AS vezes
      FROM repertorio r JOIN ocorrencias o ON o.id = r.ocorrencia_id JOIN musicas m ON m.id = r.musica_id
      GROUP BY mes, m.id ORDER BY mes DESC, vezes DESC`).all());
    const maisUsadas = (await db.prepare(`
      SELECT m.id, m.titulo, m.artista, COUNT(r.id) AS vezes,
        (SELECT r2.tom FROM repertorio r2 WHERE r2.musica_id = m.id AND r2.tom IS NOT NULL
         GROUP BY r2.tom ORDER BY COUNT(*) DESC LIMIT 1) AS tom_mais_usado
      FROM musicas m LEFT JOIN repertorio r ON r.musica_id = m.id
      GROUP BY m.id ORDER BY vezes DESC, m.titulo LIMIT 15`).all());
    const tons = (await db.prepare(`
      SELECT COALESCE(r.tom, m.tom) AS tom, COUNT(*) AS vezes
      FROM repertorio r JOIN musicas m ON m.id = r.musica_id
      WHERE COALESCE(r.tom, m.tom) IS NOT NULL
      GROUP BY COALESCE(r.tom, m.tom) ORDER BY vezes DESC`).all());
    return { usoMensal, maisUsadas, tons };
  });

  // Busca de letra na internet (lyrics.ovh — gratuito, sem chave; proxy p/ evitar CORS).
  rota('GET', '/api/buscar-letra', async (req) => {
    const { artista, titulo } = req.query;
    exigir(artista && titulo, 'Informe artista e título', 400);
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artista)}/${encodeURIComponent(titulo)}`, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) return { encontrada: false };
      const json = await res.json();
      return { encontrada: !!json.lyrics, letra: json.lyrics || null };
    } catch {
      return { encontrada: false, erro: 'Sem conexão com o serviço de letras' };
    }
  }, { papel: 'lider' });

  // ---------- setlists ----------
  rota('GET', '/api/setlists/:id/musicas', async (req) => {
    return (await db.prepare(`
      SELECT sm.id AS item_id, sm.ordem, sm.tom AS tom_execucao, m.*
      FROM setlist_musicas sm JOIN musicas m ON m.id = sm.musica_id
      WHERE sm.setlist_id = ? ORDER BY sm.ordem`).all(req.params.id));
  });
  rota('POST', '/api/setlists/:id/musicas', async (req) => {
    const ordem = (await db.prepare('SELECT COALESCE(MAX(ordem),0)+1 AS o FROM setlist_musicas WHERE setlist_id = ?').get(req.params.id)).o;
    (await db.prepare('INSERT INTO setlist_musicas (setlist_id, musica_id, ordem, tom) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(req.params.id, req.body.musica_id, ordem, req.body.tom || null));
    return { ok: true };
  }, { papel: 'lider' });
  rota('DELETE', '/api/setlist-musicas/:id', async (req) => {
    (await db.prepare('DELETE FROM setlist_musicas WHERE id = ?').run(req.params.id));
    return { ok: true };
  }, { papel: 'lider' });

  // ---------- repertório do culto ----------
  rota('POST', '/api/ocorrencias/:id/repertorio', async (req) => {
    const ordem = (await db.prepare('SELECT COALESCE(MAX(ordem),0)+1 AS o FROM repertorio WHERE ocorrencia_id = ?').get(req.params.id)).o;
    (await db.prepare('INSERT INTO repertorio (ocorrencia_id, musica_id, ordem, tom) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(req.params.id, req.body.musica_id, ordem, req.body.tom || null));
    return { ok: true };
  }, { papel: 'lider' });
  rota('PUT', '/api/repertorio/:id', async (req) => {
    const cols = ['tom', 'ordem', 'ministro_voluntario_id'].filter((c) => req.body[c] !== undefined);
    exigir(cols.length, 'Nenhum campo válido', 400);
    (await db.prepare(`UPDATE repertorio SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => req.body[c]), req.params.id));
    return { ok: true };
  }, { papel: 'lider' });
  rota('DELETE', '/api/repertorio/:id', async (req) => {
    (await db.prepare('DELETE FROM repertorio WHERE id = ?').run(req.params.id));
    return { ok: true };
  }, { papel: 'lider' });

  // ---------- aniversariantes e convites ----------
  rota('GET', '/api/aniversariantes', async (req) => {
    return (await engine.aniversariantes(db, req.query.mes ? Number(req.query.mes) : null));
  });

  // Convites expiram em CONVITE_DIAS (calculado a partir de criado_em; sem migração).
  const CONVITE_DIAS = 7;
  const conviteExpiraEm = (criadoEm) => {
    const d = new Date(String(criadoEm).replace(' ', 'T'));
    d.setDate(d.getDate() + CONVITE_DIAS);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const conviteExpirado = (criadoEm) => conviteExpiraEm(criadoEm) < agoraISO();

  rota('POST', '/api/convites', async (req) => {
    const token = crypto.randomBytes(12).toString('hex');
    const agora = agoraISO();
    (await db.prepare('INSERT INTO convites (token, criado_por, criado_em) VALUES (?, ?, ?)').run(token, req.usuario.id, agora));
    return {
      token,
      url: `http://localhost:${process.env.PORT || 3000}/?convite=${token}`,
      expira_em: conviteExpiraEm(agora),
      validade_dias: CONVITE_DIAS,
    };
  }, { papel: 'admin' });
  rota('GET', '/api/convites', async () => {
    return (await db.prepare(`
      SELECT c.token, c.criado_em, c.usado_em, uc.nome AS criado_por_nome, uu.nome AS usado_por_nome
      FROM convites c LEFT JOIN usuarios uc ON uc.id = c.criado_por LEFT JOIN usuarios uu ON uu.id = c.usado_por
      ORDER BY c.criado_em DESC LIMIT 30`).all())
      .map((c) => ({
        ...c,
        url: `http://localhost:${process.env.PORT || 3000}/?convite=${c.token}`,
        expira_em: conviteExpiraEm(c.criado_em),
        expirado: !c.usado_em && conviteExpirado(c.criado_em),
      }));
  }, { papel: 'admin' });

  // ---------- dashboard e ranking ----------
  rota('GET', '/api/ranking', async () => {
    return (await db.prepare(`
      SELECT v.id, v.nome, COALESCE(SUM(p.valor),0) AS pontos
      FROM voluntarios v LEFT JOIN pontos p ON p.voluntario_id = v.id
      WHERE v.ativo = 1 GROUP BY v.id ORDER BY pontos DESC, v.nome LIMIT 20`).all());
  });

  // Ranking da igreja — Servindo, referência e compromisso (avaliação automática).
  rota('GET', '/api/avaliacao', async (req) => {
    const de = req.query.de || hojeISO(-90);
    const ate = req.query.ate || hojeISO(30);
    return (await engine.avaliacaoServico(db, de, ate));
  });

  // Cultos com pendências (vagas incompletas, louvores não informados etc.).
  rota('GET', '/api/pendencias', async (req) => {
    const de = req.query.de || hojeISO();
    const ate = req.query.ate || hojeISO(35);
    return (await engine.listarPendencias(db, de, ate));
  }, { papel: 'lider' });

  // Setlist aprovada por WhatsApp (texto + link individual por escalado).
  rota('GET', '/api/ocorrencias/:id/whatsapp-setlist', async (req) => (await engine.setlistWhatsApp(db, Number(req.params.id))));
  // Visão geral com filtro de período (?de=AAAA-MM-DD&ate=AAAA-MM-DD).
  rota('GET', '/api/dashboard', async (req) => {
    const hoje = hojeISO();
    const de = req.query.de || hojeISO(-30);
    const ate = req.query.ate || hojeISO(30);
    const kpis = {
      periodo: { de, ate },
      voluntarios_ativos: (await db.prepare('SELECT COUNT(*) AS n FROM voluntarios WHERE ativo = 1').get()).n,
      escalas_periodo: (await db.prepare("SELECT COUNT(*) AS n FROM ocorrencias WHERE data BETWEEN ? AND ? AND status != 'cancelada'").get(de, ate)).n,
      trocas_abertas: (await db.prepare("SELECT COUNT(*) AS n FROM trocas WHERE status = 'aguardando'").get()).n,
      vagas_abertas_7d: (await db.prepare(`
        SELECT COALESCE(SUM(n.quantidade),0) - (
          SELECT COUNT(*) FROM escala e JOIN ocorrencias o2 ON o2.id = e.ocorrencia_id
          WHERE e.status != 'recusado' AND o2.data BETWEEN ? AND to_char(?::date + 7, 'YYYY-MM-DD') AND o2.status != 'cancelada'
        ) AS n
        FROM ocorrencias o JOIN evento_necessidades n ON n.evento_id = o.evento_id
        WHERE o.data BETWEEN ? AND to_char(?::date + 7, 'YYYY-MM-DD') AND o.status != 'cancelada'`).get(hoje, hoje, hoje, hoje)).n,
    };
    const agg = (await db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN e.status = 'confirmado' THEN 1 ELSE 0 END) AS conf,
             SUM(CASE WHEN e.faltou = 1 THEN 1 ELSE 0 END) AS faltas,
             COUNT(DISTINCT e.voluntario_id) AS membros
      FROM escala e JOIN ocorrencias o ON o.id = e.ocorrencia_id
      WHERE e.status != 'recusado' AND o.data BETWEEN ? AND ?`).get(de, ate));
    const chk = (await db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN e.checkin_em IS NOT NULL THEN 1 ELSE 0 END) AS chk
      FROM escala e JOIN ocorrencias o ON o.id = e.ocorrencia_id
      WHERE e.status != 'recusado' AND o.data BETWEEN ? AND ?`).get(de, hoje < ate ? hoje : ate));
    kpis.total_escalacoes = agg.total;
    kpis.faltas = agg.faltas || 0;
    kpis.membros_escalados = agg.membros;
    kpis.taxa_confirmacao = agg.total ? Math.round((agg.conf / agg.total) * 100) : null;
    kpis.taxa_checkin = chk.total ? Math.round((chk.chk / chk.total) * 100) : null;
    kpis.indisponibilidades = (await db.prepare(
      'SELECT COUNT(*) AS n FROM bloqueios WHERE data <= ? AND COALESCE(data_fim, data) >= ?').get(ate, de)).n;
    kpis.musicas_selecionadas = (await db.prepare(`
      SELECT COUNT(*) AS n FROM repertorio r JOIN ocorrencias o ON o.id = r.ocorrencia_id
      WHERE o.data BETWEEN ? AND ?`).get(de, ate)).n;
    kpis.nota_media = (await db.prepare(`
      SELECT ROUND(AVG(fb.nota),1) AS m FROM feedback fb
      JOIN ocorrencias o ON o.id = fb.ocorrencia_id WHERE o.data BETWEEN ? AND ?`).get(de, ate)).m;

    const distribuicao = (await db.prepare(`
      SELECT v.nome, COUNT(e.id) AS escalas
      FROM voluntarios v LEFT JOIN escala e ON e.voluntario_id = v.id AND e.status != 'recusado'
        AND e.ocorrencia_id IN (SELECT id FROM ocorrencias WHERE data BETWEEN ? AND ?)
      WHERE v.ativo = 1 GROUP BY v.id ORDER BY escalas DESC, v.nome`).all(de, ate));
    const ranking = (await db.prepare(`
      SELECT v.nome, COALESCE(SUM(p.valor),0) AS pontos
      FROM voluntarios v LEFT JOIN pontos p ON p.voluntario_id = v.id
      WHERE v.ativo = 1 GROUP BY v.id ORDER BY pontos DESC, v.nome LIMIT 8`).all());
    const porMinisterio = (await db.prepare(`
      SELECT m.nome, m.cor, COUNT(DISTINCT vf.voluntario_id) AS voluntarios
      FROM ministerios m LEFT JOIN funcoes f ON f.ministerio_id = m.id
      LEFT JOIN voluntario_funcoes vf ON vf.funcao_id = f.id
      GROUP BY m.id ORDER BY m.nome`).all());
    return { kpis, distribuicao, ranking, porMinisterio };
  });

  // ---------- utilitários ----------
  rota('POST', '/api/seed-demo', async () => {
    exigir((await estaVazio(db)), 'O banco já possui dados; o seed só roda em banco vazio', 400);
    (await seedDemo(db));
    (await engine.gerarOcorrencias(db, hojeISO(28)));
    return { ok: true };
  }, { publico: true });
  rota('GET', '/api/export', async () => {
    const dump = {};
    const tabelas = (await db.prepare("SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_meta'").all());
    for (const t of tabelas) {
      if (t.name === 'sessoes' || t.name === 'usuarios') continue; // credenciais fora do backup
      dump[t.name] = (await db.prepare(`SELECT * FROM ${t.name}`).all());
    }
    return dump;
  }, { papel: 'admin' });

  // Compila padrões em regex uma única vez.
  for (const r of rotas) {
    const nomes = [];
    const re = r.padrao.replace(/:([a-zA-Z]+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; });
    r.re = new RegExp(`^${re}$`);
    r.nomes = nomes;
  }

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const caminho = decodeURIComponent(url.pathname);

    if (caminho.startsWith('/api/')) {
      let body = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        try {
          const bruto = await lerCorpo(req);
          body = bruto ? JSON.parse(bruto) : {};
        } catch {
          return responder(res, 400, { erro: 'JSON inválido' });
        }
      }
      // Sessão via cookie.
      const token = lerCookie(req.headers.cookie, COOKIE);
      let usuario = null;
      if (token) {
        const s = (await db.prepare('SELECT * FROM sessoes WHERE token = ?').get(token));
        if (s && s.expira_em > new Date().toISOString()) usuario = (await carregarUsuario(s.usuario_id));
        else if (s) (await db.prepare('DELETE FROM sessoes WHERE token = ?').run(token));
      }

      for (const r of rotas) {
        if (r.metodo !== req.method) continue;
        const m = caminho.match(r.re);
        if (!m) continue;
        const params = {};
        r.nomes.forEach((n, i) => { params[n] = m[i + 1]; });
        const ctx = { params, body, query: Object.fromEntries(url.searchParams), usuario, token };
        try {
          if (!r.opts.publico && !usuario) return responder(res, 401, { erro: 'Faça login para continuar' });
          if (r.opts.papel === 'admin' && !ehAdmin(usuario)) return responder(res, 403, { erro: 'Apenas administradores' });
          if (r.opts.papel === 'lider' && !ehLider(usuario)) return responder(res, 403, { erro: 'Apenas líderes ou administradores' });
          const out = await r.fn(ctx);
          const headers = {};
          if (out && out.setCookie) {
            headers['Set-Cookie'] = `${COOKIE}=${out.setCookie}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSAO_DIAS * 86400}`;
            return responder(res, 200, out.me, headers);
          }
          if (ctx.cookieLimpar) headers['Set-Cookie'] = `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
          return responder(res, 200, out, headers);
        } catch (e) {
          return responder(res, e.status || 500, { erro: e.message });
        }
      }
      return responder(res, 404, { erro: 'Rota não encontrada' });
    }

    // Estáticos
    const arquivo = caminho === '/' ? '/index.html' : caminho;
    const alvo = path.join(__dirname, 'public', path.normalize(arquivo).replace(/^([.][.][\\/])+/, ''));
    if (!alvo.startsWith(path.join(__dirname, 'public'))) return responder(res, 403, { erro: 'Proibido' });
    fs.readFile(alvo, (err, dados) => {
      if (err) return responder(res, 404, { erro: 'Arquivo não encontrado' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(alvo)] || 'application/octet-stream' });
      res.end(dados);
    });
  };
}

// Wrapper para uso local/testes: devolve um http.Server de verdade (chame o método
// que sobe o servidor você mesmo — ver scripts/dev.js).
function criarServidor(db) {
  return http.createServer(criarHandler(db));
}

function lerCookie(header, nome) {
  if (!header) return null;
  for (const par of header.split(';')) {
    const [k, ...v] = par.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return null;
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (c) => { dados += c; if (dados.length > 5_000_000) reject(new Error('Corpo grande demais')); });
    req.on('end', () => resolve(dados));
    req.on('error', reject);
  });
}

function responder(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(obj ?? null));
}

module.exports = { criarServidor, criarHandler };
