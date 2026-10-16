// Tipos do prompt do João: configuração da IA e contexto vindo de `conv_private.ai_context`.

export type AiSettings = {
  version: number;
  persona_name: string;
  model: string;
  instructions: string;
  business_context: string;
  buffer_seconds: number;
  max_turns: number;
  handoff_keywords: string[];
  daily_turn_budget?: number;
  proposal_ttl_minutes?: number;
};

// O contexto é o JSON de `conv_private.ai_context`: o contrato está no SQL, e aqui ele só é lido e repassado ao prompt.
export type Ctx = Record<string, any>;
