/**
 * Applies supabase/migrations/*.sql to a local database (PGlite or a dev Postgres). Supabase
 * itself is migrated with `supabase db push`; this runner is for local runs and tests only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Sql } from './db';

export function migrationsDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = join(/*turbopackIgnore: true*/ dir, 'supabase', 'migrations');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return resolve(/*turbopackIgnore: true*/ process.cwd(), '../../supabase/migrations');
}

export async function migrate(sql: Sql, dir = migrationsDir()): Promise<string[]> {
  await sql.exec('create table if not exists bao_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await sql.query<{ name: string }>('select name from bao_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    await sql.exec(readFileSync(join(/*turbopackIgnore: true*/ dir, file), 'utf8'));
    await sql.query('insert into bao_migrations (name) values ($1)', [file]);
    applied.push(file);
  }
  return applied;
}
