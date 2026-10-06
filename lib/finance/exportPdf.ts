/**
 * PDF de um `ReportSpec` (jsPDF, já usado no app). Carregado sob demanda.
 * Paisagem, tabela paginada, cabeçalho com título/base/período/filtros e
 * rodapé com a data de geração e a página.
 */
import { cellText, formatGeneratedAt, type ReportSpec } from './export';
import { formatBRL } from './money';
import { brDate } from './dates';

const MARGIN = 28;

export async function toPdf(spec: ReportSpec): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - MARGIN * 2;

  const weights = spec.columns.map((c) => (c.kind === 'text' ? 3 : c.kind === 'date' ? 1.2 : 1.5));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / totalW) * usable);

  let y = MARGIN;
  const header = () => {
    doc.setFont('helvetica', 'bold').setFontSize(14).text(spec.title, MARGIN, y);
    y += 16;
    doc.setFont('helvetica', 'normal').setFontSize(9);
    doc.text(`Base: ${spec.basis}`, MARGIN, y); y += 12;
    if (spec.period) { doc.text(`Período: ${brDate(spec.period.from)} a ${brDate(spec.period.to)}`, MARGIN, y); y += 12; }
    for (const f of spec.filters) { doc.text(`${f.label}: ${f.value}`, MARGIN, y); y += 12; }
    y += 6;
  };
  const columnsHeader = () => {
    doc.setFont('helvetica', 'bold').setFontSize(9);
    let x = MARGIN;
    spec.columns.forEach((c, i) => {
      doc.text(c.label, c.kind === 'text' ? x : x + widths[i] - 4, y, { align: c.kind === 'text' ? 'left' : 'right' });
      x += widths[i];
    });
    y += 4;
    doc.setLineWidth(0.5).line(MARGIN, y, pageW - MARGIN, y);
    y += 11;
    doc.setFont('helvetica', 'normal');
  };

  header();
  columnsHeader();
  for (const row of spec.rows) {
    if (y > pageH - MARGIN - 30) {
      doc.addPage();
      y = MARGIN;
      columnsHeader();
    }
    let x = MARGIN;
    spec.columns.forEach((c, i) => {
      const raw = cellText(c.kind, row[c.key] ?? null);
      const maxChars = Math.floor(widths[i] / 4.4);
      const text = raw.length > maxChars ? `${raw.slice(0, Math.max(maxChars - 1, 1))}…` : raw;
      doc.text(text, c.kind === 'text' ? x : x + widths[i] - 4, y, { align: c.kind === 'text' ? 'left' : 'right' });
      x += widths[i];
    });
    y += 12;
  }
  if (spec.totals.length > 0) {
    if (y > pageH - MARGIN - 20 - spec.totals.length * 12) { doc.addPage(); y = MARGIN; }
    y += 6;
    doc.setFont('helvetica', 'bold');
    for (const t of spec.totals) { doc.text(`${t.label}: ${formatBRL(t.cents)}`, MARGIN, y); y += 12; }
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p).setFont('helvetica', 'normal').setFontSize(8);
    doc.text(`Gerado em ${formatGeneratedAt(spec.generatedAt)} — Sobral Tênis Clube`, MARGIN, pageH - 14);
    doc.text(`Página ${p} de ${pages}`, pageW - MARGIN, pageH - 14, { align: 'right' });
  }
  return doc.output('blob');
}
