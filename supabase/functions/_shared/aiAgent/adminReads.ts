// Consultas do assessor (Onda 1): o servidor busca (RPC `conv_svc_ai_admin_read`, como o administrador) e escreve o texto.
// O modelo só escolhe o domínio e o período; nenhum número passa pela cabeça dele.

export const ADMIN_READ_DOMAINS = ['caixa', 'receber_pagar', 'dre', 'receita_alunos', 'comprovantes', 'acessos', 'assinaturas', 'ocupacao', 'comparativo', 'followups', 'preferencias', 'socios', 'inadimplentes', 'pagamentos', 'socio_ficha', 'vencimentos', 'alunos', 'movimentos', 'capacidades', 'memoria', 'formularios', 'formulario', 'formulario_resultado'] as const;
/** Domínios de formulários do clube: buscados por `conv_svc_ai_admin_forms_read`. */
export const FORMS_DOMAINS: readonly string[] = ['formularios', 'formulario', 'formulario_resultado'];
/** Domínios que o servidor busca por `conv_svc_ai_admin_read_more` (o resto vai por `conv_svc_ai_admin_read`; `socios` por `conv_svc_ai_admin_members`). */
export const READ_MORE_DOMAINS: readonly string[] = ['inadimplentes', 'pagamentos', 'socio_ficha', 'vencimentos', 'alunos', 'movimentos'];
export type AdminReadDomain = typeof ADMIN_READ_DOMAINS[number];
type Row = Record<string, unknown>;

export const isAdminReadDomain = (v: unknown): v is AdminReadDomain => ADMIN_READ_DOMAINS.includes(v as AdminReadDomain);

export const brl = (v: unknown) => `R$ ${(Number(v ?? 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const dia = (v: unknown) => String(v ?? '').slice(0, 10).split('-').reverse().join('/');
const dh = (v: unknown) => { const s = String(v ?? ''); return s ? `${dia(s)}` : ''; };
export const n = (v: unknown) => Number(v ?? 0);
export const arr = (v: unknown): Row[] => (Array.isArray(v) ? v as Row[] : []);
export const periodo = (d: Row) => `${dia(d.from)} a ${dia(d.to)}`;

const EXPENSE_LINES = ['variable_cost', 'operational', 'administrative', 'commercial', 'financial'];
export const LINE_LABEL: Record<string, string> = { revenue: 'Receitas', deduction: 'Deduções', variable_cost: 'Custos variáveis', operational: 'Operacional',
  administrative: 'Administrativo', commercial: 'Comercial', financial: 'Financeiro' };

export const sumLines = (rows: Row[]) => {
  const by = (l: string) => n(rows.find((r) => r.line === l)?.amount_cents);
  const despesas = EXPENSE_LINES.reduce((t, l) => t + by(l), 0);
  return { receitas: by('revenue'), deducoes: by('deduction'), despesas, resultado: by('revenue') - by('deduction') - despesas };
};

function renderCaixa(d: Row): string {
  const net = n(d.net_cents);
  return `Caixa de ${periodo(d)}:\n- Saldo no início: ${brl(d.opening_cents)}\n- Entrou: ${brl(d.inflow_cents)}\n- Saiu: ${brl(d.outflow_cents)}\n- Resultado do período: ${net < 0 ? '-' : ''}${brl(Math.abs(net))}\n- Saldo no fim: ${brl(d.closing_cents)}`;
}

function renderReceberPagar(d: Row): string {
  const r = (d.receivables ?? {}) as Row; const p = (d.payables ?? {}) as Row;
  return `A receber: ${brl(r.open_cents)} em aberto (${n(r.open_count)} cobranças); vencido ${brl(r.overdue_cents)} (${n(r.overdue_count)} cobranças, ${n(r.overdue_members)} sócios); vence em 7 dias ${brl(r.due_7d_cents)}, em 30 dias ${brl(r.due_30d_cents)}.\n`
    + `A pagar: ${brl(p.payable_open_cents)} em aberto; vencido ${brl(p.payable_overdue_cents)} (${n(p.payable_overdue_count)} contas); vence em 7 dias ${brl(p.payable_due_7d_cents)}, em 30 dias ${brl(p.payable_due_30d_cents)}.`;
}

function renderDre(d: Row): string {
  const cur = sumLines(arr(d.by_line)); const prev = sumLines(arr(d.previous_by_line));
  const sinal = (v: number) => `${v < 0 ? '-' : ''}${brl(Math.abs(v))}`;
  const linhas = arr(d.by_line).filter((l) => n(l.amount_cents) !== 0).map((l) => `  ${LINE_LABEL[String(l.line)] ?? l.line}: ${brl(l.amount_cents)}`).join('\n');
  const top = arr(d.top).slice(0, 6).map((t) => `  ${t.name}: ${brl(t.amount_cents)}`).join('\n');
  return `Resultado de ${periodo(d)}: receitas ${brl(cur.receitas)}${cur.deducoes ? `, deduções ${brl(cur.deducoes)}` : ''}, despesas ${brl(cur.despesas)} → resultado ${sinal(cur.resultado)}.\n`
    + `Período anterior (mesma duração): receitas ${brl(prev.receitas)}, despesas ${brl(prev.despesas)}, resultado ${sinal(prev.resultado)}.`
    + (linhas ? `\nPor grupo:\n${linhas}` : '') + (top ? `\nMaiores categorias:\n${top}` : '');
}

function renderReceitaAlunos(d: Row): string {
  const cats = arr(d.by_category).map((c) => `  ${c.name}: ${brl(c.amount_cents)}`).join('\n');
  return `Receita de alunos em ${periodo(d)}: ${brl(d.total_cents)} em ${n(d.count)} lançamentos.${cats ? `\n${cats}` : ''}`;
}

function renderComprovantes(d: Row): string {
  const total = n(d.total);
  if (!total) return 'Nenhum comprovante aguardando análise.';
  const itens = arr(d.items).map((i) => `- ${i.member}: ${i.declared_amount_cents != null ? brl(i.declared_amount_cents) : 'valor não lido'}${i.declared_paid_on ? `, pago em ${dia(i.declared_paid_on)}` : ''}, enviado em ${dh(i.created_at)}${i.status === 'in_review' ? ' (em análise)' : ''}${i.possible_duplicate ? ' ⚠ possível duplicado' : ''}`).join('\n');
  return `${total} comprovante${total > 1 ? 's' : ''} aguardando análise:\n${itens}${total > arr(d.items).length ? `\n…e mais ${total - arr(d.items).length}.` : ''}`;
}

function renderAcessos(d: Row): string {
  const total = n(d.total);
  if (!total) return 'Nenhum pedido de acesso pendente.';
  const itens = arr(d.items).map((i) => `- ${i.name} (pediu em ${dh(i.created_at)})`).join('\n');
  return `${total} pedido${total > 1 ? 's' : ''} de acesso pendente${total > 1 ? 's' : ''}:\n${itens}${total > arr(d.items).length ? `\n…e mais ${total - arr(d.items).length}.` : ''}`;
}

function renderAssinaturas(d: Row): string {
  const docs = arr(d.documents);
  if (!docs.length) return 'Não há documento publicado para assinatura.';
  return docs.map((x) => {
    const falta = n(x.recipients) - n(x.signed);
    const avisos = [n(x.notifications_failed) ? `${n(x.notifications_failed)} aviso(s) com falha` : '', n(x.no_phone) ? `${n(x.no_phone)} sem telefone` : ''].filter(Boolean).join(', ');
    return `- ${x.title} (v${x.version}): ${n(x.signed)} de ${n(x.recipients)} assinaram, faltam ${falta}${x.due_at ? `, prazo ${dia(x.due_at)}` : ''}${avisos ? ` · ${avisos}` : ''}`;
  }).join('\n');
}

function renderOcupacao(d: Row): string {
  const itens = arr(d.items);
  if (!itens.length) return `Sem reservas em ${dia(d.date)}.`;
  const por = new Map<string, string[]>();
  for (const i of itens) por.set(String(i.court), [...(por.get(String(i.court)) ?? []), `${i.start}-${i.end} ${i.type}${i.by ? ` (${i.by})` : ''}`]);
  return `Reservas de ${dia(d.date)}:\n${[...por].map(([q, l]) => `${q}: ${l.join(' · ')}`).join('\n')}`;
}

function renderComparativo(d: Row): string {
  const cur = sumLines(arr(d.by_line)); const prev = sumLines(arr(d.previous_by_line));
  const sinal = (v: number) => `${v < 0 ? '-' : ''}${brl(Math.abs(v))}`;
  const pct = (a: number, b: number) => (b === 0 ? '' : ` (${a >= b ? '+' : '-'}${Math.abs(Math.round(((a - b) / b) * 100))}%)`);
  const rotulo = (l: Row) => `${l.name}${l.line === 'revenue' ? '' : ' (despesa)'}`;
  const mudancas = arr(d.changes).slice(0, 6).map((c) => {
    const delta = n(c.delta_cents);
    return `  ${rotulo(c)}: ${brl(c.previous_cents)} → ${brl(c.current_cents)} (${delta > 0 ? '+' : '-'}${brl(Math.abs(delta))})`;
  }).join('\n');
  return `Comparativo de ${periodo(d)} com o período anterior (mesma duração):\n`
    + `- Receitas: ${brl(cur.receitas)} contra ${brl(prev.receitas)}${pct(cur.receitas, prev.receitas)}\n`
    + `- Despesas: ${brl(cur.despesas)} contra ${brl(prev.despesas)}${pct(cur.despesas, prev.despesas)}\n`
    + `- Resultado: ${sinal(cur.resultado)} contra ${sinal(prev.resultado)}`
    + (mudancas ? `\nO que mais mudou:\n${mudancas}` : '\nNenhuma categoria mudou de valor.');
}

function renderFollowups(d: Row): string {
  const itens = arr(d.items);
  if (!itens.length) return 'Nenhum retorno pendente.';
  const quando = (v: unknown) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(String(v)));
  return `${itens.length} retorno${itens.length > 1 ? 's' : ''} pendente${itens.length > 1 ? 's' : ''}:\n${itens.map((i) => `- ${quando(i.due_at)} · ${i.who}${i.note ? `: ${i.note}` : ''}${i.sends ? ' (manda mensagem)' : ''}`).join('\n')}`;
}

function renderPreferencias(d: Row): string {
  const sn = (v: unknown) => (v ? 'ligado' : 'desligado');
  return `Suas preferências:\n- Resumo da manhã: ${sn(d.briefing_enabled)} (${d.briefing_style})\n- Alertas: ${sn(d.alerts_enabled)}; cobrança vencida a partir de ${n(d.overdue_days)} dias; `
    + `${d.min_balance_cents != null ? `caixa abaixo de ${brl(d.min_balance_cents)}` : 'sem aviso de caixa baixo'}\n- Conta padrão: ${d.default_account ?? 'nenhuma'}`;
}

function renderSocios(d: Row): string {
  const todos = arr(d.members);
  const dir = todos.filter((m) => m.role === 'admin'); const socios = todos.filter((m) => m.role !== 'admin');
  const lista = (rows: Row[]) => rows.map((m, i) => `${i + 1}. ${m.name}`).join('\n');
  if (!todos.length) return 'Não achei sócios ativos no cadastro.';
  return `O STC tem ${todos.length} sócios ativos no cadastro (${dir.length} da diretoria e ${socios.length} sócios).\n\nDiretoria:\n${lista(dir)}\n\nSócios:\n${lista(socios)}`;
}

function renderInadimplentes(d: Row): string {
  const itens = arr(d.items);
  if (!itens.length) return 'Ninguém está com cobrança vencida agora. 🎉';
  const lista = itens.map((i) => `- ${i.name}: ${brl(i.total_cents)} (${n(i.charges)} cobrança${n(i.charges) > 1 ? 's' : ''}, ${n(i.days_late)} dia${n(i.days_late) === 1 ? '' : 's'} de atraso)`).join('\n');
  return `${n(d.members)} sócio${n(d.members) > 1 ? 's' : ''} com cobrança vencida, ${brl(d.total_cents)} no total (com multa e juros):\n${lista}${n(d.members) > itens.length ? `\n…e mais ${n(d.members) - itens.length}.` : ''}`;
}

function renderPagamentos(d: Row): string {
  const itens = arr(d.items);
  if (!itens.length) return `Nenhum pagamento de mensalidade entre ${periodo(d)}.`;
  const lista = itens.map((i) => `- ${i.name}: ${brl(i.paid_cents)}, em ${dia(i.last)}`).join('\n');
  return `${n(d.members)} sócio${n(d.members) > 1 ? 's' : ''} pagou entre ${periodo(d)}, ${brl(d.total_cents)} no total:\n${lista}${n(d.members) > itens.length ? `\n…e mais ${n(d.members) - itens.length}.` : ''}`;
}

function renderSocioFicha(d: Row): string {
  const deps = Array.isArray(d.dependents) ? d.dependents as string[] : [];
  const sit = !d.active ? 'inativo' : n(d.overdue_cents) > 0 ? `com ${brl(d.overdue_cents)} vencido` : 'em dia';
  return `${d.name} (${d.role === 'admin' ? 'diretoria' : 'sócio'}), ${sit}. No clube desde ${dia(d.since)}.\n`
    + `- Em aberto: ${brl(d.open_cents)}${d.next_due ? `; próximo vencimento ${dia(d.next_due)}` : ''}\n`
    + `- Último pagamento: ${d.last_payment ? dia(d.last_payment) : 'nenhum registrado'}\n`
    + `- Dependentes: ${deps.length ? deps.join(', ') : 'nenhum'}${d.phone ? `\n- Telefone: ${d.phone}` : ''}`;
}

function renderVencimentos(d: Row): string {
  const itens = arr(d.items);
  if (!itens.length) return `Nada a vencer até ${dia(d.until)}.`;
  const lista = itens.map((i) => `- ${dia(i.due_date)}${i.late ? ' (atrasado)' : ''}: ${i.kind === 'revenue' ? 'a receber' : 'a pagar'} ${brl(i.amount_cents)} — ${i.description}${i.supplier ? ` (${i.supplier})` : ''}`).join('\n');
  return `Até ${dia(d.until)}: a pagar ${brl(d.payable_cents)}${n(d.receivable_cents) ? `, a receber ${brl(d.receivable_cents)}` : ''}.\n${lista}`;
}

function renderAlunos(d: Row): string {
  const itens = arr(d.items);
  const lista = itens.map((i) => `- ${i.name}${i.plan ? ` (${i.plan})` : ''}${i.expires ? `, plano até ${dia(i.expires)}` : ''}`).join('\n');
  return `Alunos ativos: ${n(d.regular)} avulsos/regulares e ${n(d.dependent)} dependentes de sócios.${lista ? `\n${lista}` : ''}`;
}

function renderMovimentos(d: Row): string {
  const itens = arr(d.items);
  if (!itens.length) return 'Ainda não há lançamentos pagos.';
  return `Últimos lançamentos pagos:\n${itens.map((i) => `- ${dia(i.on)}: ${i.kind === 'revenue' ? 'entrou' : 'saiu'} ${brl(i.amount_cents)} — ${i.description}`).join('\n')}`;
}

const renderCapacidades = (d: Row): string => String(d.text ?? '');

function renderMemoria(d: Row): string {
  const itens = arr(d.items);
  const quem = d.subject ? ` sobre ${d.subject}` : '';
  if (!itens.length) return `Não tenho nenhuma memória aprovada${quem}.`;
  const KIND: Record<string, string> = { role_title: 'cargo', confirmed_fact: 'fato', recurring_preference: 'preferência', social_relation: 'relação', inside_joke: 'brincadeira interna' };
  return `O que eu sei${quem}:\n${itens.map((i) => `- ${i.subject_name} (${KIND[String(i.kind)] ?? 'nota'}): ${i.content}`).join('\n')}`;
}


const FORM_STATE: Record<string, string> = { aberto: 'aberto', encerrado: 'encerrado', vencido: 'com o prazo vencido', agendado: 'ainda não iniciado' };
const nomes = (rows: Row[], max = 60) => `${rows.slice(0, max).map((r) => `${r.name}${r.reachable === false ? ' (sem WhatsApp válido)' : ''}`).join(', ')}${rows.length > max ? ` e mais ${rows.length - max}` : ''}`;

function renderFormularios(d: Row): string {
  const itens = arr(d.items);
  if (!itens.length) return 'Ainda não há formulário cadastrado.';
  const linhas = itens.map((i) => `- «${i.title}»: ${FORM_STATE[String(i.state)] ?? i.state}, ${n(i.participants)} ${n(i.participants) === 1 ? 'resposta' : 'respostas'}, ${n(i.questions)} pergunta${n(i.questions) === 1 ? '' : 's'}${i.expires_at ? `, prazo ${dia(i.expires_at)}` : ''}${i.secret ? ', votação secreta' : ''}\n  ${i.link}`).join('\n');
  return `Formulários do clube (${n(d.audience)} sócios ativos no total):\n${linhas}`;
}

function renderFormulario(d: Row): string {
  const respondeu = arr(d.responded); const falta = arr(d.pending); const total = n(d.audience);
  const aviso = d.requires_auth === false ? '\n⚠ Este formulário aceita resposta sem login: só dá para saber quem respondeu logado.' : '';
  const modo = d.secret ? 'votação secreta (sei QUEM participou, nunca o que cada um votou)' : 'respostas identificadas';
  return `«${d.title}» está ${FORM_STATE[String(d.state)] ?? d.state}${d.expires_at ? ` (prazo ${dia(d.expires_at)})` : ''}, ${modo}.\n`
    + `${respondeu.length} de ${total} sócios responderam; faltam ${falta.length}.${aviso}\n`
    + `Responderam: ${respondeu.length ? nomes(respondeu) : 'ninguém ainda'}\n`
    + `Faltam: ${falta.length ? nomes(falta) : 'ninguém, todos responderam 🎉'}\n`
    + `Link: ${d.link}`;
}

function renderFormularioResultado(d: Row): string {
  const perguntas = arr(d.questions);
  const blocos = perguntas.map((q, i) => {
    const ops = arr(q.options);
    const votos = ops.map((o) => `  - ${o.label}: ${n(o.votes)}`).join('\n');
    const textos = arr(q.texts);
    const livres = textos.length
      ? `\n  Respostas escritas (${n(q.texts_total)}${n(q.texts_total) > textos.length ? `, as ${textos.length} mais recentes` : ''}):\n${textos.map((t) => `  - ${t.author ? `${t.author}: ` : ''}${String(t.text).replace(/\s+/g, ' ')}`).join('\n')}`
      : '';
    return `${i + 1}. ${q.title}${votos ? `\n${votos}` : ''}${livres}`;
  }).join('\n\n');
  return `Resultado de «${d.title}» (${n(d.participants)} ${n(d.participants) === 1 ? 'participante' : 'participantes'}${d.secret ? ', votação secreta: sem nomes' : ''}):\n\n${blocos || 'O formulário não tem perguntas.'}`;
}

const RENDER: Record<AdminReadDomain, (d: Row) => string> = {
  caixa: renderCaixa, receber_pagar: renderReceberPagar, dre: renderDre, receita_alunos: renderReceitaAlunos,
  comprovantes: renderComprovantes, acessos: renderAcessos, assinaturas: renderAssinaturas, ocupacao: renderOcupacao, comparativo: renderComparativo, followups: renderFollowups, preferencias: renderPreferencias, socios: renderSocios, inadimplentes: renderInadimplentes, pagamentos: renderPagamentos,
  socio_ficha: renderSocioFicha, vencimentos: renderVencimentos, alunos: renderAlunos, movimentos: renderMovimentos, capacidades: renderCapacidades, memoria: renderMemoria,
  formularios: renderFormularios, formulario: renderFormulario, formulario_resultado: renderFormularioResultado,
};

export const renderAdminRead = (domain: AdminReadDomain, data: unknown): string =>
  RENDER[domain]((data && typeof data === 'object' ? data : {}) as Row);
