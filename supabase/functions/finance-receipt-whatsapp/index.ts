// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { readReceiptServer } from '../_shared/financeReceiptOcr.ts';

const url=Deno.env.get('SUPABASE_URL');
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SUPABASE_SECRET_KEY');
if(!url||!secret) throw new Error('Missing server configuration');
const service=createClient(url,secret,{auth:{persistSession:false}});

const SOURCE_BUCKET='conv-media';
const RECEIPTS_BUCKET='fin-receipts';
const MAX=10*1024*1024;
const allowed=new Set(['application/pdf','image/jpeg','image/png','image/webp','image/heic']);

const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8'}});

async function sha256(bytes:Uint8Array){
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function safeName(name:string,mime:string){
  const ext=mime==='application/pdf'?'pdf':mime==='image/png'?'png':mime==='image/webp'?'webp':mime==='image/heic'?'heic':'jpg';
  const base=(name||'comprovante').split(/[\\/]/).pop()!.replace(/\.[^.]*$/,'')
    .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^[-.]+|[-.]+$/g,'').slice(0,60)||'comprovante';
  return `${base}.${ext}`;
}

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json(405,{error:'METHOD_NOT_ALLOWED'});
  const auth=req.headers.get('authorization')||'';
  if(auth!==`Bearer ${secret}`) return json(401,{error:'UNAUTHORIZED'});

  let body:any;
  try{body=await req.json();}catch{return json(400,{error:'INVALID_JSON'});}
  const messageId=String(body?.message_id??'');
  if(!/^[0-9a-f-]{36}$/i.test(messageId)) return json(400,{error:'INVALID_MESSAGE_ID'});

  const {data:msg,error:msgErr}=await service.from('conv_messages')
    .select('id,conversation_id,direction,kind,media_path,media_mime,media_name')
    .eq('id',messageId).maybeSingle();
  if(msgErr) return json(500,{error:'MESSAGE_QUERY_FAILED'});
  if(!msg?.media_path||msg.direction!=='inbound') return json(200,{skipped:true,reason:'NO_INBOUND_MEDIA'});
  // Figurinha não é comprovante: antes virava um envio "em análise" com leitura falha.
  if(msg.kind==='sticker') return json(200,{skipped:true,reason:'STICKER'});

  const mime=String(msg.media_mime||'').split(';')[0].trim().toLowerCase();
  if(!allowed.has(mime)) return json(200,{skipped:true,reason:'UNSUPPORTED_MEDIA'});

  const {data:conv}=await service.from('conv_conversations').select('id,kind,contact_id').eq('id',msg.conversation_id).maybeSingle();
  if(!conv||conv.kind!=='direct'||!conv.contact_id) return json(200,{skipped:true,reason:'NOT_DIRECT_CHAT'});

  const {data:contact}=await service.from('conv_contacts').select('profile_id,link_status').eq('id',conv.contact_id).maybeSingle();
  if(!contact?.profile_id||!['linked','manual'].includes(String(contact.link_status))) return json(200,{skipped:true,reason:'CONTACT_NOT_LINKED'});

  // Cobranças em aberto (e a mensalidade do mês, se ainda não foi gerada) são resolvidas no banco.

  const {data:file,error:downErr}=await service.storage.from(SOURCE_BUCKET).download(msg.media_path);
  if(downErr||!file) return json(500,{error:'MEDIA_DOWNLOAD_FAILED'});
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!bytes.length||bytes.length>MAX) return json(200,{skipped:true,reason:'INVALID_MEDIA_SIZE'});

  const hash=await sha256(bytes);
  const submissionId=crypto.randomUUID();
  const name=safeName(String(msg.media_name||'comprovante'),mime);
  const storagePath=`${contact.profile_id}/${submissionId}/${name}`;

  const up=await service.storage.from(RECEIPTS_BUCKET).upload(storagePath,bytes,{contentType:mime,upsert:false});
  if(up.error) return json(500,{error:'RECEIPT_UPLOAD_FAILED'});

  const ocr=await readReceiptServer(bytes,mime);
  if(ocr.status==='failed') console.error('receipt_ocr_failed',ocr.reason);
  const stored=ocr.stored as any;
  const payload={
    storage_path:storagePath,
    file_name:name,
    content_type:mime,
    size_bytes:bytes.length,
    content_sha256:hash,
    declared_amount_cents:stored?.amount_cents??null,
    declared_paid_on:stored?.paid_on??null,
    declared_reference:stored?.identifier??null,
    ocr_status:ocr.status,
    ocr:stored,
  };

  const {data:result,error:rpcErr}=await service.rpc('fin_submit_whatsapp_pendency_receipt',{
    p_message:messageId,p_submission:submissionId,p_data:payload,
  });

  if(rpcErr){
    // Avoid orphaning a duplicate upload when the DB rejected the submission.
    await service.storage.from(RECEIPTS_BUCKET).remove([storagePath]).catch(()=>undefined);
    return json(500,{error:'RECEIPT_REGISTER_FAILED'});
  }

  return json(200,{ok:true,...(result||{}),ocr_status:ocr.status});
});
