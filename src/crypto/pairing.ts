import { fromBase64, toBase64, utf8 } from './bytes';
import { CryptoError } from './password';
import { decodePublicKey, encodePublicKey, hybridKeyPairRandom, hybridOpen, hybridSeal, type HybridKeyPair, type HybridSealed } from './hybrid';

/**
 * Moving a secret (the key that encrypts the cloud) from a device that has it to a new one, with no server in the
 * middle that could read it, and in a way a future quantum computer cannot undo from a recording of the exchange.
 *
 *   new device   makes a hybrid key pair (X25519 + ML-KEM-768) and shows its PUBLIC half as a code, plus 12 check digits
 *   old device   the person types that code in; it shows the same 12 digits; the person confirms they match, then the
 *                device seals the secret to that public key and shows a second code
 *   new device   the person types the second code in; only the new device's private half opens it
 *
 * Both codes can travel over any channel, even a chat: the first is public, the second is sealed. What the channel
 * could do is swap the first code for its own, so the person compares the check digits on both screens (12 digits, which
 * cannot be ground out within the time it takes to look at two phones). The codes are one-time: the key pair is made
 * for the exchange and dropped after it.
 */

const REQUEST = 'JOIN1.';
const ANSWER = 'SEAL1.';

const b64url = (b: Uint8Array): string => toBase64(b).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64url = (s: string): Uint8Array => fromBase64(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4));
const clean = (code: string): string => code.replace(/\s+/g, '').replace(/^["'«]+|["'»]+$/g, '');

/** 12 digits, in groups of four, from the request code: the same on both screens if nothing was swapped. */
export async function checkDigits(requestCode: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(clean(requestCode))));
  let n = 0n;
  for (const byte of hash.slice(0, 8)) n = (n << 8n) | BigInt(byte);
  return String(n % 1_000_000_000_000n).padStart(12, '0').replace(/(\d{4})(?=\d)/g, '$1 ');
}

export interface JoinRequest {
  /** what to give to the old device */
  code: string;
  checkDigits: string;
  /** stays on this device until the answer arrives */
  pair: HybridKeyPair;
}

/** The new device. */
export async function startJoin(): Promise<JoinRequest> {
  const pair = await hybridKeyPairRandom();
  const code = REQUEST + b64url(utf8(encodePublicKey(pair.publicKey)));
  return { code, checkDigits: await checkDigits(code), pair };
}

/** The old device: reads the request (@throws CryptoError for a code that is not one). */
export async function readJoinRequest(requestCode: string): Promise<{ checkDigits: string; seal(secret: Uint8Array<ArrayBuffer>, purpose: string): Promise<string> }> {
  const code = clean(requestCode);
  if (!code.startsWith(REQUEST)) throw new CryptoError('invalid_payload', "This isn't a code from the new device.");
  let publicKey: ReturnType<typeof decodePublicKey>;
  try {
    publicKey = decodePublicKey(new TextDecoder().decode(unb64url(code.slice(REQUEST.length))));
  } catch {
    throw new CryptoError('invalid_payload', 'The code is damaged. Copy it again in full.');
  }
  return {
    checkDigits: await checkDigits(code),
    async seal(secret, purpose) {
      const sealed = await hybridSeal(publicKey, secret, `${purpose}|${await checkDigits(code)}`);
      return ANSWER + b64url(utf8(JSON.stringify(sealed)));
    },
  };
}

/** The new device: opens the answer. @throws CryptoError */
export async function finishJoin(request: JoinRequest, answerCode: string, purpose: string): Promise<Uint8Array<ArrayBuffer>> {
  const code = clean(answerCode);
  if (!code.startsWith(ANSWER)) throw new CryptoError('invalid_payload', "This isn't the answer from the other device.");
  let sealed: HybridSealed;
  try {
    sealed = JSON.parse(new TextDecoder().decode(unb64url(code.slice(ANSWER.length)))) as HybridSealed;
  } catch {
    throw new CryptoError('invalid_payload', 'The code is damaged. Copy it again in full.');
  }
  // the purpose and the check digits are part of what was sealed: an answer meant for another request does not open
  return hybridOpen(request.pair.secretKey, request.pair.publicKey, sealed, `${purpose}|${request.checkDigits}`);
}

