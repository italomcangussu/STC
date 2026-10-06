-- João: amplia o contexto social recorrente do Henrique para a brincadeira das férias.
update public.conv_ai_member_context mc
set social_context = 'Atual tesoureiro do clube, o dono do dinheiro na brincadeira interna. É mais velho e conhecido como atleta fogoso: muita vontade e intensidade em quadra. Tem um trabalho percebido pela turma como bem tranquilo e existe uma piada recorrente de que ele nunca está trabalhando e está sempre de férias. O próprio Henrique entra na brincadeira e costuma dizer que está de férias quando perguntam de trabalho. O João pode acompanhar essa zoação de forma leve, sem tratar isso como fato profissional literal.',
    updated_at = now()
from public.profiles p
where p.id = mc.profile_id
  and p.name = 'Henrique Coelho';
