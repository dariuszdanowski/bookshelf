import { env } from 'cloudflare:workers';

const ALG = { name: 'AES-GCM', length: 256 } as const;
const IV_BYTES = 12;

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function importKey(rawKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64ToBytes(rawKeyB64), ALG, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Szyfruje plaintext AES-GCM. Zwraca "<ivB64>:<ciphertextB64>".
 * rawKey: base64-zakodowany 32-bajtowy klucz.
 */
export async function encrypt(plaintext: string, rawKey: string): Promise<string> {
  const key = await importKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`;
}

/**
 * Deszyfruje string "<ivB64>:<ciphertextB64>". Rzuca gdy format lub klucz błędny.
 */
export async function decrypt(encrypted: string, rawKey: string): Promise<string> {
  const sep = encrypted.indexOf(':');
  if (sep === -1) throw new Error('Invalid encrypted format');
  const iv = b64ToBytes(encrypted.slice(0, sep));
  const ct = b64ToBytes(encrypted.slice(sep + 1));
  const key = await importKey(rawKey);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/**
 * Czyta USER_KEYS_ENCRYPTION_KEY z env (CF Workers runtime lub Vitest vi.mock).
 * Wzorzec identyczny z supabase.server.ts — runtime first, fallback import.meta.env.
 */
export function getEncryptionKey(): string {
  const key = env?.USER_KEYS_ENCRYPTION_KEY ?? import.meta.env.USER_KEYS_ENCRYPTION_KEY;
  if (!key) throw new Error('USER_KEYS_ENCRYPTION_KEY not configured');
  return key;
}

export function encryptWithEnvKey(plaintext: string): Promise<string> {
  return encrypt(plaintext, getEncryptionKey());
}

export function decryptWithEnvKey(encrypted: string): Promise<string> {
  return decrypt(encrypted, getEncryptionKey());
}
