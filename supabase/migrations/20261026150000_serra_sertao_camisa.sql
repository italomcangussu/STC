-- Serra e Sertão 2026: foto da camisa do atleta (branca, "ATLETA" nas costas) para o João mandar a quem pedir.
-- O arquivo está no bucket conv-media, o mesmo de onde o João envia mídia pelo WhatsApp. A camisa vermelha é da organização.
update public.championships
set joao_info = joao_info
  || jsonb_build_object('shirt_image', jsonb_build_object(
       'path', 'championships/serra-e-sertao-2026/camisa-atleta.jpg', 'mime', 'image/jpeg', 'name', 'camisa-atleta-serra-e-sertao.jpg'))
  || jsonb_build_object('info', (joao_info->>'info') || E'\n' ||
       'Camisa do atleta: branca com detalhes em vermelho, "Auge Open" na frente, "Circuito de Tênis Serra Sertão - 3ª etapa" na manga e "ATLETA" nas costas. A camisa vermelha é da organização, não do atleta.')
where slug = 'serra-e-sertao-2026' and joao_info->'shirt_image' is distinct from jsonb_build_object(
  'path', 'championships/serra-e-sertao-2026/camisa-atleta.jpg', 'mime', 'image/jpeg', 'name', 'camisa-atleta-serra-e-sertao.jpg');
