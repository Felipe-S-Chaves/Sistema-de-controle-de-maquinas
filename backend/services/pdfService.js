'use strict';

const PDFDocument = require('pdfkit');
const money = require('../utils/money');

const COLORS = {
  text: '#1f2933',
  muted: '#6b7280',
  line: '#d7dce2',
  headerBg: '#1f3a5f',
  headerText: '#ffffff',
  zebra: '#f4f6f9',
  positive: '#166534',
  negative: '#b91c1c'
};

const PAGE_MARGIN = 36;

function formatDate(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDocument(doc, type) {
  if (!doc) return '-';
  if (type === 'cnpj' || doc.length === 14) {
    return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function tituloDoRelatorio(report) {
  if (report.scope === 'own') return 'RELATORIO DAS MINHAS COLETAS';
  return 'RELATORIO DE COLETAS';
}

/**
 * Colunas do relatorio.
 *
 * A ordem conta a historia da coleta da esquerda para a direita: quando foi,
 * em que maquina, como estavam os relogios na coleta anterior, como estao
 * agora e quanto isso deu. O "valor bruto" e o calculated_total_value - o
 * mesmo numero de sempre, com o nome que o sistema passou a usar.
 *
 * A ultima coluna e a metade do valor bruto: quanto cabe a cada uma das duas
 * partes. E uma leitura do relatorio, nao um valor gravado na coleta.
 */
const COLUMNS = [
  { key: 'collected_at', label: 'Data', width: 76, align: 'left', datetime: true },
  { key: 'machine_label', label: 'Maquina', width: 124, align: 'left' },
  { key: 'previous_entry_value', label: 'Ultima entrada', width: 82, align: 'right', money: true },
  { key: 'previous_exit_value', label: 'Ultima saida', width: 78, align: 'right', money: true },
  { key: 'current_entry_value', label: 'Entrada atual', width: 82, align: 'right', money: true },
  { key: 'current_exit_value', label: 'Saida atual', width: 78, align: 'right', money: true },
  { key: 'calculated_total_value', label: 'Valor bruto', width: 84, align: 'right', money: true },
  { key: 'half', label: 'Para cada', width: 80, align: 'right', money: true }
];

/**
 * Gera o PDF do relatorio e devolve um Buffer.
 * Layout profissional: cabecalho, filtros aplicados, tabela zebrada
 * com repeticao de cabecalho a cada pagina, bloco de totais e rodape numerado.
 */
function generateReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: tituloDoRelatorio(report),
        Author: 'Sistema de Controle de Maquinas'
      }
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const columns = COLUMNS;
    const pageWidth = doc.page.width - PAGE_MARGIN * 2;

    drawHeader(doc, report, pageWidth);
    const tableTop = doc.y + 6;
    drawTable(doc, report, columns, pageWidth, tableTop);
    drawTotals(doc, report, pageWidth);
    drawFooters(doc);
    doc.flushPages();

    doc.end();
  });
}

function drawHeader(doc, report, pageWidth) {
  doc.fillColor(COLORS.headerBg).font('Helvetica-Bold').fontSize(15)
    .text('SISTEMA DE CONTROLE DE MAQUINAS', PAGE_MARGIN, PAGE_MARGIN, { width: pageWidth });

  doc.moveDown(0.2);
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11)
    .text(tituloDoRelatorio(report), { width: pageWidth });

  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);

  const lines = [];
  if (report.scope === 'own') {
    lines.push(`Responsavel: ${report.operator || '-'}`);
    lines.push('Contem somente as coletas registradas por este usuario.');
  } else if (report.owner) {
    lines.push(`Cliente: ${report.owner.name}${report.owner.document ? ` (${formatDocument(report.owner.document, report.owner.document_type)})` : ''}`);
  } else {
    lines.push('Cliente: Todos');
  }
  if (report.scope !== 'own') {
    const selecionadas = report.machines || [];
    if (selecionadas.length === 1) {
      lines.push(`Maquina: ${selecionadas[0].number} - ${selecionadas[0].name}`);
    } else if (selecionadas.length) {
      // Lista as escolhidas; alem de oito, so a contagem cabe no cabecalho.
      const rotulos = selecionadas.slice(0, 8).map((m) => `${m.number} - ${m.name}`);
      const resto = selecionadas.length - rotulos.length;
      lines.push(`Maquinas (${selecionadas.length}): ${rotulos.join('; ')}${resto > 0 ? ` e mais ${resto}` : ''}`);
    } else {
      lines.push('Maquinas: Todas');
    }
  }
  lines.push(`Periodo: ${report.from ? formatDate(report.from) : 'inicio'} a ${report.to ? formatDate(report.to) : 'hoje'} (${report.period_label})`);
  lines.push(`Emitido em: ${formatDateTime(new Date())}`);

  for (const line of lines) doc.text(line, { width: pageWidth });

  doc.moveDown(0.4);
  doc.strokeColor(COLORS.line).lineWidth(1)
    .moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + pageWidth, doc.y).stroke();
  doc.moveDown(0.3);
}

function scaleColumns(columns, pageWidth) {
  const total = columns.reduce((sum, c) => sum + c.width, 0);
  const factor = pageWidth / total;
  return columns.map((c) => ({ ...c, width: c.width * factor }));
}

function drawTableHeader(doc, columns, y, pageWidth) {
  doc.rect(PAGE_MARGIN, y, pageWidth, 20).fill(COLORS.headerBg);
  doc.fillColor(COLORS.headerText).font('Helvetica-Bold').fontSize(8);
  let x = PAGE_MARGIN;
  for (const col of columns) {
    doc.text(col.label, x + 4, y + 6, { width: col.width - 8, align: col.align, lineBreak: false });
    x += col.width;
  }
  return y + 20;
}

function cellValue(row, col) {
  // Metade do valor bruto da linha, calculada na hora de imprimir.
  if (col.key === 'half') return money.formatBRL(money.half(row.calculated_total_value));

  if (col.key === 'machine_label') {
    const number = row.machine_number || row.number;
    const name = row.machine_name || row.name;
    return `${number} - ${name}`;
  }
  if (col.key === 'document') return formatDocument(row.document, row.document_type);
  if (col.datetime) return formatDateTime(row[col.key]);
  if (col.money) return money.formatBRL(row[col.key]);
  const value = row[col.key];
  return value === null || value === undefined ? '-' : String(value);
}

function drawTable(doc, report, rawColumns, pageWidth, startY) {
  const columns = scaleColumns(rawColumns, pageWidth);
  const bottomLimit = doc.page.height - PAGE_MARGIN - 40;
  let y = drawTableHeader(doc, columns, startY, pageWidth);

  if (!report.rows.length) {
    doc.fillColor(COLORS.muted).font('Helvetica-Oblique').fontSize(9)
      .text('Nenhuma coleta confirmada no periodo selecionado.', PAGE_MARGIN + 4, y + 8, { width: pageWidth - 8 });
    doc.y = y + 28;
    return;
  }

  doc.font('Helvetica').fontSize(8);
  let zebra = false;

  for (const row of report.rows) {
    if (y + 18 > bottomLimit) {
      doc.addPage();
      y = drawTableHeader(doc, columns, PAGE_MARGIN, pageWidth);
      doc.font('Helvetica').fontSize(8);
      zebra = false;
    }

    if (zebra) doc.rect(PAGE_MARGIN, y, pageWidth, 18).fill(COLORS.zebra);
    zebra = !zebra;

    let x = PAGE_MARGIN;
    for (const col of columns) {
      const value = cellValue(row, col);
      let color = COLORS.text;
      if (col.key === 'calculated_total_value' || col.key === 'half') {
        color = Number(row.calculated_total_value) < 0 ? COLORS.negative : COLORS.positive;
      }
      doc.fillColor(color)
        .text(value, x + 4, y + 5, { width: col.width - 8, align: col.align, lineBreak: false, ellipsis: true });
      x += col.width;
    }

    doc.strokeColor(COLORS.line).lineWidth(0.5)
      .moveTo(PAGE_MARGIN, y + 18).lineTo(PAGE_MARGIN + pageWidth, y + 18).stroke();
    y += 18;
  }

  doc.y = y + 10;
}

function drawTotals(doc, report, pageWidth) {
  const boxHeight = 92;
  if (doc.y + boxHeight > doc.page.height - PAGE_MARGIN - 30) doc.addPage();

  const y = doc.y + 6;
  doc.rect(PAGE_MARGIN, y, pageWidth, boxHeight).fillAndStroke('#f8fafc', COLORS.line);

  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10)
    .text('TOTAIS DO PERIODO', PAGE_MARGIN + 10, y + 8);

  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
  const line = (label, value, offset, bold = false, color = COLORS.text) => {
    doc.font('Helvetica').fillColor(COLORS.muted)
      .text(label, PAGE_MARGIN + 10, y + offset, { width: pageWidth / 2, lineBreak: false });
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color)
      .text(value, PAGE_MARGIN + 10, y + offset, { width: pageWidth - 20, align: 'right', lineBreak: false });
  };

  line('Coletas confirmadas', String(report.totals.collections_count), 26);
  line('TOTAL DE ENTRADAS APURADAS', money.formatBRL(report.totals.total_entry), 38);
  line('TOTAL DE SAIDAS APURADAS', money.formatBRL(report.totals.total_exit), 50);
  line('TOTAL BRUTO', money.formatBRL(report.totals.total_value), 62, true,
    Number(report.totals.total_value) < 0 ? COLORS.negative : COLORS.positive);

  // Separador antes do valor do acerto: e o numero que as duas partes levam.
  doc.strokeColor(COLORS.line).lineWidth(0.5)
    .moveTo(PAGE_MARGIN + 10, y + 76).lineTo(PAGE_MARGIN + pageWidth - 10, y + 76).stroke();

  line('VALOR PARA CADA (metade do total bruto)',
    money.formatBRL(report.totals.total_value_half), 80, true,
    Number(report.totals.total_value_half) < 0 ? COLORS.negative : COLORS.positive);

  doc.y = y + boxHeight + 8;
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);

    // Escrever na faixa da margem inferior sem que o PDFKit crie uma pagina nova.
    const originalBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = doc.page.height - PAGE_MARGIN + 8;
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text(
        `Sistema de Controle de Maquinas  -  Pagina ${i - range.start + 1} de ${range.count}  -  Somente coletas confirmadas entram nos totais.`,
        PAGE_MARGIN, y,
        { width: doc.page.width - PAGE_MARGIN * 2, align: 'center', lineBreak: false }
      );

    doc.page.margins.bottom = originalBottom;
  }
}

/**
 * Comprovante de UMA coleta.
 *
 * E o documento que o operador entrega ao cliente no local: mostra os
 * dois relogios, o calculo aberto passo a passo e quem registrou. Cabe em
 * uma pagina A4 e e legivel impresso ou na tela do celular.
 */
function generateCollectionReceiptPdf(collection) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: `Comprovante de coleta ${collection.id}`,
        Author: 'Sistema de Controle de Maquinas'
      }
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const larguraUtil = doc.page.width - PAGE_MARGIN * 2;
    const cancelada = collection.status === 'cancelled';

    // ---- Cabecalho ----
    doc.fillColor(COLORS.headerBg).font('Helvetica-Bold').fontSize(15)
      .text('SISTEMA DE CONTROLE DE MAQUINAS', PAGE_MARGIN, PAGE_MARGIN, { width: larguraUtil });

    doc.moveDown(0.2);
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(12)
      .text('COMPROVANTE DE COLETA', { width: larguraUtil });

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
      .text(`Numero do comprovante: ${String(collection.id).padStart(6, '0')}`, { width: larguraUtil });

    doc.moveDown(0.5);
    doc.strokeColor(COLORS.line).lineWidth(1)
      .moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + larguraUtil, doc.y).stroke();
    doc.moveDown(0.6);

    if (cancelada) {
      const y = doc.y;
      doc.rect(PAGE_MARGIN, y, larguraUtil, 42).fillAndStroke('#fdecec', COLORS.negative);
      doc.fillColor(COLORS.negative).font('Helvetica-Bold').fontSize(11)
        .text('COLETA CANCELADA', PAGE_MARGIN + 10, y + 8, { width: larguraUtil - 20 });
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.text)
        .text(`Motivo: ${collection.cancellation_reason || '-'}`,
          PAGE_MARGIN + 10, y + 24, { width: larguraUtil - 20, height: 14, ellipsis: true });
      doc.y = y + 50;
    }

    // ---- Identificacao ----
    const linhaInfo = (rotulo, valor) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
        .text(rotulo, PAGE_MARGIN, y, { width: larguraUtil * 0.35, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text)
        .text(valor, PAGE_MARGIN + larguraUtil * 0.35, y,
          { width: larguraUtil * 0.65, lineBreak: false, ellipsis: true });
      doc.y = y + 14;
    };

    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.headerBg)
      .text('IDENTIFICACAO', PAGE_MARGIN, doc.y, { width: larguraUtil });
    doc.moveDown(0.3);

    linhaInfo('Cliente',
      `${collection.owner_name}${collection.owner_document ? `  (${formatDocument(collection.owner_document, collection.owner_document_type)})` : ''}`);
    linhaInfo('Maquina', `${collection.machine_number} - ${collection.machine_name}`);
    linhaInfo('Data e hora da coleta', formatDateTime(collection.collected_at));
    linhaInfo('Registrado por', collection.user_name);

    doc.moveDown(0.6);

    // ---- Leituras dos relogios ----
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.headerBg)
      .text('LEITURA DOS RELOGIOS', PAGE_MARGIN, doc.y, { width: larguraUtil });
    doc.moveDown(0.3);

    const colunas = [
      { label: '', width: larguraUtil * 0.34, align: 'left' },
      { label: 'Leitura anterior', width: larguraUtil * 0.22, align: 'right' },
      { label: 'Leitura atual', width: larguraUtil * 0.22, align: 'right' },
      { label: 'Apurado', width: larguraUtil * 0.22, align: 'right' }
    ];

    let y = doc.y;
    doc.rect(PAGE_MARGIN, y, larguraUtil, 20).fill(COLORS.headerBg);
    doc.fillColor(COLORS.headerText).font('Helvetica-Bold').fontSize(8);
    let x = PAGE_MARGIN;
    colunas.forEach((c) => {
      doc.text(c.label, x + 4, y + 6, { width: c.width - 8, align: c.align, lineBreak: false });
      x += c.width;
    });
    y += 20;

    const linhaRelogio = (nome, anterior, atual, apurado, zebra) => {
      if (zebra) doc.rect(PAGE_MARGIN, y, larguraUtil, 20).fill(COLORS.zebra);
      const valores = [nome, money.formatBRL(anterior), money.formatBRL(atual), money.formatBRL(apurado)];
      let cx = PAGE_MARGIN;
      colunas.forEach((c, i) => {
        doc.font(i === 0 || i === 3 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
          .fillColor(COLORS.text)
          .text(valores[i], cx + 4, y + 6, { width: c.width - 8, align: c.align, lineBreak: false });
        cx += c.width;
      });
      doc.strokeColor(COLORS.line).lineWidth(0.5)
        .moveTo(PAGE_MARGIN, y + 20).lineTo(PAGE_MARGIN + larguraUtil, y + 20).stroke();
      y += 20;
    };

    linhaRelogio('Entrada', collection.previous_entry_value, collection.current_entry_value,
      collection.calculated_entry_value, false);
    linhaRelogio('Saida', collection.previous_exit_value, collection.current_exit_value,
      collection.calculated_exit_value, true);

    doc.y = y + 10;

    // ---- Resultado ----
    const alturaCaixa = 58;
    doc.rect(PAGE_MARGIN, doc.y, larguraUtil, alturaCaixa)
      .fillAndStroke('#f8fafc', COLORS.line);

    const yCaixa = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
      .text('Entrada apurada menos saida apurada', PAGE_MARGIN + 10, yCaixa + 10,
        { width: larguraUtil - 20, lineBreak: false });

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text)
      .text(`${money.formatBRL(collection.calculated_entry_value)}  -  ${money.formatBRL(collection.calculated_exit_value)}`,
        PAGE_MARGIN + 10, yCaixa + 24, { width: larguraUtil - 20, lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text)
      .text('VALOR BRUTO', PAGE_MARGIN + 10, yCaixa + 40, { width: larguraUtil / 2, lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(14)
      .fillColor(cancelada ? COLORS.muted : (Number(collection.calculated_total_value) < 0 ? COLORS.negative : COLORS.positive))
      .text(money.formatBRL(collection.calculated_total_value),
        PAGE_MARGIN + 10, yCaixa + 36, { width: larguraUtil - 20, align: 'right', lineBreak: false });

    doc.y = yCaixa + alturaCaixa + 12;

    // ---- Excecao e observacao ----
    if (collection.is_exception && collection.exception_reason) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.negative)
        .text('EXCECAO DE LEITURA', PAGE_MARGIN, doc.y, { width: larguraUtil });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.text)
        .text(collection.exception_reason, { width: larguraUtil });
      doc.moveDown(0.6);
    }

    if (collection.observation) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.headerBg)
        .text('OBSERVACOES', PAGE_MARGIN, doc.y, { width: larguraUtil });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.text)
        .text(collection.observation, { width: larguraUtil });
      doc.moveDown(0.6);
    }

    const qtdFotos = (collection.images || []).length;
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
      .text(`${qtdFotos} comprovante(s) fotografico(s) arquivado(s) no sistema.`,
        PAGE_MARGIN, doc.y, { width: larguraUtil });

    // ---- Assinaturas ----
    const yAssinatura = Math.max(doc.y + 40, doc.page.height - PAGE_MARGIN - 90);
    const larguraLinha = (larguraUtil - 30) / 2;

    doc.strokeColor(COLORS.muted).lineWidth(0.5)
      .moveTo(PAGE_MARGIN, yAssinatura).lineTo(PAGE_MARGIN + larguraLinha, yAssinatura).stroke()
      .moveTo(PAGE_MARGIN + larguraLinha + 30, yAssinatura)
      .lineTo(PAGE_MARGIN + larguraUtil, yAssinatura).stroke();

    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
      .text('Responsavel pela coleta', PAGE_MARGIN, yAssinatura + 5,
        { width: larguraLinha, align: 'center', lineBreak: false })
      .text('Cliente', PAGE_MARGIN + larguraLinha + 30, yAssinatura + 5,
        { width: larguraLinha, align: 'center', lineBreak: false });

    // Escrever na faixa da margem inferior sem que o PDFKit crie pagina nova.
    const margemOriginal = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text(`Emitido em ${formatDateTime(new Date())}  -  documento gerado pelo sistema`,
        PAGE_MARGIN, doc.page.height - PAGE_MARGIN + 8,
        { width: larguraUtil, align: 'center', lineBreak: false });
    doc.page.margins.bottom = margemOriginal;

    doc.flushPages();
    doc.end();
  });
}

module.exports = { generateReportPdf, generateCollectionReceiptPdf };
