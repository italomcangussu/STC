# Produto — STC Play (Sobral Tênis Clube)

- **Quem usa e onde:** sócio do clube, no celular (PWA instalado), muitas vezes na quadra ou a caminho dela: sol na tela, uma mão, pressa entre um jogo e outro. Admin e professores no celular e às vezes no computador. A lanchonete usa o Klanches no balcão.
- **A tarefa principal:** reservar ou conferir horário de quadra (a Agenda é a tela inicial). Depois: desafiar e conferir o ranking, acompanhar campeonatos, ver o próprio financeiro e assinar documentos.
- **Pico e fim:** reserva confirmada; desafio vencido e a subida no ranking; avançar na chave; comprovante aceito no financeiro. Cada fluxo termina dizendo o que acontece agora.
- **Plataforma:** PWA standalone (React + Tailwind 4), um idioma só para iPhone e Android.
- **Marca:** saibro (laranja de quadra de saibro, `saibro-*`), verde de quadra (`court-*`), noite (fundo da chave, `noite-*`), Inter, logo do clube (Storage `logoapp`). No tema claro, saibro nunca decora: é ação ou "agora". No tema escuro o saibro é o chão (quadra à noite, `ChaoSaibro`), a ação é amarelo bola e o "agora" segue saibro.
- **Evidência real disponível:** nenhuma para uso em material de venda; tudo que aparece vem do banco.
- **Não inventar:** horários, preços, mensalidades, posições, pontos, placares, nomes de sócios. Dado de demonstração só no laboratório (`design-lab.tsx`), marcado "Demo".
- **Tom do texto:** "você"; termos do clube: sócio, saibro, quadra, desafio, chave, classe, mensalidade, comprovante. Botão diz o verbo ("Reservar", "Enviar comprovante").
- **O que faria um resultado bonito parecer errado aqui:** parecer app de banco ou de aposta; laranja em tudo, a ponto de não se saber o que é ação; foto ou vidro atrás de texto que se lê no sol.
