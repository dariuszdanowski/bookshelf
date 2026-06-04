import { describe, it, expect, vi } from 'vitest';

// vi.hoisted zapewnia że TEST_KEY jest dostępne w fabryce vi.mock (która jest hoistowana)
const TEST_KEY = vi.hoisted(() => btoa(String.fromCharCode(...new Array(32).fill(0x42))));

vi.mock('cloudflare:workers', () => ({
  env: { USER_KEYS_ENCRYPTION_KEY: TEST_KEY },
}));

import { encrypt, decrypt, encryptWithEnvKey, decryptWithEnvKey } from '../../../../src/lib/keys/crypto';

describe('encrypt/decrypt', () => {
  it('round-trip: decrypt(encrypt(plaintext)) === plaintext', async () => {
    const plaintext = 'sk-ant-test-key-12345';
    const enc = await encrypt(plaintext, TEST_KEY);
    const dec = await decrypt(enc, TEST_KEY);
    expect(dec).toBe(plaintext);
  });

  it('dwa encrypt z tym samym plaintext dają różne wyniki (losowy IV)', async () => {
    const plaintext = 'same-key';
    const enc1 = await encrypt(plaintext, TEST_KEY);
    const enc2 = await encrypt(plaintext, TEST_KEY);
    expect(enc1).not.toBe(enc2);
  });

  it('decrypt z błędnym ciphertext rzuca', async () => {
    await expect(decrypt('invalid:ciphertext', TEST_KEY)).rejects.toThrow();
  });
});

describe('encryptWithEnvKey / decryptWithEnvKey', () => {
  it('round-trip przez env key', async () => {
    const plaintext = 'env-test-key';
    const enc = await encryptWithEnvKey(plaintext);
    const dec = await decryptWithEnvKey(enc);
    expect(dec).toBe(plaintext);
  });
});
