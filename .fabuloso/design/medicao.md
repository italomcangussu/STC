# Medição em tela — STC

> 2026-11-10 16:18 · http://localhost:3000/design-lab.html · Google Chrome. Evidência: emulação em Chromium (sem recorte do iPhone, sem zoom do Safari, sem gesto do sistema).

| P | Lei | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P1 | robustez | #ranking · iphone | imagem não carregou: button.flex.min-h-11 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | contraste | #desafios · iphone | 2.52:1 em div.relative.z-10:nth-of-type(1) > div.flex.flex-col:nth-of-type(2) > span.text-meta.uppercase ("1ª Classe", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | contraste | #desafios · iphone | 2.41:1 em div.mt-4.grid:nth-of-type(2) > div.bg-stone-50.p-2:nth-of-type(1) > p.text-meta.text-stone-400:nth-of-type(1) ("Como Desafiante", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | contraste | #desafios · iphone | 2.41:1 em div.mt-4.grid:nth-of-type(2) > div.bg-stone-50.p-2:nth-of-type(2) > p.text-meta.text-stone-400:nth-of-type(1) ("Como Desafiado", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | robustez | #desafios · iphone | imagem não carregou: button.flex.min-h-11 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P2 | Fitts | #ranking · iphone | alvo de 80×36 em div.p-4.pb-40 > div.flex.gap-1:nth-of-type(2) > button.flex-1.py-2:nth-of-type(1) ("4ªª") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #ranking · iphone | alvo de 80×36 em div.p-4.pb-40 > div.flex.gap-1:nth-of-type(2) > button.flex-1.py-2:nth-of-type(2) ("5ªª") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #ranking · iphone | alvo de 80×36 em div.p-4.pb-40 > div.flex.gap-1:nth-of-type(2) > button.flex-1.py-2:nth-of-type(3) ("6ªª") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #ranking · iphone | alvo de 80×36 em div.p-4.pb-40 > div.flex.gap-1:nth-of-type(2) > button.flex-1.py-2:nth-of-type(4) ("🏆 Geral") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | contraste | #ranking · iphone | 4.4:1 em div.p-4.pb-40 > div.flex.gap-1:nth-of-type(2) > button.flex-1.py-2:nth-of-type(2) ("5ªª", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #ranking · iphone | 4.4:1 em div.p-4.pb-40 > div.flex.gap-1:nth-of-type(2) > button.flex-1.py-2:nth-of-type(3) ("6ªª", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #ranking · iphone | 4.4:1 em div.p-4.pb-40 > div.flex.gap-1:nth-of-type(2) > button.flex-1.py-2:nth-of-type(4) ("🏆 Geral", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | mobile | #ranking · iphone | faixa que rola de lado sem overscroll-behavior-x em div.mx-auto.min-w-0 > div.p-4.pb-40 > div.flex.gap-1:nth-of-type(2) (elástico do iPhone / voltar do Android pegam o arrasto) | `overflow-y: hidden` + `overscroll-behavior-x: none` numa utilidade única do design system; nada com margem negativa sobrando embaixo | `faixa-solta` |
| P2 | contraste | #desafios · iphone | 3.16:1 em div.mt-4.grid:nth-of-type(2) > div.bg-stone-50.p-2:nth-of-type(1) > p.font-bold.text-green-600:nth-of-type(2) ("/1", 16px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #desafios · iphone | 3.16:1 em div.mt-4.grid:nth-of-type(2) > div.bg-stone-50.p-2:nth-of-type(2) > p.font-bold.text-green-600:nth-of-type(2) ("/1", 16px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P3 | contraste | #ranking · iphone | 7 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |

## Capturas
- #ranking · iphone · claro: `.fabuloso/design/capturas/_ranking-iphone.png`
- #desafios · iphone · claro: `.fabuloso/design/capturas/_desafios-iphone.png`
