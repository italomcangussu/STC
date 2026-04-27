export type AdminAuditAction = 'login' | 'insert' | 'update' | 'delete' | string;

export interface AdminAuditLog {
  id: string;
  action: AdminAuditAction;
  table_name?: string | null;
  record_id?: string | null;
  occurred_at: string;
  actor_user_id?: string | null;
  actor_name?: string | null;
  target_user_id?: string | null;
  target_user_name?: string | null;
  changed_fields?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

export interface AdminAuditQueryParams {
  orderBy: 'occurred_at';
  ascending: false;
  limit: number;
  or?: string;
}

export const buildAdminAuditQueryParams = (athleteId: string, limit = 100): AdminAuditQueryParams => {
  const params: AdminAuditQueryParams = {
    orderBy: 'occurred_at',
    ascending: false,
    limit
  };

  if (athleteId && athleteId !== 'all') {
    params.or = `actor_user_id.eq.${athleteId},target_user_id.eq.${athleteId},related_user_ids.cs.{${athleteId}}`;
  }

  return params;
};

const actionLabels: Record<string, string> = {
  insert: 'criou',
  update: 'alterou',
  delete: 'removeu'
};

export const describeAuditLog = (log: AdminAuditLog): string => {
  const actor = log.actor_name || 'Usuário';

  if (log.action === 'login') {
    return `${actor} entrou no sistema`;
  }

  const action = actionLabels[log.action] || log.action;
  const tableName = log.table_name || 'registro';
  const target = log.target_user_name ? ` de ${log.target_user_name}` : '';
  const fields = log.changed_fields?.length ? `: ${log.changed_fields.join(', ')}` : '';

  return `${actor} ${action} ${tableName}${target}${fields}`;
};
