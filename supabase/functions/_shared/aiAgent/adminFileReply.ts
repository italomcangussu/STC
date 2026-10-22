// Arquivo para o administrador no privado (somente leitura, vai para ele mesmo): PDF de relatório, gerado dos
// mesmos dados da consulta, ou documento que o sistema já guarda (comprovante, anexo de despesa, documento).

import type { DecideInput } from './decide.ts';
import { type FileKind, type FileKit, type PdfDoc, reportDoc, safeName } from './adminFiles.ts';
import { type Args, type Ask, READ_FAILED, askWith, memberId, periodArgs, readAdmin } from './adminReadRpc.ts';
import type { Decision, Memory, OutFile } from './turnTypes.ts';

type StoredKind = Exclude<FileKind, 'relatorio_pdf'>;
type StoredFile = { bucket: string; path: string; name: string; mime: string; label: string };
type Reply = { i: DecideInput; memory: Memory; kit: FileKit; ask: Ask; falhou: Decision };

const PDF = 'application/pdf';
const TZ = 'America/Fortaleza';
const PDF_DOMAIN_QUESTION = 'De qual relatório você quer o PDF: caixa, a receber/a pagar, resultado (DRE), receita de alunos, comparativo, comprovantes, assinaturas ou reservas do dia? E de qual período?';

const stamp = () => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .format(new Date()).replace(',', '');
const shortTitle = (doc: PdfDoc) => doc.title.replace(/^STC — /, '');
const pdfName = (doc: PdfDoc) => `${safeName(shortTitle(doc))}-${new Date().toLocaleDateString('en-CA', { timeZone: TZ })}.pdf`;
const pdfCaption = (doc: PdfDoc) => shortTitle(doc) + (doc.subtitle ? ` · ${doc.subtitle.replace('Período: ', '')}` : '');

const sending = (r: Reply, out: { text: string; action: string; files: OutFile[] }): Decision =>
  ({ bubbles: [out.text], awaiting: false, close: false, action: out.action, memory: r.memory, files: out.files });

/** Relatório em PDF: lê como a consulta, monta o documento e anexa. */
async function reportPdf(r: Reply): Promise<Decision> {
  const domain = r.i.slots.read_domain;
  if (!domain) return r.ask(PDF_DOMAIN_QUESTION);
  const res = await readAdmin(r.i, domain, periodArgs(r.i));
  if (!res?.ok) return r.ask(res?.message ?? READ_FAILED, false);
  const doc = reportDoc(domain, res.data, stamp());
  const bytes = await r.kit.pdf(doc).catch(() => null);
  const name = pdfName(doc);
  const path = bytes ? await r.kit.stage({ bytes }, name, PDF) : null;
  if (!path) return r.falhou;
  return sending(r, { text: 'Aqui está o PDF, gerado agora com os mesmos números da consulta.', action: `admin_file:${domain}`,
    files: [{ path, name, mime: PDF, caption: pdfCaption(doc) }] });
}

/** O que cada tipo de arquivo guardado manda para a busca; comprovante pode filtrar por sócio. */
const STORED_FILTER: Record<StoredKind, (i: DecideInput) => Promise<Args | { ask: string }>> = {
  comprovante: async (i) => {
    if (!i.slots.member_name) return {};
    const m = await memberId(i, i.slots.member_name);
    return 'ask' in m ? m : { profile_id: m.id };
  },
  despesa_anexo: async ({ slots }) => ({ text: slots.description ?? slots.note ?? null }),
  documento: async ({ slots }) => ({ text: slots.doc_title ?? null }),
};

/** Copia cada arquivo para a mídia da conversa; o que falhar fica de fora. */
async function stageAll(kit: FileKit, files: StoredFile[]): Promise<OutFile[]> {
  const out: OutFile[] = [];
  for (const f of files) {
    const path = await kit.stage({ bucket: f.bucket, path: f.path }, f.name, f.mime);
    if (path) out.push({ path, name: f.name, mime: f.mime, caption: f.label });
  }
  return out;
}

/** Arquivos que o sistema já guarda: busca no banco e copia cada um para a mídia da conversa. */
async function storedFiles(r: Reply, kind: StoredKind): Promise<Decision> {
  const { deps, slots, session } = r.i;
  const filter = await (STORED_FILTER[kind] ?? STORED_FILTER.documento)(r.i);
  if ('ask' in filter) return r.ask(String(filter.ask));
  const p = { kind, from: slots.read_from ?? null, to: slots.read_to ?? null, ...filter };
  const res = (await deps.db('conv_svc_ai_admin_file', { p_session: session, p })).data as { ok: boolean; message?: string; files?: StoredFile[] } | null;
  if (!res?.ok || !res.files?.length) return r.ask(res?.message ?? 'Não achei nenhum arquivo com esses dados.', false);
  const files = await stageAll(r.kit, res.files);
  if (!files.length) return r.falhou;
  return sending(r, { text: files.length > 1 ? `Achei ${files.length} arquivos, já mando.` : 'Achei, já mando o arquivo.', action: `admin_file:${kind}`, files });
}

export async function adminArquivo(i: DecideInput, memory: Memory): Promise<Decision> {
  const ask = askWith(memory);
  const kit = i.deps.files;
  if (!kit) return ask('Não consegui gerar ou anexar arquivo agora. Posso te mandar o resumo em texto?', false);
  const r: Reply = { i, memory, kit, ask, falhou: ask('Não consegui anexar o arquivo agora. Tenta de novo daqui a pouco?', false) };
  const kind = i.slots.file_kind as FileKind;
  return kind === 'relatorio_pdf' ? reportPdf(r) : storedFiles(r, kind);
}
