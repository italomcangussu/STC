# Sistema visual · "Quadra" (app inteiro)

Plano: `plano-evolucao.md`. Tokens: `index.css` @theme (bloco "CARDÁPIO v2"). Tudo em HEX (html2canvas não lê oklch).

## Frase de identidade

Chão liso stone-50, superfícies brancas com borda de 1 px e sombra de contato, Inter de 400 a 800, saibro só para ação ou "agora", raio 8 / 14 / 24, alvo de 44 px e nenhum texto abaixo de 12 px. Nada de foto nem vidro atrás de texto.

## Papéis de cor (use o papel, não o tom)

| Papel | Classe | Valor | Contraste no branco |
|---|---|---|---|
| Chão | `bg-chao` | #fafaf9 | |
| Superfície | `bg-superficie` | #ffffff | |
| Superfície 2 (campo, trilho) | `bg-superficie-2` | #f5f5f4 | |
| Linha | `border-linha` | #e7e5e4 | |
| Borda de campo | `border-linha-forte` | #a8a29e | 3:1 |
| Texto | `text-texto` | #1c1917 | 17:1 |
| Texto 2 | `text-texto-2` | #57534e | 7,6:1 |
| Texto 3 (o mínimo) | `text-texto-3` | #78716c | 4,8:1 |
| Ação | `bg-acao` / `text-acao` | #c2410c | branco 5,18:1 |
| Ação forte (hover, pressionado) | `bg-acao-forte` | #9a3412 | |
| Ação suave (seleção, "agora") | `bg-acao-suave` | #fff7ed | |
| Sucesso / aviso / erro / info | `*-sucesso`, `*-aviso`, `*-erro`, `*-info` (+ `-suave`) | green-700, #b45309, red-700, noite-600 | ≥ 5:1 |

`text-stone-400` e `text-stone-300` sobre claro ficam abaixo de 4,5:1: são trocados por `text-texto-3` (Fase 2).

## Escalas

- **Texto:** `text-meta` 12/16 600 é o menor. 11, 10, 9 e 8 px não existem.
- **Peso:** `font-black` agora é 800 real (Inter carrega 400–800).
- **Raio:** `rounded-lg` 8 (controle), `rounded-xl`/`rounded-2xl` 14 (card), `rounded-3xl` 24 (folha). Aliases `rounded-controle`, `rounded-card`, `rounded-folha`.
- **Sombra:** `shadow-e1` contato · `e2` card erguido/menu · `e3` folha · `e4` diálogo. `shadow-sm…2xl` apontam para eles.
- **Movimento:** `--dur-toque` 120 · `--dur-estado` 200 · `--dur-entrada` 280 · `--dur-contexto` 400 ms; `ease-saida` (componentes) e `ease-folha` (folhas).
- **Camadas:** `--z-barra` 40 · `--z-folha` 50 · `--z-dialogo` 60 · `--z-toast` 70.

## Navegador

Viewport sem bloqueio de zoom; campo com 16 px no toque; `accent-color`, `caret-color`, `::selection` e `:focus-visible` em saibro; `theme-color` #fafaf9; ícone maskable no manifest.

---

# Sistema visual · Chave dos campeonatos

Canvas de referência: https://claude.ai/artifact/LUGMUkB1tUdgN4mfmY55JD (privado do dono).

## Frase de identidade

Inter, fundo noite, saibro só para ação ou para o que acontece agora, cards claros com raio de 14 px, alvos de 44 px e nenhum texto abaixo de 12 px.

## Cores (tokens em `index.css` @theme)

| Papel | Token | Valor | Uso |
|---|---|---|---|
| Fundo | `noite-950` | #061320 | Fundo da chave |
| Superfície | `noite-900` | #0d2338 | Barra, chips, trilho de abas |
| Borda / hover | `noite-800` | #15324d | Divisórias, chip ativo |
| Conector | `noite-600` | #3d6a93 | Linhas da chave (3,28:1, só não-texto) |
| Texto mínimo | `noite-500` | #6b7f94 | Só quando 400 não cabe (4,54:1) |
| Texto de apoio | `noite-400` | #8fa6bd | Contadores, metadados (7,45:1) |
| Texto secundário | `noite-200` | #c5d3e0 | Botões fantasmas, abas inativas |
| Texto principal | `noite-50` | #f1f5f9 | Títulos |
| Ação primária | `saibro-700` | #c2410c | "Meu jogo", CTA (branco 5,18:1) |
| Ao vivo | `saibro-50` / `saibro-800` / ponto `saibro-600` | | Chip e placar do set em curso |
| Você | `saibro-100` / `saibro-800`, anel `saibro-500` | | Card e nome de quem vê |
| Vencedor | `court-green` | #166534 | Check do vencedor |
| Perdedor | `stone-500` | #78716c | Nome e placar de quem perdeu (4,80:1 no branco) |
| Meta no card | `stone-600` | #57534e | Cabeçalho do card |

Saibro nunca decora: se não é ação nem "agora", não é laranja.

## Tipografia (razão 1,2, uma família)

| Papel | Tamanho / peso |
|---|---|
| Título da tela | 24 / 800 |
| Fase | 20 / 700 |
| Destaque | 16 / 600 |
| Nome no card | 14 / 600 (vencedor 700, perdedor 500) |
| Meta (maiúsculas, tracking 0,06–0,08em) | 12 / 700 |

Proibido: 11, 13 e 15 px. Placar sempre `tabular-nums`.

## Card de jogo

- Raio 14 px, fundo branco sobre noite.
- Cabeçalho de 32 px: `J<n> · dia/hora` à esquerda, estado à direita.
- Duas linhas de jogador de 44 px cada, separadas por 1 px `stone-100`.
- Estados: a definir (itálico `stone-500`), agendado, ao vivo (chip + set atual em `saibro-50`), encerrado (check verde, perdedor rebaixado), seu jogo (anel 2 px `saibro-500` + pílula "Você").

## Conectores

2 px em `noite-600`. O caminho de quem já venceu acende em `saibro-400`.

## Movimento

150–250 ms em `cubic-bezier(0.32,0.72,0,1)`. Com `prefers-reduced-motion`, sem deslocamento.

## Alvos

Todo controle tem pelo menos 44 × 44 px; o card inteiro é o alvo do jogo.
