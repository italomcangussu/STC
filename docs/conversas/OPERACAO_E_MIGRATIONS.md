# Conversas e WhatsApp — validar, aplicar e operar

> Nada disto foi aplicado em lugar nenhum: **sem commit, sem deploy, sem `db push`, sem migration no banco remoto**.
> Os comandos abaixo são para **você** rodar na IDE local, na ordem, conferindo cada passo.

## 1. Migrations (ordem obrigatória)

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `20261007100000_conversations_foundation.sql` | schema `conv_private`, canal, grupos, contatos, conversas, mensagens, respostas rápidas, notas, retornos, RLS só-admin, bucket `conv-media`, realtime |
| 2 | `20261007100100_conversations_operations.sql` | ingestão idempotente, envio com idempotência (queue → provedor → finish), caixa, ações do administrador, wrappers `conv_svc_*` |
| 3 | `20261007100200_conversations_ai.sql` | configuração/sessões/propostas da IA, `validate_reservation`, `ai_propose`/`ai_confirm`, gatilho |
| 4 | `20261007100300_conversations_automations.sql` | regras, versões, execuções, destinatários, públicos, janela/teto/opt-out, revalidação |

**Pré-requisitos no banco** (todos já usados pelo STC): `public.is_admin()`, `public.profiles`, `public.reservations`,
`public.courts`, `public.non_socio_students`, `public.student_profiles`, `public.championships`/`matches`/`championship_registrations`,
`public.admin_audit_insert_log`, e o **financeiro** (`fin_private.charge_rows`, `public.fin_settings`) — as migrations
`20261006100*` precisam estar aplicadas antes. Nenhuma tabela existente é alterada.

### 1.1 Validar sem tocar em nenhum banco real

```bash
npm ci
npx vitest run __tests__/conversations/sql     # aplica as 4 migrations em Postgres real (PGlite) e roda os cenários de SQL (acesso, ingestão, IA/reserva, automações)
npx vitest run __tests__/conversations          # + edge functions, IA (turno × SQL real), UI
npx tsc --noEmit && npx eslint . && npm run build
```

O PGlite roda as migrations **na ordem acima**; se alguma falhar, o teste `sql/smoke` mostra qual.

### 1.2 Aplicar (recomendado: primeiro num branch/projeto de teste)

1. Leia os 4 arquivos (são os únicos que mudam o banco). Eles só **criam**; nenhum `DROP`/`UPDATE` em dado existente.
2. Crie um **branch** do Supabase (ou use um projeto de homologação) e aplique:
   ```bash
   supabase link --project-ref <ref-de-teste>
   supabase db push --dry-run          # mostra o que seria aplicado
   supabase db push
   ```
   (ou cole cada arquivo, em ordem, no SQL Editor — um por vez.)
3. Se o remoto tiver a pasta legada `migrations/` ou SQLs soltos, **confira antes** que nada colide com prefixo `conv_`
   (`select tablename from pg_tables where tablename like 'conv\_%';` deve vir vazio).
4. Conferência pós-aplicação (todas devem passar):
   ```sql
   select count(*) from pg_tables where schemaname='public' and tablename like 'conv\_%';        -- 19 tabelas conv_*
   select tablename from pg_tables where schemaname='public' and tablename like 'conv\_%' and not rowsecurity; -- vazio
   select has_table_privilege('anon','public.conv_messages','select');                            -- false
   select has_table_privilege('authenticated','public.conv_messages','insert');                   -- false
   select has_function_privilege('authenticated','public.conv_svc_ai_confirm(uuid, uuid)','execute'); -- false
   select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename like 'conv\_%';   -- conv_messages e conv_conversations
   ```
5. Só depois de testar no branch, aplique no projeto de produção do mesmo jeito.

### 1.3 Reverter

Nenhuma tabela existente é tocada; reverter é remover o que foi criado (o cabeçalho de cada migration traz o roteiro):
`drop` das tabelas `conv_*` (ordem inversa das FKs), do schema `conv_private`, das funções `public.conv_*`, das políticas
`conv_media_*` e do bucket `conv-media` (só vazio); retirar `conv_messages`/`conv_conversations` da publicação `supabase_realtime`.
**Faça backup antes**: mensagens e auditoria são histórico e não têm `DELETE`.

## 2. Segredos (Supabase → Edge Functions → Secrets)

| Nome | Para quê | Obrigatório |
|---|---|---|
| `UAZAPI_SERVER_URL` | URL do servidor UazAPI | sim (enviar/receber) |
| `STC_UAZAPI_INSTANCE_TOKEN` | token da **instância** do clube (nunca vai ao navegador nem ao banco) | sim |
| `STC_PUBLIC_ORIGIN` | origem(ns) permitida(s) do app, separadas por vírgula (ex.: `https://app.exemplo.com`) | sim (CORS da função do painel) |
| `STC_DISPATCH_SECRET` | segredo (≥ 24 caracteres) do agendador de `conversations-dispatch` | sim, para automações/retornos |
| `STC_AI_API_KEY` | chave do provedor de IA | só para a IA |
| `STC_AI_BASE_URL` | base compatível com OpenAI (padrão: OpenRouter) | opcional |

`SUPABASE_URL`, `SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`) e `SUPABASE_PUBLISHABLE_KEY` já existem no ambiente
das funções. **Não grave nenhum destes valores em arquivo versionado, log ou resposta.**

## 3. Funções de borda

```bash
supabase functions deploy whatsapp-webhook --no-verify-jwt        # o provedor não envia JWT; a autorização é o token da URL
supabase functions deploy conversations-dispatch --no-verify-jwt  # autorização: cabeçalho x-dispatch-secret
supabase functions deploy conversation-operations                 # exige JWT do administrador (e confere o papel no banco)
```

## 4. Conectar o WhatsApp e ligar cada capacidade (tela **Conversas → Canal**)

1. **Instância**: *Conectar* → ler o QR no celular do clube (WhatsApp → Aparelhos conectados). Estado “Conectado”.
2. **Webhook**: *Registrar webhook*. Isso gera um token novo (guardado só como hash), aponta a instância para
   `…/functions/v1/whatsapp-webhook?token=…` **sem filtrar grupos** e sem reentrada do que o próprio clube enviou.
   Registrar de novo invalida a URL anterior.
3. **Conta institucional**: informe o **telefone com DDI** (e o LID, se o provedor usar) da conta “STC Institucional” e salve.
4. **Chat**: já funciona (mensagens individuais chegam e saem).
5. **IA individual**: aba **IA** → modelo, contexto do clube, ligar; aba **Canal** → “IA atende conversas individuais”.
   Sem `STC_AI_API_KEY` o agente transfere tudo para a equipe.
6. **Grupos** (só depois de 7):
   - num grupo de teste, **permita** o grupo (aparece como “detectado” na primeira mensagem);
   - de outro celular envie: (a) mensagem marcando a conta institucional; (b) `@todos`; (c) marcando outra pessoa;
     (d) só digitando “STC Institucional”;
   - em **Canal → Menção direta**, confira que **só (a)** aparece como “chamou o STC”. Se nada aparecer como menção,
     o provedor não está entregando a lista: **não marque como verificada** (e registre o payload com o suporte do UazAPI);
   - então *Marcar como verificada*, ligue “IA atende grupos” e, no grupo, “IA neste grupo”.
7. **Automações**: aba **Automações** → criar de um modelo, ver a **Prévia** (quem entra, quem fica de fora e por quê,
   mensagem montada com dado real), enviar o **teste para você** e só então **Ativar**. Em *Regras de envio* ajuste
   janela, dias e tetos por contato.

## 5. Agendar o disparo (automações, retornos e expiração de sessões de IA)

`conversations-dispatch` precisa ser chamada **a cada poucos minutos**. É idempotente: repetir/atrasar/cair no meio nunca
envia duas vezes. Exemplo com `pg_cron` + `pg_net` (se as extensões existirem no projeto) — **troque os dois valores
entre `<>` e não versione o resultado**:

```sql
select cron.schedule('conversations-dispatch', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/conversations-dispatch',
    headers := jsonb_build_object('x-dispatch-secret', '<STC_DISPATCH_SECRET>', 'content-type', 'application/json'),
    body := '{}'::jsonb);
$$);
```

Alternativas: Supabase Cron (painel) ou qualquer agendador externo com o mesmo cabeçalho. A resposta traz contagens
(`tick`, `expiredSessions`, `automations`, `followups`) e **nenhum dado de contato**. O mesmo disparo expira as
sessões de IA vencidas. A coluna “última execução” da aba **Automações** mostra se está rodando.

## 6. Smoke test depois de ligar (nessa ordem)

1. Mandar uma mensagem de um celular qualquer para o número do clube → aparece em **Conversas** em tempo real.
2. Responder pelo painel → chega no celular; o balão passa por “Enviando → Enviada → Entregue/Lida” só com retorno real.
3. Derrubar a conexão e tentar enviar → balão “Não enviada” com *tentar de novo*; nenhuma credencial aparece.
4. IA individual: pedir uma quadra por mensagem → resumo + pedido de confirmação → “sim” → reserva aparece na **Agenda**
   com observação “Reserva via WhatsApp (IA)” e a proposta fica “Confirmada e gravada” na aba IA. Repetir o “sim” não
   cria outra. Ocupar o horário antes do “sim” → a resposta é “indisponível”, **sem** reserva.
5. Automação: prévia → teste para si → ativar → conferir a execução e os destinatários.

## 7. Custos, repetições e falhas

- **IA**: 1 chamada ao modelo por turno; `daily_turn_budget` (padrão 300/dia) e `max_turns` limitam; estourou ⇒ transfere
  para a equipe. O tamanho da conversa enviada ao modelo é limitado (últimas mensagens da sessão).
- **WhatsApp**: sem custo por mensagem na UazAPI, mas o número ligado por QR pode ser bloqueado pelo WhatsApp se houver
  envio em massa — por isso a janela de horário, os tetos por contato e a aprovação manual.
- **Duplicidade**: `provider_message_id` único (entrada), `request_id` único (saída), `purpose_key + dedupe_key`
  (automação), `request_key`/`reservation_id` (reserva). **Retry**: automação 3 tentativas (10 e 20 min), depois fica
  “falhou” para decisão humana (*Reenviar falhas*); mensagem manual fica “falhou” e o administrador reenvia.
- **Provedor fora do ar**: o webhook continua respondendo 200; envios ficam `failed`/`queued` e nada é dado como enviado.

## 8. O que ainda depende de você

- Aplicar as migrations e conferir contra o banco real (não inspecionado).
- Segredos da seção 2, deploy da seção 3 e o agendador da seção 5.
- Conectar o número, registrar o webhook e **verificar a menção em grupo com mensagens reais** (seção 4.6).
- Escolher o modelo de IA e preencher o “Contexto do clube”.
- Confirmar a política de multa/juros no Financeiro **se** quiser usar `{{encargos}}`.
- Decidir se o app (`Agenda`) passa a chamar a mesma função de validação de reserva (hoje as regras estão espelhadas).

## 9. João: memória, reação e resultados (migration `20261007101300_conversations_joao_pack.sql`)

Aditiva (só funções novas; nenhum dado é reescrito). Ordem para pôr no ar:

1. Aplicar a migration (ela só cria `conv_list_ai_memory_candidates`, `conv_review_ai_memory_candidate`, `conv_svc_ai_joao_pack`
   e as peças `conv_private.ai_*`). Conferir com `select conv_svc_ai_joao_pack('<id de uma sessão>')` como `service_role`.
2. Publicar `whatsapp-webhook` (turno, prompt e reação). Se a função de borda subir **antes** da migration, nada quebra:
   o João só fica sem memória/resultados até a migration entrar.
3. Abrir **Conversas → IA**: a memória só começa a ter sugestões depois que o João ouvir algo no grupo; nada vira memória sem aprovação.

Reverter: `drop function` das funções acima (a migration traz o roteiro no rodapé). O João volta ao comportamento anterior sem outra mudança.

> Estado em 2026-10-07: migration aplicada no projeto do STC e `whatsapp-webhook` publicado (v27). Se for republicar, envie **todos** os arquivos da função: o conector não faz merge com a versão anterior.
