'use strict';

/**
 * Testes de interface com navegador real (Chromium headless).
 * Cobrem o fluxo de coleta em viewport de celular e a responsividade
 * de todas as telas, incluindo a ausencia de rolagem horizontal.
 *
 * Sao ignorados automaticamente quando o Chromium nao esta disponivel.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const h = require('./helpers');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

function findChrome() {
  return CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (e) { /* opcional */ }

const chromePath = findChrome();
const SKIP = !puppeteer || !chromePath;

const PAGES = [
  ['/login.html', 'login', false],
  ['/index.html', 'dashboard', true],
  ['/owners.html', 'proprietarios', true],
  ['/owner-detail.html?id=1', 'detalhe do proprietario', true],
  ['/machines.html', 'maquinas', true],
  ['/machine-detail.html?id=1', 'detalhe da maquina', true],
  ['/collections.html', 'coletas', true],
  ['/collection-new.html', 'nova coleta', true],
  ['/collection-detail.html?id=1', 'detalhe da coleta', true],
  ['/reports.html', 'relatorios', true],
  ['/audit.html', 'auditoria', true]
];

const WIDTHS = [320, 390, 414, 768, 1024, 1440, 1920];

let browser = null;
let base = '';
let token = '';
let fixture = {};

test.before(async () => {
  if (SKIP) return;

  await h.resetDatabase();
  base = await h.startServer();
  h.cleanUploads();

  token = await h.login();
  const admin = h.client(token);

  const owner = await admin.post('/api/owners', {
    name: 'João da Silva', document: '11144477735', phone: '11988887777'
  });
  const machine = await admin.post('/api/machines', {
    number: '001', name: 'Máquina Principal', owner_id: owner.body.data.id
  });
  await admin.post('/api/machines', {
    number: '002', name: 'Máquina Salão', owner_id: owner.body.data.id, status: 'maintenance'
  });

  await admin.upload('/api/collections', h.collectionForm({
    machine_id: machine.body.data.id,
    previous_entry_value: '7200', previous_exit_value: '5100',
    current_entry_value: '10000', current_exit_value: '6000',
    observation: 'Coleta inicial da fixture.'
  }));

  fixture = { ownerId: owner.body.data.id, machineId: machine.body.data.id };

  browser = await puppeteer.launch({
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    headless: 'new'
  });
});

test.after(async () => {
  if (browser) await browser.close();
  if (!SKIP) { h.cleanUploads(); await h.stopServer(); }
});

/** Nova aba ja autenticada. */
async function authedPage(width = 390) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { page.__errors = (page.__errors || []).concat(e.message); });
  page.on('console', (m) => {
    if (m.type() === 'error') page.__errors = (page.__errors || []).concat(m.text());
  });
  await page.setViewport({ width, height: 860 });
  await page.goto(base + '/login.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    sessionStorage.setItem('scm_token', t);
    sessionStorage.setItem('scm_user', JSON.stringify({ name: 'Administrador', email: 'admin@sistema.local', role: 'admin' }));
  }, token);
  return page;
}

async function waitForUrl(page, fragment, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (page.url().includes(fragment)) { await new Promise((r) => setTimeout(r, 900)); return true; }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ====================================================================
// RESPONSIVIDADE
// ====================================================================
test('responsividade: nenhuma tela cria rolagem horizontal', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const failures = [];

  for (const [pathname, label, needsAuth] of PAGES) {
    for (const width of WIDTHS) {
      const page = needsAuth ? await authedPage(width) : await browser.newPage();
      if (!needsAuth) await page.setViewport({ width, height: 860 });

      const target = pathname.replace('id=1', `id=${pathname.includes('collection-detail') ? 1 : (pathname.includes('machine') ? fixture.machineId : fixture.ownerId)}`);
      await page.goto(base + target, { waitUntil: 'networkidle0' });
      await new Promise((r) => setTimeout(r, 700));

      const result = await page.evaluate(() => {
        const docW = document.documentElement.scrollWidth;
        const winW = window.innerWidth;
        const offenders = [];
        if (docW > winW + 1) {
          document.querySelectorAll('body *').forEach((el) => {
            if (getComputedStyle(el).position === 'fixed') return;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > winW + 1) {
              offenders.push(`${el.tagName}.${(el.className || '').toString().trim().split(/\s+/)[0]}`);
            }
          });
        }
        return { docW, winW, bad: docW > winW + 1, offenders: offenders.slice(0, 3) };
      });

      if (result.bad) {
        failures.push(`${label} @${width}px: documento ${result.docW}px > viewport ${result.winW}px ${JSON.stringify(result.offenders)}`);
      }
      await page.close();
    }
  }

  assert.deepEqual(failures, [], `Rolagem horizontal detectada:\n${failures.join('\n')}`);
});

test('responsividade: tabelas viram cartoes no celular', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(390);
  await page.goto(base + '/collections.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  const layout = await page.evaluate(() => {
    const head = document.querySelector('.table-responsive-cards thead');
    const cell = document.querySelector('.table-responsive-cards tbody td');
    return {
      headHidden: head ? getComputedStyle(head).display === 'none' : null,
      cellBlock: cell ? getComputedStyle(cell).display : null,
      hasLabel: cell ? cell.getAttribute('data-label') : null
    };
  });

  assert.equal(layout.headHidden, true, 'cabecalho da tabela some no celular');
  assert.equal(layout.cellBlock, 'flex', 'cada celula vira uma linha rotulada');
  assert.ok(layout.hasLabel, 'celula carrega o rotulo da coluna');
  await page.close();
});

test('responsividade: menu lateral vira gaveta no celular', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(390);
  await page.goto(base + '/index.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));

  const closed = await page.$eval('#appSidebar', (el) => el.getBoundingClientRect().right <= 1);
  assert.ok(closed, 'menu comeca escondido fora da tela');

  await page.click('#btnToggleSidebar');
  await new Promise((r) => setTimeout(r, 500));
  const opened = await page.$eval('#appSidebar', (el) => el.getBoundingClientRect().right > 100);
  assert.ok(opened, 'menu abre ao tocar no botao');
  await page.close();
});

test('responsividade: campos tem area de toque adequada', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(390);
  await page.goto(base + '/collection-new.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));

  const small = await page.evaluate(() => {
    const out = [];
    const MIN = 44;
    document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea, button').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      // O campo de busca do cabecalho e auxiliar e nao faz parte do fluxo de coleta.
      if (el.closest('.app-topbar') && el.tagName === 'INPUT') return;
      if (r.height < MIN - 0.5 || (el.tagName === 'BUTTON' && r.width < MIN - 0.5 && !el.textContent.trim())) {
        out.push(`${el.tagName}#${el.id || el.className}: ${Math.round(r.height)}x${Math.round(r.width)}px`);
      }
    });
    return out;
  });

  assert.deepEqual(small, [], `Elementos com area de toque menor que 44px: ${small.join(', ')}`);
  await page.close();
});

// ====================================================================
// FLUXO DE COLETA NO CELULAR
// ====================================================================
test('fluxo: login pela interface rejeita senha errada e aceita a correta', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(base + '/login.html', { waitUntil: 'networkidle0' });

  await page.type('#email', 'admin@sistema.local');
  await page.type('#password', 'senha-errada');
  await page.click('#btnLogin');
  await new Promise((r) => setTimeout(r, 1500));

  const errorShown = await page.$eval('#loginAlert', (el) => !el.classList.contains('d-none'));
  assert.ok(errorShown, 'mensagem de erro visivel');
  assert.ok(page.url().includes('/login.html'), 'permanece no login');

  await page.$eval('#password', (el) => { el.value = ''; });
  await page.type('#password', 'Admin@123');
  await page.click('#btnLogin');
  assert.ok(await waitForUrl(page, '/index.html'), 'entra no dashboard');
  await page.close();
});

test('fluxo: coleta completa no celular calcula e salva corretamente', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(390);
  await page.goto(base + '/collection-new.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  assert.ok(await page.$eval('#btnSaveCollection', (b) => b.disabled), 'salvar comeca bloqueado');

  // Passo 1 e 2
  await page.select('#ownerSelect', String(fixture.ownerId));
  await new Promise((r) => setTimeout(r, 900));
  const machineCount = await page.$$eval('#machineSelect option', (o) => o.length - 1);
  assert.equal(machineCount, 2, 'mostra apenas as maquinas deste proprietario');

  await page.select('#machineSelect', String(fixture.machineId));
  await new Promise((r) => setTimeout(r, 900));

  // Passo 3: ultima leitura vem sozinha e nao e editavel
  const lastReading = await page.$eval('#lastReadingBox', (el) => el.innerText);
  assert.match(lastReading, /10\.000,00/, 'entrada anterior exibida');
  assert.match(lastReading, /6\.000,00/, 'saida anterior exibida');
  const previousEditable = await page.$eval('#firstPreviousFields', (el) => !el.classList.contains('d-none'));
  assert.equal(previousEditable, false, 'leitura anterior nao editavel fora da primeira coleta');

  // Passo 4 e 5: 12000-10000=2000 ; 6500-6000=500 ; apurado 1500
  await page.type('#currentEntry', '12000');
  await page.type('#currentExit', '6500');
  await new Promise((r) => setTimeout(r, 500));

  const calc = await page.$eval('#calculationBox', (el) => el.innerText);
  assert.match(calc, /2\.000,00/, 'entrada apurada na tela');
  assert.match(calc, /500,00/, 'saida apurada na tela');
  assert.match(calc, /1\.500,00/, 'valor apurado na tela');

  const apuradoEditavel = await page.evaluate(() =>
    !!document.querySelector('input[name="calculated_total_value"], input[name="calculated_entry_value"]'));
  assert.equal(apuradoEditavel, false, 'usuario nao pode digitar o valor apurado');

  // Passo 6: foto obrigatoria
  assert.ok(await page.$eval('#btnSaveCollection', (b) => b.disabled), 'salvar bloqueado sem foto');

  const tmpImage = path.join(os.tmpdir(), `relogio-teste-${Date.now()}.png`);
  fs.writeFileSync(tmpImage, h.makePng());
  await (await page.$('#photoInput')).uploadFile(tmpImage);
  await new Promise((r) => setTimeout(r, 700));

  assert.equal(await page.$$eval('#photoPreview .photo-thumb', (e) => e.length), 1, 'miniatura aparece');
  assert.equal(await page.$eval('#btnSaveCollection', (b) => b.disabled), false, 'salvar liberado com foto');

  await page.type('#observation', 'Coleta realizada normalmente.');
  await page.click('#btnSaveCollection');
  assert.ok(await waitForUrl(page, 'collection-detail.html'), 'vai para o detalhe apos salvar');

  const detail = await page.$eval('#collectionContent', (el) => el.innerText);
  assert.match(detail, /1\.500,00/, 'detalhe mostra o valor gravado pelo backend');
  assert.match(detail, /Confirmada/, 'status confirmada');
  assert.match(detail, /Coleta realizada normalmente/, 'observacao gravada');

  await new Promise((r) => setTimeout(r, 1300));
  const imgOk = await page.$$eval('#imageGallery img', (e) => e.length === 1 && e[0].naturalWidth > 0);
  assert.ok(imgOk, 'comprovante carrega na galeria');

  fs.unlinkSync(tmpImage);
  assert.deepEqual(page.__errors || [], [], 'sem erros de console durante o fluxo');
  await page.close();
});

test('fluxo: leitura menor que a anterior exige confirmar excecao com motivo', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(390);
  await page.goto(base + '/collection-new.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));

  await page.select('#ownerSelect', String(fixture.ownerId));
  await new Promise((r) => setTimeout(r, 800));
  await page.select('#machineSelect', String(fixture.machineId));
  await new Promise((r) => setTimeout(r, 900));

  await page.type('#currentEntry', '9000');   // menor que a ultima (12000)
  await page.type('#currentExit', '7000');
  await new Promise((r) => setTimeout(r, 500));

  const visible = await page.$eval('#exceptionBox', (el) => !el.classList.contains('d-none'));
  assert.ok(visible, 'alerta de excecao aparece sozinho');

  const tmpImage = path.join(os.tmpdir(), `relogio-exc-${Date.now()}.png`);
  fs.writeFileSync(tmpImage, h.makePng());
  await (await page.$('#photoInput')).uploadFile(tmpImage);
  await new Promise((r) => setTimeout(r, 600));

  assert.ok(await page.$eval('#btnSaveCollection', (b) => b.disabled),
    'mesmo com foto, sem confirmar a excecao o salvar continua bloqueado');

  await page.click('#confirmException');
  await page.type('#exceptionReason', 'curto');
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(await page.$eval('#btnSaveCollection', (b) => b.disabled), 'motivo curto nao libera');

  await page.type('#exceptionReason', ' - contador reiniciado pelo tecnico.');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await page.$eval('#btnSaveCollection', (b) => b.disabled), false, 'motivo completo libera');

  fs.unlinkSync(tmpImage);
  await page.close();
});

test('fluxo: cancelamento exige motivo e mantem a coleta no historico', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const admin = h.client(token);
  const list = await admin.get(`/api/machines/${fixture.machineId}/collections`);
  const latest = list.body.data[0];

  const page = await authedPage(1280);
  await page.goto(`${base}/collection-detail.html?id=${latest.id}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  await page.click('#btnCancelCollection');
  await new Promise((r) => setTimeout(r, 700));

  await page.click('[data-confirm-ok]');
  await new Promise((r) => setTimeout(r, 600));
  const reasonError = await page.$eval('[data-confirm-reason-error]', (el) => el.textContent.trim());
  assert.ok(reasonError.length > 0, 'motivo e obrigatorio no modal');

  await page.type('[data-confirm-reason]', 'Leitura registrada por engano durante o teste.');
  await page.click('[data-confirm-ok]');
  await new Promise((r) => setTimeout(r, 2000));

  const detail = await page.$eval('#collectionContent', (el) => el.innerText);
  assert.match(detail, /Cancelada/, 'status passa a cancelada');
  assert.match(detail, /engano durante o teste/, 'motivo exibido');

  const still = await admin.get(`/api/collections/${latest.id}`);
  assert.equal(still.status, 200, 'registro continua existindo');
  await page.close();
});

test('fluxo: busca global encontra proprietario e maquina', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(1280);
  await page.goto(base + '/index.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));

  await page.type('#globalSearchInput', '001');
  await new Promise((r) => setTimeout(r, 1200));
  const machineResult = await page.$eval('#globalSearchResults', (el) => el.innerText);
  assert.match(machineResult, /Maquina/i);
  assert.match(machineResult, /001/);

  await page.$eval('#globalSearchInput', (el) => { el.value = ''; });
  await page.type('#globalSearchInput', 'Jo');
  await new Promise((r) => setTimeout(r, 1200));
  const ownerResult = await page.$eval('#globalSearchResults', (el) => el.innerText);
  assert.match(ownerResult, /Proprietario/i);
  await page.close();
});
