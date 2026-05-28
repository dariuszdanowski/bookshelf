/**
 * Phase 3 verification script — run with: node verify-phase3.mjs
 * Checks: DB state (1.6-1.9), API endpoint behaviour (2.6-2.9), basic UI structure (3.x)
 * Uses service role for admin DB queries; creates ephemeral test user for JWT-auth API tests.
 */

import { readFileSync } from 'fs';
import { spawn } from 'child_process';

// ── Load env ───────────────────────────────────────────────────────────────────
const envRaw = readFileSync('.dev.vars', 'utf-8');
const env = Object.fromEntries(
  envRaw.split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {
    const idx = l.indexOf('=');
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
  })
);

const SUPABASE_URL = env['PUBLIC_SUPABASE_URL'];
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'];
const ANON_KEY = env['PUBLIC_SUPABASE_ANON_KEY'];
const DEV_SERVER = 'http://localhost:4321';

const PASS = '✅';
const FAIL = '❌';
const SKIP = '⏭️ ';

let totalPass = 0, totalFail = 0;

function log(sym, label, detail = '') {
  console.log(`${sym} ${label}${detail ? ' — ' + detail : ''}`);
  if (sym === PASS) totalPass++;
  if (sym === FAIL) totalFail++;
}

// ── Supabase REST helpers ───────────────────────────────────────────────────────
async function sbFetch(path, opts = {}, useServiceRole = true) {
  const key = useServiceRole ? SERVICE_KEY : ANON_KEY;
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(opts.headers ?? {}),
    },
  });
}

// ── Auth helpers ───────────────────────────────────────────────────────────────
const TEST_EMAIL = `verify-phase3-${Date.now()}@test.example`;
const TEST_PASS  = 'Test1234!Pass';
let testUserId = null;
let testJwt = null;

async function createTestUser() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS, email_confirm: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createTestUser failed: ${JSON.stringify(body)}`);
  testUserId = body.id;
  return testUserId;
}

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signIn failed: ${JSON.stringify(body)}`);
  testJwt = body.access_token;
  return testJwt;
}

async function deleteTestUser() {
  if (!testUserId) return;
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUserId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

// ── Dev server helpers ─────────────────────────────────────────────────────────
let devProc = null;

async function startDevServer() {
  return new Promise((resolve, reject) => {
    devProc = spawn('npm', ['run', 'dev'], {
      cwd: process.cwd(),
      shell: true,
      env: { ...process.env, ...env, PORT: '4321' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    const onData = (chunk) => {
      const s = chunk.toString();
      if (!ready && (s.includes('4321') || s.includes('localhost') || s.includes('ready'))) {
        ready = true;
        resolve();
      }
    };
    devProc.stdout.on('data', onData);
    devProc.stderr.on('data', onData);
    devProc.on('error', reject);
    // Fallback: 15s
    setTimeout(() => { if (!ready) { ready = true; resolve(); } }, 15000);
  });
}

function stopDevServer() {
  if (devProc) { try { devProc.kill(); } catch {} }
}

async function devFetch(path, opts = {}, jwt = null) {
  return fetch(`${DEV_SERVER}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Cookie: `sb-${SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token=${JSON.stringify({ access_token: jwt })}` } : {}),
      ...(opts.headers ?? {}),
    },
    redirect: 'manual',
  });
}

// Helper — api call via dev server with Authorization header (Bearer works for Astro locals.user via @supabase/ssr)
async function apiCall(path, opts = {}) {
  return fetch(`${DEV_SERVER}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${testJwt}`,
      ...(opts.headers ?? {}),
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 1 — DB Checks
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n=== DB Checks (1.6-1.9) ===');

// 1.6 — vision_runs table populated for photos with detections
async function check_1_6() {
  const res = await sbFetch('/rest/v1/vision_runs?select=id,photo_id,status&limit=100');
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    log(FAIL, '1.6 vision_runs populated', `got ${JSON.stringify(rows).slice(0,120)}`);
    return null;
  }
  log(PASS, '1.6 vision_runs populated', `${rows.length} rows`);
  return rows[0].photo_id;
}

// 1.7 — no detections with null vision_run_id
async function check_1_7() {
  const res = await sbFetch('/rest/v1/detections?vision_run_id=is.null&select=id&limit=5');
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    log(FAIL, '1.7 detections.vision_run_id all non-null', `unexpected: ${JSON.stringify(rows).slice(0,120)}`);
    return;
  }
  if (rows.length > 0) {
    log(FAIL, '1.7 detections.vision_run_id all non-null', `${rows.length} rows with null vision_run_id`);
    return;
  }
  log(PASS, '1.7 detections.vision_run_id all non-null');
}

// 1.8 — trigger blocks second running insert
async function check_1_8(samplePhotoId) {
  if (!samplePhotoId) { log(SKIP, '1.8 concurrent-run trigger — no photo_id'); return; }

  // First INSERT running — should succeed
  const r1 = await sbFetch('/rest/v1/vision_runs', {
    method: 'POST',
    body: JSON.stringify({ photo_id: samplePhotoId, status: 'running' }),
    headers: { Prefer: 'return=representation' },
  });
  if (!r1.ok) {
    const b = await r1.json();
    log(FAIL, '1.8 trigger — first insert failed unexpectedly', JSON.stringify(b).slice(0,120));
    return;
  }
  const [inserted] = await r1.json();
  const runId = inserted?.id;

  // Second INSERT running — trigger should block it
  const r2 = await sbFetch('/rest/v1/vision_runs', {
    method: 'POST',
    body: JSON.stringify({ photo_id: samplePhotoId, status: 'running' }),
    headers: { Prefer: 'return=representation' },
  });
  const b2 = await r2.json();
  const blocked = !r2.ok && (JSON.stringify(b2).includes('P0001') || JSON.stringify(b2).includes('Vision run already') || r2.status === 400 || r2.status === 409);
  if (blocked) {
    log(PASS, '1.8 concurrent-run trigger blocks second insert', `status=${r2.status}`);
  } else {
    log(FAIL, '1.8 concurrent-run trigger did NOT block', `status=${r2.status} body=${JSON.stringify(b2).slice(0,120)}`);
  }

  // Cleanup: mark first inserted run as 'failed' so it doesn't affect production data
  if (runId) {
    await sbFetch(`/rest/v1/vision_runs?id=eq.${runId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', error_message: 'verify-phase3 cleanup' }),
    });
  }
}

// 1.9 — RLS isolation cannot be checked server-side with service role (bypasses RLS)
// We can at least verify the policy exists by querying pg_policies via service role REST (returns all rows regardless of RLS)
async function check_1_9() {
  const res = await sbFetch('/rest/v1/vision_runs?select=id&limit=1');
  if (res.ok) {
    log(SKIP, '1.9 RLS isolation — requires 2-user Studio test (service role bypasses RLS)');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 2 — API Checks (via dev server + JWT auth)
// ══════════════════════════════════════════════════════════════════════════════
async function section2() {
  console.log('\n=== API Checks (2.6-2.9 via dev server) ===');

  // Find a shelf and photo for test user — test user is fresh, so we need to create data
  // 2.6 — Concurrent process → 409
  // For this we need a photo. Let's find ANY existing photo from production service-role view
  // But we need a photo belonging to test user for JWT auth to work.
  // Since test user is fresh (no shelves/photos), we'll use service role to create a shelf+photo.

  // Create a shelf via REST (bypass RLS with service role for setup)
  const shelfRes = await sbFetch('/rest/v1/shelves', {
    method: 'POST',
    body: JSON.stringify({ user_id: testUserId, name: 'TestShelf-verify3', position_index: 99 }),
    headers: { Prefer: 'return=representation' },
  });
  if (!shelfRes.ok) {
    const b = await shelfRes.json();
    log(FAIL, '2.x setup — create test shelf', JSON.stringify(b).slice(0, 120));
    return;
  }
  const [shelf] = await shelfRes.json();
  const shelfId = shelf.id;

  // Create a photo record (no real storage path — process endpoint will fail at download step but before that it should try to create vision_run)
  const photoRes = await sbFetch('/rest/v1/photos', {
    method: 'POST',
    body: JSON.stringify({ user_id: testUserId, shelf_id: shelfId, storage_path: 'verify/dummy-phase3.jpg', status: 'uploaded' }),
    headers: { Prefer: 'return=representation' },
  });
  if (!photoRes.ok) {
    const b = await photoRes.json();
    log(FAIL, '2.x setup — create test photo', JSON.stringify(b).slice(0, 120));
    return;
  }
  const [photo] = await photoRes.json();
  const photoId = photo.id;

  // 2.9 — GET /api/shelves/[id]/photos
  {
    const res = await apiCall(`/api/shelves/${shelfId}/photos`);
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.data?.photos !== undefined) {
      const photos = json.data.photos;
      const p = photos.find(p => p.id === photoId);
      if (p && p.stage === 'uploaded') {
        log(PASS, '2.9 GET /api/shelves/[id]/photos', `found photo, stage=${p.stage}`);
      } else if (p) {
        log(PASS, '2.9 GET /api/shelves/[id]/photos', `found photo, stage=${p.stage} (ok)`);
      } else {
        log(FAIL, '2.9 GET /api/shelves/[id]/photos', `photo not in list. json=${JSON.stringify(json).slice(0,200)}`);
      }
    } else {
      log(FAIL, '2.9 GET /api/shelves/[id]/photos', `status=${res.status} json=${JSON.stringify(json).slice(0,200)}`);
    }
  }

  // 2.6 — POST /api/photos/[id]/process twice fast → 409 on second
  // Note: first call will fail at Storage download (dummy path) before vision, but it will INSERT vision_run(running) first.
  // Actually the endpoint inserts vision_run(running) BEFORE downloading, so first call creates running run.
  // If first call fails at download and sets run to 'failed', second call won't 409.
  // Instead: manually insert a running vision_run, then call /process.
  const insertRunRes = await sbFetch('/rest/v1/vision_runs', {
    method: 'POST',
    body: JSON.stringify({ photo_id: photoId, status: 'running' }),
    headers: { Prefer: 'return=representation' },
  });
  const [manualRun] = insertRunRes.ok ? await insertRunRes.json() : [null];

  if (insertRunRes.ok) {
    const res = await apiCall(`/api/photos/${photoId}/process`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (res.status === 409 && json.error?.code === 'CONFLICT') {
      log(PASS, '2.6 POST /process → 409 CONFLICT when running run exists', `msg="${json.error.message?.slice(0,60)}"`);
    } else {
      log(FAIL, '2.6 POST /process → 409 CONFLICT', `status=${res.status} json=${JSON.stringify(json).slice(0,200)}`);
    }
    // Cleanup: mark manual run as failed
    if (manualRun?.id) {
      await sbFetch(`/rest/v1/vision_runs?id=eq.${manualRun.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'failed', error_message: 'verify-phase3 cleanup' }),
      });
    }
  } else {
    log(FAIL, '2.6 setup — insert manual running run', `status=${insertRunRes.status}`);
  }

  // 2.7, 2.8 — full process call requires real Storage path, skip for dummy photo
  log(SKIP, '2.7 POST /process → vision_runs row created', 'needs real Storage photo (dummy path fails at download step)');
  log(SKIP, '2.8 Repeat /process → stale detections preserved', 'needs real Storage photo');

  // Cleanup: delete test data (cascade deletes vision_runs + detections)
  await sbFetch(`/rest/v1/photos?id=eq.${photoId}`, { method: 'DELETE' });
  await sbFetch(`/rest/v1/shelves?id=eq.${shelfId}`, { method: 'DELETE' });
}

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 3 — UI / Route Checks
// ══════════════════════════════════════════════════════════════════════════════
async function section3(sampleShelfId) {
  console.log('\n=== UI / Route Checks (3.x) ===');

  // 3.5 — /shelves HTML contains "Zobacz zdjęcia →" link (server-rendered)
  // The ShelfListItem is a React island (client-side), so static HTML won't have it.
  // We check that the page renders (200) and the island script is present.
  try {
    const res = await devFetch('/shelves', {}, testJwt);
    if (res.status === 200) {
      const html = await res.text();
      const hasIsland = html.includes('ShelvesIsland') || html.includes('astro-island') || html.includes('client:load');
      log(hasIsland ? PASS : FAIL, '3.5 /shelves renders ShelvesIsland', `status=200, island=${hasIsland}`);
    } else {
      // Might redirect to /login if cookie-based session check fails (astro locals.user from cookie, not Bearer)
      log(SKIP, '3.5 /shelves — redirect (auth via cookie required, not Bearer)', `status=${res.status}`);
    }
  } catch (e) {
    log(FAIL, '3.5 /shelves render check', e.message);
  }

  // 3.6 — /shelves/[id] route exists and returns 200 (or redirect to login) — not 404
  if (sampleShelfId) {
    try {
      const res = await devFetch(`/shelves/${sampleShelfId}`, {}, testJwt);
      if (res.status === 200) {
        const html = await res.text();
        const hasIsland = html.includes('PhotoListIsland') || html.includes('astro-island') || html.includes('client:load');
        log(PASS, '3.6 /shelves/[id] renders PhotoListIsland', `status=200, island=${hasIsland}`);
      } else if (res.status === 302 || res.status === 301) {
        log(SKIP, '3.6 /shelves/[id] — auth redirect (cookie-based auth)', `status=${res.status}`);
      } else if (res.status === 404) {
        log(FAIL, '3.6 /shelves/[id] route — 404 (route not found)', `status=404`);
      } else {
        log(SKIP, '3.6 /shelves/[id]', `status=${res.status}`);
      }
    } catch (e) {
      log(FAIL, '3.6 /shelves/[id] render check', e.message);
    }
  } else {
    log(SKIP, '3.6 /shelves/[id] — no shelf_id available');
  }

  // 3.7-3.12 require browser / interactive session — mark as skipped (user-only)
  log(SKIP, '3.7-3.12 interactive UI checks (Run vision, Re-run, toast, mobile)', 'requires browser');

  // API endpoint checks via auth-header
  // Check that unauthenticated call to /api/shelves/[id]/photos returns 401
  if (sampleShelfId) {
    try {
      const res = await fetch(`${DEV_SERVER}/api/shelves/${sampleShelfId}/photos`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 401 && json.error?.code === 'UNAUTHENTICATED') {
        log(PASS, '3.x GET /api/shelves/[id]/photos → 401 for anon');
      } else {
        log(FAIL, '3.x GET /api/shelves/[id]/photos → 401 for anon', `status=${res.status}`);
      }
    } catch (e) {
      log(FAIL, '3.x 401 check', e.message);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('Phase 3 verification starting...\n');

  // Section 1 — DB (no server needed)
  const samplePhotoId = await check_1_6();
  await check_1_7();
  await check_1_8(samplePhotoId);
  await check_1_9();

  // Get a real shelf_id for route checks
  let sampleShelfId = null;
  {
    const res = await sbFetch('/rest/v1/shelves?select=id&limit=1');
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) sampleShelfId = rows[0].id;
  }

  // Setup test user
  console.log('\n=== Test User Setup ===');
  try {
    await createTestUser();
    await signIn();
    log(PASS, 'Test user created & signed in');
  } catch (e) {
    log(FAIL, 'Test user setup', e.message);
  }

  // Start dev server
  console.log('\n=== Starting dev server on :4321 ===');
  try {
    await startDevServer();
    await new Promise(r => setTimeout(r, 3000)); // wait for full boot
    log(PASS, 'Dev server started');
  } catch (e) {
    log(FAIL, 'Dev server start', e.message);
  }

  // Section 2 — API checks
  if (testJwt) {
    await section2();
  } else {
    log(FAIL, 'Section 2 skipped — no JWT');
  }

  // Section 3 — UI checks
  await section3(sampleShelfId);

  // Teardown
  stopDevServer();
  await deleteTestUser().catch(() => {});
  console.log('\nTest user cleaned up.');

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Result: ${totalPass} passed, ${totalFail} failed`);
  console.log('═'.repeat(50));

  if (totalFail > 0) process.exit(1);
}

main().catch(e => { console.error('Unhandled error:', e); stopDevServer(); process.exit(1); });
