// Mensagens de WhatsApp do módulo Documentos e Assinaturas. Puro: sem I/O.
//
// Três tipos de aviso na fila (`sig_notifications`) e um envio direto:
//   publish / new_member  link + passo a passo de como assinar (ao publicar, ou quando o sócio entra);
//   reminder              lembrete 3 dias antes (`d-3@AAAA-MM-DD`) e no dia do prazo (`d0@AAAA-MM-DD`);
//   código                6 dígitos da assinatura (enviado na hora, nunca pela fila).
// O link é um atalho (`/#documentos/<id>`): exige login e NÃO assina nada. Quem assina é o código,
// digitado no app. Por isso toda mensagem repete o aviso de não repassar o código.

export const DEFAULT_APP_URL = 'https://stcplay.com.br';
export const CODE_VALID_MINUTES = 10;

/** `Documentos e Assinaturas` é o nome da aba no app; a mensagem ensina a achá-la. */
const TAB = 'Documentos e Assinaturas';

/**
 * Telefone do cadastro → número do WhatsApp (DDI 55). O STC guarda o telefone local (DDD + número, 10 ou
 * 11 dígitos), mesma regra de `lib/phoneAuth.ts`; a UazAPI precisa do DDI. `null` se não parece telefone.
 */
export function toWhatsappNumber(phone: string | null | undefined): string | null {
  let local = (phone ?? '').replace(/\D/g, '');
  if (local.startsWith('55') && local.length >= 12) local = local.slice(2);
  if (local.length > 11) local = local.slice(-11);
  return local.length >= 10 ? `55${local}` : null;
}

/** `(88) •••••-1234`: o app confirma para onde o código foi sem expor o número inteiro. */
export function maskPhone(phone: string | null | undefined): string {
  const n = toWhatsappNumber(phone);
  if (!n) return '';
  const local = n.slice(2);
  return `(${local.slice(0, 2)}) •••••-${local.slice(-4)}`;
}

/** Primeiro nome; vazio se o "nome" é um número (perfil sem nome). */
export function firstName(fullName: string | null | undefined): string {
  const nome = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return nome && !/^\+?\d/.test(nome) ? nome : '';
}

/** Título vindo do admin sem marcas que quebram a formatação do WhatsApp (*negrito*, _itálico_, ~tachado~, `código`). */
export function plainTitle(title: string): string {
  return (title ?? '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
}

const PARTS = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** `20/10/2026 às 18:00`, no fuso do clube (Fortaleza). `null` se não há prazo. */
export function formatDue(dueAt: string | null | undefined): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  // `hour12: false` pode devolver "24" à meia-noite em alguns motores.
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.day}/${p.month}/${p.year} às ${hour}:${p.minute}`;
}

export function documentLink(appUrl: string, documentId: string): string {
  return `${(appUrl || DEFAULT_APP_URL).replace(/\/+$/, '')}/#documentos/${documentId}`;
}

const SAUDACAO = (name: string) => (firstName(name) ? `Olá, ${firstName(name)}! 👋` : 'Olá! 👋');

const COMO_ASSINAR = (link: string) => [
  '*Como assinar (leva uns 2 minutos):*',
  `1️⃣ Toque no link abaixo — ou abra o app do STC, entre com o seu telefone e toque em *${TAB}*.`,
  link,
  '2️⃣ Leia o documento até o fim. O "Li e concordo" só libera quando você chega na última página.',
  '3️⃣ Marque *Li e concordo* e toque em *Assinar digitalmente*.',
  '4️⃣ Você vai receber aqui, neste WhatsApp, um código de 6 dígitos. Digite no app e pronto: assinado!',
].join('\n');

const AVISO_CODIGO = '🔒 O código só deve ser digitado no app. Não passe para ninguém, nem para o STC.';

export type NotificationContext = {
  kind: string; slot: string; name: string; title: string; dueAt: string | null; documentId: string; appUrl: string;
};

/** Aviso de publicação (ou de sócio novo): link e passo a passo. */
export function publishMessage(c: Pick<NotificationContext, 'name' | 'title' | 'dueAt' | 'documentId' | 'appUrl'>, newMember = false): string {
  const prazo = formatDue(c.dueAt);
  return [
    SAUDACAO(c.name),
    '',
    newMember ? 'Bem-vindo(a) ao STC! 🎾 Para começar, tem um documento esperando a sua assinatura:' : 'Tem um documento do STC esperando a sua assinatura:',
    `📄 *${plainTitle(c.title)}*`,
    ...(prazo ? [`⏰ Prazo: ${prazo}`] : []),
    '',
    COMO_ASSINAR(documentLink(c.appUrl, c.documentId)),
    '',
    AVISO_CODIGO,
  ].join('\n');
}

/** Lembrete. `slot` é `d-3@AAAA-MM-DD` (3 dias antes) ou `d0@AAAA-MM-DD` (dia do prazo). */
export function reminderMessage(c: Pick<NotificationContext, 'slot' | 'name' | 'title' | 'dueAt' | 'documentId' | 'appUrl'>): string {
  const prazo = formatDue(c.dueAt);
  const hoje = c.slot.startsWith('d0@');
  const abertura = hoje
    ? `⏰ Hoje é o último dia para assinar *${plainTitle(c.title)}*${prazo ? ` (até ${prazo.split(' às ')[1]})` : ''}.`
    : `⏳ Faltam 3 dias para assinar *${plainTitle(c.title)}*${prazo ? ` (prazo: ${prazo})` : ''}.`;
  return [
    SAUDACAO(c.name),
    '',
    abertura,
    'Ainda não vi a sua assinatura. Leva uns 2 minutos:',
    '',
    COMO_ASSINAR(documentLink(c.appUrl, c.documentId)),
    '',
    AVISO_CODIGO,
  ].join('\n');
}

/** Texto de um aviso da fila. `null` para um tipo desconhecido (não se envia o que não se conhece). */
export function composeNotification(c: NotificationContext): string | null {
  switch (c.kind) {
    case 'publish': return publishMessage(c);
    case 'new_member': return publishMessage(c, true);
    case 'reminder': return reminderMessage(c);
    default: return null;
  }
}

/** O código fica em uma linha só dele, em negrito: no WhatsApp dá para tocar e copiar. */
export function codeMessage(c: { name: string; title: string; code: string }): string {
  return [
    '🔐 *Código de assinatura STC*',
    '',
    `*${c.code}*`,
    '',
    `Documento: ${plainTitle(c.title)}`,
    `Vale por ${CODE_VALID_MINUTES} minutos. Digite no app para concluir a assinatura.`,
    '',
    'Nunca compartilhe este código — nem com o STC. Se não foi você que pediu, ignore esta mensagem.',
  ].join('\n');
}
