# Handoff para o agente da IDE — Documentos e Assinaturas

Branch `feat/documentos-assinaturas` (PR #17). Leia primeiro `docs/assinaturas/OPERACAO_E_MIGRATIONS.md` e `.fabuloso/arquitetura.md`.

## Estado
- Fase 1 (banco, bucket, RPCs, testes): pronta. Fase 2 (edge functions `signature-operations` e `signature-dispatch`): pronta no código, **não implantada**. Fase 3 (telas do sócio + link `#documentos/<id>`): pronta.
- Faltam: **fase 4** (Painel Admin) e **fase 5** (recibo em PDF + lembretes agendados).

## 1. Banco (fazer antes de tudo)
1. As migrations `supabase/migrations/2026100712*_signatures_*.sql` já foram aplicadas no projeto `smztsayzldjmkzmufqcz`, **exceto 4 funções com `delete from`** (o conector do Supabase trava nelas).
2. Rode `docs/assinaturas/PENDENTE_funcoes_com_delete.sql` no SQL Editor (ou `psql`/`supabase db push`). Sem `sig_publish` nada é publicado.
3. Confira: `select proname from pg_proc where proname like 'sig\_%';` deve listar todas as funções `sig_*` do documento de operação.
4. Rode os testes SQL das migrations (veja §banco do doc de operação) contra um banco real.

## 2. Edge functions e segredos
- `supabase functions deploy signature-operations`
- `supabase functions deploy signature-dispatch --no-verify-jwt`
- Segredos: `STC_PUBLIC_ORIGIN` (inclui `https://stcplay.com.br`); opcionais `STC_APP_URL`, `STC_GEOIP_URL`. UazAPI reutiliza a config de Conversas.
- Agende o `signature-dispatch` com pg_cron (a cada 5–10 min).

## 3. Fase 4 — Painel Admin (nova seção em `components/` do painel admin)
- Upload de PDF (≤10 MB) para o bucket privado `sig-docs`, com SHA-256 (`lib/signatures/hash.ts`) e contagem de páginas (`lib/signatures/pdf.ts`).
- Publicar com confirmação: chama a RPC de publicação e depois `dispatch` em laço até esvaziar a fila.
- Status por sócio (assinou / pendente / falha de envio), reenviar falhas, arquivar, criar nova versão. Documento publicado é **imutável**.
- Reuse `components/signatures/ui.tsx`, `lib/signatures/format.ts` e `documentErrorMessage`.

## 4. Fase 5
- Recibo em PDF com o dossiê (nome, telefone verificado, CPF declarado, IP/cidade, GPS se houver, hash, horários da jornada).
- Lembretes (d‑3 e d0) pelo dispatcher + pg_cron.

## Regras do projeto
- Validação pesada só pela fila: `node <skill fabuloso>/scripts/fabuloso.mjs testar -- <cmd>` (vitest, tsc, build).
- Nunca `--force`/`--no-verify`; nunca push na `main`; sem segredos em log.
- Commits terminam com os trailers do Claude (veja `git log`). Não cite modelo em commits/PR.
- Decisões fixas: só sócios titulares (admin também assina), sem recusa, assinatura eletrônica simples (Lei 14.063/2020), código 10 min/5 tentativas/reenvio 60 s/5 por hora.
