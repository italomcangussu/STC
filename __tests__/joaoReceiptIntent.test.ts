import { describe, expect, it, vi } from 'vitest';
import { handleReceiptIntent, loadReceiptStage, type ReceiptStage } from '../supabase/functions/_shared/aiAgent/receiptIntent';

const stage=(patch:Partial<ReceiptStage>={}):ReceiptStage=>({
  id:'11111111-1111-4111-8111-111111111111',
  source_message_id:'22222222-2222-4222-8222-222222222222',
  status:'awaiting_purpose',amount_cents:'3000', ...patch
});
const transcript=[
  {direction:'inbound',kind:'text',body:'Vou mandar os comprovantes da campanha das crianças'},
  {direction:'outbound',kind:'text',body:'Pode enviar'},
  {direction:'inbound',kind:'image',body:null},
];
const call=(args:Record<string,unknown>={})=>{
  const db=vi.fn().mockResolvedValue({data:{ok:true,status:'confirmed',kind:'donation'}});
  const chat=vi.fn().mockResolvedValue({output:JSON.stringify({action:'purpose',purpose_kind:'donation',purpose_detail:'campanha Dia das Crianças'})});
  return {db,chat,turn:{stage:stage(),messageId:'33333333-3333-4333-8333-333333333333',
    mediaOnly:false,text:'é para a campanha das crianças',transcript,
    db,chat,model:'test-model',...args}};
};
describe('João: comprovantes sem classificação presumida',()=>{
  it('pergunta antes de qualquer baixa, inclusive OCR de R$ 30',async()=>{
    const d=call({mediaOnly:true});
    const r=await handleReceiptIntent(d.turn);
    expect(r?.messages.join(' ')).toMatch(/ainda não lancei/i);
    // Só as checagens automáticas (mensalidade e inscrição do campeonato; o servidor decide e aqui não aplica); nenhuma outra escrita.
    expect(d.db.mock.calls.map((c:unknown[])=>c[0])).toEqual(['conv_svc_receipt_membership_auto','conv_svc_receipt_championship_auto']);
    expect(d.chat).not.toHaveBeenCalled();
  });
  it('usa campanha explicitamente informada e pede confirmação SEM gravar caixa',async()=>{
    const d=call();
    const r=await handleReceiptIntent(d.turn);
    expect(d.db).toHaveBeenCalledWith('conv_svc_receipt_purpose',
      expect.objectContaining({p_kind:'donation',p_detail:'campanha Dia das Crianças'}));
    expect(r?.messages.join(' ')).toMatch(/Confirma/);
    expect(d.db).not.toHaveBeenCalledWith('conv_svc_receipt_confirm',expect.anything());
  });
  it('não absorve resposta sobre tema alheio e mantém a pendência',async()=>{
    const d=call({text:'quero marcar uma quadra'});
    d.chat.mockResolvedValue({output:JSON.stringify({action:'unrelated',purpose_kind:null,purpose_detail:null})});
    const r=await handleReceiptIntent(d.turn);
    expect(r).toBeNull();
    expect(d.db).not.toHaveBeenCalled();
  });
  it('só confirma proposta em segundo turno, não o primeiro comprovante',async()=>{
    const d=call({stage:stage({status:'awaiting_confirmation',purpose_kind:'donation',purpose_detail:'campanha'}),text:'confirmo',transcript:[...transcript,{direction:'outbound',kind:'text',body:'Vou classificar o comprovante de R$ 30,00 como doação. Confirma?'}]});
    const r=await handleReceiptIntent(d.turn);
    expect(d.db).toHaveBeenCalledWith('conv_svc_receipt_confirm',
      expect.objectContaining({p_stage:d.turn.stage.id,p_message:d.turn.messageId}));
    expect(r?.messages.join(' ')).toMatch(/conferir/i);
  });
  it('um sim após outra pergunta nunca confirma comprovante antigo',async()=>{
    const d=call({stage:stage({status:'awaiting_confirmation',purpose_kind:'donation',purpose_detail:'campanha'}),text:'sim',
      transcript:[...transcript,{direction:'outbound',kind:'text',body:'Vou classificar o comprovante de R$ 30,00. Confirma?'},{direction:'inbound',kind:'text',body:'E a quadra de amanhã?'},{direction:'outbound',kind:'text',body:'Quer reservar a quadra de amanhã?'}]});
    const result=await handleReceiptIntent(d.turn);
    expect(result).toBeNull();
    expect(d.db).not.toHaveBeenCalled();
  });
  it('corrige finalidade sem executar o lançamento financeiro',async()=>{
    const d=call({stage:stage({status:'awaiting_confirmation'}),text:'não'});
    await handleReceiptIntent(d.turn);
    expect(d.db).toHaveBeenCalledWith('conv_svc_receipt_revise',expect.anything());
    expect(d.db).not.toHaveBeenCalledWith('conv_svc_receipt_confirm',expect.anything());
  });
});

describe('João: o comprovante da vez é o que acabou de chegar',()=>{
  const antigo={id:'a',source_message_id:'msg-antiga',status:'awaiting_purpose',amount_cents:'2250'};
  const novo={id:'b',source_message_id:'msg-nova',status:'awaiting_purpose',amount_cents:'40000'};
  const sleep=vi.fn().mockResolvedValue(undefined);
  it('espera o OCR gravar a intenção da imagem nova em vez de citar a anterior',async()=>{
    const db=vi.fn().mockResolvedValueOnce({data:antigo}).mockResolvedValueOnce({data:antigo}).mockResolvedValue({data:novo});
    const s=await loadReceiptStage({db,conversation:'conv',mediaMessageId:'msg-nova',sleep});
    expect(s?.amount_cents).toBe('40000');
    expect(db).toHaveBeenCalledTimes(3);
  });
  it('imagem sem intenção própria não usa a de outro comprovante',async()=>{
    const db=vi.fn().mockResolvedValue({data:antigo});
    expect(await loadReceiptStage({db,conversation:'conv',mediaMessageId:'msg-nova',sleep,tries:3})).toBeNull();
    expect(db).toHaveBeenCalledTimes(3);
  });
  it('texto sem mídia segue a intenção mais recente',async()=>{
    const db=vi.fn().mockResolvedValue({data:antigo});
    expect((await loadReceiptStage({db,conversation:'conv',sleep}))?.id).toBe('a');
    expect(db).toHaveBeenCalledTimes(1);
  });
});
