# Campeonato (Serra e Sertão 2026, chave, inscrição e Pix)

Leia antes de mexer em `components/TournamentBracketView.tsx`, `championship_registrations`/`championship_signups`, `conv_svc_receipt_championship_auto`, `conv_private.champ_confirm_from_entry` ou na chave do Serra e Sertão (id 8d8e7ec9-bb0a-4290-90f0-716bc0802b07).

## Chave oficial do Serra e Sertão 2026 (migration 20261103120000_serra_sertao_chave_oficial)
- A chave veio das imagens da organização e foi criada direto por migration, sem sorteio. Seeds definidos; campeonato em `ongoing`.
- 4ª Classe: fase `qualify` na rodada 1 (4 jogos, J1 a J4); os vencedores entram nos slots 2, 10, 14 e 6 das oitavas (`format_config.qualifying = {matchCount:4, entrySlots:[2,10,14,6]}`). As rodadas antigas da 4ª foram deslocadas para 2 a 5. Oitavas J5 a J12, quartas J13 a J16, semis J17 e J18, final J19.
- 5ª Classe: oitavas J1 a J8, quartas J9 a J12, semis J13 e J14, final J15.
- Os números de jogo se repetem entre as classes; o front separa por `bracket_class`. Nunca identificar um jogo só pelo número.
- Hermeson Veras joga as duas classes (exceção registrada em `championships.joao_info`, junto com o parágrafo "CHAVE OFICIAL" e os pares corretos da quali).

## Pré-inscrito com registration_id e confirmação de Pix
- Pré-inscritos que a organização já pôs na chave (Daniel Rodrigues, Derlan André, Ismael Pedrosa Machado, Ítalo Cangussu) ganharam `championship_registrations` e entraram na chave com o Pix pendente; o signup segue `pre` com `registration_id` preenchido.
- Regra: quando o signup já tem `registration_id`, `public.conv_svc_receipt_championship_auto` e `conv_private.champ_confirm_from_entry` só marcam o signup como confirmado/pago. Não criam outra inscrição (senão duplica a pessoa na chave).

## Armadilha: loading preso no StrictMode (components/TournamentBracketView.tsx)
- O loading do primeiro carregamento dependia de um ref (`primeiraCarga`). No StrictMode (dev) o efeito roda duas vezes, e o spinner nunca saía.
- Correção (af2e41a): o `finally` limpa o loading sempre que o efeito está ativo. Não condicionar o fim do loading a ref que sobrevive ao segundo disparo do efeito.
