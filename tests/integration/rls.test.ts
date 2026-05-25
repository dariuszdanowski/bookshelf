import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/lib/db/database.types';

/**
 * Dowód, że RLS egzekwuje izolację per-user na zlinkowanym, zdalnym projekcie
 * Supabase — dla obu kształtów polityk z `0002_rls_policies.sql`:
 *   - bezpośredni `user_id = auth.uid()` (tabela `shelves`),
 *   - EXISTS-przez-parent (tabela `shelf_entries` → `books.user_id`).
 *
 * Test tworzy dwóch userów przez admin API (service-role konstruowany TYLKO tu,
 * w pliku testu — nigdy w `src/lib/db/`), loguje każdego anon-klientem po to, by
 * jego żądania niosły JWT i były RLS-scoped, po czym dowodzi, że userB nie widzi
 * danych userA. Cleanup kasuje obu userów (cascade czyści dane domenowe).
 *
 * Osadzony poza domyślnym `npm run test` (jsdom, offline) — uruchamiany przez
 * `npm run test:integration` (config: vitest.integration.config.ts, env node).
 */

const url = process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(url && anonKey && serviceRoleKey);

if (!hasEnv) {
  describe.skip(
    'RLS isolation (integration) — SKIPPED: brak PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (uzupełnij .dev.vars lub .env.local)',
    () => {
      it('skipped', () => {
        expect(true).toBe(true);
      });
    }
  );
} else {
  describe('RLS isolation (integration)', () => {
    const PASSWORD = 'rls-test-Password-12345!';
    const stamp = Date.now();
    const emailA = `rls-test-a-${stamp}@example.com`;
    const emailB = `rls-test-b-${stamp}@example.com`;

    // service-role: tworzenie/kasowanie userów. Lokalnie w teście, nie w src/.
    const admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let userAId = '';
    let userBId = '';
    let clientA: SupabaseClient<Database>;
    let clientB: SupabaseClient<Database>;

    // Dane userA, do których userB nie powinien mieć dostępu.
    let shelfAId = '';
    let entryAId = '';

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

      // Anon-klienty → po signInWithPassword niosą JWT usera → RLS-scoped.
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

      // userA: półka (polityka bezpośrednia user_id).
      const { data: shelf, error: shelfErr } = await clientA
        .from('shelves')
        .insert({ user_id: userAId, name: 'RLS test shelf A' })
        .select('id')
        .single();
      if (shelfErr) throw shelfErr;
      shelfAId = shelf.id;

      // userA: książka (polityka bezpośrednia; parent dla shelf_entries).
      const { data: book, error: bookErr } = await clientA
        .from('books')
        .insert({ user_id: userAId, title: 'RLS test book A' })
        .select('id')
        .single();
      if (bookErr) throw bookErr;

      // userA: wpis na półce (polityka EXISTS-przez-parent: books.user_id).
      const { data: entry, error: entryErr } = await clientA
        .from('shelf_entries')
        .insert({ book_id: book.id, shelf_id: shelfAId })
        .select('id')
        .single();
      if (entryErr) throw entryErr;
      entryAId = entry.id;
    });

    afterAll(async () => {
      // Cascade (FK on delete cascade → auth.users) czyści shelves/books/shelf_entries.
      if (userAId) await admin.auth.admin.deleteUser(userAId);
      if (userBId) await admin.auth.admin.deleteUser(userBId);
    });

    it('polityka bezpośrednia (shelves.user_id): userA widzi własną półkę, userB dostaje 0 wierszy', async () => {
      const { data: aRead, error: aErr } = await clientA
        .from('shelves')
        .select('id')
        .eq('id', shelfAId);
      expect(aErr).toBeNull();
      expect(aRead).toHaveLength(1);

      const { data: bRead, error: bErr } = await clientB
        .from('shelves')
        .select('id')
        .eq('id', shelfAId);
      expect(bErr).toBeNull();
      expect(bRead).toEqual([]);
    });

    it('polityka EXISTS-przez-parent (shelf_entries → books.user_id): userA widzi własny wpis, userB dostaje 0 wierszy', async () => {
      const { data: aRead, error: aErr } = await clientA
        .from('shelf_entries')
        .select('id')
        .eq('id', entryAId);
      expect(aErr).toBeNull();
      expect(aRead).toHaveLength(1);

      const { data: bRead, error: bErr } = await clientB
        .from('shelf_entries')
        .select('id')
        .eq('id', entryAId);
      expect(bErr).toBeNull();
      expect(bRead).toEqual([]);
    });
  });
}
