# public.vw_familia_modelos_expandidos
> view · security definer (padrão)

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| familia_id | bigint | sim |  |  |
| modelo_canonico | text | sim |  |  |
| modelo_canonico_expandidos | text | sim |  |  |

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)

## Definição
```sql
SELECT t.familia_id,
    t.modelo_canonico,
        CASE
            WHEN t.modelo_canonico = '__ALL_MODELOS__'::text THEN a.modelos_agregados
            ELSE t.modelo_canonico
        END AS modelo_canonico_expandidos
   FROM tabela_familia_iphone_map t
     LEFT JOIN ( SELECT tabela_familia_iphone_map.familia_id,
            string_agg(DISTINCT tabela_familia_iphone_map.modelo_canonico, ', '::text ORDER BY tabela_familia_iphone_map.modelo_canonico) AS modelos_agregados
           FROM tabela_familia_iphone_map
          WHERE tabela_familia_iphone_map.modelo_canonico IS NOT NULL AND tabela_familia_iphone_map.modelo_canonico <> '__ALL_MODELOS__'::text
          GROUP BY tabela_familia_iphone_map.familia_id) a USING (familia_id);
```
