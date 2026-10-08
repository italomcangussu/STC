// Arquivos que o João entrega ao administrador no privado (relatório em PDF e documentos que o sistema já guarda).
// O PDF sai dos MESMOS dados da consulta (`conv_svc_ai_admin_read`): nenhum número é calculado de novo nem passa pelo modelo.
import { arr, brl, LINE_LABEL, n, periodo, renderAdminRead, sumLines, type AdminReadDomain } from './adminReads.ts';

export const FILE_KINDS = ['relatorio_pdf', 'comprovante', 'despesa_anexo', 'documento'] as const;
export type FileKind = typeof FILE_KINDS[number];
export const isFileKind = (v: unknown): v is FileKind => FILE_KINDS.includes(v as FileKind);

export type PdfTable = { heading?: string; columns: { label: string; right?: boolean }[]; rows: string[][]; boldLast?: boolean };
export type PdfDoc = { title: string; subtitle?: string; tables: PdfTable[]; paragraphs: string[]; footer: string };

/** Quem gera o PDF e entrega o arquivo ao WhatsApp. Injetado pela borda (a lógica do turno não depende de rede nem de biblioteca). */
export type FileKit = {
  pdf: (doc: PdfDoc) => Promise<Uint8Array>;
  /** Copia o arquivo para o armazenamento de mídia da conversa e devolve o caminho (`out/<uuid>/<nome>`); nulo se falhar. */
  stage: (source: { bucket: string; path: string } | { bytes: Uint8Array }, name: string, mime: string) => Promise<string | null>;
  signedUrl: (path: string) => Promise<string | null>;
};

type Row = Record<string, unknown>;
const signed = (v: number) => `${v < 0 ? '-' : ''}${brl(Math.abs(v))}`;
const pct = (cur: number, prev: number) => (prev === 0 ? '—' : `${(((cur - prev) / Math.abs(prev)) * 100).toFixed(1).replace('.', ',')}%`);

export const DOMAIN_TITLE: Partial<Record<AdminReadDomain, string>> = {
  caixa: 'Caixa', receber_pagar: 'A receber e a pagar', dre: 'DRE — Demonstração do Resultado', receita_alunos: 'Receita de alunos',
  comprovantes: 'Comprovantes aguardando análise', acessos: 'Pedidos de acesso', assinaturas: 'Assinaturas', ocupacao: 'Ocupação das quadras',
  comparativo: 'Comparativo de períodos', followups: 'Retornos', preferencias: 'Preferências', socios: 'Relação de sócios', inadimplentes: 'Inadimplentes', pagamentos: 'Pagamentos recebidos', socio_ficha: 'Ficha do sócio', vencimentos: 'Vencimentos', alunos: 'Alunos', movimentos: 'Últimos lançamentos', capacidades: 'O que o João faz', memoria: 'Memória do João',
};

export function reportDoc(domain: AdminReadDomain, data: unknown, generatedAt: string): PdfDoc {
  const d = (data && typeof data === 'object' ? data : {}) as Row;
  const title = DOMAIN_TITLE[domain] ?? 'Relatório';
  const base = { title: `STC — ${title}`, subtitle: d.from && d.to ? `Período: ${periodo(d)}` : undefined, footer: `Gerado em ${generatedAt} pelo João (assistente do STC)` };
  if (domain === 'dre') {
    const cur = sumLines(arr(d.by_line)); const prev = sumLines(arr(d.previous_by_line));
    const byLine = (rows: Row[], l: string) => n(rows.find((r) => r.line === l)?.amount_cents);
    const keys = Object.keys(LINE_LABEL).filter((l) => byLine(arr(d.by_line), l) || byLine(arr(d.previous_by_line), l));
    const rows = keys.map((l) => {
      const a = byLine(arr(d.by_line), l); const p = byLine(arr(d.previous_by_line), l);
      const neg = l !== 'revenue';
      return [LINE_LABEL[l], signed(neg ? -a : a), signed(neg ? -p : p), pct(a, p)];
    });
    rows.push(['Resultado', signed(cur.resultado), signed(prev.resultado), pct(cur.resultado, prev.resultado)]);
    const tables: PdfTable[] = [{ heading: 'Resultado por grupo (competência)', columns: [{ label: 'Linha' }, { label: 'Período atual', right: true }, { label: 'Período anterior', right: true }, { label: 'Variação', right: true }], rows, boldLast: true }];
    const top = arr(d.top).slice(0, 12);
    if (top.length) tables.push({ heading: 'Maiores categorias', columns: [{ label: 'Categoria' }, { label: 'Valor', right: true }], rows: top.map((t) => [String(t.name ?? ''), brl(t.amount_cents)]) });
    return { ...base, tables, paragraphs: ['Valores em reais. Deduções, custos e despesas aparecem com sinal negativo. O período anterior tem a mesma duração.'] };
  }
  return { ...base, tables: [], paragraphs: renderAdminRead(domain, data).split('\n') };
}

/** Só caracteres que a fonte padrão do PDF desenha (Latin-1 + travessão e marcador): acentos do português passam, emoji sai. */
const clean = (s: string) => s.replace(/[^ -ÿ–—•]/g, '').replace(/\s+$/g, '');

type Pdf = {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  setFont(f: string, s?: string): Pdf; setFontSize(n: number): Pdf; text(t: string | string[], x: number, y: number, o?: Record<string, unknown>): Pdf;
  splitTextToSize(t: string, w: number): string[]; addPage(): Pdf; line(a: number, b: number, c: number, d: number): Pdf; setLineWidth(n: number): Pdf;
  output(t: 'arraybuffer'): ArrayBuffer; getNumberOfPages(): number; setPage(n: number): Pdf;
};
export type JsPdfCtor = new (o: Record<string, unknown>) => Pdf;

export function renderPdf(JsPDF: JsPdfCtor, doc: PdfDoc): Uint8Array {
  const pdf = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(); const H = pdf.internal.pageSize.getHeight(); const M = 40; const usable = W - M * 2;
  let y = M;
  const room = (h: number) => { if (y + h > H - M - 20) { pdf.addPage(); y = M; } };
  pdf.setFont('helvetica', 'bold').setFontSize(16); pdf.text(clean(doc.title), M, y); y += 20;
  pdf.setFont('helvetica', 'normal').setFontSize(10);
  if (doc.subtitle) { pdf.text(clean(doc.subtitle), M, y); y += 14; }
  y += 8;
  for (const t of doc.tables) {
    if (t.heading) { room(30); pdf.setFont('helvetica', 'bold').setFontSize(11); pdf.text(clean(t.heading), M, y); y += 16; }
    const first = usable * (t.columns.length === 2 ? 0.62 : 0.34); const rest = (usable - first) / Math.max(t.columns.length - 1, 1);
    const xs = t.columns.map((_, i) => M + (i === 0 ? 0 : first + rest * (i - 1)));
    const cell = (txt: string, i: number) => {
      const right = t.columns[i].right; const w = i === 0 ? first : rest;
      const s = pdf.splitTextToSize(clean(txt), w - 6)[0] ?? '';
      pdf.text(s, right ? xs[i] + w - 4 : xs[i], y, right ? { align: 'right' } : undefined);
    };
    room(24); pdf.setFont('helvetica', 'bold').setFontSize(9); t.columns.forEach((c, i) => cell(c.label, i)); y += 4;
    pdf.setLineWidth(0.5); pdf.line(M, y, W - M, y); y += 12;
    t.rows.forEach((r, k) => {
      room(14);
      pdf.setFont('helvetica', t.boldLast && k === t.rows.length - 1 ? 'bold' : 'normal').setFontSize(9);
      r.forEach((c, i) => cell(c, i)); y += 14;
    });
    y += 10;
  }
  pdf.setFont('helvetica', 'normal').setFontSize(10);
  for (const p of doc.paragraphs) {
    for (const l of pdf.splitTextToSize(clean(p), usable)) { room(14); pdf.text(l, M, y); y += 14; }
  }
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFont('helvetica', 'normal').setFontSize(8);
    pdf.text(clean(`${doc.footer}  |  página ${i} de ${pages}`), M, H - 20);
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}

export const safeName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'arquivo';
