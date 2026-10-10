// João: intenção do comprovante -> finalidade -> confirmação do remetente -> fila financeira.
// OCR nunca define finalidade; "sim" apenas confirma proposta ainda aberta.
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error?:{message:string}|null}>;
type Chat=(messages:{role:'system'|'user'|'assistant';content:string}[],config:{model:string;temperature?:number;maxTokens?:number;json?:boolean})=>Promise<{output:string}>;
export type ReceiptStage={id:string;source_message_id:string;status:'awaiting_purpose'|'awaiting_confirmation';purpose_kind?:string|null;purpose_detail?:string|null;amount_cents?:string|null;paid_on?:string|null;payee?:string|null;created_at?:string|null};
type Turn={stage:ReceiptStage;messageId?:string;mediaOnly:boolean;text:string;transcript:Record<string,unknown>[];db:Rpc;chat:Chat|null;model:string};
type Response={messages:string[];action:string}|null;
const normal=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const br=(c:unknown)=>{const n=Number(c);return Number.isFinite(n)&&n>0?'R$ '+(n/100).toFixed(2).replace('.',','):'valor não identificado';};
const names:Record<string,string>={donation:'doação/campanha',membership:'mensalidade de sócio',member_pendency:'pendência de sócio',student_card:'Card Mensal de aluno',day_card:'Day Card',other:'outra finalidade'};
const valid=new Set(Object.keys(names));
const yes=/^(sim|confirmo|confirmado|pode registrar|pode lancar|pode lançar|isso mesmo|correto|exatamente|certo|ok)[\s.!]*$/i;
const no=/^(n[aã]o|nao|errado|n[aã]o,? (?:[eé] isso|[eé] esse|[eé] assim)|quero corrigir|corrigir)[\s.!]*$/i;
const campaign=/\b(campanha|criancas|dia das criancas|doacao|contribuicao|brinquedos)\b/;

export async function handleReceiptIntent(t:Turn):Promise<Response>{
 const s=t.stage;
 const prev=t.transcript.filter(x=>x.direction==='inbound'&&x.kind==='text').slice(0,8).reverse().map(x=>String(x.body||'')).join('\n');
 const amount=br(s.amount_cents);
 if(t.mediaOnly){
   if(campaign.test(normal(prev))) return {action:'receipt_purpose_requested',messages:['Recebi o comprovante ('+amount+'). Pelo que conversamos, pode ser uma contribuição para a campanha do Dia das Crianças. Confirma que é dessa campanha ou me diz a finalidade correta? Ainda não lancei nada no caixa.']};
   return {action:'receipt_purpose_requested',messages:['Recebi o comprovante ('+amount+'), mas ainda não vou lançar. Esse pagamento é referente a quê: mensalidade, Card, pendência, doação ou outra coisa? Me explica para eu classificar corretamente.']};
 }
 if(!t.messageId||!t.text.trim())return null;
 const clean=t.text.trim();
 if(s.status==='awaiting_confirmation'){
   if(no.test(clean)){
     const r=await t.db('conv_svc_receipt_revise',{p_stage:s.id,p_message:t.messageId});
     if((r.data as {ok?:boolean}|null)?.ok) return {action:'receipt_purpose_correction',messages:['Certo, não registrei nada. Qual é a finalidade correta desse comprovante?']};
     return {action:'receipt_error',messages:['Não consegui corrigir essa proposta. Pode repetir o que o pagamento representa?']};
   }
   if(yes.test(clean)){
     const r=await t.db('conv_svc_receipt_confirm',{p_stage:s.id,p_message:t.messageId});
     const result=r.data as {ok?:boolean;status?:string;reason?:string;kind?:string;code?:string}|null;
     if(!result?.ok)return {action:'receipt_not_confirmed',messages:['Não consegui validar a confirmação dessa proposta. Pode responder "confirmo" à descrição que enviei? Nenhum valor foi baixado.']};
     if(result.status==='needs_review')return {action:'receipt_pending_review',messages:['Finalidade confirmada. Separei o comprovante para conferência financeira, pois os dados ou a vinculação ainda precisam de revisão. Não dei baixa em mensalidade nem alterei o saldo do caixa.']};
     if(result.kind==='donation')return {action:'receipt_donation_registered',messages:['Confirmação recebida. Registrei a doação como receita a conferir, separada das mensalidades. O valor só entrará no saldo do caixa após conferência financeira.']};
     return {action:'receipt_registered',messages:['Confirmação recebida. Coloquei o comprovante na fila de conferência da finalidade informada. Ainda não dei baixa na cobrança nem alterei o caixa.']};
   }
   if(!/(comprov|pagamento|doa|card|mensal|outro|corrig|troca|na verdade)/i.test(normal(clean)))return null;
   const r=await t.db('conv_svc_receipt_revise',{p_stage:s.id,p_message:t.messageId});
   if((r.data as {ok?:boolean}|null)?.ok)return {action:'receipt_purpose_correction',messages:['Entendi que quer ajustar a finalidade. Não lancei nada. Pode me dizer para que foi esse pagamento?']};
   return null;
 }
 if(s.status!=='awaiting_purpose')return null;
 const lastBot=t.transcript.filter(x=>x.direction==='outbound').slice(0,2).reverse().map(x=>String(x.body||'')).join('\n');
 if(!t.chat||!t.model)return {action:'receipt_purpose_requested',messages:['Qual é a finalidade desse comprovante? Preciso que me diga antes de montar o resumo para confirmação.']};
 let parsed:{action?:string;purpose_kind?:string;purpose_detail?:string}={};
 try{
   const output=await t.chat([
     {role:'system',content:[
      'Você classifica UMA resposta do remetente sobre a finalidade de um comprovante recebido no STC.',
      'Responda SOMENTE JSON: {"action":"purpose|unclear|unrelated","purpose_kind":"donation|membership|member_pendency|student_card|day_card|other|null","purpose_detail":"texto breve|null"}.',
      'Use o sentido da conversa e das perguntas anteriores. "Sim" só indica doação se a pergunta imediatamente anterior era explicitamente "é da campanha?".',
      'Doação de campanha, especialmente Dia das Crianças, NÃO É mensalidade nem Card.',
      'Nunca conclua finalidade apenas por valor (inclusive R$ 30), PIX, OCR, nome do favorecido ou por existir cobrança em aberto.',
      'Comprovantes encaminhados por terceiros NÃO são, por padrão, pagamentos da mensalidade do remetente.',
      'Se o remetente falou de outro assunto: action=unrelated. Se finalidade ambígua: action=unclear. Não afirme que foi pago.'
     ].join('\n')},
     {role:'user',content:'Mensagens recentes:\n'+prev.slice(-1500)+'\nPergunta do João:\n'+lastBot.slice(-550)+'\nNova mensagem:\n'+clean.slice(0,900)}
   ],{model:t.model,temperature:0,maxTokens:220,json:true});
   parsed=JSON.parse(output.output);
 }catch{return {action:'receipt_purpose_unclear',messages:['Quero registrar da forma certa. Esse comprovante é de mensalidade, doação para a campanha das crianças ou outro pagamento?']}};
 if(parsed.action==='unrelated')return null;
 const kind=String(parsed.purpose_kind||'');
 const detail=String(parsed.purpose_detail||'').trim();
 if(parsed.action!=='purpose'||!valid.has(kind)||detail.length<3)return {action:'receipt_purpose_unclear',messages:['Para não classificar errado, me diz: esse comprovante é referente a qual pagamento? Não registrei nada.']};
 const r=await t.db('conv_svc_receipt_purpose',{p_stage:s.id,p_message:t.messageId,p_kind:kind,p_detail:detail});
 if(!(r.data as {ok?:boolean}|null)?.ok)return {action:'receipt_purpose_not_saved',messages:['Não consegui preparar a classificação. Pode repetir a finalidade? Não fiz nenhum lançamento.']};
 return {action:'receipt_confirmation_requested',messages:['Vou classificar o comprovante de '+amount+' como '+names[kind]+' ('+detail+'). Confirma que essa é a finalidade e autoriza registrar para conferência? Responda "confirmo" ou "não". Ainda não dei baixa nem alterei o caixa.']};
}
