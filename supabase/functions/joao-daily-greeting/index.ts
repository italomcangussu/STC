// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.89.0";

const URL=Deno.env.get("SUPABASE_URL");
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SUPABASE_SECRET_KEY")||"";
const UAZ_RAW=Deno.env.get("UAZAPI_SERVER_URL")||"";
const UAZ=UAZ_RAW.endsWith("/")?UAZ_RAW.slice(0,-1):UAZ_RAW;
const TOKEN=Deno.env.get("STC_UAZAPI_INSTANCE_TOKEN")||"";
const AIKEY=Deno.env.get("STC_AI_API_KEY")||"";
const AIBASE_RAW=Deno.env.get("STC_AI_BASE_URL")||"https://openrouter.ai/api/v1";
const AIBASE=AIBASE_RAW.endsWith("/")?AIBASE_RAW.slice(0,-1):AIBASE_RAW;
if(!URL) throw new Error("NO_SUPABASE_URL");
const db=createClient(URL,SERVICE,{auth:{persistSession:false}});
const GROUP="Sócios Sobral Tênis Clube";
const TZ="America/Fortaleza";
const stars=["carlos alcaraz","jannik sinner","novak djokovic","alexander zverev","daniil medvedev","taylor fritz","alex de minaur","holger rune","ben shelton","jack draper","lorenzo musetti","casper ruud","felix auger-aliassime","joao fonseca","thiago seyboth wild","thiago monteiro","aryna sabalenka","iga swiatek","coco gauff","elena rybakina","jessica pegula","mirra andreeva","madison keys","qinwen zheng","beatriz haddad maia","bia haddad maia","laura pigossi"];
const br=["joao fonseca","thiago seyboth wild","thiago monteiro","beatriz haddad maia","bia haddad maia","laura pigossi"];

const js=(s,b)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const norm=s=>String(s||"").normalize("NFD").toLowerCase();

async function auth(req){
  const secret=req.headers.get("x-joao-secret")||"";
  if(!secret||!SERVICE)return false;
  const r=await db.rpc("joao_daily_secret_ok",{p_secret:secret});
  return !r.error&&r.data===true;
}
function parts(){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",weekday:"long"}).formatToParts(new Date());
  const g=t=>p.find(x=>x.type===t)?.value||"";
  const iso=g("year")+"-"+g("month")+"-"+g("day");
  return {iso,espn:iso.split("-").join(""),weekday:g("weekday")};
}
function localIso(v){
  const d=new Date(v); if(!Number.isFinite(d.getTime()))return "";
  const p=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return g("year")+"-"+g("month")+"-"+g("day");
}
async function getjson(u){
  try{
    const r=await fetch(u,{headers:{accept:"application/json","user-agent":"STC-Joao-Daily/2.1"},signal:AbortSignal.timeout(12000)});
    return r.ok?await r.json():null;
  }catch{return null}
}
function parse(data,fallback,wanted){
  const out=[];
  for(const e of Array.isArray(data?.events)?data.events:[]){
    for(const gr of Array.isArray(e?.groupings)?e.groupings:[]){
      const group=String(gr?.grouping?.displayName||"");
      const tour=/women/i.test(group)?"WTA":/men/i.test(group)?"ATP":fallback;
      for(const c of Array.isArray(gr?.competitions)?gr.competitions:[]){
        const date=String(c?.date||c?.startDate||"");
        if(!date||localIso(date)!==wanted)continue;
        const players=(Array.isArray(c?.competitors)?c.competitors:[]).map(x=>{
          const name=String(x?.athlete?.displayName||x?.athlete?.fullName||x?.roster?.displayName||"").trim();
          const n=Number(x?.curatedRank?.current??x?.seed);
          return {name,seed:Number.isFinite(n)&&n>0?n:null,country:String(x?.athlete?.flag?.alt||x?.roster?.athletes?.[0]?.flag?.alt||"")||null};
        }).filter(x=>x.name&&x.name!=="TBD");
        if(players.length<2)continue;
        out.push({
          id:String(c?.id||e?.id+":"+date+":"+players.map(x=>x.name).join("|")),
          tour,tournament:String(e?.name||e?.shortName||tour),group:group||null,
          round:String(c?.round?.displayName||"")||null,date,
          state:String(c?.status?.type?.state||"").toLowerCase()||null,
          status:String(c?.status?.type?.description||c?.status?.type?.detail||"")||null,
          players
        });
      }
    }
  }
  return out;
}
function score(f){
  let s=f.state==="in"?400:f.state==="pre"?350:-200;
  if(/final|semifinal|quarter/i.test(f.round||""))s+=25;
  if(/singles/i.test(f.group||""))s+=15;
  for(const p of f.players||[]){
    const n=norm(p.name);
    if(br.some(x=>n.includes(x)))s+=220;
    if(stars.some(x=>n.includes(x)))s+=100;
    if(p.seed&&p.seed<=10)s+=25;else if(p.seed&&p.seed<=20)s+=12;
  }
  return s;
}
async function facts(d){
  const [a,w]=await Promise.all([
    getjson("https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates="+d.espn),
    getjson("https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard?dates="+d.espn)
  ]);
  const raw=[...parse(a,"ATP",d.iso),...parse(w,"WTA",d.iso)];
  const uniq=[...new Map(raw.map(f=>[f.id,f])).values()];
  return uniq.sort((x,y)=>score(y)-score(x)).slice(0,24);
}
async function group(){
  const g=await db.from("conv_groups").select("id,group_jid").eq("name",GROUP).eq("status","allowed").eq("ai_enabled",true).maybeSingle();
  if(g.error||!g.data)throw new Error("GROUP_NOT_FOUND");
  const c=await db.from("conv_conversations").select("id").eq("group_id",g.data.id).eq("kind","group").eq("status","open").maybeSingle();
  if(c.error||!c.data)throw new Error("GROUP_CONVERSATION_NOT_FOUND");
  return {cid:c.data.id,jid:g.data.group_jid};
}
async function history(cid){
  const since=new Date(Date.now()-30*86400000).toISOString();
  const r=await db.from("conv_messages").select("body").eq("conversation_id",cid).eq("direction","outbound").in("origin",["ai","system"]).gte("created_at",since).order("created_at",{ascending:false}).limit(90);
  return (r.data||[]).map(x=>String(x.body||"")).filter(Boolean);
}
async function model(){
  const r=await db.from("conv_ai_settings").select("model").eq("active",true).order("version",{ascending:false}).limit(1).maybeSingle();
  return String(r.data?.model||"openai/gpt-6-luna");
}
function hasCompleteMatch(text,fs){
  const t=norm(text);
  return fs.slice(0,12).some(f=>f?.players?.length>=2&&
    t.includes(norm(f.players[0].name))&&t.includes(norm(f.players[1].name)));
}

function folded(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim()}
function theme(text){
  const t=folded(text);
  if(/(bola pegou|pegou ou nao|bola dentro|bola fora|na linha|da linha)/.test(t))return "linha";
  if(/(bola na rede|pouca bola na rede|bateu na rede)/.test(t))return "rede";
  if(/(ferias|nunca trabalha)/.test(t))return "ferias";
  if(/(bets|apostas|palpite)/.test(t))return "apostas";
  return null;
}
function repetition(text,h){
  const t=folded(text), topic=theme(text);
  const used=h.slice(0,60).filter(Boolean);
  for(const [i,prev] of used.entries()){
    const old=folded(prev);
    if(t===old)return "identical";
    if(topic && topic===theme(prev) && i<25)return "same_theme";
    const a=new Set(t.split(" ").filter(x=>x.length>=5 && !["jogadores","torneio","tenistas","masters","circuito","enquanto"].includes(x)));
    const b=new Set(old.split(" ").filter(x=>x.length>=5 && !["jogadores","torneio","tenistas","masters","circuito","enquanto"].includes(x)));
    if(a.size>=5&&b.size>=5){
      let n=0;for(const token of a)if(b.has(token))n++;
      if(n/Math.min(a.size,b.size)>=0.78)return "similar_punchline";
    }
  }
  return null;
}
function fallback(d,fs,h){
  const f=fs[0], ps=f?.players||[];
  const match=ps.length>=2 ? " Hoje tem "+(
    ps.length===4 ? ps[0].name+" / "+ps[1].name+" x "+ps[2].name+" / "+ps[3].name
      : ps[0].name+" x "+ps[1].name
  )+" no "+f.tournament+"." : "";
  const variants=[
    "Bom dia, turma!"+match+" Bom sábado ou não, quem puder aproveite para bater uma bola.",
    "Bom dia, pessoal!"+match+" Que seja um dia bom de quadra e de conversa.",
    "Um ótimo dia para a turma do STC!"+match+" Aproveitem o clube.",
    "Bom dia, tenistas!"+match+" Bom jogo para quem entrar em quadra hoje.",
    "Bom dia, turma!"+match+" Um excelente dia para todo mundo.",
    "Bom dia, pessoal do STC!"+match+" Que não falte disposição para jogar.",
    "Passando para desejar bom dia à turma!"+match+" Aproveitem o dia.",
    "Bom dia, STC!"+match+" Boa diversão para quem for jogar hoje."
  ];
  const k=Number(d.iso.replace(/-/g,""))%variants.length;
  for(let i=0;i<variants.length;i++){
    const candidate=variants[(k+i)%variants.length];
    if(!repetition(candidate,h))return candidate;
  }
  return "Bom dia, pessoal!"+match+" Ótimo dia para todos.";
}
async function greeting(d,fs,h){
  const fb=fallback(d,fs,h);
  if(!AIKEY){console.warn("JOAO_GREETING_FALLBACK",JSON.stringify({date:d.iso,reason:"missing_ai_key"}));return fb;}
  const clean=fs.slice(0,12).map(f=>({circuito:f.tour,torneio:f.tournament,categoria:f.group,rodada:f.round,estado:f.state,status:f.status,jogadores:f.players.map(p=>({nome:p.name,cabeca_de_chave:p.seed,pais:p.country}))}));
  const sys=[
    "Você é João Fonseca, assistente do Sobral Tênis Clube, escrevendo no grupo de sócios.",
    "Escreva um bom dia humano de 1 a 3 frases. O humor é opcional: não force piada, trocadilho ou frase de efeito.",
    "Priorize primeiro partidas programadas ou em andamento hoje.",
    "Se houver partida confirmada, cite ao menos um confronto completo e o torneio. Nunca invente dado.",
    "Use somente os fatos fornecidos. Se os jogadores formarem duplas, não transforme colegas de dupla em adversários.",
    "Não repita a estrutura, tema, punchline ou bordão das últimas mensagens. Evite particularmente bola na linha e bola na rede quando já usados.",
    "Sem markdown, hashtags, boletim ou pergunta obrigatória. Varie o início e o final.",
  ].join("\n");
  let reason="unknown";
  for(let attempt=0;attempt<2;attempt++){
    try{
      const more=attempt?"Tentativa de revisão: a mensagem anterior falhou. Escreva outra, realmente diferente, sem repetir tema ou conclusão.":null;
      const messages=[{role:"system",content:sys},{role:"user",content:JSON.stringify({data:d.iso,dia:d.weekday,fatos_confirmados:clean,mensagens_recentes:h.slice(0,45),instrucao_extra:more})}];
      const r=await fetch(AIBASE+"/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+AIKEY},body:JSON.stringify({model:await model(),max_tokens:400,messages}),signal:AbortSignal.timeout(22000)});
      if(!r.ok){reason="provider_http_"+r.status;continue;}
      const j=await r.json().catch(()=>null);
      const t=String(j?.choices?.[0]?.message?.content||"").trim();
      if(!t||t.length>700){reason="empty_or_invalid_length";continue;}
      if(fs.length&&!hasCompleteMatch(t,fs)){reason="match_validation";continue;}
      const repeated=repetition(t,h);
      if(repeated){reason="repeated_"+repeated;continue;}
      console.info("JOAO_GREETING_GENERATED",JSON.stringify({date:d.iso,attempt:attempt+1,history:h.length}));
      return t;
    }catch(e){reason=e instanceof Error&&e.name==="TimeoutError"?"timeout":"provider_exception";}
  }
  console.warn("JOAO_GREETING_FALLBACK",JSON.stringify({date:d.iso,reason,history:h.length}));
  return fb;
}
async function idkey(iso){
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode("joao-daily-greeting:"+iso))).slice(0,16);
  b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;
  const h=[...b].map(x=>x.toString(16).padStart(2,"0")).join("");
  return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);
}
function pid(j){const x=j?.messageid??j?.messageId??j?.id??j?.key?.id;return typeof x==="string"&&x?x:null}
async function send(number,text){
  if(!UAZ||!TOKEN)return {ok:false,provider:null,error:"WHATSAPP_NOT_CONFIGURED"};
  try{
    const r=await fetch(UAZ+"/send/text",{method:"POST",headers:{"content-type":"application/json",token:TOKEN},body:JSON.stringify({number,text}),signal:AbortSignal.timeout(20000)});
    const j=await r.json().catch(()=>({}));
    return {ok:r.ok,provider:r.ok?pid(j):null,error:r.ok?null:"HTTP_"+r.status};
  }catch(e){return {ok:false,provider:null,error:e instanceof Error&&e.name==="TimeoutError"?"TIMEOUT":"NETWORK_ERROR"}}
}
Deno.serve(async req=>{
  if(req.method!=="POST")return js(405,{error:"METHOD_NOT_ALLOWED"});
  if(!(await auth(req)))return js(401,{error:"UNAUTHORIZED"});
  if(!SERVICE)return js(503,{error:"SERVER_NOT_CONFIGURED"});
  const body=await req.json().catch(()=>({}));
  try{
    const d=parts(),g=await group();
    const [fs,h]=await Promise.all([facts(d),history(g.cid)]);
    const text=await greeting(d,fs,h);
    const info={date:d.iso,text,facts_count:fs.length,top_facts:fs.slice(0,5)};
    if(body?.dry_run===true)return js(200,{ok:true,dry_run:true,...info});
    const q=await db.rpc("conv_svc_queue_message",{p_conversation:g.cid,p:{kind:"text",body:text},p_author:null,p_key:await idkey(d.iso+(body?.force_today===true?":forced-today-v1":"")),p_origin:"ai",p_session:null,p_recipient:null});
    const row=Array.isArray(q.data)?q.data[0]:q.data;
    if(q.error||!row)return js(500,{error:"QUEUE_FAILED"});
    if(row.already_sent)return js(200,{ok:true,already_sent:true,...info});
    // Dois disparos simultâneos enxergam a mesma linha "queued"; só quem reivindica envia.
    const claim=await db.from("conv_messages").update({last_error:"CLAIMED"}).eq("id",row.message_id).in("status",["queued","failed"]).or("last_error.is.null,last_error.neq.CLAIMED").select("id");
    if(claim.error)return js(500,{error:"CLAIM_FAILED"});
    if(!claim.data?.length)return js(200,{ok:true,already_in_flight:true,...info});
    const s=await send(String(row.destination||g.jid),text);
    await db.rpc("conv_svc_finish_message",{p_message:row.message_id,p_sent:s.ok,p_provider_id:s.provider,p_error:s.error});
    return js(s.ok?200:503,{ok:s.ok,error:s.error,...info});
  }catch(e){return js(500,{error:e instanceof Error?e.message:"UNKNOWN"})}
});
