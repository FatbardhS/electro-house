// Creates the "electro" database on a local `prisma dev` server (development without Docker).
// Usage: node scripts/create-local-db.mjs [port]   (default port 51214)
import pg from 'pg';

const port = process.argv[2] ?? '51214';
const client = new pg.Client({ connectionString: `postgres://postgres:postgres@localhost:${port}/postgres?sslmode=disable` });
await client.connect();
const { rowCount } = await client.query("select 1 from pg_database where datname = 'electro'");
if (rowCount === 0) {
  await client.query('CREATE DATABASE electro');
  console.log(`Created database "electro" on port ${port}.`);
} else {
  console.log(`Database "electro" already exists on port ${port}.`);
}
await client.end();
