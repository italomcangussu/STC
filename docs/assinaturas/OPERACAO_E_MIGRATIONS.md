# Documentos e Assinaturas — modelo, migrations e contrato com a edge function

> **Estado (fase 1 de 5):** banco, bucket e funções (RPC) escritos e testados num Postgres em memória
> (PGlite, `__tests__/signatures/sql/`, 91 testes). **Ainda NÃO aplicado no banco real.**
> Fases seguintes: 2 edge function (código + WhatsApp) · 3 telas do sócio · 4 Painel Admin · 5 comprovante em PDF.

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

## 5. Contrato com a edge function (fase 2)

Só o `service_role` executa `sig_svc_*`. A edge function (a criar) faz:

1. **`request_code`** (JWT do sócio): gera 6 dígitos aleatórios seguros → `sig_svc_issue_challenge(profile, doc, code, evidence, ip, ua)`
   → envia o texto pela UazAPI (`_shared/uazChat.ts`) → `sig_svc_mark_code_sent(challenge, provider_id, error)`.
   `evidence` = `{geo:{lat,lng,accuracy_m}?, device:{timezone,language,screen,platform}?}` (opcional, validado no banco).
2. **`confirm_code`**: `sig_svc_verify_code(challenge, profile, code, ip, ua, geo_do_ip, device)`.
3. **Despachante** (agendado): `sig_svc_enqueue_reminders()` e depois, em laço, `sig_svc_claim_notifications(1)` →
   monta a mensagem → envia **uma por vez com intervalo** (não derrubar a instância) → `sig_svc_finish_notification(id, sent, provider_id, error)`.
   Falha volta à fila com espera de 5 e 10 min; na 3ª fica `failed` e o admin usa "Reenviar falhas".
4. **Link do aviso:** `https://stcplay.com.br/#documentos/<id>` (domínio em configuração, não fixo no código).

Texto do aviso de publicação e do código: ver fase 2. O aviso lembra que **o código só se digita no app**.

## 6. Aplicar no banco real

Só com autorização do clube (como o financeiro). Recomendado: aplicar as 3 migrations em ordem, registrando-as em
`supabase_migrations.schema_migrations` com as mesmas versões dos arquivos, e depois conferir `get_advisors` (segurança)
e rodar o teste de fumaça dentro de transação que reverte.

**Desfazer** (nada é apagado de dado existente): `drop schema sig_private cascade; drop table public.sig_* cascade;
drop function public.sig_*; drop trigger sig_profiles_new_member on public.profiles; delete from storage.buckets where id = 'sig-docs'`
(o bucket só se apaga vazio). Depois de haver assinatura, **não desfaça**: arquive o documento.

## 7. Limites conhecidos

- A leitura até o fim e o aceite são informados pelo aparelho (mitigação: hora do servidor, ordem obrigatória, tempo de leitura, páginas).
- O IP vem do cabeçalho do gateway (`cf-connecting-ip`, `x-real-ip` ou o 1º de `x-forwarded-for`); "cidade aproximada" depende de consulta de IP na fase 2.
- CPF fica em texto no banco (criptografia em repouso é a do Supabase) e é visível ao próprio sócio e ao admin. Base legal e finalidade devem constar no termo.
- Mensagem de WhatsApp pode não chegar mesmo com "enviado" (número trocado, aparelho desligado): por isso o admin acompanha quem não assinou.
