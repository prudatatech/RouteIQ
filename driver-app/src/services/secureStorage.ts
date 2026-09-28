/**
 * Supabase auth storage backed by expo-secure-store.
 *
 * SecureStore may reject values above ~2048 bytes on Android, and a Supabase
 * session can be larger, so values are split into chunks stored under
 * `${key}.${i}` with the chunk count under `${key}.chunks`.
 *
 * Items use AFTER_FIRST_UNLOCK so the background location task can read the
 * session while the phone is locked.
 */
import * as SecureStore from 'expo-secure-store';

// Measured in UTF-8 bytes, so a chunk is also at most this many characters.
const MAX_CHUNK_BYTES = 1800;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');
const countKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

function split(value: string): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of value) {
    const size = utf8Length(ch.codePointAt(0)!);
    if (bytes + size > MAX_CHUNK_BYTES) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key), OPTIONS);
  const n = raw === null ? 0 : parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const secureStorage = {
  async getItem(rawKey: string): Promise<string | null> {
    const key = safeKey(rawKey);
    const count = await readCount(key);
    if (count === 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i), OPTIONS);
      if (part === null) return null; // incomplete write; treat as absent
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(rawKey: string, value: string): Promise<void> {
    const key = safeKey(rawKey);
    const previous = await readCount(key);
    const chunks = split(value);
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), chunks[i], OPTIONS);
    }
    await SecureStore.setItemAsync(countKey(key), String(chunks.length), OPTIONS);
    for (let i = chunks.length; i < previous; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
    }
  },

  async removeItem(rawKey: string): Promise<void> {
    const key = safeKey(rawKey);
    const count = await readCount(key);
    await SecureStore.deleteItemAsync(countKey(key), OPTIONS);
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
    }
  },
};
