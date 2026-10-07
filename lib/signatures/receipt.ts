import { supabase } from '../supabase';
import { cpfDigits, formatCpf, maskCpf } from './cpf';
import { formatDateTimeSeconds } from './format';

/**
 * Comprovante de assinatura em PDF (fase 5).
 *
 * Tudo vem de UMA linha de `sig_signatures`, o dossiê append-only gravado na hora da assinatura: o
 * sócio lê a sua (RLS) e o administrador lê todas. Nada é recalculado nem inferido aqui: o comprovante
 * só mostra o que foi gravado, com os horários no fuso do clube. A parte pura (`buildReceipt`) não
 * depende de PDF nem de rede; o jsPDF só é baixado quando alguém pede o arquivo.
 *
 * Privacidade: o comprovante do SÓCIO mostra CPF e telefone mascarados (ele pode repassar o arquivo);
 * o do ADMINISTRADOR (`full: true`) mostra tudo, porque é a cópia do dossiê do clube.
 */

export type SignatureDossier = {
  id: string;
  document_id: string;
  seq: number;
  signed_at: string;
  document_title: string;
  document_version: number;
  document_sha256: string;
  signer_name: string;
  signer_phone: string;
  signer_cpf: string;
  consent_text: string;
  accepted_at: string;
  read_started_at: string | null;
  read_completed_at: string | null;
  read_seconds: number | null;
  pages_seen: number | null;
  pages_total: number | null;
  code_sent_at: string;
  code_verified_at: string;
  code_attempts: number;
  provider_message_id: string | null;
  ip: string | null;
  user_agent: string | null;
  geo: { source?: string; city?: string; region?: string; country?: string; lat?: number; lng?: number; accuracy_m?: number } | null;
  device: Record<string, string> | null;
  evidence_hash: string;
  prev_chain_hash: string | null;
  chain_hash: string;
};

export type ReceiptSection = { heading: string; rows: Array<[label: string, value: string, mono?: boolean]> };
export type ReceiptModel = { title: string; fileName: string; sections: ReceiptSection[]; notes: string[]; generatedAt: string };

const dash = '—';
const orDash = (v: string | number | null | undefined) => (v === null || v === undefined || `${v}`.trim() === '' ? dash : `${v}`);

/** `(85) 99999-1234` a partir do número salvo (com ou sem DDI); desconhecido volta como veio. */
export function formatPhone(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '');
  const local = d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return raw;
}

export function maskPhone(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '');
  const local = d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
  return local.length >= 10 ? `(${local.slice(0, 2)}) *****-${local.slice(-4)}` : dash;
}

const LOCATION_LABEL: Record<string, string> = {
  granted: 'permitida pelo sócio', denied: 'negada pelo sócio', unavailable: 'indisponível no aparelho',
  timeout: 'sem resposta do aparelho', unsupported: 'sem suporte no aparelho',
};

function placeText(geo: SignatureDossier['geo']): string {
  const place = [geo?.city, geo?.region, geo?.country].filter(Boolean).join(', ');
  return place || dash;
}

function gpsText(geo: SignatureDossier['geo']): string {
  if (geo?.lat === undefined || geo?.lng === undefined) return dash;
  const acc = geo.accuracy_m === undefined ? '' : ` (precisão de ${Math.round(Number(geo.accuracy_m))} m)`;
  return `${Number(geo.lat).toFixed(6)}, ${Number(geo.lng).toFixed(6)}${acc}`;
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'documento';

export const receiptFileName = (r: Pick<SignatureDossier, 'document_title' | 'document_version' | 'seq'>) =>
  `comprovante-assinatura-${slug(r.document_title)}-v${r.document_version}-n${r.seq}.pdf`;

export function buildReceipt(r: SignatureDossier, opts: { full: boolean; now?: Date }): ReceiptModel {
  const full = opts.full;
  const cpf = cpfDigits(r.signer_cpf);
  const device = r.device ?? {};
  const read = r.read_seconds === null || r.read_seconds === undefined ? dash
    : r.read_seconds < 60 ? `${r.read_seconds} s` : `${Math.floor(r.read_seconds / 60)} min ${String(r.read_seconds % 60).padStart(2, '0')} s`;

  const sections: ReceiptSection[] = [
    { heading: 'Documento', rows: [
      ['Título', r.document_title], ['Versão', String(r.document_version)],
      ['Impressão digital do arquivo (SHA-256)', r.document_sha256, true],
    ] },
    { heading: 'Assinante', rows: [
      ['Nome', r.signer_name],
      ['CPF (declarado pelo assinante)', cpf.length === 11 ? (full ? formatCpf(cpf) : maskCpf(cpf).replace(/•/g, '*')) : dash],
      ['WhatsApp que recebeu o código', full ? formatPhone(r.signer_phone) : maskPhone(r.signer_phone)],
    ] },
    { heading: 'Cronologia (horário de Fortaleza, UTC-3)', rows: [
      ['Início da leitura', orDash(formatDateTimeSeconds(r.read_started_at))],
      ['Leitura concluída', orDash(formatDateTimeSeconds(r.read_completed_at))],
      ['Páginas vistas / tempo de leitura', r.pages_seen !== null && r.pages_total !== null ? `${r.pages_seen} de ${r.pages_total} · ${read}` : read],
      ['Aceite ("li e concordo")', formatDateTimeSeconds(r.accepted_at)],
      ['Código enviado ao WhatsApp', formatDateTimeSeconds(r.code_sent_at)],
      ['Código confirmado', `${formatDateTimeSeconds(r.code_verified_at)} · ${r.code_attempts} ${r.code_attempts === 1 ? 'tentativa' : 'tentativas'}`],
      ['Assinatura registrada', formatDateTimeSeconds(r.signed_at)],
    ] },
    { heading: 'Aceite', rows: [['Texto aceito', r.consent_text]] },
    { heading: 'Origem do acesso', rows: [
      ['Endereço IP', orDash(r.ip)],
      ['Localização aproximada (pelo IP)', placeText(r.geo)],
      ['Localização do aparelho (GPS)', r.geo?.source === 'gps' ? gpsText(r.geo) : `não registrada — ${LOCATION_LABEL[device.location ?? ''] ?? 'sem informação'}`],
      ['Aparelho', [device.platform, device.mode === 'pwa' ? 'app instalado' : device.mode === 'browser' ? 'navegador' : undefined, device.screen && `tela ${device.screen}`, device.language, device.timezone].filter(Boolean).join(' · ') || dash],
      ['Navegador (user-agent)', orDash(r.user_agent)],
    ] },
    { heading: 'Integridade do registro', rows: [
      ['Número da assinatura no documento', `nº ${r.seq}`],
      ['Código do registro', r.id, true],
      ['Hash da evidência (SHA-256)', r.evidence_hash, true],
      ['Hash anterior da cadeia', r.prev_chain_hash ?? 'início da cadeia', true],
      ['Hash desta assinatura na cadeia', r.chain_hash, true],
    ] },
  ];

  return {
    title: 'Comprovante de assinatura eletrônica',
    fileName: receiptFileName(r),
    generatedAt: formatDateTimeSeconds(opts.now ?? new Date()),
    sections,
    notes: [
      'Assinatura eletrônica simples (Lei 14.063/2020): o assinante foi identificado pela posse do WhatsApp que recebeu o código de 6 dígitos, e declarou o próprio CPF. Não é assinatura com certificado ICP-Brasil.',
      'A leitura "até o fim" e os dados do aparelho são informados pelo aparelho do assinante; o servidor registra os horários, a ordem dos eventos e o IP.',
      'Este registro não pode ser alterado nem apagado. O administrador do clube pode conferir a cadeia de hashes (Documentos, botão Conferir integridade): qualquer alteração, remoção ou troca de ordem é detectada.',
      ...(full ? [] : ['Por privacidade, CPF e telefone aparecem mascarados nesta cópia; o clube guarda os dados completos.']),
    ],
  };
}

// ---- PDF ------------------------------------------------------------------------------------------------

const MARGIN = 48;

/** Desenha o modelo em A4 retrato, com quebra de linha e de página. Carrega o jsPDF só aqui. */
export async function renderReceiptPdf(model: ReceiptModel): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setProperties({ title: model.title, subject: model.fileName, creator: 'STC' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const width = pageW - MARGIN * 2;
  const labelW = 170;
  let y = MARGIN;

  const ensure = (needed: number) => {
    if (y + needed > pageH - MARGIN - 18) { doc.addPage(); y = MARGIN; }
  };

  doc.setFont('helvetica', 'bold').setFontSize(17).text(model.title, MARGIN, y);
  y += 18;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110).text(`Emitido em ${model.generatedAt} (horário de Fortaleza)`, MARGIN, y);
  doc.setTextColor(0);
  y += 22;

  for (const section of model.sections) {
    ensure(40);
    doc.setFont('helvetica', 'bold').setFontSize(11).text(section.heading, MARGIN, y);
    y += 4;
    doc.setDrawColor(200).setLineWidth(0.5).line(MARGIN, y, pageW - MARGIN, y);
    y += 14;
    for (const [label, value, mono] of section.rows) {
      doc.setFont('helvetica', 'normal').setFontSize(9);
      const labelLines = doc.splitTextToSize(label, labelW - 8) as string[];
      doc.setFont(mono ? 'courier' : 'helvetica', 'normal').setFontSize(mono ? 8 : 9);
      const valueLines = doc.splitTextToSize(value, width - labelW) as string[];
      const lines = Math.max(labelLines.length, valueLines.length);
      ensure(lines * 11 + 4);
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100).text(labelLines, MARGIN, y);
      doc.setTextColor(0).setFont(mono ? 'courier' : 'helvetica', 'normal').setFontSize(mono ? 8 : 9).text(valueLines, MARGIN + labelW, y);
      y += lines * 11 + 4;
    }
    y += 8;
  }

  ensure(30);
  doc.setFont('helvetica', 'bold').setFontSize(10).text('Observações', MARGIN, y);
  y += 14;
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(70);
  for (const note of model.notes) {
    const lines = doc.splitTextToSize(`- ${note}`, width) as string[];
    ensure(lines.length * 10.5 + 4);
    doc.text(lines, MARGIN, y);
    y += lines.length * 10.5 + 4;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130);
    doc.text(`${model.title} · página ${i} de ${pages}`, pageW / 2, pageH - 24, { align: 'center' });
  }
  return doc.output('blob');
}

// ---- busca e download -----------------------------------------------------------------------------------

export async function getSignatureDossier(signatureId: string): Promise<SignatureDossier> {
  const { data, error } = await supabase.from('sig_signatures').select('*').eq('id', signatureId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('SIG_NOT_FOUND');
  return data as SignatureDossier;
}

/** Busca o dossiê, monta o PDF e devolve o arquivo (a tela decide como entregá-lo). */
export async function buildReceiptFile(signatureId: string, opts: { full: boolean }): Promise<{ blob: Blob; fileName: string }> {
  const model = buildReceipt(await getSignatureDossier(signatureId), opts);
  return { blob: await renderReceiptPdf(model), fileName: model.fileName };
}

/** Entrega o arquivo ao usuário (download). Só roda a partir de um clique. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadReceipt(signatureId: string, opts: { full: boolean }): Promise<void> {
  const { blob, fileName } = await buildReceiptFile(signatureId, opts);
  saveBlob(blob, fileName);
}
