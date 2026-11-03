# Auditoria de design — STC

> 2026-11-03 13:07 · 3 arquivos · tipo pwa-standalone (web). Heurístico: confira cada item antes de corrigir. P1–P3 é a sugestão do script; P0 (tarefa bloqueada) é julgamento seu. Exceção: `design-ok <id>: motivo`.

| P | Lei / lente | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P1 | mobile | components/ResenhaOpenTournamentBoard.tsx:552 | rolagem de lado sem travar o eixo vertical em <div> | só o eixo x rola: `overflow-x-auto overflow-y-hidden overscroll-x-none` (crie uma utilidade do design system, ex. `rolagem-x`/`faixa-rolavel`, e use só ela); a linha de base das abas é sombra interna, não borda + `-mb-px` | `faixa-solta` |
| P1 | legibilidade | components/ResenhaOpenTournamentBoard.tsx:695 | texto de 11px (text-[11px]) | mínimo de 12 px; corpo 16 px no celular (`text-xs` é 12, `text-base` 16) | `texto-pequeno` |
| P1 | legibilidade | components/ResenhaOpenTournamentBoard.tsx:737 | texto de 11px (text-[11px]) | mínimo de 12 px; corpo 16 px no celular (`text-xs` é 12, `text-base` 16) | `texto-pequeno` |
| P1 | legibilidade | components/ResenhaOpenTournamentBoard.tsx:741 | texto de 11px (text-[11px]) | mínimo de 12 px; corpo 16 px no celular (`text-xs` é 12, `text-base` 16) | `texto-pequeno` |
| P1 | legibilidade | components/ResenhaOpenTournamentBoard.tsx:750 | texto de 11px (text-[11px]) | mínimo de 12 px; corpo 16 px no celular (`text-xs` é 12, `text-base` 16) | `texto-pequeno` |
| P1 | legibilidade | components/ResenhaOpenTournamentBoard.tsx:752 | texto de 11px (text-[11px]) | mínimo de 12 px; corpo 16 px no celular (`text-xs` é 12, `text-base` 16) | `texto-pequeno` |
| P1 | legibilidade | components/ResenhaOpenTournamentBoard.tsx:785 | texto de 11px (text-[11px]) | mínimo de 12 px; corpo 16 px no celular (`text-xs` é 12, `text-base` 16) | `texto-pequeno` |
| P2 | cor | components/ResenhaOpenBracketView.tsx:74 | cor fora do cardápio | use o token do papel (`bg-primary`, `text-muted-foreground`, `var(--…)`): cor solta não acompanha o modo escuro nem a troca de tema | `cor-solta` |
| P2 | cor | components/ResenhaOpenTournamentBoard.tsx:312 | cor fora do cardápio | use o token do papel (`bg-primary`, `text-muted-foreground`, `var(--…)`): cor solta não acompanha o modo escuro nem a troca de tema | `cor-solta` |
| P2 | escala | components/ResenhaOpenTournamentBoard.tsx:314 | valor fora da escala (rounded-[1.75rem]) | troque pelo degrau mais próximo da escala de espaço (4 8 12 16 24 32 48 64…): `p-4`, `gap-6` | `espaco-fora-escala` |
| P2 | cor | components/ResenhaOpenTournamentBoard.tsx:314 | cor fora do cardápio | use o token do papel (`bg-primary`, `text-muted-foreground`, `var(--…)`): cor solta não acompanha o modo escuro nem a troca de tema | `cor-solta` |
| P2 | cor | components/ResenhaOpenTournamentBoard.tsx:374 | cor fora do cardápio | use o token do papel (`bg-primary`, `text-muted-foreground`, `var(--…)`): cor solta não acompanha o modo escuro nem a troca de tema | `cor-solta` |
| P2 | cor | components/ResenhaOpenTournamentBoard.tsx:421 | cor fora do cardápio | use o token do papel (`bg-primary`, `text-muted-foreground`, `var(--…)`): cor solta não acompanha o modo escuro nem a troca de tema | `cor-solta` |
| P2 | cor | components/ResenhaOpenTournamentBoard.tsx:473 | cor fora do cardápio | use o token do papel (`bg-primary`, `text-muted-foreground`, `var(--…)`): cor solta não acompanha o modo escuro nem a troca de tema | `cor-solta` |
| P2 | cor | components/ResenhaOpenTournamentBoard.tsx:498 | cor fora do cardápio | use o token do papel (`bg-primary`, `text-muted-foreground`, `var(--…)`): cor solta não acompanha o modo escuro nem a troca de tema | `cor-solta` |
| P2 | escala | components/ResenhaOpenTournamentBoard.tsx:701 | valor fora da escala (h-[68px]) | troque pelo degrau mais próximo da escala de espaço (4 8 12 16 24 32 48 64…): `p-4`, `gap-6` | `espaco-fora-escala` |
| P2 | escala | components/ResenhaOpenTournamentBoard.tsx:765 | valor fora da escala (h-[34px]) | troque pelo degrau mais próximo da escala de espaço (4 8 12 16 24 32 48 64…): `p-4`, `gap-6` | `espaco-fora-escala` |
| P2 | escala | components/ResenhaOpenTournamentBoard.tsx:769 | valor fora da escala (h-[34px]) | troque pelo degrau mais próximo da escala de espaço (4 8 12 16 24 32 48 64…): `p-4`, `gap-6` | `espaco-fora-escala` |
| P2 | escala | components/ResenhaOpenTournamentBoard.tsx:769 | valor fora da escala (w-[3px]) | troque pelo degrau mais próximo da escala de espaço (4 8 12 16 24 32 48 64…): `p-4`, `gap-6` | `espaco-fora-escala` |
| P2 | cor | components/TournamentBracketView.tsx:103 | cor fora do cardápio | use o token do papel (`bg-primary`, `text-muted-foreground`, `var(--…)`): cor solta não acompanha o modo escuro nem a troca de tema | `cor-solta` |
| P3 | reflexo | components/ResenhaOpenTournamentBoard.tsx:319 | rótulo em caixa alta em cima do título | tire o rótulo e deixe o título falar; se a seção precisa de contexto, ele vai no próprio título ou na migalha | `rotulo-sobre-titulo` |
| P3 | escala | components/ResenhaOpenTournamentBoard.tsx:772 | tamanho de texto fora da escala (text-[13px]) | use um degrau da escala de texto do projeto | `texto-fora-escala` |
| P3 | escala | components/ResenhaOpenTournamentBoard.tsx:856 | tamanho de texto fora da escala (text-[15px]) | use um degrau da escala de texto do projeto | `texto-fora-escala` |
