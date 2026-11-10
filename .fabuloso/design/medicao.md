# Medição em tela — STC

> 2026-11-10 16:17 · http://localhost:3000/design-lab.html · Google Chrome. Evidência: emulação em Chromium (sem recorte do iPhone, sem zoom do Safari, sem gesto do sistema).

| P | Lei | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P1 | contraste | #agenda · android | 2.52:1 em div.flex.justify-end:nth-of-type(2) > div.flex.items-center > span.text-meta.uppercase ("Ver Canceladas", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | robustez | #agenda · android | imagem não carregou: button.flex.min-h-11 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P2 | Fitts | #agenda · android | alvo de 68×44 em header.flex-none.backdrop-blur-xl > div.flex.items-center:nth-of-type(2) > button.flex.min-h-11 ("Menu Principal") | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · android | alvo de 42×34 em div.flex.flex-col:nth-of-type(1) > div.flex.justify-between:nth-of-type(1) > button.bg-saibro-600.text-white | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · android | alvo de 113×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(1) ("Dia") | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · android | alvo de 113×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(2) ("Semana") | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · android | alvo de 113×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(3) ("Mês") | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · android | alvo de 40×40 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(1) | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · android | alvo de 40×40 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(2) | mínimo 48×48; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | contraste | #agenda · android | 4.4:1 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(2) ("Semana", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #agenda · android | 4.4:1 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(3) ("Mês", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #agenda · android | ícone com 2.41:1 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(1) | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | contraste | #agenda · android | ícone com 2.41:1 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(2) | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P3 | contraste | #agenda · android | 9 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |

## Capturas
- #agenda · android · claro: `.fabuloso/design/capturas/_agenda-android.png`
