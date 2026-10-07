# Documentos e Assinaturas — modelo, migrations e contrato com a edge function

> **Estado (fase 3 de 5):** banco e funções testados num Postgres em memória (PGlite, `__tests__/signatures/sql/`,
> 91 testes) **e aplicados no banco real (2026-10-07), exceto 4 funções** (ver §6). Edge functions
> `signature-operations` (código + WhatsApp) e `signature-dispatch` (avisos e lembretes) **escritas e testadas, ainda NÃO
> publicadas** (`__tests__/signatures/edge/`, 108 testes, incluindo um que liga a edge function ao SQL real).
> **Telas do sócio prontas** (aba "Documentos e Assinaturas", leitor de PDF, aceite, CPF, folha do código, link `#documentos/<id>`,
> selo de pendentes no menu): ver §8 (`__tests__/signatures/client/`, 14 arquivos). Falta o outro lado: o admin ainda não tem tela
> para subir/publicar (fase 4); sem isso, o documento só nasce por SQL/RPC.
> Fases seguintes: 4 Painel Admin · 5 comprovante em PDF e lembretes agendados.

## 1. O que é

O admin publica um PDF. Cada sócio destinatário recebe um WhatsApp com o link e o passo a passo, lê o
documento até o fim, marca "li e concordo", pede o código de 6 dígitos (chega no WhatsApp) e o digita no app.
A assinatura fica gravada com um dossiê de prova.

**Nível:** assinatura eletrônica **simples** (Lei 14.063/2020) + dossiê. Não é ICP-Brasil.
**O que prova o quê:** o telefone é provado pela posse do WhatsApp (código). O **CPF é declarado** pelo sócio
(só os dígitos verificadores são validados). A leitura "até o fim" é **informada pelo aparelho**; o servidor
registra data e hora, ordem dos eventos e IP, mas não consegue ver a tela.

## 2. Migrations (ordem obrigatória)

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `20261007120000_signatures_foundation.sql` | Tabelas `sig_*`, schema privado `sig_private`, imutabilidade (documento publicado, assinaturas e eventos append-only), cadeia de hash, RLS, bucket privado `sig-docs` e políticas de storage, auditoria |
| 2 | `20261007120100_signatures_admin.sql` | Funções do admin: rascunho, destinatários, **publicar (enfileira o WhatsApp)**, incluir/remover, prazo, arquivar, reenviar falhas, acompanhamento, verificação de integridade |
| 3 | `20261007120200_signatures_signing.sql` | Jornada do sócio (eventos de leitura, CPF, listagem), funções `sig_svc_*` do `service_role` (código, assinatura, fila de avisos, lembretes) e gatilho de sócio novo |

Todas **aditivas**: nenhuma tabela existente é alterada. Pontos que tocam objetos existentes:

- **Gatilho `sig_profiles_new_member` em `public.profiles`** (`after insert or update of is_active, role`): só atua
  para documento publicado marcado "vale para sócio novo". É à prova de erro (falha vira `WARNING`, nunca impede
  criar ou editar o perfil). `profiles` já tem 4 gatilhos (`fin_profile_membership_end`, `trg_admin_audit_profiles`,
  `trg_profile_class_change`, `update_profiles_updated_at`).
- **Storage:** cria o bucket `sig-docs` (privado, 10 MB, só `application/pdf`) e 4 políticas `sig_docs_*`. As políticas
  genéricas que já existem (`Public Access`, `Authenticated Upload/Update`) filtram por `bucket_id` e não alcançam o `sig-docs`.
- **Auditoria:** usa `admin_audit_logs` (`source = 'signatures'`). CPF e telefone **não** vão para o log.

### Conferido no banco real antes de aplicar (somente leitura, 2026-10-07)

`is_admin()` e `admin_audit_insert_log(...)` com a mesma assinatura do repositório; `profiles.role` é o enum `user_role`;
`profiles.phone` e `is_active` existem; nenhum objeto `sig_*`/`sig_private`/`sig-docs` pré-existente; Postgres 17.6.
26 sócios ativos (todos com telefone): a primeira publicação para "todos" gera 26 avisos.

## 3. Tabelas

| Tabela | Papel |
|---|---|
| `sig_documents` | O documento: título, PDF (`<id>/<sha256>.pdf`), hash, páginas, versão, prazo, público (`all`/`selected`), "vale para sócio novo". Rascunho → publicado → arquivado. Publicado é **imutável** |
| `sig_recipients` | Quem deve assinar (e se já assinou). Chave `(documento, sócio)` |
| `sig_signatures` | **A prova.** Retrato do documento, do signatário (nome, telefone, CPF), aceite, leitura, código, IP, aparelho, local e hashes. **Append-only**, sem FK para `profiles` (sobrevive a perfil apagado) |
| `sig_events` | Trilha da jornada com hora do **servidor**: viewed → read_started → read_completed → consent_checked → code_* → signed; envios de aviso. Append-only |
| `sig_notifications` | Fila de WhatsApp: `publish`, `reminder`, `new_member`. Chave única `(documento, sócio, tipo, slot)` = nunca envia duas vezes |
| `sig_member_identities` | CPF declarado (só dígitos, validado) |
| `sig_private.challenges` | Código de 6 dígitos **em hash com sal** (nunca em claro), 10 min, 5 tentativas. Fora da API |

**Integridade:** cada assinatura guarda `evidence_hash` (SHA-256 da evidência canônica, datas em UTC) e `chain_hash`
(= SHA-256 de `prev_chain_hash` + `evidence_hash`, por documento). `sig_verify_integrity(doc)` recalcula tudo e
aponta alteração (`evidence_changed`), buraco (`sequence_gap`) e cadeia rompida (`chain_broken`).

## 4. Fluxo e erros

```
admin   sig_create_draft → (app envia o PDF para sig-docs/<caminho>) → [sig_set_recipients] → sig_publish
        └─ publica + enfileira 1 aviso por destinatário (sem telefone: "skipped/no_phone")
sócio   sig_my_documents → sig_log_event(viewed, read_started, read_completed, consent_checked)
        → sig_save_my_cpf → [edge] sig_svc_issue_challenge → WhatsApp → sig_svc_mark_code_sent
        → [edge] sig_svc_verify_code → assinatura gravada
```

- Funções do app lançam `SIG_*` (ex.: `SIG_FORBIDDEN`, `SIG_FILE_MISSING`, `SIG_NO_RECIPIENTS`, `SIG_DUE_IN_PAST`,
  `SIG_ALREADY_PUBLISHED`, `SIG_READ_INCOMPLETE`, `SIG_CPF_INVALID`, `SIG_CPF_LOCKED`).
- Funções `sig_svc_*` **não lançam** erro de usuário: devolvem `{ok:false, reason}` (um erro desfaria a contagem de
  tentativas). `reason`: `cpf_required`, `read_required`, `consent_required`, `no_phone`, `too_soon` (+`retry_in_seconds`),
  `rate_limited`, `wrong_code` (+`attempts_left`), `locked`, `expired`, `superseded`, `failed`, `not_member`,
  `not_published`, `not_recipient`, `already_signed`, `not_found`.

## 5. Edge functions (fase 2)

Só o `service_role` executa `sig_svc_*`. Quem fala com ele são duas funções de borda; a lógica fica em
`supabase/functions/_shared/signature*.ts` (testável sem Deno) e os `index.ts` só ligam as pontas.

### `signature-operations` (exige JWT do usuário; confere o papel no banco)

| Ação | Quem | O que faz |
|---|---|---|
| `request_code` `{document_id, geo?, device?}` | sócio ativo ou admin | gera 6 dígitos (fonte criptográfica) → `sig_svc_issue_challenge` (só o **hash** fica no banco) → envia pelo WhatsApp **do cadastro** → `sig_svc_mark_code_sent`. Responde `{ok, challenge_id, phone_masked, expires_at}`. **O código nunca volta na resposta** |
| `confirm_code` `{challenge_id, code, device?}` | sócio ativo ou admin | descobre a cidade pelo IP → `sig_svc_verify_code` → assinatura gravada. Responde `{ok, signature_id, signed_at, seq, replayed}` |
| `dispatch` `{limit?}` | **só admin** | despacha agora a fila de avisos (o app chama logo após publicar, em voltas, até `done:true`) |

Erros do usuário voltam como `{ok:false, reason}` com status HTTP (`wrong_code` 422 + `attempts_left`, `expired` 410,
`locked` 423, `too_soon` 429 + `retry_in_seconds`, `rate_limited` 429, `cpf_required`/`read_required`/`consent_required` 409,
`no_phone`/`invalid_phone` 422, `whatsapp_unavailable` 503, `send_failed` 502…). Exceção do banco vira `{error:'REJECTED'}`
(nunca a mensagem crua do Postgres). Quem assina é sempre o dono do **token**; perfil ou telefone no corpo são ignorados.

### `signature-dispatch` (sem JWT; autorizada pelo cabeçalho `x-dispatch-secret`, o mesmo de `conversations-dispatch`)

Agendada a cada 5 min: `sig_svc_enqueue_reminders()` (3 dias antes e no dia do prazo, só para quem não assinou) e depois,
**um aviso por vez** com intervalo aleatório de 1,5–3,5 s (não derrubar a instância), `sig_svc_claim_notifications(1)` →
monta o texto → UazAPI → `sig_svc_finish_notification`. Falha volta à fila com espera de 5 e 10 min; na 3ª fica `failed`
e o admin usa "Reenviar falhas". Sem WhatsApp configurado não pega nada da fila (não gasta tentativa).

### Mensagens (`signatureMessages.ts`)

- **Publicação / sócio novo:** título, prazo, **link `https://stcplay.com.br/#documentos/<id>`** e 4 passos (abrir o link ou
  a aba *Documentos e Assinaturas*; ler até o fim; marcar *Li e concordo* e *Assinar digitalmente*; digitar o código de 6 dígitos).
- **Lembretes:** "faltam 3 dias" e "hoje é o último dia (até HH:mm)", com o mesmo passo a passo.
- **Código:** o número sozinho em uma linha (dá para copiar), validade de 10 min.
- Todas dizem que **o código só se digita no app e não se passa a ninguém**. O link só leva ao app (exige login); quem assina é o código.
- O telefone do cadastro (DDD + número) ganha o DDI `55` no envio, na mesma regra de `lib/phoneAuth.ts`.

### Localização no clique de "Assinar digitalmente" (cliente, `lib/signatures/`)

O botão **Assinar digitalmente** deve chamar `requestSignatureCode(documentId)` (`lib/signatures/api.ts`). Essa função:

1. **abre primeiro a tela do sistema** que pede permissão de localização (`navigator.geolocation.getCurrentPosition`, com GPS e 12 s de
   limite), se o sócio ainda não decidiu;
2. **depois** pede o código à `signature-operations`, mandando no mesmo pedido o GPS (`geo`) e o aparelho (`device`, incluindo
   `device.location` = `granted | denied | unavailable | timeout | unsupported`);
3. devolve `{challengeId, phoneMasked, expiresAt, location}`. "Reenviar código" chama a mesma função.

Regras: **a localização é opcional e nunca bloqueia** (negar, falhar ou demorar → a assinatura segue só com o IP, e o resultado fica
no dossiê). Uma rede de segurança de 45 s libera o fluxo se o navegador nunca responder o pedido. O app **não consegue pedir de novo**
depois de "Não permitir": a tela deve mostrar `locationHint(status)`, que orienta a liberar nos ajustes do celular. Mostre
`LOCATION_NOTICE` ao lado do botão (por que pedimos e que é opcional). Exige **HTTPS** (contexto seguro). GPS é dado pessoal: a base
legal e a finalidade devem constar no termo.

### Cidade aproximada pelo IP

O IP é gravado sempre. A cidade é um complemento: consulta a um serviço de localização por IP (padrão `https://ipwho.is/{ip}`,
HTTPS, sem chave), com 2,5 s de limite e cache; **falha ou IP privado = assinatura segue só com o IP**. Não usamos cabeçalhos
de localização do Cloudflare (sem a regra ligada eles viriam do próprio cliente). ⚠️ Isto envia o **IP do sócio a um serviço
de terceiros**; para desligar, `STC_GEOIP_URL=off`; para trocar de serviço, `STC_GEOIP_URL=https://…/{ip}`.

### Segredos (Supabase → Edge Functions → Secrets)

| Nome | Para quê | Obrigatório |
|---|---|---|
| `UAZAPI_SERVER_URL`, `STC_UAZAPI_INSTANCE_TOKEN` | WhatsApp do clube (**já existem** por causa de Conversas) | sim |
| `STC_PUBLIC_ORIGIN` | origem(ns) do app permitidas (CORS). **Precisa incluir `https://stcplay.com.br`** | sim |
| `STC_DISPATCH_SECRET` | segredo (≥ 24 caracteres) do agendador (**já existe** se Conversas está agendada) | sim, para lembretes |
| `STC_APP_URL` | endereço do app no link das mensagens | não (padrão `https://stcplay.com.br`) |
| `STC_GEOIP_URL` | serviço de cidade por IP, com `{ip}`; `off` desliga | não |

### Publicar as funções e agendar

```bash
supabase functions deploy signature-operations                  # exige JWT do usuário
supabase functions deploy signature-dispatch --no-verify-jwt    # autorização: cabeçalho x-dispatch-secret
```

```sql
-- troque os dois valores entre <>; não versione o resultado (mesmo molde de conversations-dispatch)
select cron.schedule('signature-dispatch', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/signature-dispatch',
    headers := jsonb_build_object('x-dispatch-secret', '<STC_DISPATCH_SECRET>', 'content-type', 'application/json'),
    body := '{}'::jsonb);
$$);
```

**Teste de fumaça depois de publicar** (nessa ordem): (1) publicar um documento de teste só para o admin → chega o WhatsApp com o
link e o passo a passo; (2) ler, aceitar, pedir o código → chega o código; (3) código errado → "tentativas restantes"; (4) código
certo → assinatura gravada e `sig_verify_integrity` com `ok: true`; (5) repetir o disparo → nada é enviado de novo.

## 6. Aplicar no banco real

**Situação (2026-10-07, com autorização do clube):** migrations **1 e 3 aplicadas por inteiro** e registradas em
`supabase_migrations.schema_migrations`. A **2 foi aplicada sem 4 funções** — `sig_set_recipients`, `sig_delete_draft`,
`sig_publish` e `sig_remove_recipient` — porque o conector Supabase usado pelo assistente **trava (sem erro do banco) em
qualquer SQL com `delete from`** (a sessão não consegue dar a confirmação que ele espera). Não contornamos o filtro: o trecho
literal está em **`docs/assinaturas/PENDENTE_funcoes_com_delete.sql`**. **Rode esse arquivo inteiro, uma vez, no SQL Editor
do Supabase.** Ele cria as 4 funções, refaz as permissões e registra a migration 2 (`20261007120100`).
**Sem `sig_publish` nenhum documento pode ser publicado.**

Depois de rodar: conferir `get_advisors` (segurança) e, dentro de uma transação que reverte, um teste de fumaça
(rascunho → arquivo → publicar → assinar).

**Desfazer** (nada é apagado de dado existente): `drop schema sig_private cascade; drop table public.sig_* cascade;
drop function public.sig_*; drop trigger sig_profiles_new_member on public.profiles; delete from storage.buckets where id = 'sig-docs'`
(o bucket só se apaga vazio). Depois de haver assinatura, **não desfaça**: arquive o documento.

## 7. Limites conhecidos

- A leitura até o fim e o aceite são informados pelo aparelho (mitigação: hora do servidor, ordem obrigatória, tempo de leitura, páginas).
- O IP vem do cabeçalho do gateway (`cf-connecting-ip`, `x-real-ip` ou o 1º de `x-forwarded-for`); a "cidade aproximada" vem de um serviço de terceiros e pode faltar (o IP fica gravado de qualquer jeito).
- CPF fica em texto no banco (criptografia em repouso é a do Supabase) e é visível ao próprio sócio e ao admin. Base legal e finalidade devem constar no termo.
- Mensagem de WhatsApp pode não chegar mesmo com "enviado" (número trocado, aparelho desligado): por isso o admin acompanha quem não assinou.

## 8. Telas do sócio (fase 3)

Aba **"Documentos e Assinaturas"** no menu (sócios e administradores, que também assinam; lanchonete não vê). Código em
`components/signatures/` e `lib/signatures/`; a aba carrega sob demanda (`React.lazy`), e o pdfjs só é baixado quando alguém abre um documento.

**Link do aviso:** `https://stcplay.com.br/#documentos/<id>` (`lib/signatures/routes.ts`). Fica no `#`: não depende de roteador, sobrevive
ao login (o estado da aba nasce antes da tela de login) e, com o app já aberto, `hashchange` troca de aba sem recarregar. Id malformado ou
de documento que não é do sócio abre a lista com o aviso "Documento indisponível". Sair da aba limpa o `#`.

**Selo de pendentes:** `sig_my_pending_count` alimenta o número no item do menu (celular e desktop) e um ponto vermelho no botão do menu
do celular. Atualiza ao abrir o app, ao voltar o foco, a cada 5 min e quando o sócio assina (`stc:signatures-changed`). Se a consulta
falha, o selo mantém o último valor, sem erro na tela.

**Jornada (a ordem é a que o servidor exige, e cada passo leva a hora DELE):**

| Passo na tela | Libera quando | Grava no servidor (`sig_log_event`) |
|---|---|---|
| 1. Ler até o fim | **todas** as páginas apareceram na tela **e** o fim da última foi alcançado | `viewed` + `read_started` (ao desenhar a 1ª página); `read_completed` com `pages_seen/pages_total` |
| 2. "Li e concordo" | a leitura foi **registrada** no servidor | `consent_checked` (a caixa só marca depois que o servidor confirma) |
| 3. CPF | digita 11 dígitos válidos (a tela confere os dígitos como o banco) e confirma | `sig_save_my_cpf` (travado depois da 1ª assinatura) |
| 4. "Assinar digitalmente" | passos 1–3 feitos e o PDF abriu sem erro | `request_code` → folha do código → `confirm_code` |

- **"Leia até o fim":** `lib/signatures/reading.ts`. Uma página conta como vista com ≥ 40% do que cabe dela na tela e **já desenhada**
  (página em branco não conta). Pular direto para o fim não vale: as páginas do meio nunca aparecem. Girar o aparelho não perde o
  progresso. Conferido no Chromium real (PDF de 6 páginas): começa em 1/6; pular ao fim dá 2/6 sem concluir; rolar até o fim conclui.
- **Arquivo conferido:** o PDF baixado do bucket privado tem o SHA-256 comparado ao `content_sha256` publicado; se não bater, o documento
  **não abre** para leitura. O número de páginas do arquivo também precisa bater com o cadastro (senão a leitura nunca fecharia).
- **Memória do celular:** as páginas são desenhadas só perto da tela (margem de 150%) e liberadas ao se afastar; resolução limitada a 2×.
- **Trilha em fila:** os eventos saem um por vez, na ordem (`lib/signatures/journey.ts`); se um falhar, o seguinte tenta de novo e a tela
  oferece "Tentar registrar de novo". Cada passo só é enviado uma vez com sucesso.
- **Clique em "Assinar digitalmente":** a primeira coisa é `requestSignatureCode`, que abre o pedido de localização do sistema e só depois
  pede o código (a localização nunca bloqueia; ver §5). O CPF é salvo no passo 3, justamente para o clique já abrir o pedido de localização.
- **Folha do código:** 6 dígitos (aceita colar "123 456"), `autocomplete="one-time-code"`, contagem de validade (10 min) e do reenvio (60 s),
  tentativas restantes, mensagem para localização negada. Tocar fora da folha **não** a fecha. Código errado/expirado/bloqueado explica e
  manda pedir outro.
- **Documento já assinado:** só consulta (sem passos, sem eventos, sem rastrear leitura) e mostra data/hora no horário de Fortaleza.
- **Prazo:** "Vence em N dias", "Vence hoje", "Prazo venceu há N dias" (calendário do clube; não bloqueia assinar depois do prazo).

**O que NÃO mudou no banco:** nenhuma migration nova na fase 3. Tudo usa `sig_my_documents`, `sig_my_pending_count`, `sig_log_event`,
`sig_save_my_cpf`, leitura de `sig_member_identities` (só a própria linha, filtrada por id) e o bucket `sig-docs`.

**Teste no navegador real (Chromium + Playwright, backend simulado por interceptação de rede):** link `#documentos/<id>` abriu direto o
documento; botão e aceite desabilitados antes da leitura e depois de pular ao fim; ordem das chamadas
`storage → viewed → read_started → read_completed → consent_checked → sig_save_my_cpf → request_code → confirm_code`; com permissão de
GPS o pedido do código levou `{lat, lng, accuracy_m}` e `location: granted`; sem permissão, sem `geo`, `location: denied` e o aviso na folha;
código errado mostrou "Restam 4 tentativas" e o certo assinou.
