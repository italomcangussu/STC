// @vitest-environment node
/**
 * João com MODELO REAL (sem roteiro de intenção) + turn.ts real + banco real em PGlite, só com dados de teste.
 * Usa o MESMO modelo e provedor de produção (openai/gpt-6-luna na OpenRouter). Opcional e fora do CI: roda só com
 * JOAO_LIVE_KEY (a OPEN_ROUTER_API_KEY do .env.local).
 * As conversas ficam em JOAO_LIVE_LOG (se definido) para leitura humana.
 */
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { U, j, key, pgDb, q, rpc, svc, world } from '../sql/harness';
import { runTurn } from '../../../supabase/functions/_shared/aiAgent/turn';
import { chatClient, type Chat } from '../../../supabase/functions/_shared/aiAgent/llm';
import type { UazCaller } from '../../../supabase/functions/_shared/uazChat';

const KEY = process.env.JOAO_LIVE_KEY;
const MODEL = 'openai/gpt-6-luna';
const LOG = process.env.JOAO_LIVE_LOG;
const ADMIN = '5599900000001';
let n = 0;

type W = Awaited<ReturnType<typeof world>>;

function live(): Chat {
  const base = chatClient({ apiKey: KEY!, timeoutMs: 90000 });
  return async (messages, config) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await base(messages, { ...config, model: MODEL });
        if (process.env.JOAO_LIVE_RAW && LOG) appendFileSync(LOG, `  - (bruto, ${r.output.length} chars, max ${config.maxTokens}): ${r.output.slice(-300).replace(/\n/g, ' ')}\n`);
        return r;
      } catch (e) {
        if (process.env.JOAO_LIVE_RAW && LOG) appendFileSync(LOG, `  - (erro do provedor): ${String(e).slice(0, 300)}\n`);
        if (attempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  };
}

async function setup() {
  const w = await world();
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: MODEL, buffer_seconds: 0, max_turns: 12 })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5599900000099', ai_direct_enabled: true })})`);
  await rpc(w.db, U.admin, `public.fin_save_account('${key()}', null, null, ${j({ name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2020-01-01', is_default_receipts: true })})`);
  return w;
}

function conversa(w: W, titulo: string) {
  const sent: string[] = [];
  const uaz: UazCaller = async ({ path, body }) => {
    if (path === '/send/text') sent.push(String(body.text));
    return { ok: true, body: { messageid: `OUT${++n}` } };
  };
  const chat = live();
  if (LOG) appendFileSync(LOG, `\n\n## ${titulo}\n`);
  return {
    sent,
    async diz(texto: string) {
      await new Promise((r) => setTimeout(r, 20));
      const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `L${++n}${Math.random()}`, chat_kind: 'direct', phone: ADMIN, name: 'Presidente', kind: 'text', body: texto })})`);
      const antes = sent.length;
      const r = await runTurn(m.message_id, { db: pgDb(w.db), chat, uaz, sleep: async () => undefined });
      const resposta = sent.slice(antes).join(' / ');
      if (LOG) appendFileSync(LOG, `- **Presidente:** ${texto}\n- **João** (${r.action ?? r.status}): ${resposta}\n`);
      return { ...r, resposta };
    },
  };
}

const entradas = (w: W) => q<{ amount_cents: number }>(w.db, 'select amount_cents from public.fin_entries');
const PERGUNTA_DE_DADO_JA_DADO = /qual (é |seria )?o valor|quanto foi|qual a descri|de que se trata/i;

describe.skipIf(!KEY)('João com modelo real', () => {
  it('caso real de 08/10: doação de R$ 30 com "Sim" e "Isso" → nunca grava antes de uma proposta; grava uma vez no aceite dela', async () => {
    const w = await setup();
    const c = conversa(w, 'Doação de R$ 30 (caso de 08/10)');
    // A ordem exata depende do modelo (ele pode inferir a categoria antes): o invariante é o que importa.
    let propostaAnterior = false;
    // Como no atendimento real: "Sim" ao lançar no caixa, "Isso" quando ele sugere Outras receitas, aceite natural na proposta.
    const proxima = (i: number, ultima: string, proposta: boolean) => i === 0 ? 'Recebi 30 reais de doação para comprar presentes, pipoca e picolé para as crianças carentes'
      : proposta ? 'pode lançar' : /outras receitas/i.test(ultima) ? 'Isso' : i === 1 ? 'Sim, lança no caixa' : 'Outras receitas';
    for (let i = 0; i < 6; i++) {
      const r = await c.diz(proxima(i, c.sent.at(-1) ?? '', propostaAnterior));
      const gravadas = await entradas(w);
      if (gravadas.length) {
        expect(propostaAnterior).toBe(true);
        expect(r.action).toBe('admin_confirmed');
        break;
      }
      propostaAnterior = Boolean(r.action?.startsWith('proposed'));
      if (propostaAnterior) expect(c.sent.at(-1)).toMatch(/R\$ 30,00.*Outras receitas/is);
    }
    expect(await entradas(w)).toEqual([{ amount_cents: 3000 }]);
    expect(c.sent.join(' ')).not.toMatch(/recome[cç]|do zero/i);
  }, 600000);

  it('interrupção + sessão expirada: "sobre aquele dinheiro, pode continuar" retoma sem pedir valor/descrição e sem lançar', async () => {
    const w = await setup();
    const c = conversa(w, 'Retomada depois de expirar a sessão');
    await c.diz('Lança uma receita de 50 reais: patrocínio da Padaria Pão Quente, categoria outras receitas');
    await c.diz('Antes disso, me diz uma coisa: quantas quadras de saibro o clube tem?');
    await q(w.db, `update public.conv_ai_sessions set expires_at = now() - interval '1 minute'`);
    await svc(w.db, 'public.conv_svc_ai_expire_sessions()');
    const r = await c.diz('Sobre aquele dinheiro, pode continuar');
    expect(r.resposta).not.toMatch(PERGUNTA_DE_DADO_JA_DADO);
    expect(r.resposta).toMatch(/50/);
    expect(await entradas(w)).toHaveLength(0);
    expect(r.resposta).not.toMatch(/recome[cç]/i);
  }, 600000);

  it('recusas naturais nunca lançam; "Não, pode deixar" encerra só aquele assunto', async () => {
    const w = await setup();
    const c = conversa(w, 'Recusas');
    await c.diz('Lança 80 reais de receita de aluguel de quadra para evento, categoria outras receitas, já foi pago');
    for (const recusa of ['Negativo', 'Agora não', 'Sim, mas espera']) {
      await c.diz(recusa);
      expect(await entradas(w)).toHaveLength(0);
    }
    await c.diz('Não, pode deixar, o financeiro resolve');
    expect(await entradas(w)).toHaveLength(0);
    const abertos = await q(w.db, `select 1 from public.conv_ai_topics where status in ('awaiting_data','awaiting_confirmation','suspended')`);
    expect(abertos).toHaveLength(0);
  }, 600000);

  it('conversa longa (20 trocas no meio) e resposta curta no fim continua a tarefa certa', async () => {
    const w = await setup();
    const c = conversa(w, 'Conversa longa');
    await c.diz('Preciso lançar uma receita de 120 reais da rifa do torneio');
    const conversaFiada = ['Quem ganhou o último torneio?', 'Kkkk', 'E o ranking, mudou muito?', 'Beleza', 'Valeu',
      'Hoje tá quente hein', 'Tem jogo do Fonseca hoje?', 'Show', 'Que horas abre o clube?', 'Ok'];
    for (const fala of [...conversaFiada, ...conversaFiada]) await c.diz(fala);
    const r = await c.diz('Sobre a rifa: categoria outras receitas, já recebi no pix');
    expect(r.resposta).not.toMatch(PERGUNTA_DE_DADO_JA_DADO);
    expect(await entradas(w)).toHaveLength(0);
    expect(c.sent.at(-1)).toMatch(/120/);
  }, 1200000);

  it('pedido composto inédito: mostra o plano e não executa nada sem o aceite', async () => {
    const w = await setup();
    await w.db.exec(`create table if not exists public.announcements(id uuid primary key default gen_random_uuid(), title text not null, message text not null, image_url text,
      is_active boolean default true, show_once boolean default false, created_at timestamptz default now(), expires_at timestamptz, updated_at timestamptz default now())`);
    const c = conversa(w, 'Pedido composto');
    const r = await c.diz('Recebi 200 de doação do Rotary para o torneio infantil: lança em outras receitas, publica um aviso no app agradecendo o Rotary e coloca o logo deles no site');
    expect(await entradas(w)).toHaveLength(0);
    expect(r.resposta).not.toMatch(/não consigo|não posso/i);
    expect(r.action === 'proposed_admin' || /\b1\./.test(r.resposta)).toBe(true);
  }, 600000);
});
