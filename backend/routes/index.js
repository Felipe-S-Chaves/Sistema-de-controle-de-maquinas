'use strict';

const express = require('express');

const { authenticate, requirePermission, blockTemporaryPassword } = require('../middlewares/auth');
const { uploadCollectionImages, uploadOwnerDocument } = require('../middlewares/upload');

const authRoutes = require('./authRoutes');
const ownerController = require('../controllers/ownerController');
const machineController = require('../controllers/machineController');
const collectionController = require('../controllers/collectionController');
const dashboardController = require('../controllers/dashboardController');
const reportController = require('../controllers/reportController');
const auditController = require('../controllers/auditController');
const userController = require('../controllers/userController');

const router = express.Router();

// ---- Saude ----
router.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));

// ---- Autenticacao ----
router.use('/auth', authRoutes);

// A partir daqui, tudo exige autenticacao.
router.use(authenticate);

// E quem esta com senha temporaria nao passa daqui ate trocar. As rotas de
// /auth ficam acima, entao a troca de senha continua acessivel.
router.use(blockTemporaryPassword);

// ---- Dashboard e busca global ----
// Painel e busca global sao ferramentas de gestao: o operador nao acessa.
router.get('/dashboard', requirePermission('dashboard.full'), dashboardController.index);
router.get('/search', requirePermission('owners.view'), dashboardController.search);

// ---- Clientes ----
// A listagem e a busca ficam liberadas: o operador precisa delas para
// escolher o cliente ao cadastrar uma maquina ou registrar uma coleta.
router.get('/owners', ownerController.index);
router.get('/owners/search', ownerController.search);
router.post('/owners', requirePermission('owners.create'), uploadOwnerDocument, ownerController.store);
router.get('/owners/:id', ownerController.show);
router.get('/owners/:id/document-photo', ownerController.documentPhoto);
router.put('/owners/:id', requirePermission('owners.update'), uploadOwnerDocument, ownerController.update);
router.patch('/owners/:id/status', requirePermission('owners.update'), ownerController.changeStatus);
router.delete('/owners/:id', requirePermission('owners.delete'), ownerController.destroy);
router.get('/owners/:id/collections', requirePermission('collections.viewAll'), ownerController.collections);
router.get('/owners/:ownerId/machines', machineController.byOwner);

// ---- Maquinas ----
router.get('/machines', machineController.index);
router.post('/machines', requirePermission('machines.create'), machineController.store);
router.get('/machines/:id', machineController.show);
router.put('/machines/:id', requirePermission('machines.update'), machineController.update);
router.patch('/machines/:id/status', requirePermission('machines.update'), machineController.changeStatus);
router.delete('/machines/:id', requirePermission('machines.delete'), machineController.destroy);
router.get('/machines/:id/collections', requirePermission('collections.viewAll'), machineController.history);
router.get('/machines/:machineId/last-reading', collectionController.lastReading);

// ---- Coletas ----
// O operador so enxerga as proprias coletas; o filtro e aplicado no controller.
router.get('/collections', collectionController.index);
router.post('/collections', requirePermission('collections.create'), uploadCollectionImages, collectionController.store);
router.get('/collections/images/:imageId', collectionController.image);
router.get('/collections/:id/receipt', requirePermission('collections.receipt'), collectionController.receipt);
router.get('/collections/:id', collectionController.show);
router.post('/collections/:id/cancel', requirePermission('collections.cancel'), collectionController.cancel);

// ---- Relatorios ----
// "Minhas coletas": disponivel tambem para o operador, restrito ao proprio trabalho.
router.get('/reports/own', requirePermission('reports.own'), reportController.own);
router.get('/reports/own/pdf', requirePermission('reports.own'), reportController.ownPdf);

// Existe um unico relatorio: analitico, filtrado por cliente e por
// maquinas selecionadas na tela.
router.get('/reports/period', requirePermission('reports.view'), reportController.period);
router.get('/reports/pdf', requirePermission('reports.view'), reportController.pdf);

// ---- Usuarios (somente admin) ----
router.get('/users', requirePermission('users.manage'), userController.index);
router.post('/users', requirePermission('users.manage'), userController.store);
router.put('/users/:id', requirePermission('users.manage'), userController.update);
router.delete('/users/:id', requirePermission('users.delete'), userController.destroy);
router.patch('/users/:id/status', requirePermission('users.manage'), userController.changeStatus);
router.post('/users/:id/reset-password', requirePermission('users.manage'), userController.resetPassword);

// ---- Auditoria (somente admin) ----
router.get('/audit-logs', requirePermission('audit.view'), auditController.index);

module.exports = router;
