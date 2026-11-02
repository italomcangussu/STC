-- Fórmula e cabeças de chave do AUGE OPEN (Hermeson, áudio no grupo do campeonato, 02/11): a turma discutiu reduzir de 8
-- para 4 cabeças na 4ª Classe; a organização decidiu não mexer neste ano. O João passa a saber disso pelas INFORMAÇÕES
-- OFICIAIS, para não reabrir a discussão nem propor outra fórmula.

update public.championships
set joao_info = joao_info || jsonb_build_object('info', coalesce(joao_info->>'info', '') || '

FÓRMULA E CABEÇAS DE CHAVE (decisão da organização, Hermeson, 02/11): neste ano ninguém mexe. Sobral segue o mesmo formato das etapas de Nova Russas e de Tianguá, e a chave da 4ª fica como a organização montou (8 cabeças, 4 classificados direto e 4 vagas da quali). Ideias de mudança, como reduzir para 4 cabeças, ficam para o regulamento do ano que vem, que a organização monta antes das etapas começarem.')
where name = 'Serra e Sertão 2026' and position('FÓRMULA E CABEÇAS DE CHAVE' in coalesce(joao_info->>'info', '')) = 0;
