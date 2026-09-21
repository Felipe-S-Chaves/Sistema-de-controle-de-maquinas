'use strict';

const express = require('express');
const controller = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.post('/login', controller.login);

// Auto-cadastro de operador: rota publica, conta nasce aguardando liberacao.
// A lista de contas tambem e publica - e o que alimenta a escolha no cadastro.
router.get('/accounts', controller.accounts);
router.post('/register', controller.register);
router.post('/logout', authenticate, controller.logout);
router.get('/me', authenticate, controller.me);
router.post('/change-password', authenticate, controller.changePassword);

module.exports = router;
