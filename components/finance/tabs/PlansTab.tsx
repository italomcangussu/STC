/**
 * Cadastros › Mensalidades dos sócios: o valor individual de cada sócio (não há valor padrão).
 * É cadastro, não cobrança: as cobranças nascem daqui em Receber › Cobranças de sócios › "Gerar mensalidades".
 */
import React from 'react';
import { listPlans } from '../../../lib/finance/financeApi';
import { useAsync } from '../hooks';
import { PlansView } from './members/PlansView';

const PlansTab: React.FC = () => {
  const plans = useAsync(() => listPlans(), []);
  return <div className="space-y-4"><PlansView plans={plans} onChanged={plans.reload} /></div>;
};

export default PlansTab;
