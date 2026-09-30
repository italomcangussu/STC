-- Fecha o bucket `avatars` no dono e permite a faxina das fotos antigas.
--
-- Como estava: só havia policy de SELECT (pública) e de INSERT
-- (`auth.role() = 'authenticated'`, sem amarrar caminho nenhum). Duas
-- consequências:
--
--   1. qualquer sócio logado podia gravar em cima da pasta de qualquer outro;
--   2. sem policy de DELETE, ninguém conseguia apagar nada — cada troca de foto
--      deixava o arquivo anterior no bucket para sempre (31 objetos e 23 MB
--      para 3 sócios quando medimos).
--
-- Agora o app grava em `<user_id>/<timestamp>.<ext>`, então a primeira pasta do
-- caminho identifica o dono e o RLS consegue usá-la. O INSERT também aceita o
-- formato antigo (`avatars/<user_id>-…`) para que a ordem do deploy não
-- importe: banco novo com app antigo continua funcionando.
--
-- UPDATE e DELETE olham `owner`, não o caminho, para que o sócio também
-- consiga limpar os arquivos que ficaram no esquema antigo.

DROP POLICY IF EXISTS "Auth Upload Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Avatars: socio grava na propria pasta" ON storage.objects;

CREATE POLICY "Avatars: socio grava na propria pasta"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'avatars'
        AND auth.role() = 'authenticated'
        AND (
            (storage.foldername(name))[1] = auth.uid()::text
            -- Esquema antigo, na raiz do bucket.
            OR name LIKE 'avatars/' || auth.uid()::text || '-%'
        )
    );

DROP POLICY IF EXISTS "Avatars: socio substitui a propria foto" ON storage.objects;

CREATE POLICY "Avatars: socio substitui a propria foto"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'avatars' AND owner = auth.uid())
    WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());

DROP POLICY IF EXISTS "Avatars: socio apaga as proprias fotos" ON storage.objects;

CREATE POLICY "Avatars: socio apaga as proprias fotos"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'avatars' AND owner = auth.uid());
