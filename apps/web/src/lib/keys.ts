/**
 * Server keypairs, each from an inline secret (JSON byte array or base58, for Vercel) or a
 * file path (local). A missing key disables only the feature that needs it.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from '@solana/kit';
import { env } from './env';
import { log } from './log';

export type KeyName = 'faucet' | 'crank' | 'mintAuthority';

const VARS: Record<KeyName, { inline: keyof ReturnType<typeof env>; path: keyof ReturnType<typeof env>; feature: string }> = {
  faucet: { inline: 'FAUCET_KEYPAIR', path: 'FAUCET_KEYPAIR_PATH', feature: 'faucet SOL drips' },
  crank: { inline: 'CRANK_KEYPAIR', path: 'CRANK_KEYPAIR_PATH', feature: 'crank and claim payouts' },
  mintAuthority: {
    inline: 'MINT_AUTHORITY_KEYPAIR',
    path: 'MINT_AUTHORITY_KEYPAIR_PATH',
    feature: 'faucet tSKR and test Genesis mints',
  },
};

export function parseSecret(secret: string): Uint8Array {
  const trimmed = secret.trim();
  const bytes = trimmed.startsWith('[') ? new Uint8Array(JSON.parse(trimmed) as number[]) : new Uint8Array(getBase58Encoder().encode(trimmed));
  if (bytes.length !== 64) throw new Error(`expected a 64-byte secret key, got ${bytes.length} bytes`);
  return bytes;
}

const cache = new Map<KeyName, Promise<KeyPairSigner | null>>();

export function loadSigner(name: KeyName): Promise<KeyPairSigner | null> {
  let hit = cache.get(name);
  if (!hit) {
    hit = (async () => {
      const e = env();
      const vars = VARS[name];
      try {
        const inline = e[vars.inline] as string | undefined;
        const path = (e[vars.path] as string | undefined)?.replace(/^~(?=$|[\\/])/, homedir());
        if (inline) return await createKeyPairSignerFromBytes(parseSecret(inline));
        if (path) return await createKeyPairSignerFromBytes(parseSecret(readFileSync(path, 'utf8')));
        log.once(`keys.${name}_missing`, { note: `${String(vars.inline)}/${String(vars.path)} unset; ${vars.feature} disabled` });
        return null;
      } catch (err) {
        log.error(`keys.${name}_invalid`, { error: (err as Error).message });
        return null;
      }
    })();
    cache.set(name, hit);
  }
  return hit;
}

export function resetSigners() {
  cache.clear();
}
