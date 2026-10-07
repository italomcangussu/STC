# Handoff para o agente da IDE — Documentos e Assinaturas

Branch `feat/documentos-assinaturas` (PR #17). Leia primeiro `docs/assinaturas/OPERACAO_E_MIGRATIONS.md` e `.fabuloso/arquitetura.md`.

## Estado
- Fase 1 (banco, bucket, RPCs, testes): pronta. Fase 2 (edge functions `signature-operations` e `signature-dispatch`): **implantadas** em 2026-10-07 (cron `signature-dispatch` a cada 5 min, job 6). Fase 3 (telas do sócio + link `#documentos/<id>`): pronta. Fase 4 (Painel Admin, seção Documentos): pronta (ver `OPERACAO_E_MIGRATIONS.md` §9).
Fase 5 (comprovante em PDF + lembretes agendados): pronta (§10 do documento de operação).
- Falta só o **teste de ponta a ponta** com um documento real, que manda WhatsApp de verdade (roteiro no `OPERACAO_E_MIGRATIONS.md` §5).

## 1. Banco (feito em 2026-10-07)
As 3 migrations estão aplicadas por inteiro no projeto `smztsayzldjmkzmufqcz`. As 4 funções com `delete from` (`sig_set_recipients`, `sig_delete_draft`, `sig_publish`, `sig_remove_recipient`) foram aplicadas pela API de gestão a partir de `PENDENTE_funcoes_com_delete.sql` (arquivo só de registro; não rode de novo). O conector MCP do Supabase continua travando em SQL com `delete from`; para esse caso use a API de gestão com o token do `.env.local`, por referência.

## 2. Edge functions e segredos (feito em 2026-10-07)
- Publicadas com `supabase functions deploy <nome> --use-api` (sem Docker): `signature-operations` (JWT) e `signature-dispatch --no-verify-jwt`.
- Segredos já existiam (`STC_PUBLIC_ORIGIN` aceita `https://stcplay.com.br`, `STC_DISPATCH_SECRET`, UazAPI de Conversas). Opcionais: `STC_APP_URL`, `STC_GEOIP_URL`.
- Cron `signature-dispatch` (`*/5 * * * *`) criado clonando o comando do job de Conversas (o segredo nunca passa pelo terminal).
- Verificado: preflight CORS ok, 401 sem JWT/segredo, e o despacho real respondeu `configured: true` com a fila vazia.

## 3. Fase 4 — Painel Admin (pronta)
Seção `documentos` no grupo Clube do painel (`components/signatures/admin/`, `lib/signatures/admin.ts`). Detalhes e decisões em `OPERACAO_E_MIGRATIONS.md` §9.
Para o primeiro teste de ponta a ponta, **depois** de §1 e §2: publicar um documento só para um admin (modo "escolhidos"), conferir o WhatsApp, assinar e rodar "Conferir integridade".

## 4. Fase 5 (pronta)
Comprovante em PDF (sócio: cópia mascarada; admin: completa) e lembretes d-3/d0 pelo `signature-dispatch` + cron. Ver `OPERACAO_E_MIGRATIONS.md` §10.

## Regras do projeto
- Validação pesada só pela fila: `node <skill fabuloso>/scripts/fabuloso.mjs testar -- <cmd>` (vitest, tsc, build).
- Nunca `--force`/`--no-verify`; nunca push na `main`; sem segredos em log.
- Commits terminam com os trailers do Claude (veja `git log`). Não cite modelo em commits/PR.
- Decisões fixas: só sócios titulares (admin também assina), sem recusa, assinatura eletrônica simples (Lei 14.063/2020), código 10 min/5 tentativas/reenvio 60 s/5 por hora.
