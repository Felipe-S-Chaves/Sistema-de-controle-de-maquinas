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
  ['/change-password.html', 'trocar senha', true],
  ['/index.html', 'dashboard', true],
  ['/owners.html', 'clientes', true],
  ['/owner-detail.html?id=1', 'detalhe do cliente', true],
  ['/machines.html', 'maquinas', true],
  ['/machine-detail.html?id=1', 'detalhe da maquina', true],
  ['/collections.html', 'coletas', true],
  ['/collection-new.html', 'nova coleta', true],
  ['/collection-detail.html?id=1', 'detalhe da coleta', true],
  ['/reports.html', 'relatorios', true],
  ['/users.html', 'usuarios', true],
  ['/audit.html', 'auditoria', true]
];

const WIDTHS = [320, 390, 414, 768, 1024, 1440, 1920];

let browser = null;
let base = '';
let token = '';
let sessionUser = null;
let fixture = {};

test.before(async () => {
  if (SKIP) return;

  await h.resetDatabase();
  base = await h.startServer();
  h.cleanUploads();

  const sessao = await h.loginFull();
  token = sessao.token;
  sessionUser = sessao.user;
  const admin = h.client(token);

  const owner = await admin.upload('/api/owners', h.ownerForm({
    name: 'João da Silva', document: '11144477735', phone: '11988887777'
  }));
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
  // Grava a sessao exatamente como o login real grava, com as permissoes:
  // sem elas, o frontend esconde os botoes e o teste falha por engano.
  await page.evaluate((t, u) => {
    sessionStorage.setItem('scm_token', t);
    sessionStorage.setItem('scm_user', JSON.stringify(u));
  }, token, sessionUser);
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
  assert.equal(machineCount, 2, 'mostra apenas as maquinas deste cliente');

  await page.select('#machineSelect', String(fixture.machineId));
  await new Promise((r) => setTimeout(r, 900));

  // Passo 3: ultima leitura vem sozinha e nao e editavel
  const lastReading = await page.$eval('#lastReadingBox', (el) => el.innerText);
  assert.match(lastReading, /10\.000,00/, 'entrada anterior exibida');
  assert.match(lastReading, /6\.000,00/, 'saida anterior exibida');
  const previousEditable = await page.$eval('#firstPreviousFields', (el) => !el.classList.contains('d-none'));
  assert.equal(previousEditable, false, 'leitura anterior nao editavel fora da primeira coleta');

  // O campo aceita SO digitos, como o visor da maquina, e os dois ultimos
  // sao os centavos: 1200000 vale R$ 12.000,00.
  await page.type('#currentEntry', '1a2.,b00000');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.$eval('#currentEntry', (el) => el.value), '1200000',
    'letras e pontuacao nao entram no campo');
  // O Intl do navegador usa espaco nao separavel depois do "R$".
  const eco = await page.$eval('[data-echo-for="currentEntry"]',
    (el) => el.innerText.replace(/\u00a0/g, ' ').trim());
  assert.equal(eco, 'R$ 12.000,00', 'o campo mostra em reais o que foi digitado');

  // Valor colado ja formatado cai no mesmo lugar: os separadores somem e
  // sobram exatamente os digitos do visor.
  await page.$eval('#currentEntry', (el) => {
    el.value = 'R$ 12.000,00';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.$eval('#currentEntry', (el) => el.value), '1200000',
    'valor colado do sistema volta para os digitos do visor');

  // Passo 4 e 5: R$ 12.000,00 e R$ 6.500,00 contra R$ 10.000,00 e R$ 6.000,00
  //   apurada 2000,00 ; apurada 500,00 ; bruto 2000 - 500 = 1500,00
  await page.type('#currentExit', '650000');
  await new Promise((r) => setTimeout(r, 500));

  const calc = await page.$eval('#calculationBox', (el) => el.innerText);
  assert.match(calc, /2\.000,00/, 'entrada apurada na tela');
  assert.match(calc, /500,00/, 'saida apurada na tela');
  assert.match(calc, /1\.500,00/, 'valor bruto na tela');
  assert.match(calc, /1200000\s*\u2212\s*1000000/, 'a apuracao aparece em digitos do visor');

  const brutoEditavel = await page.evaluate(() =>
    !!document.querySelector('input[name="calculated_total_value"], input[name="calculated_entry_value"]'));
  assert.equal(brutoEditavel, false, 'usuario nao pode digitar o valor bruto');

  // Passo 6: a foto e opcional - o salvar ja esta liberado sem ela.
  assert.equal(await page.$eval('#btnSaveCollection', (b) => b.disabled), false,
    'a foto deixou de ser obrigatoria');

  const tmpImage = path.join(os.tmpdir(), `relogio-teste-${Date.now()}.png`);
  fs.writeFileSync(tmpImage, h.makePng());
  await (await page.$('#galleryInput')).uploadFile(tmpImage);
  await new Promise((r) => setTimeout(r, 700));

  assert.equal(await page.$$eval('#photoPreview .photo-thumb', (e) => e.length), 1, 'miniatura aparece');

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

  await page.type('#currentEntry', '900000');   // R$ 9.000,00, menor que a ultima (R$ 12.000,00)
  await page.type('#currentExit', '7000');
  await new Promise((r) => setTimeout(r, 500));

  const visible = await page.$eval('#exceptionBox', (el) => !el.classList.contains('d-none'));
  assert.ok(visible, 'alerta de excecao aparece sozinho');

  const tmpImage = path.join(os.tmpdir(), `relogio-exc-${Date.now()}.png`);
  fs.writeFileSync(tmpImage, h.makePng());
  await (await page.$('#galleryInput')).uploadFile(tmpImage);
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

test('fluxo: busca global encontra cliente e maquina', { skip: SKIP && 'Chromium indisponivel' }, async () => {
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
  assert.match(ownerResult, /Cliente/i);
  await page.close();
});

// ====================================================================
// RELATORIO: selecao por clique e as novas colunas
// ====================================================================
test('relatorio: cliente e maquinas sao escolhidos por clique', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(390);
  await page.goto(base + '/reports.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));

  // O filtro de tipo deixou de existir: so ha um relatorio.
  assert.equal(await page.$('#typeSelect'), null, 'o campo de tipo foi removido');
  assert.equal(await page.$('#machineFilter'), null, 'o dropdown de maquinas foi removido');

  // Cliente: um clique basta.
  const clientes = await page.$$('#ownerPick [data-pick]');
  assert.ok(clientes.length >= 2, 'a lista traz "Todos" e os clientes');
  await clientes[1].click();
  await new Promise((r) => setTimeout(r, 900));

  assert.equal(
    await page.$eval('#ownerPick [data-pick]:nth-child(2)', (el) => el.getAttribute('aria-pressed')),
    'true', 'o cliente clicado fica marcado'
  );

  // Maquinas: varias, alternando a cada clique.
  const maquinas = await page.$$('#machinePick [data-pick]');
  assert.ok(maquinas.length >= 2, 'as maquinas do cliente aparecem para clique');

  assert.equal(await page.$eval('#machineCount', (el) => el.innerText), 'Todas',
    'sem selecao, o filtro cobre todas');

  await maquinas[0].click();
  await maquinas[1].click();
  await new Promise((r) => setTimeout(r, 300));
  assert.match(await page.$eval('#machineCount', (el) => el.innerText), /2 selecionada/);

  // Clicar de novo desmarca.
  await maquinas[1].click();
  await new Promise((r) => setTimeout(r, 300));
  assert.match(await page.$eval('#machineCount', (el) => el.innerText), /1 selecionada/);

  // A requisicao leva as maquinas escolhidas.
  const pedido = new Promise((resolve) => {
    page.on('request', (req) => { if (req.url().includes('/api/reports/period')) resolve(req.url()); });
  });

  await page.click('#btnGenerate');
  const url = await pedido;
  assert.match(url, /machine_ids=/, 'a selecao por clique vira machine_ids');

  await new Promise((r) => setTimeout(r, 1500));

  // No celular o cabecalho vira rotulo de cartao (data-label), entao a
  // verificacao das colunas olha o proprio <thead>.
  const colunas = await page.$$eval('#reportContent thead th', (ths) => ths.map((t) => t.textContent.trim()));
  assert.deepEqual(colunas, [
    'Data', 'Maquina', 'Cliente', 'Ultima entrada', 'Ultima saida',
    'Entrada atual', 'Saida atual', 'Valor bruto', 'Para cada', 'Responsavel', ''
  ]);
  assert.equal(colunas.some((c) => /apurad/i.test(c)), false,
    '"apurado" virou "valor bruto" no relatorio');
  assert.equal(colunas.some((c) => /status/i.test(c)), false, 'a coluna de status saiu');

  const tabela = await page.$eval('#reportContent', (el) => el.innerText);
  assert.match(tabela, /001 - M[aá]quina Principal/, 'a maquina aparece com numero e nome');

  const totais = await page.$eval('#reportTotals', (el) => el.innerText);
  assert.ok(totais.includes('Total bruto'), 'o total tambem passou a se chamar bruto');

  assert.deepEqual(page.__errors || [], [], 'sem erros de console');
  await page.close();
});

// ====================================================================
// EXCLUSAO: o botao existe para o administrador e barra o historico
// ====================================================================
test('apagar: o administrador ve o botao e e avisado do historico', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(1280);
  await page.goto(base + '/owners.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1000));

  const botao = await page.$('#ownersList [data-delete]');
  assert.ok(botao, 'o administrador tem o botao de apagar');

  await botao.click();
  await new Promise((r) => setTimeout(r, 700));

  assert.match(await page.$eval('#deletionModal [data-del-title]', (el) => el.innerText), /Apagar cliente/);

  // Confirma: o backend responde 409 porque ha maquinas e coletas.
  await page.click('#deletionModal [data-del-confirm]');
  await new Promise((r) => setTimeout(r, 1500));

  const corpo = await page.$eval('#deletionModal .modal-body', (el) => el.innerText);
  assert.match(corpo, /maquina/i, 'o aviso lista o que seria destruido');
  assert.match(corpo, /coleta/i);

  const ofereceDesativar = await page.$eval('#deletionModal [data-del-deactivate]',
    (el) => !el.classList.contains('d-none'));
  assert.ok(ofereceDesativar, 'desativar e oferecido como alternativa');

  // A saida destrutiva exige digitar APAGAR - clicar direto nao faz nada.
  await page.click('#deletionModal [data-del-confirm]');
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(await page.$eval('#deletionModal', (el) => el.classList.contains('show')),
    'sem digitar APAGAR, o modal continua aberto');

  const admin = h.client(token);
  assert.equal((await admin.get(`/api/owners/${fixture.ownerId}`)).status, 200,
    'nada foi apagado');

  await page.close();
});

test('apagar: o operador nao ve o botao em nenhuma tela', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const admin = h.client(token);
  await admin.post('/api/users', {
    name: 'Operador Sem Botao', email: 'sembotao@teste.local',
    role: 'operator', password: 'Operador@123'
  });

  const sessao = await h.loginFull('sembotao@teste.local', 'Operador@123');

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 860 });
  await page.goto(base + '/login.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((t, u) => {
    sessionStorage.setItem('scm_token', t);
    sessionStorage.setItem('scm_user', JSON.stringify(u));
  }, sessao.token, sessao.user);

  await page.goto(base + '/owners.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(await page.$('#ownersList [data-delete]'), null, 'operador nao apaga cliente');

  await page.goto(base + '/machines.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(await page.$('#machinesList [data-delete]'), null, 'operador nao apaga maquina');

  await page.close();
});

// ====================================================================
// FOTO DO DOCUMENTO DO CLIENTE
// ====================================================================
test('cliente: o cadastro exige a foto do documento', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(390);
  await page.goto(base + '/owners.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  await page.click('#btnNewOwner');
  await new Promise((r) => setTimeout(r, 600));

  // O campo aparece marcado como obrigatorio.
  assert.equal(
    await page.$eval('#docPhotoRequired', (el) => !el.classList.contains('d-none')),
    true, 'a foto e obrigatoria no cadastro'
  );

  await page.type('#ownerName', 'Cliente Sem Documento');
  await page.click('#btnSaveOwner');
  await new Promise((r) => setTimeout(r, 800));

  const erro = await page.$eval('[data-error-for="document_photo"]', (el) => el.innerText.trim());
  assert.match(erro, /foto do documento/i, 'o formulario barra antes de enviar');

  // Com a foto, o cadastro conclui.
  const tmp = path.join(os.tmpdir(), `documento-${Date.now()}.png`);
  fs.writeFileSync(tmp, h.makePng());
  await (await page.$('#ownerDocGallery')).uploadFile(tmp);
  await new Promise((r) => setTimeout(r, 1800));

  assert.ok(await page.$('#docPhotoPreview img'), 'a miniatura do documento aparece');

  await page.click('#btnSaveOwner');
  await new Promise((r) => setTimeout(r, 2500));

  assert.equal(await page.$eval('#ownerModal', (el) => el.classList.contains('show')), false,
    'o modal fecha depois de salvar');

  const lista = await page.$eval('#ownersList', (el) => el.innerText);
  assert.match(lista, /Cliente Sem Documento/, 'o cliente foi cadastrado');

  fs.unlinkSync(tmp);
  assert.deepEqual(page.__errors || [], [], 'sem erros de console');
  await page.close();
});

test('cliente: a tela inteira fala em cliente, nunca em proprietario', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(1280);

  for (const caminho of ['/owners.html', '/machines.html', '/collection-new.html', '/reports.html']) {
    await page.goto(base + caminho, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 900));

    const texto = await page.evaluate(() => document.body.innerText);
    assert.equal(/propriet[aá]ri/i.test(texto), false, `${caminho} ainda fala em proprietario`);
  }

  await page.close();
});

// ====================================================================
// SENHA TEMPORARIA NA INTERFACE
// ====================================================================
test('senha temporaria leva para a tela de troca e libera o sistema', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const temporaria = await h.resetSegundaConta();

  const page = await browser.newPage();
  page.on('pageerror', (e) => { page.__errors = (page.__errors || []).concat(e.message); });
  await page.setViewport({ width: 390, height: 860 });

  await page.goto(base + '/login.html', { waitUntil: 'networkidle0' });
  await page.type('#email', 'megaplay@gmail.com');
  await page.type('#password', temporaria);
  await page.click('#btnLogin');

  assert.ok(await waitForUrl(page, 'change-password.html'), 'vai direto para a troca de senha');
  assert.equal(
    await page.$eval('#avisoObrigatorio', (el) => !el.classList.contains('d-none')),
    true, 'o aviso explica por que a troca e obrigatoria'
  );

  await page.type('#senhaAtual', temporaria);
  await page.type('#senhaNova', 'Megaplay@2026');
  await page.type('#senhaConfirma', 'Megaplay@2026');
  await page.click('#btnSalvar');

  assert.ok(await waitForUrl(page, 'index.html'), 'depois da troca, entra no sistema');

  // E a conta nova comeca vazia: nada da outra conta aparece.
  await new Promise((r) => setTimeout(r, 1200));
  const painel = await page.$eval('#appMain', (el) => el.innerText);
  assert.equal(/Jo[aã]o da Silva/.test(painel), false, 'nao ve os dados da outra conta');

  await page.close();
});

test('cadastro pela tela de login pede a conta', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 860 });
  await page.goto(base + '/login.html', { waitUntil: 'networkidle0' });

  await page.click('#btnShowRegister');
  await new Promise((r) => setTimeout(r, 1200));

  const opcoes = await page.$$eval('#regAccount option', (os) => os.map((o) => o.textContent.trim()));
  assert.ok(opcoes.length >= 3, 'lista as duas contas alem do placeholder');
  assert.ok(opcoes.some((o) => /Megaplay/i.test(o)), 'a conta Megaplay aparece na escolha');

  await page.close();
});

test('cliente: a ficha mostra a foto do documento', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const admin = h.client(token);

  const comFoto = await admin.upload('/api/owners', h.ownerForm({
    name: 'Cliente Com Documento', document: '39053344705'
  }));
  assert.equal(comFoto.status, 201);

  const page = await authedPage(1280);
  await page.goto(base + `/owner-detail.html?id=${comFoto.body.data.id}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1800));

  const ficha = await page.$eval('#ownerContent', (el) => el.innerText);
  assert.match(ficha, /Documento do cliente/, 'a ficha tem o bloco do documento');
  assert.match(ficha, /documento\.png/, 'mostra o nome do arquivo');

  // A imagem carrega de verdade, nao fica um <img> quebrado.
  const miniatura = await page.$eval('#documentPhoto', (el) => el.naturalWidth);
  assert.ok(miniatura > 0, 'a miniatura do documento carregou');

  // E abre em tamanho maior sem quebrar - o endereco do blob continua valido.
  await page.click('#btnOpenDocument');
  await new Promise((r) => setTimeout(r, 1200));
  const ampliada = await page.$eval('[data-document-image]', (el) => el.naturalWidth);
  assert.ok(ampliada > 0, 'a imagem do modal carregou');

  assert.deepEqual(page.__errors || [], [], 'sem erros de console');
  await page.close();
});

test('cliente antigo sem foto mostra um aviso, nao um erro', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  // Cadastrado direto no banco, como os que existiam antes da exigencia.
  const db = require('../backend/config/database');
  const resultado = await db.query(
    `INSERT INTO owners (account_id, name, document, document_type, status, created_by)
     VALUES (?, 'Cliente Sem Documento Antigo', '15350946056', 'cpf', 'active', ?)`,
    [sessionUser.account_id, sessionUser.id]
  );

  const page = await authedPage(390);
  await page.goto(base + `/owner-detail.html?id=${resultado.insertId}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));

  const ficha = await page.$eval('#ownerContent', (el) => el.innerText);
  assert.match(ficha, /nao tem foto de documento/i);
  assert.equal(await page.$('#documentPhoto'), null, 'nao tenta carregar imagem nenhuma');

  assert.deepEqual(page.__errors || [], [], 'sem erros de console');
  await page.close();
});

test('relatorio: mostra quanto vai para cada parte', { skip: SKIP && 'Chromium indisponivel' }, async () => {
  const page = await authedPage(1440);
  await page.goto(base + '/reports.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));

  await page.click('#btnGenerate');
  await new Promise((r) => setTimeout(r, 1800));

  const totais = await page.$eval('#reportTotals', (el) => el.innerText.replace(/ /g, ' '));
  assert.match(totais, /Valor para cada/, 'o fechamento mostra o valor de cada parte');
  assert.match(totais, /metade do total bruto/, 'e explica de onde o numero sai');

  // O numero e mesmo a metade do total bruto.
  const numeros = await page.evaluate(() => {
    const ler = (marcador) => {
      const el = document.querySelector('[data-total="' + marcador + '"]');
      if (!el) return null;
      const limpo = el.innerText.replace(/[^0-9,.-]/g, '');
      return Number(limpo.replace(/\./g, '').replace(',', '.'));
    };
    return { bruto: ler('bruto'), cada: ler('cada') };
  });

  assert.ok(numeros.bruto !== null && numeros.cada !== null, 'os dois valores aparecem');
  assert.ok(numeros.bruto > 0, 'o cenario precisa de um total bruto');
  assert.equal(Math.round(numeros.cada * 100), Math.round(Math.round(numeros.bruto * 100) / 2),
    'o valor para cada e exatamente a metade do total bruto');

  assert.deepEqual(page.__errors || [], [], 'sem erros de console');
  await page.close();
});
