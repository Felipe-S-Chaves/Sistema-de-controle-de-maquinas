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

const TITLES = {
  owners: 'RELATORIO POR PROPRIETARIO',
  machines: 'RELATORIO POR MAQUINA',
  period: 'RELATORIO DE COLETAS POR PERIODO'
};

const COLUMNS = {
  owners: [
    { key: 'name', label: 'Proprietario', width: 150, align: 'left' },
    { key: 'document', label: 'CPF/CNPJ', width: 100, align: 'left' },
    { key: 'machines_total', label: 'Maq.', width: 40, align: 'right' },
    { key: 'collections_count', label: 'Coletas', width: 50, align: 'right' },
    { key: 'total_entry', label: 'Entrada apurada', width: 90, align: 'right', money: true },
    { key: 'total_exit', label: 'Saida apurada', width: 85, align: 'right', money: true },
    { key: 'total_value', label: 'Apurado', width: 90, align: 'right', money: true }
  ],
  machines: [
    { key: 'machine_label', label: 'Maquina', width: 140, align: 'left' },
    { key: 'owner_name', label: 'Proprietario', width: 125, align: 'left' },
    { key: 'collections_count', label: 'Coletas', width: 50, align: 'right' },
    { key: 'total_entry', label: 'Entrada apurada', width: 90, align: 'right', money: true },
    { key: 'total_exit', label: 'Saida apurada', width: 85, align: 'right', money: true },
    { key: 'total_value', label: 'Apurado', width: 90, align: 'right', money: true }
  ],
  period: [
    { key: 'collected_at', label: 'Data', width: 78, align: 'left', datetime: true },
    { key: 'machine_label', label: 'Maquina', width: 118, align: 'left' },
    { key: 'current_entry_value', label: 'Entrada', width: 78, align: 'right', money: true },
    { key: 'current_exit_value', label: 'Saida', width: 78, align: 'right', money: true },
    { key: 'calculated_entry_value', label: 'Entr. apurada', width: 82, align: 'right', money: true },
    { key: 'calculated_exit_value', label: 'Said. apurada', width: 82, align: 'right', money: true },
    { key: 'calculated_total_value', label: 'Apurado', width: 84, align: 'right', money: true }
  ]
};

/**
 * Gera o PDF do relatorio e devolve um Buffer.
 * Layout profissional: cabecalho, filtros aplicados, tabela zebrada
 * com repeticao de cabecalho a cada pagina, bloco de totais e rodape numerado.
 */
function generateReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: report.type === 'period' ? 'landscape' : 'portrait',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: TITLES[report.type] || 'Relatorio',
        Author: 'Sistema de Controle de Maquinas'
      }
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const columns = COLUMNS[report.type] || COLUMNS.period;
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
    .text(TITLES[report.type] || 'RELATORIO', { width: pageWidth });

  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);

  const lines = [];
  if (report.owner) {
    lines.push(`Proprietario: ${report.owner.name}${report.owner.document ? ` (${formatDocument(report.owner.document, report.owner.document_type)})` : ''}`);
  } else {
    lines.push('Proprietario: Todos');
  }
  if (report.machine) {
    lines.push(`Maquina: ${report.machine.number} - ${report.machine.name}`);
  } else if (report.type !== 'owners') {
    lines.push('Maquina: Todas');
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
      if (col.key === 'total_value' || col.key === 'calculated_total_value') {
        color = Number(row[col.key]) < 0 ? COLORS.negative : COLORS.positive;
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
  const boxHeight = 74;
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
  line('TOTAL DE ENTRADAS (apurado)', money.formatBRL(report.totals.total_entry), 38);
  line('TOTAL DE SAIDAS (apurado)', money.formatBRL(report.totals.total_exit), 50);
  line('TOTAL APURADO', money.formatBRL(report.totals.total_value), 62, true,
    Number(report.totals.total_value) < 0 ? COLORS.negative : COLORS.positive);

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

module.exports = { generateReportPdf };
