// @ts-nocheck — função Deno (imports `npm:`).
// Server-side OCR for WhatsApp financial receipts.
// Reuses the same extraction contract as lib/finance/receiptText.ts:
// raw OCR text is never persisted or logged, only structured fields.

export type ReceiptMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
type Confidence = 'high' | 'low' | 'none';

export type ServerReceiptOcr = {
  status: 'ok' | 'unreadable' | 'failed';
  stored: Record<string, unknown> | null;
};

const MONTHS: Record<string, number> = {
  janeiro:1,jan:1,fevereiro:2,fev:2,marco:3,mar:3,abril:4,abr:4,maio:5,mai:5,junho:6,jun:6,
  julho:7,jul:7,agosto:8,ago:8,setembro:9,set:9,outubro:10,out:10,novembro:11,nov:11,dezembro:12,dez:12,
};
const strip=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const clean=(s:string)=>s.replace(/[ \t\r]+/g,' ').trim();
const MONEY_RE=/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\d)/g;
const NOISE=/tarifa|taxa|juros|multa|desconto|saldo|limite|iof|encargo|abatimento|cashback|parcela/;
const MONEY_BEFORE=/tarifa|taxa|juros|multa|desconto|saldo|limite/;
const PAYEE_LABEL=/^(?:favorecido|recebedor|destinat[aá]rio|benefici[aá]rio|quem recebeu|nome do recebedor|destino|para)\s*[:-]?\s*(.*)$/i;
const NOT_NAME=/\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|r\$|ag[eê]ncia|conta|chave|cpf|cnpj|banco|institui/i;
const E2E_RE=/\bE\d{8}\d{8}\d{4}[A-Za-z0-9]{11}\b/;
const ID_LABEL_RE=/(?:autentica[cç][aã]o|id da transa[cç][aã]o|id transa[cç][aã]o|c[oó]digo de transa[cç][aã]o|c[oó]digo da transa[cç][aã]o|protocolo|n[uú]mero da transa[cç][aã]o|nsu)\s*[:-]?\s*([A-Za-z0-9.-]{6,64})/i;

function moneyCents(s:string):number|null{
  const n=Number(s.replace(/\./g,'').replace(',','.'));
  return Number.isFinite(n)?Math.round(n*100):null;
}
function iso(y:number,m:number,d:number):string|null{
  const dt=new Date(Date.UTC(y,m-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d||y<2000||y>2100)return null;
  return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

/** Exportado só para teste: o texto bruto nunca sai daqui, só os campos estruturados. */
export function parseReceiptText(text:string):Record<string,unknown>{
  const lines=text.replace(/\u00a0/g,' ').split(/\r?\n/).map(x=>x.trimEnd()).filter(x=>x.trim());
  const amounts:{value:number;priority:number}[]=[];
  lines.forEach((raw,idx)=>{
    const line=strip(raw),prev=idx?strip(lines[idx-1]):'';
    if(NOISE.test(line))return;
    for(const m of raw.matchAll(MONEY_RE)){
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
    const push=(v:string|null)=>{
      if(!v)return;
      let priority=1;
      if(/vencimento|vence |validade|agendad/.test(line))priority=0;
      else if(/pago em|data do pagamento|data da transfer|realizad|efetivad|data\b|hora|concluid/.test(near))priority=3;
      dates.push({value:v,priority});
    };
    for(const m of raw.matchAll(/\b(\d{2})[/.](\d{2})[/.](\d{4})\b/g))push(iso(Number(m[3]),Number(m[2]),Number(m[1])));
    for(const m of raw.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))push(iso(Number(m[1]),Number(m[2]),Number(m[3])));
    for(const m of strip(raw).matchAll(/\b(\d{1,2}) (?:de )?([a-z]{3,9})\.? (?:de )?(\d{4})\b/g)){const mo=MONTHS[m[2]];if(mo)push(iso(Number(m[3]),mo,Number(m[1])));}
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
    if(!candidate){
      for(let j=i+1;j<Math.min(i+4,lines.length);j++){
        const next=clean(lines[j]); if(!next||/^nome$/i.test(next))continue; candidate=next; break;
      }
    }
    if(candidate.length>=3&&candidate.length<=80&&!NOT_NAME.test(candidate)&&/[A-Za-zÀ-ÿ]{3}/.test(candidate))payee=candidate;
  }

  return {
    amount_cents:amount, paid_on:paidOn, identifier, payee,
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

async function imageText(bytes:Uint8Array):Promise<string>{
  const {createWorker}=await import('npm:tesseract.js@6.0.1');
  const worker=await createWorker(['por','eng']);
  try{
    const out=await worker.recognize(bytes);
    return out.data.text??'';
  }finally{await worker.terminate();}
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
  }catch{
    return {status:'failed',stored:null};
  }
}
