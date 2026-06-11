import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/lib/db/database.types';
import { unconfirmDetectionFromCatalog } from '../../src/lib/books/confirm';

/**
 * Dowód RLS dla unconfirmDetectionFromCatalog: user B nie może cofnąć
 * akceptacji detekcji usera A — helper zwraca not_found (RLS ukrywa detection).
 */

const url = process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(url && anonKey && serviceRoleKey);

if (!hasEnv) {
  describe.skip('unconfirm RLS (integration) — SKIPPED: brak env (uzupełnij .dev.vars)', () => {
    it('skipped', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('unconfirm RLS (integration)', () => {
    const PASSWORD = 'rls-unconfirm-Password-12345!';
    const stamp = Date.now();
    const emailA = `unconfirm-rls-a-${stamp}@example.com`;
    const emailB = `unconfirm-rls-b-${stamp}@example.com`;

    const admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let userAId = '';
    let userBId = '';
    let clientB: SupabaseClient<Database>;
    let detectionAId = '';

    beforeAll(async () => {
      const { data: a, error: aErr } = await admin.auth.admin.createUser({
        email: emailA,
        password: PASSWORD,
        email_confirm: true,
      });
      if (aErr) throw aErr;
      userAId = a.user.id;

      const { data: b, error: bErr } = await admin.auth.admin.createUser({
        email: emailB,
        password: PASSWORD,
        email_confirm: true,
      });
      if (bErr) throw bErr;
      userBId = b.user.id;

      clientB = createClient<Database>(url!, anonKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInB } = await clientB.auth.signInWithPassword({
        email: emailB,
        password: PASSWORD,
      });
      if (signInB) throw signInB;

      // Utwórz dane usera A przez service-role (bypass RLS)
      const { data: shelf, error: shelfErr } = await admin
        .from('shelves')
        .insert({ user_id: userAId, name: 'unconfirm-rls-shelf-a' })
        .select('id')
        .single();
      if (shelfErr) throw shelfErr;

      const { data: photo, error: photoErr } = await admin
        .from('photos')
        .insert({
          user_id: userAId,
          shelf_id: shelf.id,
          storage_path: 'unconfirm-rls-test/fake.jpg',
          status: 'processed',
        })
        .select('id')
        .single();
      if (photoErr) throw photoErr;

      // vision_run wymagany jako FK w detections (user_id derywowany przez trigger z photos)
      const { data: visionRun, error: vrErr } = await admin
        .from('vision_runs')
        .insert({ photo_id: photo.id, status: 'completed' })
        .select('id')
        .single();
      if (vrErr) throw vrErr;

      const { data: detection, error: detErr } = await admin
        .from('detections')
        .insert({
          photo_id: photo.id,
          position_index: 1,
          raw_title: 'Test RLS Book',
          status: 'confirmed',
          vision_run_id: visionRun.id,
        })
        .select('id')
        .single();
      if (detErr) throw detErr;
      detectionAId = detection.id;
    });

    afterAll(async () => {
      await Promise.allSettled(
        [userAId, userBId].filter((id) => id).map((id) => admin.auth.admin.deleteUser(id)),
      );
    });

    it('user B nie może cofnąć akceptacji detekcji usera A (not_found przez RLS)', async () => {
      const result = await unconfirmDetectionFromCatalog(clientB, userBId, detectionAId);

      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });
  });
}
