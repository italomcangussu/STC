/**
 * Receber › Outras receitas: o que ENTRA fora dos módulos automáticos —
 * receitas avulsas (patrocínio, evento, aluguel do espaço…) e aportes. Mesma
 * lista e mesmas folhas de Contas a pagar (`entries/`), com a direção "receber".
 *
 * Mensalidades, pendências de sócio e Day Card não se lançam aqui: têm abas
 * próprias, e as categorias automáticas nem aparecem no formulário.
 */
import React from 'react';
import EntriesTab from './entries/EntriesTab';

const ReceivablesTab: React.FC = () => <EntriesTab direction="receive" />;

export default ReceivablesTab;
