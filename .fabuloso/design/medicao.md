# Medição em tela — STC

> 2026-11-10 16:15 · http://localhost:3000/design-lab.html · Google Chrome. Evidência: emulação em Chromium (sem recorte do iPhone, sem zoom do Safari, sem gesto do sistema).

| P | Lei | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P1 | contraste | #agenda · iphone | 2.52:1 em div.flex.justify-end:nth-of-type(2) > div.flex.items-center > span.text-meta.uppercase ("Ver Canceladas", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | robustez | #agenda · iphone | imagem não carregou: button.flex.min-h-11 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | contraste | #agenda · pequeno | 2.52:1 em div.flex.justify-end:nth-of-type(2) > div.flex.items-center > span.text-meta.uppercase ("Ver Canceladas", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | robustez | #agenda · pequeno | texto coberto em div.relative.rounded-2xl > div.relative.z-10:nth-of-type(3) > div.flex.items-center:nth-of-type(2) ("VER DETALHES") por #root > div.relative.h-full > nav.absolute.bottom-0 | ordem de camadas (z-index) ou espaço reservado para o elemento fixo | `texto-coberto` |
| P1 | robustez | #agenda · pequeno | imagem não carregou: button.flex.min-h-11 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P2 | Fitts | #agenda · iphone | alvo de 42×34 em div.flex.flex-col:nth-of-type(1) > div.flex.justify-between:nth-of-type(1) > button.bg-saibro-600.text-white | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 107×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(1) ("Dia") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 107×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(2) ("Semana") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 107×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(3) ("Mês") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 40×40 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(1) | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 40×40 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(2) | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | contraste | #agenda · iphone | 4.4:1 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(2) ("Semana", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #agenda · iphone | 4.4:1 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(3) ("Mês", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #agenda · iphone | ícone com 2.41:1 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(1) | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | contraste | #agenda · iphone | ícone com 2.41:1 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(2) | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | Fitts | #agenda · pequeno | alvo de 68×44 em header.flex-none.backdrop-blur-xl > div.flex.items-center:nth-of-type(2) > button.flex.min-h-11 ("Menu Principal") | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · pequeno | alvo de 42×34 em div.flex.flex-col:nth-of-type(1) > div.flex.justify-between:nth-of-type(1) > button.bg-saibro-600.text-white | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · pequeno | alvo de 96×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(1) ("Dia") | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · pequeno | alvo de 96×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(2) ("Semana") | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · pequeno | alvo de 96×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(3) ("Mês") | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · pequeno | alvo de 40×40 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(1) | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · pequeno | alvo de 40×40 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(2) | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | contraste | #agenda · pequeno | 4.4:1 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(2) ("Semana", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #agenda · pequeno | 4.4:1 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(3) ("Mês", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #agenda · pequeno | ícone com 2.41:1 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(1) | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | contraste | #agenda · pequeno | ícone com 2.41:1 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(2) | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P3 | contraste | #agenda · iphone | 9 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |
| P3 | contraste | #agenda · pequeno | 9 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |

## Capturas
- #agenda · iphone · claro: `.fabuloso/design/capturas/_agenda-iphone.png`
- #agenda · pequeno · claro: `.fabuloso/design/capturas/_agenda-pequeno.png`
