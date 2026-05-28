// Smoke test wszystkich kluczowych operacji na lokalnym Astro + Supabase.
// Wymaga: dev server na localhost:4321 + supabase start (kontenery w WSL).
// Zachowuje cookies sesji w cookieJar zeby auth flow dzialal end-to-end.

const BASE = 'http://localhost:4321';
const rand = Math.floor(Math.random() * 99999);
const email = `smoke-${rand}@example.com`;
const password = `SmokeTest${rand}!`;

const cookieJar = new Map();

function applyCookies(setCookieHeaders) {
  for (const raw of setCookieHeaders) {
    const [pair] = raw.split(';');
    const [name, value] = pair.split('=');
    if (name && value !== undefined) cookieJar.set(name.trim(), value.trim());
  }
}

function cookieHeader() {
  if (cookieJar.size === 0) return undefined;
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

const results = [];

async function test(name, { method = 'GET', path, body, expect }) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  // Astro 6 checkOrigin blokuje POST/PATCH/DELETE bez Origin matching site.
  if (method !== 'GET') headers.origin = BASE;
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;

  let status = 0;
  let bodyText = '';
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    status = res.status;
    bodyText = await res.text();
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length) applyCookies(setCookies);
  } catch (e) {
    bodyText = `NETWORK: ${e.message}`;
  }

  const expected = Array.isArray(expect) ? expect : [expect];
  const ok = expected.includes(status);
  results.push({
    name,
    status,
    expect: expected.join(','),
    result: ok ? 'PASS' : 'FAIL',
    body: bodyText.slice(0, 200),
  });
  return { status, body: bodyText };
}

console.log('=== e2e smoke ===');
console.log(`email: ${email}`);
console.log(`base:  ${BASE}\n`);

// 1. Health
await test('GET /api/health', { path: '/api/health', expect: 200 });

// 2. Landing
await test('GET / (landing)', { path: '/', expect: 200 });

// 3. Login page anon
await test('GET /login (anon)', { path: '/login', expect: 200 });

// 4. Protected page anon -> 302
await test('GET /shelves (anon, expect 302)', { path: '/shelves', expect: 302 });

// 5. Signup
await test('POST /api/auth/signup', {
  method: 'POST',
  path: '/api/auth/signup',
  body: { email, password, display_name: `Smoke ${rand}` },
  expect: [200, 201],
});

// 6. Login
await test('POST /api/auth/login', {
  method: 'POST',
  path: '/api/auth/login',
  body: { email, password },
  expect: 200,
});

// 7. Protected page after login
await test('GET /shelves (auth, expect 200)', { path: '/shelves', expect: 200 });

// 8. List shelves (powinno miec "Zakupione" z handle_new_user trigger)
const listRes = await test('GET /api/shelves', { path: '/api/shelves', expect: 200 });
let zakupioneId = null;
let createdId = null;
try {
  const shelves = JSON.parse(listRes.body).data.shelves;
  console.log(`  shelves count: ${shelves.length}`);
  const zak = shelves.find((s) => s.name === 'Zakupione');
  if (zak) {
    zakupioneId = zak.id;
    console.log(`  Zakupione id: ${zakupioneId}`);
  }
} catch (e) {
  console.log(`  list parse err: ${e.message}`);
}

// 9. Create shelf
const createRes = await test('POST /api/shelves (create)', {
  method: 'POST',
  path: '/api/shelves',
  body: { name: `Smoke shelf ${rand}` },
  expect: [200, 201],
});
try {
  createdId = JSON.parse(createRes.body).data.shelf.id;
  console.log(`  created id: ${createdId}`);
} catch (e) {
  console.log(`  create parse err: ${e.message}`);
}

// 10. Update shelf
if (createdId) {
  await test(`PATCH /api/shelves/{created}`, {
    method: 'PATCH',
    path: `/api/shelves/${createdId}`,
    body: { name: `Smoke updated ${rand}` },
    expect: 200,
  });
}

// 11. Try rename "Zakupione" -> 400 (trigger blokuje)
if (zakupioneId) {
  await test('PATCH Zakupione name (expect 400)', {
    method: 'PATCH',
    path: `/api/shelves/${zakupioneId}`,
    body: { name: 'Foo' },
    expect: 400,
  });
}

// 12. Try delete "Zakupione" -> 400
if (zakupioneId) {
  await test('DELETE Zakupione (expect 400)', {
    method: 'DELETE',
    path: `/api/shelves/${zakupioneId}`,
    expect: 400,
  });
}

// 13. Delete created
if (createdId) {
  await test(`DELETE /api/shelves/{created}`, {
    method: 'DELETE',
    path: `/api/shelves/${createdId}`,
    expect: [200, 204],
  });
}

// 14. Logout
await test('POST /api/auth/logout', { method: 'POST', path: '/api/auth/logout', expect: [200, 204] });

// 15. Protected page after logout -> 302
await test('GET /shelves (after logout, 302)', { path: '/shelves', expect: 302 });

console.log('\n=== WYNIKI ===');
for (const r of results) {
  const flag = r.result === 'PASS' ? '✓' : '✗';
  console.log(`${flag} [${r.result}] ${r.name.padEnd(45)} status=${r.status} expect=${r.expect}`);
}

const failed = results.filter((r) => r.result === 'FAIL');
console.log(`\nTOTAL: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);

if (failed.length > 0) {
  console.log('\n=== FAILED details ===');
  for (const r of failed) {
    console.log(`\n[${r.name}]`);
    console.log(`  status=${r.status} expect=${r.expect}`);
    console.log(`  body: ${r.body}`);
  }
  process.exit(1);
}
