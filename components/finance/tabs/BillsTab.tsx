/**
 * Pagar › Contas a pagar: só o que SAI ou se move entre contas — despesas,
 * retiradas e transferências (e devoluções a sócio, criadas por outro fluxo),
 * com anexos (nota fiscal, boleto). Receitas avulsas e aportes ficam em
 * Receber › Outras receitas (`ReceivablesTab`), com as mesmas folhas.
 *
 * Mensalidades, Card Mensal, Aula avulsa, Day Card, descontos e multas
 * NÃO se lançam aqui (categorias reservadas): já nascem dos seus módulos, e
 * lançar de novo contaria o valor duas vezes.
 */
import React from 'react';
import EntriesTab from './entries/EntriesTab';

const BillsTab: React.FC = () => <EntriesTab direction="pay" />;

export default BillsTab;
