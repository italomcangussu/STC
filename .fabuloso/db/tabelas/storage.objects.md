# storage.objects
> tabela · RLS on — tabela do Supabase Storage; só as políticas são mapeadas

## Políticas RLS
- "Authenticated Update" — UPDATE para public · using `((bucket_id = 'championship-logos'::text) AND (auth.role() = 'authenticated'::text))`
- "Authenticated Upload" — INSERT para public · check `((bucket_id = 'championship-logos'::text) AND (auth.role() = 'authenticated'::text))`
- "Avatars: socio apaga as proprias fotos" — DELETE para public · using `((bucket_id = 'avatars'::text) AND (owner = auth.uid()))`
- "Avatars: socio grava na propria pasta" — INSERT para public · check `((bucket_id = 'avatars'::text) AND (auth.role() = 'authenticated'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (name ~~ (('avatars/'::text \|\| (auth.uid())::text) \|\| '-%'::text))))`
- "Avatars: socio substitui a propria foto" — UPDATE para public · using `((bucket_id = 'avatars'::text) AND (owner = auth.uid()))` · check `((bucket_id = 'avatars'::text) AND (owner = auth.uid()))`
- "Public Access" — SELECT para public · using `(bucket_id = 'championship-logos'::text)`
- "Public Access Avatars" — SELECT para public · using `(bucket_id = 'avatars'::text)`
- "conv_media_read" — SELECT para authenticated · using `((bucket_id = 'conv-media'::text) AND is_admin())`
- "conv_media_upload" — INSERT para authenticated · check `((bucket_id = 'conv-media'::text) AND is_admin() AND (name ~~ 'out/%'::text))`
- "fin_docs_admin_read" — SELECT para authenticated · using `((bucket_id = 'fin-docs'::text) AND is_admin())`
- "fin_docs_admin_upload" — INSERT para authenticated · check `((bucket_id = 'fin-docs'::text) AND is_admin() AND (name ~ '^[0-9a-f-]{36}/[^/]+$'::text) AND (EXISTS ( SELECT 1 FROM fin_entries e WHERE (e.id = (split_part(objects.name, '/'::text, 1))::uuid))))`
- "fin_receipts_admin_read" — SELECT para authenticated · using `((bucket_id = 'fin-receipts'::text) AND is_admin())`
- "fin_receipts_member_read" — SELECT para authenticated · using `((bucket_id = 'fin-receipts'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text))`
- "fin_receipts_member_upload" — INSERT para authenticated · check `((bucket_id = 'fin-receipts'::text) AND fin_is_active_member(( SELECT auth.uid() AS uid)) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'::text…`
- "sig_docs_admin_delete" — DELETE para authenticated · using `((bucket_id = 'sig-docs'::text) AND sig_can_delete_file(name))`
- "sig_docs_admin_read" — SELECT para authenticated · using `((bucket_id = 'sig-docs'::text) AND is_admin())`
- "sig_docs_admin_upload" — INSERT para authenticated · check `((bucket_id = 'sig-docs'::text) AND sig_can_upload_file(name))`
- "sig_docs_member_read" — SELECT para authenticated · using `((bucket_id = 'sig-docs'::text) AND sig_can_read_file(name))`
