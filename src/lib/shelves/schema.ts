import { z } from 'zod';

/**
 * Zod schemas dla S-02 shelves CRUD.
 *
 * Defense in depth dla niesuwalnej „Zakupione":
 *   1. Zod refuse name === 'Zakupione' na CREATE (`refine`)
 *   2. Endpoint mapuje Postgres P0001 (trigger reject) na 400 VALIDATION_ERROR
 *   3. DB triggers w migracji 0004 są ostatecznym guardem
 *   4. UI nie pokazuje delete/edit buttonów dla `is_system: true`
 */

const RESERVED_NAMES = ['Zakupione'] as const;

export const ShelfNameSchema = z
  .string()
  .trim()
  .min(1, 'Nazwa nie może być pusta')
  .max(100, 'Nazwa może mieć maksymalnie 100 znaków')
  .refine((name) => !RESERVED_NAMES.includes(name as (typeof RESERVED_NAMES)[number]), {
    message: 'Nazwa "Zakupione" jest zarezerwowana dla systemowej półki',
  });

export const LocationSchema = z
  .string()
  .trim()
  .max(200, 'Lokalizacja może mieć maksymalnie 200 znaków')
  .optional();

export const CreateShelfSchema = z.object({
  name: ShelfNameSchema,
  location: LocationSchema,
});

export const UpdateShelfSchema = z
  .object({
    name: ShelfNameSchema.optional(),
    location: LocationSchema,
  })
  .refine((data) => data.name !== undefined || data.location !== undefined, {
    message: 'Co najmniej jedno pole musi być podane',
  });

export type CreateShelfInput = z.infer<typeof CreateShelfSchema>;
export type UpdateShelfInput = z.infer<typeof UpdateShelfSchema>;

/**
 * Shape rzeczywistej półki w response API.
 *
 * `is_system: true` dla `name === 'Zakupione'` (computed na endpoincie, nie w DB).
 * `book_count` — realny count z shelf_entries (is_current=true), wyliczany
 * przez GET /api/shelves przez JS-tally z równoległego zapytania. POST (nowa
 * półka) zwraca 0 bo świeżo utworzona półka nie ma jeszcze wpisów.
 * `photo_count` — liczba zdjęć przypisanych do półki (photos.shelf_id),
 * wyliczana analogicznie do book_count.
 */
export type ShelfDTO = {
  id: string;
  name: string;
  location: string | null;
  position_index: number;
  is_system: boolean;
  book_count: number;
  photo_count: number;
  created_at: string;
};
