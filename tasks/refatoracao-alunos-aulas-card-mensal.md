# Refatoração de Alunos, Aulas e Card Mensal

## Resultado esperado

Dar ao professor um cadastro e uma lista unificada de alunos, com nível e situação independentes do vínculo com o clube e do status do Card. Sócios e dependentes participam por seu vínculo; não sócios continuam sujeitos às regras atuais de Day Card/Card Mensal. Pausas preservam pessoa, aulas, pagamentos e evolução.

## Restrições de compatibilidade

- Manter `profiles`, `non_socio_students`, `student_payments` e os campos legados de reservas.
- Não duplicar sócios; ligar metadados do aluno ao `profile_id` existente.
- Preservar os arrays atuais de participantes e os fluxos atuais de pagamento ao clube.
- Não criar comissão nem pagamento entre aluno e professor.

## Verificação

Cobrir regras de participação e expiração em teste unitário; validar migration, lint, tipos, testes e build após a implementação.
