'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';

const config = {
  rootDir: ROOT_DIR,
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: toInt(process.env.PORT, 3000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: toInt(process.env.DB_PORT, 3306),
    user: required('DB_USER', 'root'),
    password: process.env.DB_PASSWORD || '',
    database: nodeEnv === 'test'
      ? (process.env.DB_NAME_TEST || `${process.env.DB_NAME || 'music_machines'}_test`)
      : required('DB_NAME', 'music_machines'),
    connectionLimit: toInt(process.env.DB_CONNECTION_LIMIT, 10),
    timezone: process.env.DB_TIMEZONE || '-03:00'
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  },

  bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 10),

  admin: {
    name: process.env.ADMIN_NAME || 'Administrador',
    email: process.env.ADMIN_EMAIL || 'admin@sistema.local',
    password: process.env.ADMIN_PASSWORD || 'Admin@123',
    accountName: process.env.ACCOUNT_NAME || 'Conta principal'
  },

  // Segunda conta, completamente separada da primeira. A senha nao fica em
  // lugar nenhum: e sorteada na instalacao, mostrada uma vez no terminal e
  // precisa ser trocada no primeiro acesso.
  admin2: {
    name: process.env.ADMIN2_NAME || 'Administrador Megaplay',
    email: process.env.ADMIN2_EMAIL || 'megaplay@gmail.com',
    accountName: process.env.ACCOUNT2_NAME || 'Megaplay'
  },

  uploads: {
    dir: path.isAbsolute(process.env.UPLOAD_DIR || '')
      ? process.env.UPLOAD_DIR
      : path.resolve(ROOT_DIR, process.env.UPLOAD_DIR || 'backend/uploads'),
    maxFileSizeBytes: toInt(process.env.MAX_FILE_SIZE_MB, 8) * 1024 * 1024,
    maxFiles: toInt(process.env.MAX_FILES_PER_COLLECTION, 8),
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']
  },

  timezone: process.env.APP_TIMEZONE || 'America/Sao_Paulo'
};

if (config.isProduction && config.jwt.secret.length < 32) {
  throw new Error('JWT_SECRET deve ter no minimo 32 caracteres em producao.');
}

module.exports = config;
