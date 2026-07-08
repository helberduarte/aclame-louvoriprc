'use strict';
// Adaptador PostgreSQL com a mesma interface do node:sqlite (DatabaseSync),
// porém assíncrono: db.prepare(sql).run/get/all e db.exec/close retornam Promises.
// Mantém as semânticas que o app espera do SQLite:
//   - run() → { changes, lastInsertRowid }  (via RETURNING * automático em INSERT)
//   - get() → primeira linha ou undefined; all() → array de linhas
//   - COUNT(*)/BIGSERIAL chegam como Number (não string)
//   - parâmetros '?' traduzidos para $1..$n; booleanos viram 0/1; undefined vira null
const { Client, types } = require('pg');

// int8 (COUNT, BIGSERIAL) e numeric como Number — o app compara com === e soma valores.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

// Traduz '?' para $1..$n, ignorando interrogações dentro de strings SQL.
function traduzirPlaceholders(sql) {
  let out = '', n = 0, aspas = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (aspas) {
      out += c;
      if (c === aspas) aspas = null;
    } else if (c === "'" || c === '"') {
      aspas = c; out += c;
    } else if (c === '?') {
      out += '$' + (++n);
    } else {
      out += c;
    }
  }
  return out;
}

function coerce(p) {
  if (p === undefined) return null;
  if (p === true) return 1;
  if (p === false) return 0;
  return p;
}

class Statement {
  constructor(db, sql) {
    this.db = db;
    let s = traduzirPlaceholders(sql);
    // lastInsertRowid: INSERTs ganham RETURNING * (em ON CONFLICT DO NOTHING, zero linhas = changes 0).
    if (/^\s*insert\b/i.test(s) && !/\breturning\b/i.test(s)) s += ' RETURNING *';
    this.sql = s;
  }
  _q(params) { return this.db._query(this.sql, params.map(coerce)); }
  async run(...params) {
    const r = await this._q(params);
    const linha = r.rows && r.rows[0];
    return {
      changes: r.rowCount || 0,
      lastInsertRowid: linha && linha.id !== undefined && linha.id !== null ? linha.id : undefined,
    };
  }
  async get(...params) {
    const r = await this._q(params);
    return r.rows[0];
  }
  async all(...params) {
    const r = await this._q(params);
    return r.rows;
  }
}

class Db {
  // opts.schema: schema efêmero de teste — dropado no close().
  constructor(client, opts = {}) {
    this.client = client;
    this.schema = opts.schema || null;
    this._fechado = false;
  }
  _query(sql, params) { return this.client.query(sql, params); }
  prepare(sql) { return new Statement(this, sql); }
  // Sem parâmetros o node-postgres usa o protocolo simples: aceita script multi-comando.
  async exec(script) { await this.client.query(script); }
  async close() {
    if (this._fechado) return;
    this._fechado = true;
    if (this.schema) {
      try { await this.client.query(`DROP SCHEMA IF EXISTS ${this.schema} CASCADE`); } catch {}
    }
    await this.client.end();
  }
}

async function conectar(url) {
  // Postgres local (dev/testes) não usa TLS; qualquer outro host (Supabase em
  // produção) exige — sem isso a conexão externa falha logo no connect().
  const local = /@(127\.0\.0\.1|localhost)([:/]|$)/i.test(url);
  const client = new Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

module.exports = { Db, conectar, traduzirPlaceholders };
