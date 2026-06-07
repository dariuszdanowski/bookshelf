/**
 * S-41: Dowód, że `cost_events` (widok security_invoker=true, migracja 0021)
 * egzekwuje RLS tabel bazowych dla wywołującego.
 *
 * To PIERWSZY widok z security_invoker w repo — zerowy precedens.
 * Guardrail prywatności #1 z test-plan.md: user A nie widzi zdarzeń usera B
 * przez widok (ani przez `vision_runs`, ani przez `refine_calls`).
 *
 * Seed: admin wstawia po 1 wierszu vision_runs i refine_calls dla każdego usera
 * (z photo_id=null, detection_id=null — nullable po 0015/0015; user_id explicite).
 * Anon-klient usera A odpytuje `cost_events` i dostaje wyłącznie własne wiersze.
 * Anon-klient usera B analogicznie — zero wierszy usera A.
 *
 * Biega w CI (job e2e, efemeryczna Supabase na 127.0.0.1:54321).
 * Lokalnie z Windows nie dosięga stacku WSL (znane ograniczenie — memory).
 */

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(url && anonKey && serviceRoleKey);

if (!hasEnv) {
  describe.skip('cost_events RLS isolation (integration) — SKIPPED: brak PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY', () => {
    it('skipped', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('cost_events RLS isolation (integration)', () => {
    const PASSWORD = 'cost-rls-test-Password-12345!';
    const stamp = Date.now();
    const emailA = `cost-rls-a-${stamp}@example.com`;
    const emailB = `cost-rls-b-${stamp}@example.com`;

    // service-role: tworzenie/kasowanie userów + seed wierszy omijający FK shelves/photos

    const admin = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as any;

    let userAId = '';
    let userBId = '';

    let clientA: any;

    let clientB: any;

    let visionRunAId = '';
    let refineCallAId = '';

    beforeAll(async () => {
      // Utwórz dwóch userów
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

      // Anon-klienty logowane → niosą JWT → RLS-scoped
      clientA = createClient(url!, anonKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      clientB = createClient(url!, anonKey!, {
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

      // Seed userA: 1 vision_run (photo_id=null, detection_id=NULL — nullable po 0015)
      // user_id podany explicite; trigger set_vision_run_user_id to no-op gdy user_id!=null
      const { data: vr, error: vrErr } = await admin
        .from('vision_runs')
        .insert({
          user_id: userAId,
          photo_id: null,
          model: 'test-model',
          status: 'succeeded',
          cost_usd: 0.001,
          latency_ms: 100,
        })
        .select('id')
        .single();
      if (vrErr) throw vrErr;
      visionRunAId = vr.id;

      // Seed userA: 1 refine_call (photo_id=null, detection_id=null — nullable po 0015)
      const { data: rc, error: rcErr } = await admin
        .from('refine_calls')
        .insert({
          user_id: userAId,
          photo_id: null,
          detection_id: null,
          model: 'test-model',
          cost_usd: 0.002,
          latency_ms: 200,
        })
        .select('id')
        .single();
      if (rcErr) throw rcErr;
      refineCallAId = rc.id;

      // Seed userB: po 1 wierszu (żeby sprawdzić, że B widzi tylko swoje)
      await admin.from('vision_runs').insert({
        user_id: userBId,
        photo_id: null,
        model: 'test-model',
        status: 'succeeded',
        cost_usd: 0.003,
        latency_ms: 150,
      });
      await admin.from('refine_calls').insert({
        user_id: userBId,
        photo_id: null,
        detection_id: null,
        model: 'test-model',
        cost_usd: 0.004,
        latency_ms: 250,
      });
    });

    afterAll(async () => {
      // Cascade z auth.users czyści vision_runs/refine_calls (FK on delete cascade)
      await Promise.allSettled(
        [userAId, userBId].filter((id) => id).map((id) => admin.auth.admin.deleteUser(id)),
      );
    });

    it('userA widzi własne zdarzenia w cost_events (vision + refine)', async () => {
      const { data, error } = await clientA
        .from('cost_events')
        .select('id, kind, user_id')
        .in('id', [visionRunAId, refineCallAId]);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
      // wszystkie wiersze należą do userA
      for (const row of data ?? []) {
        expect(row.user_id).toBe(userAId);
      }
    });

    it('userB NIE widzi zdarzeń userA (RLS security_invoker egzekwowany przez widok)', async () => {
      const { data, error } = await clientB
        .from('cost_events')
        .select('id')
        .in('id', [visionRunAId, refineCallAId]);

      expect(error).toBeNull();
      // userB dostaje puste — RLS na vision_runs/refine_calls blokuje
      expect(data).toEqual([]);
    });

    it('userB widzi tylko własne zdarzenia', async () => {
      const { data, error } = await clientB.from('cost_events').select('id, user_id');

      expect(error).toBeNull();
      // wszystkie wiersze (jeśli jakieś) należą do userB
      for (const row of data ?? []) {
        expect(row.user_id).toBe(userBId);
      }
    });
  });
}
