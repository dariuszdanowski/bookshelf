import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/lib/db/database.types';

/**
 * Integration test dla S-17 (catalog-description-search) — weryfikuje na realnej DB:
 *  - books.description (0019) trafia do GENERATED kolumny search_text — fraza
 *    występująca TYLKO w opisie znajduje książkę przez ILIKE na search_text
 *    (jedyna warstwa dowodząca GENERATED column; unit mock byłby tautologią)
 *  - regresja 0011: książka bez opisu nadal znajdowana po tytule/autorze/wydawcy
 *
 * Wymaga ENV (jak rls.test.ts):
 *  - PUBLIC_SUPABASE_URL
 *  - PUBLIC_SUPABASE_ANON_KEY
 *  - SUPABASE_SERVICE_ROLE_KEY
 *
 * Bez env → describe.skip (CI bez secrets nie pada).
 * Uruchamiany przez `npm run test:integration` (osobny vitest config; env node).
 *
 * ⚠ NIE uruchamiać lokalnie przy `.dev.vars` = remote prod pre-merge: kolumn 0019
 * tam jeszcze nie ma (test padnie), a beforeAll tworzy realnego usera przez admin
 * API. Weryfikacja w CI (efemeryczna Supabase z pełnym replayem migracji) lub na
 * lokalnym stacku WSL po `supabase db reset`.
 */

const url = process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(url && anonKey && serviceRoleKey);

if (!hasEnv) {
  describe.skip('Books description search (integration) — SKIPPED: brak PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY', () => {
    it('skipped', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('Books description search (integration)', () => {
    const PASSWORD = 'desc-search-test-Password-12345!';
    const stamp = Date.now();
    const email = `desc-search-test-${stamp}@example.com`;
    // Fraza unikalna per run, występująca WYŁĄCZNIE w opisie (nie w tytule/autorze).
    const descPhrase = `zmierzch-nad-traktorami-${stamp}`;

    const admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let userId = '';
    let client: SupabaseClient<Database>;

    beforeAll(async () => {
      const created = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw new Error(`createUser: ${created.error?.message}`);
      }
      userId = created.data.user.id;

      client = createClient<Database>(url!, anonKey!);
      const signed = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (signed.error) throw new Error(`signIn: ${signed.error.message}`);
    });

    afterAll(async () => {
      // Cascade czyści books usera.
      if (userId) await admin.auth.admin.deleteUser(userId);
    });

    it('search_text contains description: phrase present only in description finds the book', async () => {
      const inserted = await client
        .from('books')
        .insert({
          user_id: userId,
          title: `Pora siewu ${stamp}`,
          authors: ['Anna Przykładowa'],
          description: `Saga rodzinna o trzech pokoleniach rolników; ${descPhrase} jako motyw przewodni.`,
        })
        .select('id')
        .single();
      expect(inserted.error).toBeNull();

      const found = await client
        .from('books')
        .select('id, title, description')
        .ilike('search_text', `%${descPhrase}%`);
      expect(found.error).toBeNull();
      expect(found.data).toHaveLength(1);
      expect(found.data?.[0]?.id).toBe(inserted.data!.id);
    });

    it('regression 0011: book without description still found by title', async () => {
      const titlePhrase = `bez-opisu-${stamp}`;
      const inserted = await client
        .from('books')
        .insert({
          user_id: userId,
          title: `Tom ${titlePhrase}`,
          authors: ['Jan Bezopisowy'],
        })
        .select('id')
        .single();
      expect(inserted.error).toBeNull();

      const found = await client
        .from('books')
        .select('id')
        .ilike('search_text', `%${titlePhrase}%`);
      expect(found.error).toBeNull();
      expect(found.data).toHaveLength(1);
      expect(found.data?.[0]?.id).toBe(inserted.data!.id);
    });
  });
}
