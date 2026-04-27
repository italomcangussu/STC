import { describe, expect, it } from 'vitest';
import {
  buildAdminAuditQueryParams,
  describeAuditLog,
  type AdminAuditLog
} from '../lib/adminAudit';

describe('admin audit helpers', () => {
  it('builds the athlete filter across actor and target user fields', () => {
    expect(buildAdminAuditQueryParams('athlete-1')).toEqual({
      orderBy: 'occurred_at',
      ascending: false,
      limit: 100,
      or: 'actor_user_id.eq.athlete-1,target_user_id.eq.athlete-1,related_user_ids.cs.{athlete-1}'
    });
  });

  it('does not add an athlete filter when all athletes are selected', () => {
    expect(buildAdminAuditQueryParams('all')).toEqual({
      orderBy: 'occurred_at',
      ascending: false,
      limit: 100
    });
  });

  it('describes login and update audit rows for the admin timeline', () => {
    const loginLog: AdminAuditLog = {
      id: '1',
      action: 'login',
      occurred_at: '2026-04-27T10:00:00Z',
      actor_name: 'Carlos'
    };

    const updateLog: AdminAuditLog = {
      id: '2',
      action: 'update',
      table_name: 'profiles',
      occurred_at: '2026-04-27T11:00:00Z',
      actor_name: 'Admin',
      target_user_name: 'Carlos',
      changed_fields: ['category', 'balance']
    };

    expect(describeAuditLog(loginLog)).toBe('Carlos entrou no sistema');
    expect(describeAuditLog(updateLog)).toBe('Admin alterou profiles de Carlos: category, balance');
  });
});
