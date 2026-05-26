import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/lib/db/database.types';

/**
 * Dowód, że trigger `on_auth_user_created` (migracja 0003) tworzy profile +
 * shelf „Zakupione" po INSERT do auth.users — oraz że RLS-respecting anon
 * client (po signInWithPassword) widzi WYŁĄCZNIE własne dane.
 *
 * Service-role konstruowany TYLKO tu, w pliku testu — NIGDY w `src/lib/db/`.
 * Cleanup przez `Promise.allSettled` (resilient, analog F-01 phase 3 fix F1).
 */

const url = process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(url && anonKey && serviceRoleKey);

if (!hasEnv) {
  describe.skip(
    'handle_new_user trigger (integration) — SKIPPED: brak env (uzupełnij .dev.vars lub .env.local)',
    () => {
      it('skipped', () => {
        expect(true).toBe(true);
      });
    }
  );
} else {
  describe('handle_new_user trigger (integration)', () => {
    const PASSWORD = 'auth-trigger-Test-Password-12345!';
    const stamp = Date.now();
    const emailA = `auth-trigger-a-${stamp}@example.com`;
    const emailB = `auth-trigger-b-${stamp}@example.com`;
    const displayA = 'Trigger Test A';
    const displayB = 'Trigger Test B';

    const admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let userAId = '';
    let userBId = '';
    let clientA: SupabaseClient<Database>;
    let clientB: SupabaseClient<Database>;

    beforeAll(async () => {
      const { data: a, error: aErr } = await admin.auth.admin.createUser({
        email: emailA,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: displayA },
      });
      if (aErr) throw aErr;
      userAId = a.user.id;

      const { data: b, error: bErr } = await admin.auth.admin.createUser({
        email: emailB,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: displayB },
      });
      if (bErr) throw bErr;
      userBId = b.user.id;

      clientA = createClient<Database>(url!, anonKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      clientB = createClient<Database>(url!, anonKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error: signInA } = await clientA.auth.signInWithPassword({
        email: emailA,
        password: PASSWORD,
      });
      if (signInA) throw signInA;

      const { error: signInB } = await clientB.auth.signInWithPassword({
        email: emailB,
        password: PASSWORD,
      });
      if (signInB) throw signInB;
    });

    afterAll(async () => {
      // Cascade (FK on delete cascade → auth.users) czyści profiles + shelves.
      await Promise.allSettled(
        [userAId, userBId]
          .filter((id) => id)
          .map((id) => admin.auth.admin.deleteUser(id))
      );
    });

    it('trigger tworzy profile z display_name z user_metadata', async () => {
      // admin client → omija RLS, sprawdza realny stan bazy.
      const { data, error } = await admin
        .from('profiles')
        .select('id, display_name')
        .eq('id', userAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.display_name).toBe(displayA);
    });

    it('trigger tworzy shelf "Zakupione" dla nowego usera', async () => {
      const { data, error } = await admin
        .from('shelves')
        .select('id, name, user_id')
        .eq('user_id', userAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.name).toBe('Zakupione');
    });

    it('RLS-scoped client widzi tylko własny profile (userA nie widzi userB)', async () => {
      const { data: aRead, error: aErr } = await clientA.from('profiles').select('id');
      expect(aErr).toBeNull();
      expect(aRead).toHaveLength(1);
      expect(aRead?.[0]?.id).toBe(userAId);
    });

    it('RLS-scoped client widzi tylko własną półkę "Zakupione" (userA nie widzi userB)', async () => {
      const { data: aRead, error: aErr } = await clientA
        .from('shelves')
        .select('id, name, user_id');
      expect(aErr).toBeNull();
      expect(aRead).toHaveLength(1);
      expect(aRead?.[0]?.name).toBe('Zakupione');
      expect(aRead?.[0]?.user_id).toBe(userAId);
    });
  });
}
