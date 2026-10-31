import { pool, withTransaction } from './pool';
import { migrations } from './schema';

/** Aplica las migraciones pendientes. Es idempotente: se puede ejecutar en cada arranque. */
export async function runMigrations(): Promise<number> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.id));
  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await withTransaction(async (client) => {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [migration.id, migration.name]);
    });
    count += 1;
    console.log(`Migración aplicada: ${migration.id} ${migration.name}`);
  }
  return count;
}

if (require.main === module) {
  runMigrations()
    .then((n) => {
      console.log(n === 0 ? 'La base de datos ya está actualizada.' : `Se aplicaron ${n} migraciones.`);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
