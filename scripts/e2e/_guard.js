// Safety guard for the live HTTP check scripts: they create and delete rows, so they may only run against a
// DISPOSABLE local database. Refuses anything else (including dentalease_db) before touching Prisma.
const url = process.env.DATABASE_URL || '';
let ok = false;
try {
  const u = new URL(url);
  const db = u.pathname.replace(/^\//, '');
  ok = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname) && db !== '' && !/^dentalease/i.test(db) && /test|tmp|disposable|e2e/i.test(db);
} catch { /* unparsable URL → refuse */ }
if (!ok) {
  console.error('REFUSED: DATABASE_URL must point to a local, disposable database whose name contains test/tmp/disposable/e2e (never dentalease_db).');
  process.exit(3);
}
if (!process.env.API_BASE || (!process.env.JWT_SECRET && !process.env.E2E_NO_SECRET)) {
  console.error('REFUSED: set API_BASE (e.g. http://127.0.0.1:3011/api/v1) and JWT_SECRET (the test API process secret; not needed when E2E_NO_SECRET=1).');
  process.exit(3);
}
