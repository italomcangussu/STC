// @ts-nocheck — função Deno (imports `npm:`).
// Server-side OCR for WhatsApp financial receipts.
// Reuses the same extraction contract as lib/finance/receiptText.ts:
// raw OCR text is never persisted or logged, only structured fields.

export type ReceiptMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
type Confidence = 'high' | 'low' | 'none';

export type ServerReceiptOcr = {
  status: 'ok' | 'unreadable' | 'failed';
  stored: Record<string, unknown> | null;
  /** Só quando `failed`: a mensagem do erro do motor (nunca o conteúdo do comprovante). */
  reason?: string;
};

const MONTHS: Record<string, number> = {
  janeiro:1,jan:1,fevereiro:2,fev:2,marco:3,mar:3,abril:4,abr:4,maio:5,mai:5,junho:6,jun:6,
  julho:7,jul:7,agosto:8,ago:8,setembro:9,set:9,outubro:10,out:10,novembro:11,nov:11,dezembro:12,dez:12,
};
const strip=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const clean=(s:string)=>s.replace(/[ \t\r]+/g,' ').trim();
const MONEY_RE=/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\d)/g;
/** "R$ 130" sem centavos (Mercado Pago): só a linha que é o valor sozinho, nunca "R$50 para Ana" de um anúncio. */
const WHOLE_RE=/^\s*R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)\s*$/g;
const NOISE=/tarifa|maximo de|taxa|juros|multa|desconto|saldo|limite|iof|encargo|abatimento|cashback|parcela/;
const MONEY_BEFORE=/tarifa|taxa|juros|multa|desconto|saldo|limite/;
const PAYEE_LABEL=/^(?:\S{1,4}\s+)?(?:pago para|enviado para|transferido para|favorecido|recebedor|destinat[aá]rio|benefici[aá]rio|quem recebeu|nome do recebedor|destino|para)\s*[:-]?\s*(.*)$/i;
const NOT_NAME=/\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|r\$|ag[eê]ncia|conta|chave|cpf|cnpj|banco|institui/i;
const PAYER_LABEL=/^(?:origem|pagador|remetente|quem pagou|nome do pagador|dados de quem pagou)\b/i;
const CNPJ_RE=/(?<![\w*])[\d*•xX#]{2}\.?[\d*•xX#]{3}\.?[\d*•xX#]{3}(\/)?[\d*•xX#]{4}-?[\d*•xX#]{2}(?![\w*])/;
const E2E_RE=/\bE\d{8}\d{8}\d{4}[A-Za-z0-9]{11}\b/;
const ID_LABEL_RE=/(?:autentica[cç][aã]o|id da transa[cç][aã]o|id transa[cç][aã]o|c[oó]digo de transa[cç][aã]o|c[oó]digo da transa[cç][aã]o|protocolo|n[uú]mero da transa[cç][aã]o|nsu)\s*[:-]?\s*([A-Za-z0-9.-]{6,64})/i;

/** Linha que é só o rótulo do favorecido ("Recebedor"), sem nome depois. */
const isPayeeLabelOnly=(line:string)=>{const m=PAYEE_LABEL.exec(line);return Boolean(m)&&!clean(m![1]);};

function moneyCents(s:string):number|null{
  const n=Number(s.replace(/\./g,'').replace(',','.'));
  return Number.isFinite(n)?Math.round(n*100):null;
}
/** Valores da linha: com centavos ou "R$ 130". */
const moneyIn=(raw:string)=>[...raw.matchAll(MONEY_RE),...raw.matchAll(WHOLE_RE)];
function iso(y:number,m:number,d:number):string|null{
  const dt=new Date(Date.UTC(y,m-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d||y<2000||y>2100)return null;
  return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

/** Linhas com texto. PDF com título em negrito repete a linha ("Recebedor" 4×, caso Bruno 28/10): repetida seguida vale uma vez. */
const receiptLines=(text:string)=>text.replace(/\u00a0/g,' ').split(/\r?\n/).map(x=>x.trimEnd()).filter(x=>x.trim())
  .filter((x,i,a)=>!i||x.trim()!==a[i-1].trim());

/** Sem rótulo de favorecido (Mercado Pago: "Origem e destino"), vale o CNPJ quando o comprovante tem um só, completo. */
function soleCnpj(lines:string[]):string|null{
  const docs=new Set(lines.filter(l=>/cnpj/i.test(l)).map(l=>CNPJ_RE.exec(l)?.[0].replace(/\D/g,'')).filter(d=>d?.length===14));
  return docs.size===1?[...docs][0]!:null;
}

/** Exportado só para teste: o texto bruto nunca sai daqui, só os campos estruturados. */
export function parseReceiptText(text:string):Record<string,unknown>{
  const lines=receiptLines(text);
  const amounts:{value:number;priority:number}[]=[];
  lines.forEach((raw,idx)=>{
    const line=strip(raw),prev=idx?strip(lines[idx-1]):'';
    if(NOISE.test(line))return;
    for(const m of moneyIn(raw)){
      const cents=moneyCents(m[1]); if(!cents||cents<=0)continue;
      const label=`${line} ${/valor|total|pago|transfer|pix/.test(prev)&&!MONEY_BEFORE.test(prev)?prev:''}`;
      let priority=/r\$/i.test(m[0])?1:0;
      if(/valor (pago|da transfer|do pix|da transa|total|do pagamento|enviado|recebido)/.test(label))priority=3;
      else if(/valor|total pago|total/.test(label))priority=2;
      amounts.push({value:cents,priority});
    }
  });
  const top=Math.max(-1,...amounts.map(x=>x.priority));
  const best=amounts.filter(x=>x.priority===top);
  const amount=best[0]?.value??null;
  const amountConf:Confidence=amount===null?'none':top>=2&&new Set(best.map(x=>x.value)).size===1?'high':'low';

  const dates:{value:string;priority:number}[]=[];
  lines.forEach((raw,idx)=>{
    const line=strip(raw),near=`${idx?strip(lines[idx-1]):''} ${line}`;
    const stamped=/\b\d{1,2}[/. ](?:\d{2}|[a-z]{3,9})[/. ]\d{4}\s*(?:[-–,]|[àa]s)?\s*\d{1,2}:\d{2}/.test(line);
    const push=(v:string|null)=>{
      if(!v)return;
      let priority=1;
      if(/vencimento|vence |validade|agendad/.test(line))priority=0;
      else if(/pago em|data do pagamento|data da transfer|realizad|efetivad|data\b|hora|concluid/.test(near)||stamped)priority=3;
      dates.push({value:v,priority});
    };
    for(const m of raw.matchAll(/\b(\d{2})[/.](\d{2})[/.](\d{4})\b/g))push(iso(Number(m[3]),Number(m[2]),Number(m[1])));
    for(const m of raw.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))push(iso(Number(m[1]),Number(m[2]),Number(m[3])));
    for(const m of strip(raw).matchAll(/\b(\d{1,2})[ /.](?:de )?([a-z]{3,9})\.?[ /.](?:de )?(\d{4})\b/g)){const mo=MONTHS[m[2]];if(mo)push(iso(Number(m[3]),mo,Number(m[1])));}
  });
  const topD=Math.max(-1,...dates.map(x=>x.priority));
  const bestD=dates.filter(x=>x.priority===topD&&x.priority>0);
  const paidOn=bestD[0]?.value??null;
  const dateConf:Confidence=paidOn===null?'none':topD>=3&&new Set(bestD.map(x=>x.value)).size===1?'high':'low';

  const e2e=E2E_RE.exec(text);
  const labeled=ID_LABEL_RE.exec(text);
  const identifier=e2e?.[0]??labeled?.[1]?.slice(0,64)??null;
  const idConf:Confidence=e2e?'high':labeled?'low':'none';

  let payee:string|null=null;
  for(let i=0;i<lines.length&&!payee;i++){
    const m=PAYEE_LABEL.exec(clean(lines[i])); if(!m)continue;
    let candidate=clean(m[1]);
    const rotulo=(c:string)=>clean(c.replace(/^nome(?:\s+(?:do|da)\s+\w+)?\s*[:-]?\s+(?=\S)/i,''));
    if(!candidate){
      for(let j=i+1;j<Math.min(i+4,lines.length);j++){
        const next=clean(lines[j]); if(!next||/^nome$/i.test(next)||isPayeeLabelOnly(next))continue; candidate=next; break;
      }
    }
    candidate=rotulo(candidate);
    if(candidate.length>=3&&candidate.length<=80&&!NOT_NAME.test(candidate)&&/[A-Za-zÀ-ÿ]{3}/.test(candidate))payee=candidate;
  }

  // CNPJ só do bloco do favorecido (nunca CPF nem dados do pagador); mascarado vira `*`.
  let payeeDocument:string|null=null;
  for(let i=0;i<lines.length&&!payeeDocument;i++){
    if(!PAYEE_LABEL.test(clean(lines[i])))continue;
    for(let j=i;j<Math.min(i+9,lines.length);j++){
      const line=clean(lines[j]);
      if(j>i&&PAYER_LABEL.test(line))break;
      const m=CNPJ_RE.exec(line);
      if(!m||(!m[1]&&!/cnpj|chave/i.test(`${lines[j-1]??''} ${line}`)))continue;
      const doc=m[0].replace(/[^\d*•xX#]/g,'').replace(/[^\d]/g,'*');
      if(doc.replace(/\*/g,'').length>=4){payeeDocument=doc;break;}
    }
  }

  payeeDocument??=soleCnpj(lines);
  return {
    amount_cents:amount, paid_on:paidOn, identifier, payee, payee_document:payeeDocument,
    confidence:{amount:amountConf,date:dateConf,identifier:idConf,payee:payee?'high':'none'},
  };
}

async function pdfText(bytes:Uint8Array):Promise<string>{
  const pdfjs=await import('npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs');
  const task=pdfjs.getDocument({data:bytes,disableWorker:true});
  const doc=await task.promise;
  const pages:string[]=[];
  try{
    for(let i=1;i<=Math.min(doc.numPages,3);i++){
      const page=await doc.getPage(i);
      const content=await page.getTextContent();
      pages.push((content.items as Array<{str?:string}>).map(x=>x.str??'').join('\n'));
    }
  }finally{await doc.destroy();}
  return pages.join('\n');
}

const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

type OcrWord={text:string;confidence:number};
export type OcrLine={text:string;words:OcrWord[];bbox:{x0:number;y0:number;x1:number;y1:number}};
type Rect={left:number;top:number;width:number;height:number};
const MONEY_WORD=/\d,\d{2}/;
const MAX_REREADS=2;
const moneyWord=(ls:OcrLine[])=>ls.flatMap(l=>l.words).find(w=>MONEY_WORD.test(w.text));

/**
 * Valor relido só na linha dele (caso Bruno, 28/10): na página inteira o Tesseract leu "R$ 180,00" (confiança 67) num
 * Pix de R$ 130; o recorte da linha leu "130,00" (94). Fica a leitura mais confiável. Até 2 linhas, sem as de tarifa (CPU da função, Emanuel 28/10); falha não muda nada.
 */
export async function refineMoneyLines(text:string,lines:OcrLine[],reread:(r:Rect)=>Promise<OcrLine[]>):Promise<string>{
  let out=text;
  for(const l of lines.filter(x=>moneyWord([x])&&!NOISE.test(strip(x.text))).slice(0,MAX_REREADS)){
    const antes=moneyWord([l])!;
    const pad=Math.max(6,Math.round((l.bbox.y1-l.bbox.y0)/2));
    let de_novo:OcrLine[]=[];
    try{de_novo=await reread({left:Math.max(0,l.bbox.x0-pad),top:Math.max(0,l.bbox.y0-pad),width:l.bbox.x1-l.bbox.x0+2*pad,height:l.bbox.y1-l.bbox.y0+2*pad});}catch{continue;}
    const depois=moneyWord(de_novo);
    if(depois&&depois.confidence>antes.confidence&&depois.text!==antes.text)out=out.replace(l.text.trim(),de_novo.map(x=>x.text.trim()).join(' '));
  }
  return out;
}

/**
 * Valor em fonte grande que a leitura automática pula (Mercado Pago, 28/10: "R$ 130" não saía no texto).
 * Sem valor, relê a página como uma coluna só (PSM 4) e junta o texto; falha não muda nada.
 */
export async function columnFallback(text:string,readColumn:()=>Promise<string>):Promise<string>{
  if(parseReceiptText(text).amount_cents!=null)return text;
  try{return `${text}\n${await readColumn()}`;}catch{return text;}
}

const linesOf=(data:any):OcrLine[]=>(data?.blocks??[]).flatMap((b:any)=>b.paragraphs??[]).flatMap((p:any)=>p.lines??[]);

/**
 * Tesseract SEM `worker_threads`: o runtime das Edge Functions do Supabase não implementa `Worker`
 * (`ERR_NOT_IMPLEMENTED: Worker.prototype.constructor`), então `createWorker` do tesseract.js falha sempre.
 * O script do worker é só um despachante de mensagens; aqui ele roda no próprio processo, com o mesmo protocolo
 * do `createWorker` (load → loadLanguage → initialize → recognize). Sem cache em disco: o dado de idioma
 * (português, 2,4 MB) baixa na primeira leitura de cada instância; `STC_OCR_LANG_PATH` aponta para outro endereço.
 */
async function imageText(bytes:Uint8Array):Promise<string>{
  // Especificadores literais: o empacotador das Edge Functions só resolve `npm:` escrito por extenso.
  const dflt=(m:any)=>m.default??m;
  const worker=dflt(await import('npm:tesseract.js@6.0.1/src/worker-script/index.js'));
  const getCore=dflt(await import('npm:tesseract.js@6.0.1/src/worker-script/node/getCore.js'));
  const gunzip=dflt(await import('npm:tesseract.js@6.0.1/src/worker-script/node/gunzip.js'));
  worker.setAdapter({
    getCore,gunzip,fetch,
    readCache:async()=>undefined,writeCache:async()=>undefined,deleteCache:async()=>undefined,checkCache:async()=>false,
  });
  let n=0;
  const call=(action:string,payload:Record<string,unknown>)=>new Promise<any>((resolve,reject)=>{
    worker.dispatchHandlers({workerId:'receipt-ocr',jobId:`j${++n}`,action,payload},(m:any)=>{
      if(m.status==='resolve')resolve(m.data);
      else if(m.status==='reject')reject(new Error(String(m.data)));
    });
  });
  const langPath=Deno.env.get('STC_OCR_LANG_PATH')||LANG_PATH;
  await call('load',{options:{lstmOnly:true,logging:false}});
  await call('loadLanguage',{langs:['por'],options:{langPath,cacheMethod:'none',gzip:true,lstmOnly:true}});
  await call('initialize',{langs:'por',oem:1,config:{}});
  const out=await call('recognize',{image:bytes,options:{},output:{text:true,blocks:true}});
  const reread=async(rectangle:Rect)=>linesOf(await call('recognize',{image:bytes,options:{rectangle},output:{text:true,blocks:true}}));
  const texto=await refineMoneyLines(String(out?.text??''),linesOf(out),reread);
  return columnFallback(texto,async()=>{
    await call('setParameters',{params:{tessedit_pageseg_mode:'4'}});
    return String((await call('recognize',{image:bytes,options:{},output:{text:true}}))?.text??'');
  });
}

export async function readReceiptServer(bytes:Uint8Array,mime:string):Promise<ServerReceiptOcr>{
  try{
    const raw=mime==='application/pdf'?await pdfText(bytes):await imageText(bytes);
    const stored=parseReceiptText(raw);
    // Raw OCR text intentionally goes out of scope here and is never returned.
    if(stored.amount_cents==null&&stored.paid_on==null&&stored.identifier==null){
      return {status:'unreadable',stored:null};
    }
    return {status:'ok',stored:{engine:mime==='application/pdf'?'pdfjs-server':'tesseract-server',...stored}};
  }catch(e){
    return {status:'failed',stored:null,reason:String((e as Error)?.message??e).slice(0,200)};
  }
}
