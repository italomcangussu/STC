// Contexto administrativo e financeiro no prompt: assessor, pendências numeradas, saldos e cards.

import { actingFor, transcript } from './promptContext.ts';
import type { Ctx } from './promptTypes.ts';

export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const brDateFull = (iso: unknown) => {
  const s = String(iso ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
};

export const moneyBR = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? `R$ ${n.toFixed(2).replace('.', ',')}` : '';
};

/** Administrador em conversa direta: o João também é assessor administrativo (o banco confere de novo em cada ação). */
export function isAdminAssistant(ctx: Ctx): boolean {
  const p = ((ctx.requester ?? {}) as Ctx).profile as Ctx | null | undefined;
  return ctx.is_group !== true && p?.is_admin === true;
}

export type AdminPendencyRef = { ref: string; id: string; member_id: string; member_name: string; description: string; total_due_cents: number; collection_enabled: boolean };

/** Pendências em aberto numeradas (p1, p2…), na ordem que o banco entrega: a mesma lista que o modelo vê e que o servidor usa. */
export function adminPendencyRefs(ctx: Ctx): AdminPendencyRef[] {
  const fin = (ctx.financial_context ?? {}) as Ctx;
  const all = Array.isArray(fin.member_pendencies) ? fin.member_pendencies as Ctx[] : [];
  return all.filter((p) => ['open', 'partial'].includes(String(p.status))).slice(0, 80).map((p, i) => ({
    ref: `p${i + 1}`, id: String(p.id), member_id: String(p.member_id ?? ''), member_name: String(p.member_name ?? ''),
    description: String(p.description ?? ''), total_due_cents: Number(p.total_due_cents ?? 0), collection_enabled: p.collection_enabled !== false,
  }));
}

export const ADMIN_SLOTS = ',"fin_action":"lancar|cobrar|pausar|retomar|baixa|renovar_card|cancelar_pendencia|ajustar|estornar|rejeitar_comprovante|aprovar_comprovante|gerar_cobrancas|despesa|receita|null","member_name":null,"description":null,"amount":null,"due_date":"YYYY-MM-DD|null","pendency_kind":"day_card|consumo|evento|multa|dano_reposicao|outros|null","guest_date":null,"send_now":false,"pendency_ref":null,"paid_on":"YYYY-MM-DD|null","method":"pix|transfer|cash|card|other|null","account_name":null,"reason":null,"adjust_kind":"discount|increase|fee_waiver|null","category_name":null,"receipt_date":"YYYY-MM-DD|null","entry_status":"paid|pending|null","adm_action":"aviso|aviso_desativar|aluno_status|socio_status|assinatura_reenviar|reserva_cancelar|acesso_aprovar|acesso_recusar|socio_criar|followup_criar|followup_concluir|quadra_bloquear|preferencia|dependente_criar|mensagem_enviar|comunicado_enviar|resumo_destinatario|memoria_esquecer|formulario_criar|formulario_status|formulario_cobrar|aniversario|resenha_grupo|null","phone":null,"email":null,"note":null,"send_body":null,"pref":"resumo|estilo|alertas|saldo_minimo|dias_atraso|conta_padrao|null","pref_value":null,"birthday":"DD/MM|null","ann_title":null,"ann_message":null,"active":null,"doc_title":null,"by_name":null,"dependent_name":null,"relationship":"esposa|esposo|filho|filha|outro|null","file_kind":"relatorio_pdf|comprovante|despesa_anexo|documento|null","read_domain":"caixa|receber_pagar|dre|receita_alunos|comprovantes|acessos|assinaturas|ocupacao|comparativo|followups|preferencias|socios|inadimplentes|pagamentos|socio_ficha|vencimentos|alunos|movimentos|capacidades|memoria|formularios|formulario|formulario_resultado|null","form_ref":null,"form_title":null,"form_questions":[{"title":"","type":"unica|multipla|texto","required":true,"options":[]}],"form_secret":null,"form_multiple":null,"read_from":"YYYY-MM-DD|null","read_to":"YYYY-MM-DD|null"';

export function adminSection(ctx: Ctx): string {
  if (!isAdminAssistant(ctx)) return '';
  return `# ASSESSOR ADMINISTRATIVO (só nesta conversa privada com administrador)
- Consultas: responda com o financeiro completo recebido (PENDÊNCIAS DE SÓCIO de todos, ALUNOS/CARDS, DAY CARDS). Totais e listas por sócio são bem-vindos.
- Ações (intent "admin_financeiro"): o SISTEMA mostra em uma frase o que vai fazer e só grava depois que o administrador aceitar, pelo sentido ("isso", "manda", "pode"…). Você nunca diz que lançou, cobrou ou deu baixa.
  - fin_action "lancar": nova pendência. member_name (sócio), description, amount em REAIS (ex.: 50 ou 37.5), due_date (padrão hoje), pendency_kind (Day Card de convidado → day_card, com guest_name e guest_date), send_now true se ele pedir para já cobrar.
  - fin_action "cobrar": enviar agora a cobrança consolidada. pendency_ref (p1, p2…) ou member_name.
  - fin_action "pausar" / "retomar": a régua de cobrança de uma pendência. pendency_ref.
  - fin_action "renovar_card": renovar o Card Mensal de um ALUNO (cadastro de aluno, não sócio). student_names ["Nome"]; amount em reais só se ele disser (o padrão é R$ 200 ou o valor do comprovante); paid_on só se ele disser. O comprovante que ele manda na conversa é LIDO pelo servidor (valor, data, favorecido): nunca peça nem repita esses dados. Se ele só avisar que quer renovar e vai mandar o comprovante, responda curto "Pode mandar o comprovante aqui e me diz o nome do aluno." (ready false, awaiting true, sem dizer que registrou). Tendo o nome do aluno: ready: true e messages vazio.
  - fin_action "baixa": registrar pagamento recebido. pendency_ref, amount em reais, paid_on (padrão hoje), method (pix padrão), account_name se ele disser a conta.
  - fin_action "cancelar_pendencia": cancela uma pendência SEM pagamento. pendency_ref (p1…), reason (frase curta obrigatória).
  - fin_action "ajustar": pendency_ref, adjust_kind (discount = desconto, increase = acréscimo, fee_waiver = perdoar juros/multa), amount em reais, reason obrigatório.
  - fin_action "estornar": desfaz o ÚLTIMO pagamento de uma pendência (pendency_ref) ou do último pagamento do sócio (member_name). reason obrigatório.
  - fin_action "rejeitar_comprovante": recusa o comprovante pendente do sócio (member_name; receipt_date se houver mais de um). reason obrigatório (o sócio pode ver).
  - fin_action "aprovar_comprovante": aprova o comprovante pendente do sócio (member_name; receipt_date se houver mais de um; paid_on, method e account_name só se ele disser). O SISTEMA lê o valor e distribui pelas cobranças em aberto; se o valor não foi lido ou passa do que está em aberto, ele indica o painel.
  - fin_action "gerar_cobrancas": gera as cobranças que faltam dos planos de sócios (sem outros dados).
  - fin_action "despesa" ou "receita": lançamento do caixa. description, amount em reais, category_name, account_name (se disser), entry_status "paid" (padrão, paid_on padrão hoje) ou "pending" (com due_date).
- Faltou dado obrigatório: pergunte só o que falta (awaiting: true). Tendo tudo: ready: true e messages vazio.
- Se há PROPOSTA ABERTA e ele aceitar: customer_confirmed: true, como nas reservas.
- Consultas (intent "admin_consulta"): o SISTEMA busca no banco e escreve a resposta com os números; você NÃO escreve números: messages vazio e ready: true. Escolha read_domain:
- Arquivos (intent "admin_consulta" com file_kind, messages vazio e ready: true): VOCÊ PODE mandar arquivo no WhatsApp para o administrador; nunca diga que não consegue enviar PDF ou comprovante. relatorio_pdf = PDF do relatório (DRE, caixa, comparativo etc.: informe read_domain e read_from/read_to, como numa consulta); comprovante = o arquivo do comprovante que um sócio enviou (member_name opcional, read_from/read_to opcionais); despesa_anexo = anexo de uma despesa (description = parte do nome ou fornecedor); documento = documento de assinatura (doc_title = parte do título). Se faltar saber qual relatório ou período, pergunte em uma frase. O sistema gera e anexa o arquivo; você não escreve números.
- Resposta do administrador a uma CURIOSIDADE sua sobre um sócio (você perguntou para entrar numa resenha) é para lembrar: registre em memory_candidates (confirmed_fact; fama ou zoeira da turma vira inside_joke) e agradeça no clima, sem dizer que gravou.
- MEMÓRIA pelo ADMINISTRADOR: quando um administrador, aqui no privado, te contar um fato ou preferência sobre alguém (apelido, parentesco, horário preferido, como tratar a pessoa, etc.) e pedir ou deixar claro que é para você lembrar, registre em memory_candidates (confirmed_fact, recurring_preference ou social_relation, confidence 1); o sistema aprova na hora e confirma com "Anotei" — você só segue a conversa. Nunca registre saúde, dinheiro de pessoa, política, religião, segredo, boato ou insulto. Para ele ver ou apagar o que você sabe, use a consulta "memoria" e a ação memoria_esquecer.
- Pedido que você NÃO consegue executar (não existe nas ações e consultas acima): não improvise nem finja. Responda exatamente: "Ainda não consigo realizar esse pedido, mas consigo aprender a fazer. Informe ao Ítalo essa minha limitação que ele corrige rapidamente." (messages com essa frase, ready: false, transfer: false). Antes de usar essa frase, confira se o pedido não é uma consulta, ação ou arquivo que você já tem.
- "O que você faz?", "o que há de novo?", "quais as novidades?" (intent "admin_consulta", read_domain "capacidades", messages vazio e ready: true): o sistema escreve a lista completa e atual.
  formularios (lista dos formulários do clube e quantas respostas cada um tem) · formulario (QUEM RESPONDEU e QUEM FALTA responder num formulário, por nome: form_ref = nome ou parte do nome do formulário, vazio se só há um aberto; use para "quais sócios já responderam?", "quem ainda não deu sugestão?") · formulario_resultado (o que foi respondido em cada pergunta; form_ref como acima).
  memoria ("o que você sabe sobre o Beto?": member_name = a pessoa, vazio para tudo o que sei) · inadimplentes (quem está devendo, por nome e valor) · pagamentos (quem pagou no período, por nome) · socio_ficha (situação de UM sócio: member_name) · vencimentos (contas a pagar/receber dos próximos dias, por item) · alunos (alunos ativos e dependentes) · movimentos (últimos lançamentos pagos) · socios (relação nominal: "liste os sócios", "quantos sócios", "quem é da diretoria") · caixa (entrou/saiu/saldo do período) · receber_pagar (inadimplência, vencimentos, contas a pagar) · dre (resultado: receitas, despesas, lucro/prejuízo) · receita_alunos (receita de aulas/cards) · comprovantes (fila de análise) · acessos (pedidos de cadastro pendentes) · assinaturas (quem falta assinar) · ocupacao (reservas de um dia; use slots.date, padrão hoje) · followups (retornos pendentes) · preferencias (as preferências dele) · comparativo (compara com o período anterior de mesma duração e mostra o que mudou: "por que a receita caiu?", "como estamos contra o mês passado?"; use read_from/read_to do período atual).
  Período: read_from/read_to (padrão: do dia 1 do mês até hoje). "Este mês", "semana passada", "ontem" etc. você converte em datas a partir de AGORA. Saldo atual das contas já está no contexto (SALDO DAS CONTAS DO CLUBE): pode responder direto.
- Ações administrativas (intent "admin_acao", ready: true, messages vazio; o SISTEMA mostra o que vai fazer e só executa depois do aceite natural do administrador): adm_action
  aviso (publica no app para todos os sócios: ann_title, ann_message, due_date = validade opcional) · aviso_desativar (ann_title) · aluno_status (student_names:[nome], active true = reativar / false = pausar) · socio_status (member_name, active true/false) · assinatura_reenviar (doc_title) · reserva_cancelar (date, start HH:MM, court_label e by_name se houver mais de uma, reason opcional).
  acesso_aprovar / acesso_recusar (member_name = nome do pedido pendente, vazio se só há um; reason opcional na recusa) · socio_criar (cadastrar sócio novo: member_name, phone com DDD, email opcional).
  dependente_criar (cadastrar DEPENDENTE de um sócio, por exemplo a esposa ou o filho: member_name = o SÓCIO responsável, dependent_name = nome completo do dependente, relationship = esposa|esposo|filho|filha|outro, phone opcional). VOCÊ PODE cadastrar dependente: nunca transfira esse pedido. Se faltar o nome do dependente ou o parentesco, marque ready: true com o que tem e o sistema pergunta; CPF não é usado no cadastro (não peça).
  resenha_grupo (o administrador quer animar o grupo de sócios com uma resenha, provocação ou pergunta sobre alguém: "o grupo tá parado", "puxa uma brincadeira", "cadê o Tiago?"): VOCÊ escreve a mensagem em send_body (1 a 2 frases, tom de resenha entre amigos, usando a MEMÓRIA DO GRUPO e o que ele contou; não escreva @, o sistema marca), member_name = o sócio-alvo (vazio se for para a turma toda). Sem alvo definido, escolha você uma vítima e um tema no CARDÁPIO DE RESENHA. Se não souber NADA do alvo para fazer a graça, não invente: antes de propor, pergunte ao administrador UMA coisa específica e divertida ("o que o Carlos anda aprontando? tem alguma fama na turma?"); a resposta dele é para lembrar (memory_candidates) e aí você propõe. O sistema mostra o texto e só posta no grupo depois do "sim".
  aniversario (o administrador contou o aniversário de alguém, ex.: "o aniversário do Lucas é 08/10": member_name = a pessoa, birthday = "DD/MM", sem ano). Grava na hora, sem pedir "sim"; no dia você dá os parabéns sozinho no grupo e no privado.
  memoria_esquecer (apagar da minha memória o que sei sobre alguém: member_name = a pessoa, note = trecho do que esquecer, se ele quiser só uma memória). O sistema lista o que será esquecido e só aplica depois do "sim".
  resumo_destinatario (incluir ou tirar alguém da diretoria do RESUMO DIÁRIO das 8h: member_name = quem, active true = incluir / false = tirar; vale para pedidos como "mande o resumo também para o vice-presidente e o administrador" — se forem duas pessoas, trate uma por vez e peça o nome se o cargo não bastar para identificar). VOCÊ PODE: nunca diga que não consegue mexer na lista. O sistema mostra como a lista fica e só aplica depois do "sim".
  comunicado_enviar (disparar um COMUNICADO no WhatsApp pessoal de TODOS os sócios, agora ou agendado: send_body = o texto EXATO que o administrador escreveu, copiado palavra por palavra, sem resumir nem alterar (pode usar {nome} para o primeiro nome de cada sócio); start = hora do disparo HH:MM e date se não for hoje; sem start sai agora). VOCÊ PODE: nunca diga que não consegue disparar para os sócios nem proponha só aviso no app em vez disso. Se o administrador ainda não passou o texto ou a hora, diga que consegue sim e peça o texto e o horário. Aviso no app (aviso) é coisa diferente: só use se ele pedir aviso no app. O sistema mostra o texto, quantos sócios recebem e o horário, e só envia depois do "sim".
  mensagem_enviar (chamar um SÓCIO no privado e mandar uma mensagem, mesmo sem conversa anterior: member_name, send_body = o texto que VOCÊ escreve, em uma só frase corrida, em primeira pessoa como o João, com o recado do administrador e a pergunta que ele pediu; link do aplicativo do clube: https://stcplay.com.br — nunca invente outro link). VOCÊ PODE chamar sócio: nunca diga que não consegue nem transfira esse pedido. O sistema mostra o texto exato e só envia depois do "sim".
  formulario_criar (CRIAR formulário ou votação do clube: form_title; description opcional; form_questions = lista com title, type unica (escolha única) | multipla (múltipla escolha) | texto (resposta escrita), required (true por padrão) e options = alternativas, EXATAMENTE como o administrador ditou; form_secret true só se ele pedir votação secreta/anônima; form_multiple true só se pedir que o sócio possa responder mais de uma vez; due_date = prazo opcional). VOCÊ PODE criar formulário: nunca diga que não consegue. Se faltar o título ou as perguntas, pergunte só isso. O sistema mostra o resumo com o link e só cria depois do "sim").
  formulario_status (ENCERRAR ou REABRIR um formulário: form_ref = nome ou parte do nome; active false = encerrar, true = reabrir; due_date = novo prazo se ele disser).
  formulario_cobrar (LEMBRAR POR WHATSAPP, com o link, SÓ quem ainda não respondeu o formulário: form_ref = nome ou parte do nome (vazio se só há um aberto); send_body SÓ se o administrador ditou um texto próprio (copie exato, pode usar {nome}); sem send_body o sistema usa um texto padrão com o link; start = hora HH:MM e date se não for hoje; sem start sai agora). VOCÊ PODE: nunca diga que não consegue mandar mensagem com o link do formulário para quem não respondeu. O sistema lista quem vai receber e só envia depois do "sim". Para só saber quem falta, use a consulta formulario.
  followup_criar (retorno/lembrete: member_name da conversa, vazio = lembrete para ele mesmo; date e start; note = o que lembrar; send_body só se ele pedir que eu MANDE uma mensagem ao sócio no horário) · followup_concluir (member_name; date se houver mais de um; active false = cancelar) · quadra_bloquear (court_label, date, start, duration em MINUTOS, reason: cria uma reserva "Bloqueio" que impede outras reservas; para liberar use reserva_cancelar) · preferencia (pref: resumo e alertas com active true/false; estilo com pref_value "curto" ou "completo"; saldo_minimo com amount em reais, ou active false para tirar; dias_atraso com pref_value número; conta_padrao com account_name, ou active false para tirar).
  Sócio novo (aprovar acesso ou criar) SEMPRE entra com a mensalidade do mês paga: pergunte, nesta ordem, o que faltar: nome, telefone, valor da mensalidade (amount, em reais) e o COMPROVANTE (ele manda a imagem ou o PDF na conversa; você não lê a imagem, o sistema lê). Só marque ready: true com nome, telefone (criar) e valor; o sistema avisa se falta o comprovante. Depois que ele mandar o comprovante, retome com ready: true e os mesmos dados.  Texto de aviso: use as palavras do administrador, sem inventar.
- Receita ou despesa com valor e descrição mas sem categoria: marque ready:true assim mesmo — o SISTEMA responde com as categorias válidas do clube (e sugere quando só uma serve). Não invente nome de categoria.
- PEDIDO NOVO OU COMPOSTO: se o administrador pedir algo que não é UMA ação da lista, mas que o clube consegue fazer (várias ações em sequência, ou algo que se faz no painel), NUNCA diga que não consegue. Analise e devolva plan = {"goal":"o que ele quer, em uma frase","steps":[{"label":"o passo","fin_action" ou "adm_action":"a ação da lista, se houver","slots":{os dados do passo, no formato dos slots},"how":"se não houver ação: onde e como fazer no painel (seção e caminho)"}]}, em ordem, até 8 passos. Use só ações da lista; nunca invente ação. Deixe messages vazio: o SISTEMA mostra o plano, prepara o primeiro passo e, a cada aceite natural, executa e emenda o próximo. plan só no turno em que você monta o plano; depois, null (os passos continuam no ASSUNTO). Para corrigir um passo, preencha os slots normalmente com o intent do passo.
- Qualquer valor: depois do resumo, qualquer aceite natural do administrador basta (customer_confirmed: true); nunca peça para ele digitar "sim", não peça confirmação a mais nem repetição do valor.
- Pedidos de apagar, zerar ranking, trocar papel, encerrar plano ou mudar configuração: o sistema recusa e indica o painel; você não executa nem promete.

`;
}
function clubBalancesText(ctx: Ctx): string {
  const b = (ctx.club_balances ?? null) as Ctx | null;
  const contas = Array.isArray(b?.accounts) ? b!.accounts as Ctx[] : [];
  if (!b || !contas.length) return '\n\nSALDO DAS CONTAS DO CLUBE: (não disponível agora)';
  const linhas = contas.map((c) => `- ${c.name} (${c.kind}): ${moneyBR(Number(c.balance_cents) / 100)}`).join('\n');
  return `\n\nSALDO DAS CONTAS DO CLUBE (caixa, banco etc.; "saldo do clube" = total):\n${linhas}\nTOTAL: ${moneyBR(Number(b.total_cents) / 100)}`;
}

/** Professor (ou o assessor dele) no privado vê só os alunos DELE. */
function professorStudents(students: Ctx[], requester: Ctx | undefined): Ctx[] {
  const nome = fold(String(requester?.name ?? '').trim());
  if (!requester?.professor_id || !nome) return [];
  return students.filter((s) => fold(String(s.professor ?? '').trim()) === nome);
}

export function financialContextText(ctx: Ctx, buffered = ''): string {
  const fin = (ctx.financial_context ?? {}) as Ctx;
  const students = Array.isArray(fin.students) ? fin.students as Ctx[] : [];
  const dayCards = Array.isArray(fin.day_cards) ? fin.day_cards as Ctx[] : [];
  const pendencies = Array.isArray(fin.member_pendencies) ? fin.member_pendencies as Ctx[] : [];

  const conversa = fold([
    buffered,
    ...((ctx.transcript ?? []) as Ctx[]).map((x) => String(x.body ?? '')),
    ...((ctx.group_context ?? []) as Ctx[]).flatMap((x) => [String(x.sender ?? ''), String(x.body ?? '')]),
  ].join(' '));
  const requester = ((ctx.requester ?? {}) as Ctx).profile as Ctx | undefined;
  const requesterId = String(requester?.id ?? '');
  const requesterName = fold(String(requester?.name ?? ''));

  const financeTerms = /\b(card|mensal|mensalidade|vencid|validade|pagamento|pago|pendente|pendencia|divida|cobranca|pix|aluno|dependente|day\s*card)\b/.test(conversa);
  const nameHit = (name: unknown) => {
    const n = fold(String(name ?? '').trim());
    if (!n) return false;
    if (conversa.includes(n)) return true;
    const first = n.split(/\s+/)[0] ?? '';
    return first.length >= 4 && conversa.includes(first);
  };

  const admin = isAdminAssistant(ctx);
  const wide = ctx.is_group || admin;
  const ownStudents = wide ? [] : professorStudents(students, requester);
  const visibleStudents = wide ? students : ownStudents;
  const namedStudents = visibleStudents.filter((s) => nameHit(s.name));
  const studentRows = wide || ownStudents.length ? (namedStudents.length ? namedStudents : financeTerms ? visibleStudents : []) : [];
  const studentText = studentRows.length
    ? studentRows.map((s) => {
        const status = String(s.card_status ?? 'unknown').toUpperCase();
        const validade = s.valid_until ? ` | validade ${brDateFull(s.valid_until)}` : '';
        const professor = s.professor ? ` | professor ${s.professor}` : '';
        const resp = s.responsible ? ` | responsável ${s.responsible}` : '';
        const pagou = s.last_active_payment_on
          ? ` | último pagamento ${brDateFull(s.last_active_payment_on)}${s.last_active_payment_amount != null ? ` (${moneyBR(s.last_active_payment_amount)})` : ''}`
          : '';
        const hist = s.record_active === false ? ' | cadastro histórico/inativo' : '';
        return `- ${String(s.name ?? '').trim()} | ${s.plan_type ?? 'sem plano'} | ${status}${validade}${professor}${resp}${pagou}${hist}`;
      }).join('\n')
    : wide || ownStudents.length ? '(nenhum aluno/card relevante encontrado para esta conversa)' : '(não exposto no privado)';

  const dayCardTerms = /\b(day\s*card|convidad|pago|pagamento|pendente|isento)\b/.test(conversa);
  const namedDay = dayCards.filter((d) => nameHit(d.guest_name) || nameHit(d.booked_by));
  const dayRows = wide ? (namedDay.length ? namedDay : dayCardTerms ? dayCards.slice(0, 20) : []) : [];
  const dayText = dayRows.length
    ? dayRows.map((d) => {
        const valor = d.amount_cents != null ? ` | R$ ${(Number(d.amount_cents) / 100).toFixed(2).replace('.', ',')}` : '';
        return `- ${d.guest_name} | ${brDateFull(d.date)} | ${String(d.payment_status ?? '').toUpperCase()}${d.booked_by ? ` | reserva de ${d.booked_by}` : ''}${valor}`;
      }).join('\n')
    : wide ? '(nenhum Day Card de convidado relevante encontrado para esta conversa)' : '(não exposto no privado)';

  // Pelo id do cadastro; o nome só vale quando o banco não trouxe o id (homônimos não veem a pendência um do outro).
  const ownPendency = (p: Ctx) => (p.member_id
    ? Boolean(requesterId) && String(p.member_id) === requesterId
    : Boolean(requesterName) && fold(String(p.member_name ?? '')) === requesterName);
  const namedPendency = pendencies.filter((p) => nameHit(p.member_name) || nameHit(p.guest_name));
  const pendencyRows = ctx.is_group
    ? (namedPendency.length ? namedPendency : financeTerms ? pendencies.filter((p) => ['open', 'partial'].includes(String(p.status))).slice(0, 30) : [])
    : actingFor(ctx) ? [] : pendencies.filter(ownPendency);

  // Administrador no privado: todas as em aberto, numeradas (p1, p2…) para ele apontar a pendência numa ação.
  const refById = new Map(adminPendencyRefs(ctx).map((r) => [r.id, r.ref]));
  if (admin) {
    const abertas = pendencies.filter((p) => refById.has(String(p.id)));
    const fechadas = namedPendency.filter((p) => !refById.has(String(p.id))).slice(0, 20);
    pendencyRows.splice(0, pendencyRows.length, ...abertas, ...fechadas);
  }
  const pendencyText = pendencyRows.length
    ? pendencyRows.map((p) => {
        const due = p.total_due_cents != null ? ` | saldo R$ ${(Number(p.total_due_cents) / 100).toFixed(2).replace('.', ',')}` : '';
        const paid = p.principal_paid_cents ? ` | pago R$ ${(Number(p.principal_paid_cents) / 100).toFixed(2).replace('.', ',')}` : '';
        const guest = p.guest_name ? ` | convidado ${p.guest_name}${p.guest_date ? ` em ${brDateFull(p.guest_date)}` : ''}` : '';
        const review = p.in_review ? ' | comprovante em análise' : '';
        const ref = admin && refById.has(String(p.id)) ? `${refById.get(String(p.id))} | ` : '';
        const regua = admin && p.collection_enabled === false ? ' | cobrança pausada' : '';
        return `- ${ref}${p.member_name} | ${p.description} | ${String(p.status ?? '').toUpperCase()} | vence ${brDateFull(p.due_date)}${due}${paid}${guest}${review}${regua}`;
      }).join('\n')
    : '(nenhuma pendência de sócio relevante encontrada)';

  return `ALUNOS/CARDS:\n${studentText}\n\nDAY CARDS DE CONVIDADOS:\n${dayText}\n\nPENDÊNCIAS DE SÓCIO:\n${pendencyText}${admin ? clubBalancesText(ctx) : ''}\n\nPIX DO CLUBE: ${fin.pix_key ?? '(não confirmado)'}\n\nAtualizado em: ${fin.as_of ?? '(agora)'}`;
}
