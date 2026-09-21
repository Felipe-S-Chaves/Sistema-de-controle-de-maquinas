'use strict';

/**
 * Infraestrutura dos testes:
 * - usa um banco separado (music_machines_test) para nao tocar nos dados reais;
 * - recria o schema antes de cada suite;
 * - sobe o servidor Express em uma porta livre;
 * - oferece um cliente HTTP simples.
 */

process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

let server = null;
let baseUrl = '';

async function resetDatabase() {
  const { run: migrate } = require('../backend/database/migrate');
  process.argv.push('--fresh');
  await migrate();
  process.argv = process.argv.filter((a) => a !== '--fresh');

  const { seedAdmin, seedSegundaConta } = require('../backend/database/seed');
  await seedAdmin();

  // A segunda conta nasce com senha temporaria sorteada. Os testes precisam
  // dela, entao o seed e chamado com o console silenciado e a senha e
  // capturada da linha impressa.
  const original = console.log;
  let capturada = null;
  console.log = (...args) => {
    const linha = args.join(' ');
    const m = /Senha temporaria\.: (\S+)/.exec(linha);
    if (m) capturada = m[1];
  };
  try { await seedSegundaConta(); } finally { console.log = original; }
  global.__SENHA_TMP__ = capturada;
}

async function startServer() {
  const app = require('../backend/app');
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve(baseUrl);
    });
  });
}

async function stopServer() {
  const db = require('../backend/config/database');
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
}

/** Cliente HTTP com token opcional. */
function client(token) {
  async function request(method, pathname, { body, formData, raw } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let payload;
    if (formData) {
      payload = formData;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(baseUrl + pathname, { method, headers, body: payload });
    if (raw) return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()), response };

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body: data };
  }

  return {
    get: (p) => request('GET', p),
    post: (p, body) => request('POST', p, { body }),
    put: (p, body) => request('PUT', p, { body }),
    patch: (p, body) => request('PATCH', p, { body }),
    del: (p) => request('DELETE', p),
    upload: (p, formData) => request('POST', p, { formData }),
    uploadPut: (p, formData) => request('PUT', p, { formData }),
    raw: (p) => request('GET', p, { raw: true }),
    withToken: (t) => client(t)
  };
}

/**
 * Recria a segunda conta com uma senha temporaria nova.
 * Usado pelo teste que prova o bloqueio da senha temporaria - ele precisa de
 * uma conta que ainda nao trocou a senha.
 */
async function resetSegundaConta() {
  const db = require('../backend/config/database');
  const config = require('../backend/config/env');
  await db.query('DELETE FROM users WHERE email = ?', [config.admin2.email]);

  const { seedSegundaConta } = require('../backend/database/seed');
  const original = console.log;
  let capturada = null;
  console.log = (...args) => {
    const m = /Senha temporaria\.: (\S+)/.exec(args.join(' '));
    if (m) capturada = m[1];
  };
  try { await seedSegundaConta(); } finally { console.log = original; }

  global.__SENHA_TMP__ = capturada;
  return capturada;
}

async function login(email = 'admin@sistema.local', password = 'Admin@123') {
  const { token } = await loginFull(email, password);
  return token;
}

/** Login devolvendo token E usuario (com as permissoes do papel). */
async function loginFull(email = 'admin@sistema.local', password = 'Admin@123') {
  const result = await client().post('/api/auth/login', { email, password });
  if (!result.body.success) throw new Error('Falha no login de teste: ' + JSON.stringify(result.body));
  return { token: result.body.data.token, user: result.body.data.user };
}

// --------------------------------------------------------------------
// Geracao de uma imagem PNG valida em memoria (evita fixtures binarias).
// --------------------------------------------------------------------
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** PNG RGB valido de w x h. */
function makePng(w = 40, h = 30) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 6) % 256; raw[o + 1] = (y * 8) % 256; raw[o + 2] = 128;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** FormData com uma ou mais imagens validas. */
function collectionForm(fields, imageCount = 1) {
  const form = new FormData();
  Object.keys(fields).forEach((key) => {
    if (fields[key] !== undefined && fields[key] !== null) form.append(key, String(fields[key]));
  });
  for (let i = 0; i < imageCount; i += 1) {
    form.append('images', new Blob([makePng()], { type: 'image/png' }), `relogio-${i + 1}.png`);
  }
  return form;
}

/**
 * FormData do cadastro de cliente.
 * A foto do documento e obrigatoria, entao ela vem junto por padrao.
 */
function ownerForm(fields, comFoto = true) {
  const form = new FormData();
  Object.keys(fields).forEach((key) => {
    if (fields[key] !== undefined && fields[key] !== null) form.append(key, String(fields[key]));
  });
  if (comFoto) {
    form.append('document_photo', new Blob([makePng()], { type: 'image/png' }), 'documento.png');
  }
  return form;
}

/** FormData com um arquivo que so finge ser imagem. */
function fakeImageForm(fields) {
  const form = new FormData();
  Object.keys(fields).forEach((key) => form.append(key, String(fields[key])));
  form.append('images', new Blob([Buffer.from('isto nao e uma imagem')], { type: 'image/png' }), 'falso.png');
  return form;
}

/** Remove os uploads gerados pelos testes. */
function cleanUploads() {
  const dir = require('../backend/config/env').uploads.dir;
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.gitkeep') continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

/** Quantas fotos de coleta existem no disco agora. */
function countUploads() {
  const dir = require('../backend/config/env').uploads.dir;
  if (!fs.existsSync(dir)) return 0;

  let total = 0;
  const andar = (atual) => {
    for (const entry of fs.readdirSync(atual, { withFileTypes: true })) {
      if (entry.name === '.gitkeep') continue;
      const cheio = path.join(atual, entry.name);
      if (entry.isDirectory()) andar(cheio); else total += 1;
    }
  };
  andar(dir);
  return total;
}

module.exports = {
  ROOT, resetDatabase, resetSegundaConta, startServer, stopServer, client, login, loginFull,
  makePng, collectionForm, ownerForm, fakeImageForm, cleanUploads, countUploads,
  get baseUrl() { return baseUrl; }
};
