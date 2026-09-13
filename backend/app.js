'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config/env');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---- Seguranca ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-site' }
}));

/**
 * CORS.
 *
 * O frontend e servido pelo proprio Express, entao o caso normal e
 * same-origin. O navegador ainda envia o header Origin em POST/PUT/DELETE,
 * e essa origem pode variar legitimamente: localhost, 127.0.0.1, o IP da
 * maquina na rede local ou o dominio de producao. Por isso a requisicao
 * e liberada quando a origem e a MESMA do host que atendeu a requisicao;
 * origens diferentes precisam estar em CORS_ORIGINS.
 */
function isSameOrigin(origin, req) {
  if (!origin || !req.headers.host) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (error) {
    return false;
  }
}

const corsMiddleware = cors((req, callback) => {
  const origin = req.headers.origin;
  const allowed = !origin                                   // same-origin sem header (GET simples)
    || isSameOrigin(origin, req)                            // mesma origem que serviu a pagina
    || config.corsOrigins.includes('*')
    || config.corsOrigins.includes(origin);

  callback(null, {
    origin: allowed ? (origin || true) : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 86400
  });
});

app.use(corsMiddleware);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ---- Rate limiting ----
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.isTest ? 100000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas requisicoes. Aguarde alguns minutos.', error: 'RATE_LIMITED' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.isTest ? 100000 : 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas tentativas de login. Tente novamente em alguns minutos.', error: 'RATE_LIMITED' }
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// ---- Rotas da API ----
app.use('/api', routes);

// ---- Frontend estatico ----
const frontendDir = path.resolve(config.rootDir, 'frontend');
app.use(express.static(frontendDir, { index: 'index.html', maxAge: config.isProduction ? '1h' : 0 }));

// Fallback do frontend: qualquer rota nao-API entrega o index.
app.get(/^\/(?!api|uploads).*/, (req, res, next) => {
  if (path.extname(req.path)) return next();
  return res.sendFile(path.join(frontendDir, 'index.html'));
});

// ---- Erros ----
app.use('/api', notFoundHandler);
app.use(errorHandler);

module.exports = app;
