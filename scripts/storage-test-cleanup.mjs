// Lists and deletes the objects of ONE temporary test folder in the Supabase bucket.
//   node scripts/storage-test-cleanup.mjs test-tmp/<run>/ [--dry-run]
// Refuses any folder outside test-tmp/, so real restaurant files can never be touched.
// The secret key is read from .env and never printed.
import 'dotenv/config';
const [folder, flag] = process.argv.slice(2);
if (!folder || !/^test-tmp\/[a-z0-9-]+\/$/.test(folder)) {
  console.error('Usage: node scripts/storage-test-cleanup.mjs test-tmp/<run>/ [--dry-run]  (only test-tmp/ folders are allowed)');
  process.exit(1);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'restaurant-media';
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env');
  process.exit(1);
}
const headers = { apikey: key, 'Content-Type': 'application/json' };
async function list(prefix) {
  const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, { method: 'POST', headers, body: JSON.stringify({ prefix: prefix.replace(/\/$/, ''), limit: 1000 }) });
  if (!res.ok) throw new Error(`list failed: HTTP ${res.status}`);
  const out = [];
  for (const e of await res.json()) {
    const full = `${prefix}${e.name}`;
    if (e.id) out.push(full);
    else out.push(...(await list(`${full}/`)));
  }
  return out;
}
const names = await list(folder);
if (names.some((n) => !n.startsWith(folder))) throw new Error('listing returned objects outside the folder; stopping');
console.log(`${names.length} object(s) under ${folder}`);
if (flag !== '--dry-run' && names.length) {
  for (let i = 0; i < names.length; i += 100) {
    const res = await fetch(`${url}/storage/v1/object/${bucket}`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes: names.slice(i, i + 100) }) });
    if (!res.ok) throw new Error(`delete failed: HTTP ${res.status}`);
  }
  const left = await list(folder);
  console.log(`deleted; ${left.length} left`);
  if (left.length) process.exit(1);
}
