import { PoolClient } from 'pg';
import { query } from '../db/pool';

/** Registra una acción para auditoría (reseñas, reportes, suspensiones, aprobaciones...). */
export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
  client?: PoolClient,
): Promise<void> {
  await query(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1, $2, $3, $4, $5)',
    [actorId, action, entity, entityId, JSON.stringify(data)],
    client,
  );
}
