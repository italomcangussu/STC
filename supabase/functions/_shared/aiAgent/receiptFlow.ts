// @ts-nocheck
// Confirmação cognitiva da finalidade do comprovante, vinculada à mensagem original.
// Antes do "sim" explícito do REMETENTE, só há mídia na conversa: nada vai ao financeiro.
// Estados persistentes no meta da mensagem original (sem perder os demais assuntos do João).
import type { Chat } from './llm.ts';

type AnyRow = Record<string, any>;
type Reply = { handled: boolean; message?: string; action?: string };
export type ReceiptFlowInput = {
  conversationId: string;
  messageId: string;
  text: string;
  transcript?: AnyRow[];
};
const validMime = new Set(['image/jpeg','image/png','image/webp','image/heic','application/pdf']);
const activeStages = new Set(['awaiting_purpose','awaiting_confirmation']);
const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const extractJson = (v: string) => {
  const m=v.match(/\{[\s\S]*\}/);if(!m)return {};
  try{return JSON.parse(m[0]);}catch{return {};}
};
const cleanSubject = (v: any) => String(v ?? '').replace(/[\r\n]/g,' ').trim().slice(0,160);

export function createReceiptFlow(args: {
  service: any;
  chat: Chat | null;
  model: () => string | null;
  authorizationSecret: string;
  finalize: (originalMessageId: string) => Promise<AnyRow>;
}) {
  const {service,chat,model,authorizationSecret,finalize}=args;
  async function proofMac(messageId:string,purposeMessageId:string,confirmationMessageId:string,purpose:string,subject:string){
    const material=[messageId,purposeMessageId,confirmationMessageId,purpose,subject].join('|');
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(authorizationSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(material)));
    return [...mac].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function read(id: string): Promise<AnyRow | null> {
    const {data,error}=await service.from('conv_messages')
      .select('id,conversation_id,direction,kind,body,media_path,media_mime,created_at,meta')
      .eq('id',id).maybeSingle();
    return error?null:data;
  }
  async function persist(original: AnyRow, state: AnyRow): Promise<boolean> {
    // Só o servidor edita o estado; preservar metadados nativos do provedor.
    const {error}=await service.from('conv_messages')
      .update({meta:{...(original.meta??{}),stc_receipt_confirmation:state}})
      .eq('id',original.id).eq('conversation_id',original.conversation_id);
    if(error)console.error('RECEIPT_FLOW_PERSIST',error.message);
    return !error;
  }
  async function classify(stage:string, userText:string, state:AnyRow, transcript:AnyRow[]) {
    // Modelo lê intenção/negação/correção livremente, mas NUNCA confirma nem grava.
    // O estado persistido e a sequência cronológica são validados pelo servidor.
    if(!chat||!model()) return {action:'unknown'};
    const recent=transcript.slice(-8).map(m=>({
      direction:m.direction,kind:m.kind,body:String(m.body??'').slice(0,260),
    }));
    const schema=stage==='awaiting_purpose'
      ? 'Responda JSON: {"action":"purpose|unrelated|cancel|unknown","purpose":"membership|member_pendency|donation|other|null","subject":"resumo curto da finalidade ou nome do evento"}. Só purpose se o usuário identificar claramente a natureza do pagamento. Nunca presuma mensalidade pelo valor.'
      : 'Responda JSON: {"action":"confirm|correct|cancel|unrelated|unknown","purpose":"membership|member_pendency|donation|other|null","subject":"ajuste se houver"}. CONFIRM só para aceitação inequívoca da PROPOSTA atual (sim, pode registrar, isso mesmo), sem ressalvas. Correções/contradições são correct; pergunta ou frase sobre outro assunto é unrelated. Não confunda "sim" em outro tópico com autorização.';
    try{
      const r=await chat([
        {role:'system',content:'Você é classificador financeiro de alta precisão para o STC. Responda APENAS JSON válido; não execute nada. Requer duas mensagens distintas: primeira explica a finalidade, segunda autoriza registro. Se inseguro, unknown. Campanha Dia das Crianças é DOAÇÃO, nunca mensalidade.\n'+schema},
        {role:'user',content:JSON.stringify({stage,current_purpose:state.purpose??null,current_subject:state.subject??null,conversation:recent,userText})}
      ],{model:model()!,temperature:0,maxTokens:180,json:true});
      return extractJson(r.output);
    }catch(e){console.error('RECEIPT_FLOW_CLASSIFY_FAILED',e instanceof Error?e.name:'unknown');return {action:'unknown'};}
  }
  return async function receiptFlow(i:ReceiptFlowInput):Promise<Reply>{
    const last=await read(i.messageId);
    if(!last||last.conversation_id!==i.conversationId||last.direction!=='inbound')return {handled:false};
    const isMedia=(last.kind==='image'||last.kind==='document')&&
      !!last.media_path&&validMime.has(String(last.media_mime??'').split(';')[0].toLowerCase());
    // Somente chats individuais: arquivos do grupo nunca criam movimentação financeira.
    const {data:conv}=await service.from('conv_conversations')
      .select('kind').eq('id',i.conversationId).maybeSingle();
    if(conv?.kind!=='direct')return {handled:false};
    if(isMedia) {
      const current=(last.meta?.stc_receipt_confirmation??null) as AnyRow | null;
      if(current?.stage==='registered')return {handled:true,action:'receipt_already_registered',message:'Esse comprovante já está registrado para conferência, sem novo lançamento.'};
      if(current?.stage==='confirmed')return {handled:true,action:'receipt_confirmed',message:'Esse comprovante já foi confirmado e está aguardando a conclusão do registro.'};
      if(current?.stage==='canceled')return {handled:true,action:'receipt_canceled',message:'Esse arquivo foi cancelado. Se quiser usá-lo, envie novamente.'};
      if(current?.stage==='awaiting_confirmation')
        return {handled:true,action:'receipt_awaiting_confirmation',message:`Entendi que é ${current.subject||'um pagamento de '+String(current.purpose)}. Posso registrar esse comprovante assim? Responda sim ou me corrija.`};
      if(!current&&!(await persist(last,{stage:'awaiting_purpose',purpose:null,subject:null,created_at:new Date().toISOString()})))
        return {handled:true,message:'Recebi a imagem, mas não consegui preparar a conferência. Pode enviá-la novamente?'};
      return {handled:true,action:'receipt_ask_purpose',message:'Recebi o arquivo. É comprovante de quê: mensalidade, doação para uma campanha ou outro pagamento? Me diga a finalidade para eu conferir sem lançar no caixa errado.'};
    }

    const userText=(i.text??'').trim();
    if(!userText||!['text','audio','ptt'].includes(last.kind))return {handled:false};
    const {data:recent,error}=await service.from('conv_messages')
      .select('id,conversation_id,direction,kind,body,media_path,media_mime,created_at,meta')
      .eq('conversation_id',i.conversationId).eq('direction','inbound')
      .in('kind',['image','document'])
      .lt('created_at',last.created_at).order('created_at',{ascending:false}).limit(12);
    if(error||!recent?.length)return {handled:false};
    // Preferir o comprovante ativo MAIS RECENTE. Outras imagens não são transformadas em recibos.
    const original=recent.find(m=>activeStages.has(String(m.meta?.stc_receipt_confirmation?.stage??'')));
    if(!original)return {handled:false};
    const state={...original.meta.stc_receipt_confirmation};
    const decision=await classify(state.stage,String(last.body??userText),state,i.transcript??[]);
    const action=String(decision.action??'unknown');
    if(action==='unrelated')return {handled:false};
    if(action==='cancel'){
      if(!(await persist(original,{...state,stage:'canceled',canceled_message_id:last.id,updated_at:new Date().toISOString()})))
        return {handled:true,message:'Não consegui cancelar agora; vou manter o comprovante sem lançamento.'};
      return {handled:true,action:'receipt_canceled',message:'Certo, não vou registrar esse comprovante no financeiro.'};
    }
    if(state.stage==='awaiting_purpose') {
      const purpose=String(decision.purpose??'');
      if(action!=='purpose'||!['membership','member_pendency','donation','other'].includes(purpose))
        return {handled:true,action:'receipt_need_purpose',message:'Só para eu classificar certinho: esse comprovante é de mensalidade, pendência do clube, doação ou outra coisa?'};
      const labels={membership:'mensalidade',member_pendency:'pendência de sócio',donation:'doação',other:'outro recebimento'};
      const subject=cleanSubject(decision.subject)||labels[purpose];
      const updated={...state,stage:'awaiting_confirmation',purpose,subject,purpose_message_id:last.id,updated_at:new Date().toISOString()};
      if(!(await persist(original,updated)))return {handled:true,message:'Não consegui salvar a finalidade. Pode repetir a que pagamento se refere?'};
      return {handled:true,action:'receipt_ask_confirmation',message:`Entendi: é ${subject} (${labels[purpose]}). Posso registrar esse comprovante nessa finalidade, para conferência no financeiro? Isso não quita mensalidade automaticamente.`};
    }
    if(state.stage==='awaiting_confirmation'){
      if(action==='correct'){
        const updated={...state,stage:'awaiting_purpose',purpose:null,subject:null,purpose_message_id:null,updated_at:new Date().toISOString()};
        await persist(original,updated);
        return {handled:true,action:'receipt_purpose_correct',message:'Certo, vou corrigir. Qual é a finalidade correta desse comprovante?'};
      }
      if(action!=='confirm')return {handled:true,action:'receipt_need_explicit_confirmation',message:`Ainda não registrei. Confirma que esse comprovante é ${state.subject||'do pagamento informado'} e posso deixá-lo para conferência financeira?`};
      const originalDate=new Date(original.created_at).getTime();
      const purposeMsg=await read(String(state.purpose_message_id??''));
      if(!purposeMsg||purposeMsg.conversation_id!==i.conversationId||
          purposeMsg.direction!=='inbound'||new Date(purposeMsg.created_at).getTime()<=originalDate||
          new Date(last.created_at).getTime()<=new Date(purposeMsg.created_at).getTime()) {
        return {handled:true,message:'Preciso confirmar novamente a finalidade deste arquivo antes de registrar.'};
      }
      const mac=await proofMac(original.id,String(state.purpose_message_id),last.id,String(state.purpose),String(state.subject??''));
      const accepted={...state,stage:'confirmed',confirmation_message_id:last.id,confirmation_mac:mac,updated_at:new Date().toISOString()};
      if(!(await persist(original,accepted)))return {handled:true,message:'Não consegui guardar sua confirmação; não fiz nenhum lançamento.'};
      const result=await finalize(original.id).catch(()=>({ok:false,reason:'FINALIZATION_UNAVAILABLE'}));
      if(result.ok&&result.registered)
        return {handled:true,action:'receipt_registered',message:`Comprovante de ${state.subject||'pagamento'} registrado para conferência do financeiro. Não dei baixa em mensalidade nem somei receita ao caixa ainda.`};
      return {handled:true,action:'receipt_confirmed_pending',message:'Sua finalidade e autorização estão confirmadas, mas o registro financeiro ainda não foi concluído. Não vou lançar valores nem dar baixa até a conferência. O arquivo continua na conversa.'};
    }
    return {handled:false};
  };
}
