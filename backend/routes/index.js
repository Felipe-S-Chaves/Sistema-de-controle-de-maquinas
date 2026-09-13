'use strict';

const express = require('express');

const { authenticate, authorize, denyReadOnly } = require('../middlewares/auth');
const { uploadCollectionImages } = require('../middlewares/upload');

const authRoutes = require('./authRoutes');
const ownerController = require('../controllers/ownerController');
const machineController = require('../controllers/machineController');
const collectionController = require('../controllers/collectionController');
const dashboardController = require('../controllers/dashboardController');
const reportController = require('../controllers/reportController');
const auditController = require('../controllers/auditController');

const router = express.Router();

// ---- Saude ----
router.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));

// ---- Autenticacao ----
router.use('/auth', authRoutes);

// A partir daqui, tudo exige autenticacao.
router.use(authenticate);

// ---- Dashboard e busca global ----
router.get('/dashboard', dashboardController.index);
router.get('/search', dashboardController.search);

// ---- Proprietarios ----
router.get('/owners', ownerController.index);
router.get('/owners/search', ownerController.search);
router.post('/owners', denyReadOnly, ownerController.store);
router.get('/owners/:id', ownerController.show);
router.put('/owners/:id', denyReadOnly, ownerController.update);
router.patch('/owners/:id/status', denyReadOnly, ownerController.changeStatus);
router.get('/owners/:id/collections', ownerController.collections);
router.get('/owners/:ownerId/machines', machineController.byOwner);

// ---- Maquinas ----
router.get('/machines', machineController.index);
router.post('/machines', denyReadOnly, machineController.store);
router.get('/machines/:id', machineController.show);
router.put('/machines/:id', denyReadOnly, machineController.update);
router.patch('/machines/:id/status', denyReadOnly, machineController.changeStatus);
router.get('/machines/:id/collections', machineController.history);
router.get('/machines/:machineId/last-reading', collectionController.lastReading);

// ---- Coletas ----
router.get('/collections', collectionController.index);
router.post('/collections', denyReadOnly, uploadCollectionImages, collectionController.store);
router.get('/collections/images/:imageId', collectionController.image);
router.get('/collections/:id', collectionController.show);
router.post('/collections/:id/cancel', denyReadOnly, collectionController.cancel);

// ---- Relatorios ----
router.get('/reports/owners', reportController.owners);
router.get('/reports/machines', reportController.machines);
router.get('/reports/period', reportController.period);
router.get('/reports/pdf', reportController.pdf);

// ---- Auditoria (somente admin) ----
router.get('/audit-logs', authorize('admin'), auditController.index);

module.exports = router;
