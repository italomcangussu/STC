// @ts-nocheck
import {createClient} from 'npm:@supabase/supabase-js@2.89.0';
import {readReceiptServer} from '../_shared/financeReceiptOcr.ts';
const url=Deno.env.get('SUPABASE_URL');
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SUPABASE_SECRET_KEY');
if(!url||!secret)throw new Error('Missing server configuration');
const service=createClient(url,secret,{auth:{persistSession:false}});
const json=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const allowed=new Set(['image/jpeg','image/png','image/webp','image/heic','application/pdf']);
const labels={membership:'MENSALIDADE',member_pendency:'PENDENCIA',donation:'DOACAO',other:'OUTRO'};
async function verified(id:string,flow:any,msg:any){
  if(flow?.stage!=='confirmed'||!labels[flow.purpose]||
    !/^[a-f0-9]{64}$/.test(String(flow.confirmation_mac??'')))return false;
  const ids=[flow.purpose_message_id,flow.confirmation_message_id];
  if(ids.some(x=>!/^[0-9a-f-]{36}$/i.test(String(x))))return false;
  const payload=[id,ids[0],ids[1],flow.purpose,flow.subject??''].join('|');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=new Uint8Array(flow.confirmation_mac.match(/.{2}/g).map((h:string)=>parseInt(h,16)));
  if(!await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(payload)))return false;
  const {data:r,error}=await service.from('conv_messages').select('id,conversation_id,direction,body,created_at').in('id',ids);
  const first=r?.find(x=>x.id===ids[0]),second=r?.find(x=>x.id===ids[1]);
  return !error&&!!first&&!!second&&first.conversation_id===msg.conversation_id&&second.conversation_id===msg.conversation_id
    &&first.direction==='inbound'&&second.direction==='inbound'&&!!first.body?.trim()&&!!second.body?.trim()
    &&new Date(first.created_at).getTime()>new Date(msg.created_at).getTime()
    &&new Date(second.created_at).getTime()>new Date(first.created_at).getTime();
}
export async function handleConfirmedReceipt(req:Request):Promise<Response>{
  if(req.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(req.headers.get('authorization')!==`Bearer ${secret}`)return json(401,{error:'UNAUTHORIZED'});
  let body:any;try{body=await req.json();}catch{return json(400,{error:'INVALID_JSON'});}
  const id=String(body?.message_id??'');
  if(!/^[a-f0-9-]{36}$/i.test(id))return json(400,{error:'INVALID_MESSAGE_ID'});
  const {data:m,error}=await service.from('conv_messages')
    .select('id,conversation_id,direction,kind,media_path,media_mime,media_name,created_at,meta')
    .eq('id',id).maybeSingle();
  if(error)return json(500,{error:'MESSAGE_QUERY_FAILED'});
  const mime=String(m?.media_mime??'').split(';')[0].trim().toLowerCase();
  if(!m||m.direction!=='inbound'||!m.media_path||!['image','document'].includes(m.kind)||!allowed.has(mime))
    return json(200,{skipped:true,reason:'NOT_ELIGIBLE_MEDIA'});
  const {data:existing}=await service.from('fin_receipt_submissions').select('id')
    .eq('source_message_id',id).maybeSingle();
  if(existing)return json(200,{ok:true,registered:true,duplicate:true,submission_id:existing.id});
  const flow=m.meta?.stc_receipt_confirmation;
  if(!await verified(id,flow,m))return json(200,{skipped:true,reason:'EXPLICIT_PURPOSE_CONFIRMATION_REQUIRED'});
  const {data:conversation}=await service.from('conv_conversations').select('kind,contact_id').eq('id',m.conversation_id).maybeSingle();
  if(conversation?.kind!=='direct'||!conversation.contact_id)
    return json(200,{skipped:true,reason:'NOT_DIRECT'});
  const {data:contact}=await service.from('conv_contacts').select('profile_id,link_status').eq('id',conversation.contact_id).maybeSingle();
  if(!contact?.profile_id||!['linked','manual'].includes(String(contact.link_status)))
    return json(200,{skipped:true,reason:'CONTACT_NOT_LINKED'});
  const {data:file,error:downErr}=await service.storage.from('conv-media').download(m.media_path);
  if(downErr||!file)return json(500,{error:'MEDIA_DOWNLOAD_FAILED'});
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!bytes.length||bytes.length>10485760)return json(200,{skipped:true,reason:'INVALID_MEDIA_SIZE'});
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash=[...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
  const subId=crypto.randomUUID();
  const ext=mime==='application/pdf'?'pdf':mime==='image/png'?'png':mime==='image/webp'?'webp':mime==='image/heic'?'heic':'jpg';
  const filename=`${labels[flow.purpose]}-${String(m.media_name??'comprovante').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,58)}.${ext}`.slice(0,200);
  const path=`${contact.profile_id}/${subId}/${filename}`;
  const up=await service.storage.from('fin-receipts').upload(path,bytes,{contentType:mime,upsert:false});
  if(up.error)return json(500,{error:'RECEIPT_UPLOAD_FAILED'});
  const ocr=await readReceiptServer(bytes,mime);
  const parsed=ocr.stored as any;
  const {data:dups}=await service.from('fin_receipt_submissions').select('id')
    .eq('content_sha256',hash).in('status',['submitted','in_review','approved']).limit(1);
  const duplicate=dups?.[0]?.id??null;
  const note=`Finalidade confirmada pelo remetente: ${flow.purpose} — ${String(flow.subject??'').slice(0,160)}. Sem baixa automática ou crédito em caixa. Confirmação: ${flow.confirmation_message_id}`.slice(0,500);
  const record={
    id:subId,request_id:subId,source:'whatsapp',source_message_id:id,profile_id:contact.profile_id,status:'submitted',
    storage_path:path,file_name:filename,content_type:mime,size_bytes:bytes.length,content_sha256:hash,
    declared_amount_cents:parsed?.amount_cents??null,declared_paid_on:parsed?.paid_on??null,
    declared_reference:String(parsed?.identifier??'').slice(0,120)||null,member_note:note,
    ocr_status:ocr.status,ocr:parsed??null,possible_duplicate:!!duplicate,duplicate_of:duplicate,
  };
  const insert=await service.from('fin_receipt_submissions').insert(record).select('id').single();
  if(insert.error){
    await service.storage.from('fin-receipts').remove([path]).catch(()=>undefined);
    const {data:already}=await service.from('fin_receipt_submissions').select('id')
      .eq('source_message_id',id).maybeSingle();
    if(already)return json(200,{ok:true,registered:true,duplicate:true,submission_id:already.id});
    console.error('RECEIPT_REGISTER_FAILED',insert.error.code);
    return json(500,{error:'RECEIPT_REGISTER_FAILED'});
  }
  await service.from('conv_messages').update({meta:{...(m.meta??{}),
    stc_receipt_confirmation:{...flow,stage:'registered',finance_submission_id:subId,registered_at:new Date().toISOString()}}}).eq('id',id);
  return json(200,{ok:true,registered:true,submission_id:subId,purpose:flow.purpose,
    status:'submitted',needs_financial_review:true,auto_settled:false});
}
