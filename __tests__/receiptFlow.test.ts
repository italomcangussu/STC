import {describe,it,expect,vi} from 'vitest';
import {createReceiptFlow} from '../supabase/functions/_shared/aiAgent/receiptFlow';

type Row=Record<string,any>;
function harness(){
  const rows:Row[]=[
    {id:'00000000-0000-4000-8000-000000000001',conversation_id:'direct1',direction:'inbound',
      kind:'image',body:null,media_path:'in/foto.jpg',media_mime:'image/jpeg',
      created_at:'2026-10-10T10:00:00.000Z',meta:{provider:'uaz'}},
    {id:'00000000-0000-4000-8000-000000000002',conversation_id:'direct1',direction:'inbound',
      kind:'text',body:'Foi para a campanha do Dia das Crianças',created_at:'2026-10-10T10:01:00.000Z',meta:{}},
    {id:'00000000-0000-4000-8000-000000000003',conversation_id:'direct1',direction:'inbound',
      kind:'text',body:'Pode registrar, sim',created_at:'2026-10-10T10:02:00.000Z',meta:{}},
    {id:'00000000-0000-4000-8000-000000000004',conversation_id:'other',direction:'inbound',
      kind:'text',body:'sim',created_at:'2026-10-10T10:03:00.000Z',meta:{}},
  ];
  function query(table:string){
    const filters:Array<(r:Row)=>boolean>=[];
    let patch:Row|null=null;
    const base:any={
      select(){return base;},
      update(value:Row){patch=value;return base;},
      eq(key:string,value:any){filters.push(r=>r[key]===value);return base;},
      in(key:string,arr:any[]){filters.push(r=>arr.includes(r[key]));return base;},
      lt(key:string,value:string){filters.push(r=>r[key]<value);return base;},
      order(key:string,{ascending}:{ascending:boolean}){base.sort={key,ascending};return base;},
      async maybeSingle(){
        const result=rows.filter(r=>filters.every(f=>f(r)));
        if(table==='conv_conversations')return {data:{kind:'direct'},error:null};
        return {data:result[0]??null,error:null};
      },
      async limit(n:number){
        const result=rows.filter(r=>filters.every(f=>f(r)));
        if(base.sort)result.sort((a,b)=>(String(a[base.sort.key]).localeCompare(String(b[base.sort.key])))*(base.sort.ascending?1:-1));
        return {data:result.slice(0,n),error:null};
      },
      then(resolve:any,reject:any){
        const result=rows.filter(r=>filters.every(f=>f(r)));
        if(patch)result.forEach(r=>Object.assign(r,patch));
        return Promise.resolve({data:result,error:null}).then(resolve,reject);
      },
    };
    return base;
  }
  const service={from:(name:string)=>query(name)};
  let purpose='donation';
  const chat:any=vi.fn(async(_messages:any,_settings:any)=>({
    output:JSON.stringify(_messages[1].content.includes('awaiting_confirmation')
      ? {action:'confirm'}
      : {action:'purpose',purpose,subject:'Doação para o Dia das Crianças'})
  }));
  const finalize=vi.fn(async()=>({ok:true,registered:true}));
  const secret='test-secret-never-use-in-production';
  const flow=createReceiptFlow({service,chat,model:()=> 'test-model',authorizationSecret:secret,finalize});
  return {flow,finalize,rows,chat,setPurpose:(v:string)=>purpose=v,secret};
}

describe('Comprovantes recebidos pelo João',()=>{
  it('nunca registra só por ter recebido a imagem ou por identificar a finalidade',async()=>{
    const h=harness();
    const image=await h.flow({conversationId:'direct1',messageId:h.rows[0].id,text:'',transcript:[]});
    expect(image.action).toBe('receipt_ask_purpose');
    expect(h.finalize).not.toHaveBeenCalled();
    expect(h.rows[0].meta.stc_receipt_confirmation.stage).toBe('awaiting_purpose');
    const stated=await h.flow({conversationId:'direct1',messageId:h.rows[1].id,text:h.rows[1].body,transcript:[]});
    expect(stated.action).toBe('receipt_ask_confirmation');
    expect(h.finalize).not.toHaveBeenCalled();
    expect(h.rows[0].meta.stc_receipt_confirmation.purpose).toBe('donation');
  });
  it('só processa após um SIM posterior à identificação, vinculado ao mesmo arquivo',async()=>{
    const h=harness();
    await h.flow({conversationId:'direct1',messageId:h.rows[0].id,text:'',transcript:[]});
    await h.flow({conversationId:'direct1',messageId:h.rows[1].id,text:h.rows[1].body,transcript:[]});
    const response=await h.flow({conversationId:'direct1',messageId:h.rows[2].id,text:h.rows[2].body,transcript:[]});
    expect(response.action).toBe('receipt_registered');
    expect(h.finalize).toHaveBeenCalledOnce();
    const state=h.rows[0].meta.stc_receipt_confirmation;
    expect(state.stage).toBe('confirmed'); // A Edge Function registra e depois marca como registered.
    expect(state.confirmation_message_id).toBe(h.rows[2].id);
    const material=[h.rows[0].id,h.rows[1].id,h.rows[2].id,state.purpose,state.subject].join('|');
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(h.secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const mac=new Uint8Array(state.confirmation_mac.match(/.{2}/g).map((v:string)=>parseInt(v,16)));
    expect(await crypto.subtle.verify('HMAC',key,mac,new TextEncoder().encode(material))).toBe(true);
  });
  it('não aceita resposta de outra conversa',async()=>{
    const h=harness();
    await h.flow({conversationId:'direct1',messageId:h.rows[0].id,text:'',transcript:[]});
    await h.flow({conversationId:'direct1',messageId:h.rows[1].id,text:h.rows[1].body,transcript:[]});
    const response=await h.flow({conversationId:'other',messageId:h.rows[3].id,text:'sim',transcript:[]});
    expect(response.handled).toBe(false);
    expect(h.finalize).not.toHaveBeenCalled();
  });
});
