import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/lib/db/database.types';

/**
 * Integration test dla S-02 — weryfikuje na zdalnym Supabase:
 *  - UNIQUE (user_id, name) constraint (0004 migration)
 *  - Trigger `prevent_zakupione_delete` blokuje DELETE systemowej „Zakupione" (P0001)
 *  - Trigger `prevent_zakupione_rename` blokuje UPDATE name z „Zakupione" na inną (P0001)
 *  - RLS scoping: per-user isolation dla shelves (z 0002)
 *
 * Wymaga ENV (jak F-01 rls.test.ts):
 *  - PUBLIC_SUPABASE_URL
 *  - PUBLIC_SUPABASE_ANON_KEY
 *  - SUPABASE_SERVICE_ROLE_KEY
 *
 * Bez env → describe.skip (CI bez secrets nie pada).
 * Uruchamiany przez `npm run test:integration` (osobny vitest config; env node, nie jsdom).
 *
 * Manual gate: po `supabase db push` migracji 0004 (workflow „branch per change" =
 * po merge do main).
 */

const url = process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(url && anonKey && serviceRoleKey);

if (!hasEnv) {
  describe.skip(
    'Shelves RLS + triggers (integration) — SKIPPED: brak PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY',
    () => {
      it('skipped', () => {
        expect(true).toBe(true);
      });
    }
  );
} else {
  describe('Shelves RLS + triggers (integration)', () => {
    const PASSWORD = 'shelves-test-Password-12345!';
    const stamp = Date.now();
    const emailA = `shelves-test-a-${stamp}@example.com`;
    const emailB = `shelves-test-b-${stamp}@example.com`;

    const admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let userAId = '';
    let userBId = '';
    let clientA: SupabaseClient<Database>;
    let clientB: SupabaseClient<Database>;

    beforeAll(async () => {
      // Create userA (handle_new_user trigger zakłada „Zakupione" automatycznie).
      const a = await admin.auth.admin.createUser({
        email: emailA,
        password: PASSWORD,
        email_confirm: true,
      });
      if (a.error || !a.data.user) throw new Error(`createUser A: ${a.error?.message}`);
      userAId = a.data.user.id;

      const b = await admin.auth.admin.createUser({
        email: emailB,
        password: PASSWORD,
        email_confirm: true,
      });
      if (b.error || !b.data.user) throw new Error(`createUser B: ${b.error?.message}`);
      userBId = b.data.user.id;

      clientA = createClient<Database>(url!, anonKey!);
      const signA = await clientA.auth.signInWithPassword({ email: emailA, password: PASSWORD });
      if (signA.error) throw new Error(`signIn A: ${signA.error.message}`);

      clientB = createClient<Database>(url!, anonKey!);
      const signB = await clientB.auth.signInWithPassword({ email: emailB, password: PASSWORD });
      if (signB.error) throw new Error(`signIn B: ${signB.error.message}`);
    });

    afterAll(async () => {
      // Cascade czyści shelves usera.
      if (userAId) await admin.auth.admin.deleteUser(userAId);
      if (userBId) await admin.auth.admin.deleteUser(userBId);
    });

    it('UNIQUE (user_id, name) constraint blocks duplicate per user', async () => {
      // userA już ma „Zakupione" z triggera. Spróbuj utworzyć drugą o tej samej
      // nazwie inną drogą — przez insert „Belletrystyka" 2× wymusza unique violation.
      const first = await clientA
        .from('shelves')
        .insert({ user_id: userAId, name: 'Belletrystyka' })
        .select('id');
      expect(first.error).toBeNull();

      const dup = await clientA
        .from('shelves')
        .insert({ user_id: userAId, name: 'Belletrystyka' })
        .select('id');
      expect(dup.error).not.toBeNull();
      expect(dup.error?.code).toBe('23505');
    });

    it('UNIQUE constraint is per-user: userB can have same name', async () => {
      // userB tworzy też „Belletrystyka" — OK bo różny user_id.
      const userBShelf = await clientB
        .from('shelves')
        .insert({ user_id: userBId, name: 'Belletrystyka' })
        .select('id');
      expect(userBShelf.error).toBeNull();
    });

    it('DELETE "Zakupione" blocked by trigger (P0001)', async () => {
      const { data: zakupione } = await clientA
        .from('shelves')
        .select('id')
        .eq('user_id', userAId)
        .eq('name', 'Zakupione')
        .single();
      expect(zakupione).not.toBeNull();

      const del = await clientA.from('shelves').delete().eq('id', zakupione!.id);
      expect(del.error).not.toBeNull();
      expect(del.error?.code).toBe('P0001');
      expect(del.error?.message).toMatch(/Nie można usunąć/);
    });

    it('UPDATE name from "Zakupione" blocked by trigger (P0001); location update allowed', async () => {
      const { data: zakupione } = await clientA
        .from('shelves')
        .select('id, location')
        .eq('user_id', userAId)
        .eq('name', 'Zakupione')
        .single();
      expect(zakupione).not.toBeNull();

      // Rename should fail.
      const rename = await clientA
        .from('shelves')
        .update({ name: 'Wishlist' })
        .eq('id', zakupione!.id);
      expect(rename.error).not.toBeNull();
      expect(rename.error?.code).toBe('P0001');

      // Location update allowed (trigger checks only name).
      const locUpdate = await clientA
        .from('shelves')
        .update({ location: 'Salon' })
        .eq('id', zakupione!.id);
      expect(locUpdate.error).toBeNull();
    });

    it('RLS isolation: userB cannot see userA shelves', async () => {
      // userB queries — should see only own shelves (1 Zakupione + 1 Belletrystyka).
      const { data, error } = await clientB.from('shelves').select('user_id, name');
      expect(error).toBeNull();
      expect(data?.every((row) => row.user_id === userBId)).toBe(true);
      // userA's "Belletrystyka" / "Zakupione" not visible.
      const userAShelfIds = data?.filter((r) => r.user_id === userAId);
      expect(userAShelfIds).toEqual([]);
    });
  });
}
