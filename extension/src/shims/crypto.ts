// `node:crypto` for the reader page. The catalog hashes its files with
// createHash('sha256') synchronously; Web Crypto is async only, so this uses a
// small synchronous SHA-256 with the same output.
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const encoder = new TextEncoder();

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Only sha256 is available in the browser, not ${algorithm}.`);
  const hash = sha256.create();
  const api = {
    update(data: string | Uint8Array) {
      hash.update(typeof data === 'string' ? encoder.encode(data) : data);
      return api;
    },
    digest(encoding: 'hex') {
      if (encoding !== 'hex') throw new Error('Only hex digests are available in the browser.');
      return bytesToHex(hash.digest());
    },
  };
  return api;
}
