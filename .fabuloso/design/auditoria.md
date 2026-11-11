# Auditoria de design — STC

> 2026-11-11 20:36 · 5 arquivos · tipo pwa-standalone (web). Heurístico: confira cada item antes de corrigir. P1–P3 é a sugestão do script; P0 (tarefa bloqueada) é julgamento seu. Exceção: `design-ok <id>: motivo`.

| P | Lei / lente | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P1 | iOS | components/Agenda.tsx:160 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:265 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:277 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | Jakob | components/Agenda.tsx:936 | <div> clicável | use <button> (ou <a> para navegação): ganha foco, teclado, leitor de tela e o estado pressionado | `clicavel-sem-botao` |
| P1 | Jakob | components/Agenda.tsx:1962 | <div> clicável | use <button> (ou <a> para navegação): ganha foco, teclado, leitor de tela e o estado pressionado | `clicavel-sem-botao` |
| P1 | Jakob | components/Agenda.tsx:1987 | <div> clicável | use <button> (ou <a> para navegação): ganha foco, teclado, leitor de tela e o estado pressionado | `clicavel-sem-botao` |
| P1 | iOS | components/Agenda.tsx:2657 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2672 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2707 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | Jakob | components/Agenda.tsx:2777 | <div> clicável | use <button> (ou <a> para navegação): ganha foco, teclado, leitor de tela e o estado pressionado | `clicavel-sem-botao` |
| P1 | iOS | components/Agenda.tsx:2783 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2790 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2810 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2832 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2891 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2948 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2957 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2958 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2961 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2965 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | iOS | components/Agenda.tsx:2975 | campo com fonte menor que 16 px | o iPhone dá zoom ao focar: `text-base` (16 px) no celular, `md:text-sm` se quiser menor no desktop | `campo-zoom-ios` |
| P1 | Jakob | components/Layout.tsx:189 | <img> clicável | use <button> (ou <a> para navegação): ganha foco, teclado, leitor de tela e o estado pressionado | `clicavel-sem-botao` |
| P1 | Jakob | components/Layout.tsx:248 | <div> clicável | use <button> (ou <a> para navegação): ganha foco, teclado, leitor de tela e o estado pressionado | `clicavel-sem-botao` |
| P1 | Jakob | components/Layout.tsx:370 | <img> clicável | use <button> (ou <a> para navegação): ganha foco, teclado, leitor de tela e o estado pressionado | `clicavel-sem-botao` |
| P2 | clareza | components/Agenda.tsx:160 | campo só com placeholder | rótulo persistente (`<label htmlFor>`): o placeholder some ao digitar e a pessoa esquece o que era (Miller) | `so-placeholder` |
| P2 | acessibilidade | components/Agenda.tsx:180 | <img> sem alt | alt descritivo; decorativa: alt="" | `img-sem-alt` |
| P2 | escala | components/Agenda.tsx:964 | valor fora da escala (min-h-[40px]) | troque pelo degrau mais próximo da escala de espaço (4 8 12 16 24 32 48 64…): `p-4`, `gap-6` | `espaco-fora-escala` |
| P2 | escala | components/Agenda.tsx:1024 | valor fora da escala (max-w-[70px]) | troque pelo degrau mais próximo da escala de espaço (4 8 12 16 24 32 48 64…): `p-4`, `gap-6` | `espaco-fora-escala` |
| P2 | escala | components/Agenda.tsx:1040 | valor fora da escala (max-w-[70px]) | troque pelo degrau mais próximo da escala de espaço (4 8 12 16 24 32 48 64…): `p-4`, `gap-6` | `espaco-fora-escala` |
| P2 | acessibilidade | components/Agenda.tsx:2761 | <img> sem alt | alt descritivo; decorativa: alt="" | `img-sem-alt` |
| P2 | Fitts | components/Agenda.tsx:2777 | alvo de toque de 28 px em <div> | mínimo 44×44 (iOS e web) / 48×48 dp (Android): `min-h-11 min-w-11`, ou área de toque maior que o desenho (`p-2.5` ou pseudo-elemento) | `alvo-pequeno` |
| P2 | clareza | components/Agenda.tsx:2783 | campo só com placeholder | rótulo persistente (`<label htmlFor>`): o placeholder some ao digitar e a pessoa esquece o que era (Miller) | `so-placeholder` |
| P2 | clareza | components/Agenda.tsx:2832 | campo só com placeholder | rótulo persistente (`<label htmlFor>`): o placeholder some ao digitar e a pessoa esquece o que era (Miller) | `so-placeholder` |
| P2 | clareza | components/Agenda.tsx:2957 | campo só com placeholder | rótulo persistente (`<label htmlFor>`): o placeholder some ao digitar e a pessoa esquece o que era (Miller) | `so-placeholder` |
| P2 | clareza | components/Agenda.tsx:2958 | campo só com placeholder | rótulo persistente (`<label htmlFor>`): o placeholder some ao digitar e a pessoa esquece o que era (Miller) | `so-placeholder` |
| P2 | Tesler | components/Agenda.tsx:2958 | campo numérico sem teclado numérico | `inputMode="numeric"` (ou `tel`) e máscara que aceita qualquer formato (Postel) | `teclado-numerico` |
| P2 | Fitts | components/Layout.tsx:189 | alvo de toque de 32 px em <img> | mínimo 44×44 (iOS e web) / 48×48 dp (Android): `min-h-11 min-w-11`, ou área de toque maior que o desenho (`p-2.5` ou pseudo-elemento) | `alvo-pequeno` |
| P2 | Fitts | components/Layout.tsx:370 | alvo de toque de 40 px em <img> | mínimo 44×44 (iOS e web) / 48×48 dp (Android): `min-h-11 min-w-11`, ou área de toque maior que o desenho (`p-2.5` ou pseudo-elemento) | `alvo-pequeno` |
| P3 | movimento | components/Agenda.tsx:477 | transição de 700 ms ou mais | interface responde em 150–300 ms (saída mais rápida que a entrada); 500 ms+ só para mudança grande de contexto | `duracao-longa` |
| P3 | tipografia | components/Agenda.tsx:498 | tracking negativo demais | no máximo −0,04em (`tracking-tight` é −0,025) | `tracking-negativo` |
| P3 | hierarquia | components/Agenda.tsx:499 | peso de fonte abaixo de 400 | para rebaixar, use cor mais clara ou tamanho menor, não peso fino (`font-normal text-muted`) | `peso-fino` |
| P3 | tipografia | components/Agenda.tsx:827 | tracking negativo demais | no máximo −0,04em (`tracking-tight` é −0,025) | `tracking-negativo` |
| P3 | reflexo | components/Agenda.tsx:1016 | brilho colorido (halo sem deslocamento) | profundidade é sombra com deslocamento para baixo, em preto transparente; o halo colorido é enfeite | `brilho-colorido` |
| P3 | reflexo | components/Agenda.tsx:1032 | brilho colorido (halo sem deslocamento) | profundidade é sombra com deslocamento para baixo, em preto transparente; o halo colorido é enfeite | `brilho-colorido` |
| P3 | reflexo | components/Agenda.tsx:1822 | borda lateral de 2 px (border-l-2) | o tipo do aviso vem do ícone e do título; destaque por fundo suave da cor do papel (`bg-<papel>/10`) ou por uma barra no topo, não por faixa lateral grossa | `borda-lateral` |
| P3 | tipografia | index.css:384 | letter-spacing de -0.05em | no máximo −0,04em | `tracking-negativo` |
| P3 | movimento | index.css:805 | easing com quique | `cubic-bezier(0.16, 1, 0.3, 1)` | `easing-quique` |
