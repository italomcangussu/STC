# Financeiro do STC — operação, migrations e configuração

> **Estado (2026-10-06):** as 5 primeiras migrations foram testadas num Postgres em memória (PGlite) e
> **aplicadas no projeto Supabase "agentes N8N" (`smztsayzldjmkzmufqcz`, onde mora o STC)** a pedido do clube.
> Foram aplicadas em partes, pelo conector, e **registradas em `supabase_migrations.schema_migrations`
> com as mesmas versões dos arquivos** (`20261006100000` … `20261006100400`), então `supabase migration list`
> as mostra como aplicadas e `db push` não tenta repeti-las. Não houve deploy do app por esta sessão.
> Seções 2 e 2.1 registram a validação feita no banco real; a 3 serve para outro ambiente (homologação/novo projeto).

## 1. Migrations (ordem obrigatória)

Todas em `supabase/migrations/`, todas **aditivas** (só criam objetos `fin_*` e o
schema privado `fin_private`; nenhuma tabela ou coluna existente é apagada ou
alterada, exceto o que está listado em 1.1).

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `20261006100000_finance_foundation.sql` | Configuração (singleton), calendário de feriados, contas, categorias, lançamentos (contas a pagar/receber, aportes, retiradas, transferências), pagamentos de lançamentos, anexos, recorrências, idempotência (`fin_requests`), auditoria (reusa `admin_audit_logs`), bucket privado `fin-docs`, visão `fin_entries_v`. |
| 2 | `20261006100100_finance_member_billing.sql` | Planos individuais dos sócios (início, fim, periodicidade), histórico de preços, cobranças geradas (idempotente), ajustes (desconto/acréscimo/dispensa de encargos), pagamentos (livro-razão com estorno), créditos (excedente/duplicado), cálculo de extrato e encargos, geração/encerramento, gatilho de fim de vínculo em `profiles`. |
| 3 | `20261006100200_finance_receipts.sql` | Comprovantes (estados enviado → em análise → aprovado/rejeitado/substituído), vínculo comprovante × cobrança, bucket privado `fin-receipts` + políticas de Storage, aprovação/recusa (única porta que quita). |
| 4 | `20261006100300_finance_day_card.sql` | Só a **leitura** do Day Card dos convidados (derivado das reservas com convidado). Nenhuma tabela nova. Não há repasse a professor: o professor é pago pelo aluno, fora do financeiro do clube. |
| 5 | `20261006100400_finance_reports.sql` | DRE por competência (mensalidades, Card Mensal e Aula avulsa pelo pagamento registrado, Day Card do convidado), detalhe por categoria, movimentos e fluxo de caixa por data real, saldos por conta, resumos a receber/a pagar, tendência mensal. |
| 6 | `20261006100500_finance_due_same_month.sql` | **Vencimento no mês cobrado e só fins de semana** (decisão de 2026-10-06): `due_month_offset` padrão 0 (e 1 → 0 na configuração do clube, `version` +1); desativa todos os feriados (linhas preservadas) e `seed_holidays` passa a semear tudo inativo; redata só as cobranças **intocadas** (abertas, geradas, sem pagamento nem ajuste). Idempotente, sem `DROP` nem `UPDATE` sem `WHERE`. **Ainda NÃO aplicada no banco real**: depende de autorização do clube (muda vencimentos de cobranças abertas). |

### 1.1 Únicos pontos que tocam objetos já existentes

- **Gatilho em `public.profiles`** (`fin_profile_membership_end`, `after update of is_active, role`): encerra o plano do sócio quando ele deixa de ser sócio ativo. É à prova de erro (uma falha do financeiro nunca impede a edição do perfil).
- **Gatilho de auditoria em `public.student_payments`** (`fin_student_payments_audit`): só **registra** inserts/updates/deletes do pagamento do aluno em `admin_audit_logs` (`source = 'finance'`). É "mole": nunca bloqueia nem altera o fluxo existente.
- **Storage:** cria os buckets `fin-docs` e `fin-receipts` (privados, 10 MB, imagem/PDF) e as políticas em `storage.objects` com prefixo `fin_`.
- **Nenhuma tabela `fin_*` referencia** `reservations`, `non_socio_students`, `student_payments` nem `professors`: o app apaga esses registros e o financeiro não pode travar esses fluxos. O Day Card e as taxas dos alunos são **lidos na origem**. (Professor não tem nada no financeiro: ele é pago pelo aluno.)

## 2. Antes de aplicar (validação no banco)

Esta checagem **já foi feita no banco real do STC em 2026-10-06, antes de aplicar** (dependências
`is_admin`/`admin_audit_*` com a mesma assinatura do repositório; colunas de `reservations`,
`student_payments`, `non_socio_students` e `profiles`; enums `reservation_status = active|cancelled` e
`payment_status_type = paid|pending|exempt`; nenhum objeto `fin_*` pré-existente). Para **outro ambiente**,
rode **somente leitura** e confirme:

```sql
-- 1) Dependências existentes (devem retornar linhas)
select proname from pg_proc where proname in ('is_admin','admin_audit_insert_log','admin_audit_changed_fields','admin_audit_try_uuid');
select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='reservations'
   and column_name in ('guest_name','payment_status','creator_id','status','type','date');
select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='student_payments' and column_name in ('student_id','amount','payment_date','valid_until','status','cancelled_reason');
select column_name from information_schema.columns
 where table_schema='public' and table_name='non_socio_students' and column_name in ('name');
select column_name from information_schema.columns
 where table_schema='public' and table_name='profiles' and column_name in ('role','is_active','name');

-- 2) Nada com os nomes novos deve existir ainda (devem retornar 0 linhas)
select tablename from pg_tables where schemaname='public' and tablename like 'fin\_%';
select nspname from pg_namespace where nspname='fin_private';
select id from storage.buckets where id in ('fin-docs','fin-receipts');

-- 3) Papéis e tamanho dos dados
select role, count(*) from public.profiles group by role;
select count(*) from public.student_payments;
```

Se alguma coluna da consulta 1 não existir, **pare**: a migration 4 (Day Card) assume esses
nomes. Pontos que dependem do banco real e que eu não pude confirmar: se `reservations.payment_status`
aceita o valor `exempt` (é o que o painel já usa para isentar), se `reservations.creator_id` é quem
reservou (aparece só como "reserva de") e a política de RLS de `student_payments`/`reservations`
(as funções do financeiro são `SECURITY DEFINER` e não dependem delas).

**Recomendado:** aplicar primeiro numa *branch* do Supabase (ou projeto de homologação),
rodar a checklist da seção 5 e só então no projeto de produção. Faça backup antes.

### 2.1 O que foi conferido depois de aplicar no remoto (2026-10-06)

- **Impressão digital local × remoto idêntica:** 82 funções (`md5` do corpo, `SECURITY DEFINER` e `search_path`), 257 colunas
  (tipo/nulidade/default), 72 políticas (RLS e Storage), 34 gatilhos, 186 constraints e 63 índices `fin_*` — o banco
  real tem exatamente o que os testes provaram. (Calculada com o mesmo SQL no PGlite e no Postgres 17.6 do projeto.)
- **Teste de fumaça no banco real, dentro de transação que reverte:** leituras do administrador (DRE, caixa, saldos,
  a receber/a pagar, tendência, Day Card, receita de alunos) rodam com os dados reais; escrita com chave de
  idempotência repetida devolve o mesmo resultado (`replayed`), saldo da conta fecha e a auditoria grava; sócio comum recebe
  `FINANCE_FORBIDDEN` e não lê `fin_entries`; `anon` recebe `permission denied`. Nada ficou gravado (0 contas/lançamentos/planos).
- **Advisors de segurança:** nenhum achado novo nos objetos `fin_*`; permanece o aviso padrão "função `SECURITY DEFINER`
  executável por `authenticated`" (intencional: cada RPC valida `is_admin()`/`auth.uid()`). Os avisos antigos do projeto
  (ex.: RLS desativado em tabelas não financeiras) não foram tocados.
- **Grants:** `anon`/`public` sem acesso a nenhuma tabela, visão ou função `fin_*`; schema `fin_private` sem `USAGE` para os papéis da API.
- **Estado dos dados:** categorias (31), feriados nacionais 2024–2036 (169) e a linha única de configuração foram criados; **não há
  contas, planos, cobranças nem lançamentos** — o clube ainda precisa fazer a configuração da seção 4.

**Observações da aplicação pelo conector:** o conector travou (sem erro do banco) com `DROP …` e com `UPDATE` sem `WHERE`.
Por isso a migration 1 usa `if not exists` em vez de `drop trigger` no gatilho de `student_payments` e `fin_save_settings`
atualiza com `where id` (a tabela é de linha única). Ficou no banco uma função auxiliar de teste, **inofensiva e sem acesso pela API**:
`fin_private.zz_probe3(jsonb)`; remova pelo SQL Editor quando quiser: `drop function fin_private.zz_probe3(jsonb);`.

## 3. Como aplicar em outro ambiente (homologação ou novo projeto)

Com o Supabase CLI já ligado ao projeto (sem expor segredos — o CLI usa a sessão/`.env.local`
que você já tem):

```bash
supabase migration list                  # confirme que só as 5 migrations fin_* estão pendentes
supabase db push --dry-run               # mostra o que seria aplicado, sem aplicar
supabase db push                         # aplica (na branch/homologação primeiro)
```

Alternativa sem CLI: abra o SQL Editor do Supabase e rode os 5 arquivos, **um por vez e em ordem**.
Cada arquivo é autossuficiente (nenhum usa `begin/commit` próprio); o CLI e o SQL Editor executam o arquivo como um lote único — se algum comando falhar, confira o que ficou aplicado antes de repetir (por isso a homologação primeiro).

**Reverter:** `docs/financeiro/rollback_financeiro.sql` (destrutivo — apaga os dados financeiros;
exige a trava `set fin.confirm_drop = 'DROP_FINANCE'`). Só use em ambiente sem dados que importem
ou depois de backup. Os arquivos dos buckets precisam ser removidos pelo painel do Storage.

## 4. Configuração que o administrador precisa fazer depois de aplicar (nenhum valor é presumido)

Ordem sugerida, tudo em **Financeiro** (menu do administrador):

1. **Cadastros › Contas:** crie o caixa e a(s) conta(s) do banco, com saldo inicial; marque a **conta padrão de recebimentos**.
2. **Cadastros › Configurações › Feriados:** (opcional) “Carregar nacionais” do ano para consulta e cadastre os municipais/estaduais; nada conta até ser ativado.
3. **Configurações › Cobrança:** confira o vencimento (dia 5 do mês cobrado; sábado e domingo vão para a segunda; feriado não conta — decisão do clube de 2026-10-06) e **defina a política de encargos** (carência, multa, juros). Enquanto não confirmar, **nenhum encargo é calculado**.
4. **Configurações › Day Card e comprovantes:** confira o valor do Day Card do convidado (vem do valor já usado no app, R$ 50) e os nomes do clube nos comprovantes.
5. **Receber › Pendências › Configurar régua:** confira a chave PIX, os dias de envio e os encargos próprios das pendências de sócio (não ficam em Configurações).
6. **Receber › Mensalidades › Sócios e valores:** crie o plano de cada sócio (valor próprio, início, periodicidade) e gere as cobranças.
7. **Cadastros › Categorias:** revise o plano de contas do DRE.

### Geração automática de cobranças (opcional, não aplicada)

A geração roda quando o administrador cria/edita planos ou aperta **Gerar cobranças**. Para rodar
todo mês sem ninguém, é possível agendar com `pg_cron` (extensão do Supabase; **valide em homologação**,
pois o job roda sem usuário logado e a cobrança sai com “criado por: sistema”):

```sql
-- NÃO faz parte das migrations. Exemplo para o dia 1º, 06:00 (Fortaleza = 09:00 UTC):
-- select cron.schedule('fin-gerar-cobrancas', '0 9 1 * *', $$ select fin_private.generate_charges(null, (now() at time zone 'America/Fortaleza')::date) $$);
```

## 5. Checklist de validação depois de aplicar (em homologação)

```sql
select count(*) from pg_tables where schemaname='public' and tablename like 'fin\_%';            -- 17 tabelas
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fin\_%';  -- funções públicas
select has_function_privilege('anon','public.fin_dre_lines(date,date)','execute');                -- false
select has_function_privilege('authenticated','public.fin_dre_lines(date,date)','execute');       -- true (a função recusa quem não é admin)
select relname, relrowsecurity from pg_class where relname like 'fin\_%' and relkind='r';          -- todas com RLS ligada (true)
select id, public from storage.buckets where id in ('fin-docs','fin-receipts');                    -- public = false
```

Depois, com **três usuários de teste** (administrador, sócio, professor), confira no app:
o sócio só vê as próprias cobranças e comprovantes; o professor e a lanchonete não veem nada do financeiro; o administrador
vê tudo. A cobertura automática dessas regras está em
`__tests__/finance/sql/*.test.ts` (rodam as migrations de verdade em PGlite).

## 6. OCR e armazenamento — dependências e configuração

| Item | Situação |
|---|---|
| Leitura de imagem | `tesseract.js` (Apache-2.0), português + inglês, **no aparelho do sócio** (o arquivo não vai a nenhum serviço de OCR). Os dados de idioma/WASM baixam de um CDN público (jsDelivr) na 1ª leitura — não contêm dados do usuário. Para **hospedar por conta própria** (privacidade/CSP/offline): copie `worker.min.js`, os `tesseract-core*` e `por.traineddata.gz`/`eng.traineddata.gz` para uma pasta pública e defina `VITE_OCR_ASSETS_URL=https://seu-dominio/ocr` no ambiente de build. |
| Leitura de PDF | `pdfjs-dist` (Apache-2.0), só PDF **com camada de texto** (as 3 primeiras páginas). PDF escaneado vira “não conseguimos ler” e o sócio informa os dados à mão. |
| HEIC | Aceito no envio; a leitura automática depende do navegador decodificar a imagem — se não, cai no preenchimento manual. |
| Limites | O OCR é **sugestão**. Nada é quitado por ler ou receber arquivo; só `fin_approve_receipt` (administrador) cria pagamento. O texto lido nunca é gravado nem logado; só campos estruturados (valor, data, identificador, favorecido, confiança). |
| Armazenamento | Buckets privados `fin-receipts` (`<uid>/<envio>/<arquivo>`, sócio escreve só na própria pasta) e `fin-docs` (anexos de despesa, só administrador). URLs assinadas de 120 s. Limite de 10 MB e tipos de arquivo repetidos no bucket; **os bytes do arquivo (tipo real) só são verificados no aparelho** — o servidor valida `Content-Type` e tamanho. |
| Push | O aviso ao sócio usa o `sendPushNotification` já existente (best-effort). Sem push configurado, o status e o próximo passo aparecem na tela “Meu financeiro”. |

## 7. Decisões que cabem ao clube (nenhuma tem valor padrão inventado)

| Decisão | Onde | Enquanto não decidir |
|---|---|---|
| Valor da mensalidade de cada sócio, início e periodicidade | Mensalidades › Sócios e valores | Sócio sem plano não tem cobrança |
| Carência, multa (fixa/%) e juros diários (fixo/%) | Configurações › Cobrança | **Nenhum encargo é calculado** (tela avisa “não configurados”) |
| Base do percentual diário | Fixa no código e documentada: juros **simples**, sobre o principal em aberto no início do dia; multa única no 1º dia de atraso; encargos nunca entram na base | — (mudar exige decisão e nova versão da regra) |
| Dia/mês do vencimento e regra de dia não útil | Configurações › Cobrança | Padrão: dia 5 do mês cobrado, próximo dia útil; sábado **não** é dia útil (configurável); feriado não conta (ver abaixo) |
| Feriados (nacionais, locais, Carnaval, Corpus Christi) | Configurações › Feriados | **Nenhum conta** por padrão (só fins de semana); todos nascem **inativos** e o admin ativa os que o vencimento deve pular |
| Régua das pendências de sócio (ativa/pausada, dias de envio, PIX, carência, multa/juros) | Receber › Pendências › Configurar régua | Configuração salva; sem PIX a nova pendência avisa e leva à régua |
| Valor do Day Card (convidado) | Configurações › Day Card | R$ 50, o valor que o app já usava |
| Day Card entra no caixa ou só na competência? | Configurações › Day Card | Só competência (DRE): é derivado da reserva, sem pagamento registrado |
| Quem pode dispensar encargos / dar desconto | Papel `admin` (existente) | Só administrador — **não há papel financeiro separado** |

## 8. Limitações e itens não verificados

- **Banco real conferido, mas sem dados financeiros ainda:** a aplicação e a verificação estão na seção 2.1; o que não foi exercitado no banco real são os fluxos que dependem de dados que o clube ainda vai criar (planos de sócios, cobranças, encargos, comprovantes).
- **Papéis:** reaproveita `profiles.role` (admin/socio/lanchonete); professor e lanchonete não têm acesso ao financeiro. Não existe papel “tesoureiro”: financeiro = administrador. Criar um papel novo exigiria decisão do clube e mudança no modelo de papéis.
- **Vínculo de sócio:** o STC não tem datas de associação; o financeiro usa o plano (`start_on`/`ended_on`) e encerra automaticamente quando o perfil deixa de ser sócio ativo. Sócios antigos precisam de plano criado manualmente (não há importação automática de valores).
- **Aula avulsa e Card Mensal contam pelo pagamento registrado** no cadastro do aluno (`student_payments`). Se uma aula avulsa for paga e **não** for registrada no cadastro do aluno, ela **não aparece** no financeiro (a aula, sozinha, não gera receita). Convidados (Day Card) são derivados da reserva: se o convidado não pagou, o clube precisa isentar a reserva no Painel de alunos.
- **Nome do plano no cadastro do aluno:** o app ainda chama de "Day Card" o plano de um dia do aluno; no financeiro isso é **Aula avulsa**. Renomear no cadastro é um ajuste de texto fora do financeiro (não feito).
- **Conciliação bancária:** há saldo por conta e movimentos por data real; **não há importação de extrato** nem marcação “conciliado”.
- **Pagamentos de aluno históricos** (`student_payments`) continuam como estão; nada é copiado nem alterado.
- **PDF/CSV:** a exportação gera CSV (planilha brasileira) e PDF simples a partir do mesmo objeto exibido na tela; não há planilha `.xlsx`.
- **Geração automática mensal:** não agendada (ver seção 4); depende de decisão sobre `pg_cron`.
- **Teste em dispositivo/navegador real** (câmera, HEIC, upload no Storage, push) **não foi feito**: a interface foi validada por testes de componente e build.

## 9. Como rodar os testes

```bash
npx vitest run __tests__/finance            # regras, SQL (PGlite) e interface do financeiro
npx vitest run                              # suíte completa
npx tsc --noEmit && npx eslint . && npm run build
```

Os testes de SQL aplicam as 5 migrations reais num Postgres em memória (`@electric-sql/pglite`,
dependência de desenvolvimento), com stubs mínimos das tabelas do STC e do `auth.uid()`.
