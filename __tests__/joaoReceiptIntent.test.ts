import { describe, expect, it, vi } from 'vitest';
import { handleReceiptIntent, type ReceiptStage } from '../supabase/functions/_shared/aiAgent/receiptIntent';

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
    expect(d.db).not.toHaveBeenCalled();
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
    const d=call({stage:stage({status:'awaiting_confirmation',purpose_kind:'donation',purpose_detail:'campanha'}),text:'confirmo'});
    const r=await handleReceiptIntent(d.turn);
    expect(d.db).toHaveBeenCalledWith('conv_svc_receipt_confirm',
      expect.objectContaining({p_stage:d.turn.stage.id,p_message:d.turn.messageId}));
    expect(r?.messages.join(' ')).toMatch(/conferir/i);
  });
  it('corrige finalidade sem executar o lançamento financeiro',async()=>{
    const d=call({stage:stage({status:'awaiting_confirmation'}),text:'não'});
    await handleReceiptIntent(d.turn);
    expect(d.db).toHaveBeenCalledWith('conv_svc_receipt_revise',expect.anything());
    expect(d.db).not.toHaveBeenCalledWith('conv_svc_receipt_confirm',expect.anything());
  });
});
