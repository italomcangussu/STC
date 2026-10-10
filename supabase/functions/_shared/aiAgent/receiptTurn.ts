// @ts-nocheck
// Gateway de comprovantes antes do motor conversacional normal.
// Fica fora de turn.ts para evitar regressão do agendador, memórias e ações administrativas.
import { runTurn } from './turn.ts';
import { createReceiptFlow } from './receiptFlow.ts';
import { buildChatRequest,providerIdFrom,uazError } from '../uazChat.ts';

export function makeReceiptAwareTurn(opts:{service:any,chat:any,uaz:any,authorizationSecret:string,finalize:(messageId:string)=>Promise<any>,deps:any}) {
  const {service,chat,uaz,deps,finalize,authorizationSecret}=opts;
  // Enviar as respostas de confirmação pelo mesmo canal auditável do João.
  async function answer(messageId:string,trigger:any,body:string,action:string,memory:any){
    const q=await service.rpc('conv_svc_queue_message',{
      p_conversation:trigger.conversation_id,
      p:{kind:'text',body},
      p_author:null,p_key:crypto.randomUUID(),p_origin:'ai',p_session:trigger.session_id,
    });
    const queued=q.data;
    const target=Array.isArray(queued)?queued[0]:queued;
    if(q.error||!target?.message_id||!target.destination) throw new Error('RECEIPT_REPLY_QUEUE_FAILED');
    const pedido=buildChatRequest({action:'send',number:target.destination,kind:'text',text:body,replyId:target.reply_provider_id});
    const r=pedido&&uaz?await uaz(pedido):{ok:false,error:'WHATSAPP_NOT_CONFIGURED'};
    await service.rpc('conv_svc_finish_message',{
      p_message:target.message_id,p_sent:r.ok,
      p_provider_id:r.ok?providerIdFrom(r.body):null,p_error:uazError(r),
    });
    await service.rpc('conv_svc_ai_save_turn',{
      p_session:trigger.session_id,p_memory:memory??null,p_decision:action,
      p_payload:{action,receipt_message_id:messageId},p_awaiting:true,p_close:false,
    });
    return {status:r.ok?'replied':'send_failed',bubbles:r.ok?1:0,handoff:null,action};
  }
  return async function run(messageId:string,mediaOnly=false) {
    const q=await service.from('conv_messages')
      .select('id,kind,direction,conversation_id,media_path,media_mime,body')
      .eq('id',messageId).maybeSingle();
    const m=q.data;
    if(q.error||!m||m.direction!=='inbound'||!m.conversation_id)
      return await runTurn(messageId,{...deps,mediaOnly});
    const co=await service.from('conv_conversations').select('kind').eq('id',m.conversation_id).maybeSingle();
    if(co.data?.kind==='direct'){
      const triggerR=await service.rpc('conv_svc_ai_trigger',{p_message:messageId});
      const trigger=triggerR.data;
      if(!triggerR.error&&trigger?.run&&trigger.session_id) {
        const ctxR=await service.rpc('conv_svc_ai_context',{p_session:trigger.session_id});
        const ctx=ctxR.data;
        const ms=Math.max(0,Number(ctx?.settings?.buffer_seconds??0))*1000;
        if(ms)await new Promise(resolve=>setTimeout(resolve,ms));
        const latestR=await service.rpc('conv_svc_ai_is_latest',{p_message:messageId});
        if(!latestR.error&&latestR.data===true){
          // Instanciar a cada turno para usar o modelo REAL configurado no STC.
          const configuredFlow=createReceiptFlow({
            service,chat,authorizationSecret,
            model:()=>String(ctx?.settings?.model??'').trim()||null,
            finalize,
          });
          const f=await configuredFlow({
            conversationId:m.conversation_id,messageId,
            text:String(m.body??''),
            transcript:Array.isArray(ctx?.transcript)?ctx.transcript:[],
          });
          if(f.handled) {
            if(f.message) return await answer(messageId,trigger,f.message,f.action??'receipt_waiting',ctx?.session?.memory);
            return {status:'replied',bubbles:0,handoff:null,action:f.action??'receipt_waiting'};
          }
        }
      }
    }
    return await runTurn(messageId,{...deps,mediaOnly});
  };
}
