/**
 * Applies supabase/migrations to DATABASE_URL (local Postgres). Supabase cloud uses `supabase db push`.
 *   DATABASE_URL=postgresql://... pnpm --filter web db:migrate
 */
import { connectPg } from '../src/lib/db';
import { migrate, migrationsDir } from '../src/lib/migrate';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('set DATABASE_URL');
  const sql = await connectPg(url);
  try {
    const applied = await migrate(sql, migrationsDir());
    console.log(applied.length ? `applied ${applied.join(', ')}` : 'up to date');
  } finally {
    await sql.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
