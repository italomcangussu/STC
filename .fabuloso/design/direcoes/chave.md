# Direção escolhida · Chave dos campeonatos

Escolha: 03/11/2026. Canvas: https://claude.ai/artifact/LUGMUkB1tUdgN4mfmY55JD (artboards A-Padrao e D-Saibro).

## O que vale

- **A · Padrão** é a chave de toda classe: a árvore horizontal de hoje, com o sistema de `sistema.md` (fundo noite, card branco 32 + 44 + 44 px, raio 14 px, texto mínimo 12 px).
- **D · Saibro** é o tema da classe que joga no saibro (hoje a 4ª Classe): mesma estrutura de A, com chão `saibro-50`, cards brancos de borda `saibro-200`, cabeçalho do card em `saibro-100` e conectores em saibro.
- A troca de tema é só de cor. Estrutura, tamanhos, alvos e comportamento são os mesmos nas duas.

## Como o tema é decidido

`temaDaClasse(classe)` em `lib/bracketTheme.ts`. Não existe no banco a superfície em que a classe joga; enquanto não existir, a lista de classes de saibro mora nessa função. Vale para qualquer campeonato que use o nome "4ª Classe".

## Tokens de tema (`index.css`, classes `.chave-noite` e `.chave-saibro`)

| Variável | Noite | Saibro |
|---|---|---|
| `--chave-fundo` | noite-950 | saibro-50 |
| `--chave-superficie` | noite-900 | white |
| `--chave-borda` | noite-800 | saibro-200 |
| `--chave-texto` | noite-50 | stone-900 |
| `--chave-texto-2` | noite-200 | saibro-800 |
| `--chave-apoio` | noite-400 | saibro-800 |
| `--chave-ativo` / `--chave-ativo-texto` | white / noite-950 | saibro-800 / white |
| `--chave-conector` | noite-600 (3,28:1) | saibro-600 (3,35:1) |
| `--chave-conector-vivo` | saibro-400 | saibro-800 |
| `--chave-card-topo` / `--chave-card-topo-texto` | white / stone-600 | saibro-100 / saibro-800 |

## Fora do escopo

B (placar) e C (rodada) não entram. O cabeçalho laranja cheio de D não entra: a barra da chave fica no chão do tema.
