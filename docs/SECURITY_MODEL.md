# Security model

[Русский](ru/SECURITY_MODEL.md)

What Aster protects, against whom, how, and where the protection ends. For reporting a vulnerability see [SECURITY.md](../SECURITY.md).

## What is at stake

Everything in Aster is personal: who you know, what you said to them, what they are looking for, their birthdays and their
families. It lives in IndexedDB on your device, optionally in your own Supabase project, and, if you turn it on, in your AI provider's
hands for the length of a request.

## Who it is protected against

| Threat | What protects you | Where it ends |
|---|---|---|
| Someone with your **unlocked phone or browser profile**, or a copy of its disk | **Protect this device**: nothing readable is written to disk; the data key is opened by your password, a passkey or the recovery key | A running, unlocked app holds plain data in memory. Malware in your browser session sees what you see |
| A stolen **backup file** (in a cloud drive, an e-mail) | Encrypted backup: Argon2id → AES-256-GCM. Automatic copies are sealed to an X25519 + ML-KEM-768 public key | A weak password is the weak point; a backup in plain form is readable by anyone |
| **Code injected into the page** (XSS, a compromised dependency) | A strict content policy (no inline script, no `eval`, known hosts only) and Trusted Types (no string becomes code) | A dependency that is already in the bundle runs with the app's rights. CI audits dependencies and verifies registry signatures |
| A **compromised or curious server** (your Supabase project) | Encrypt cloud data: every record is sealed on the device before it is sent | The server sees table, id, time and size. The Claude connection, the Orbita bridge and TickTick read on the server and stop working |
| **Harvest now, decrypt later** (recorded ciphertext read by a future quantum computer) | AES-256 and Argon2id are not weakened in practice by quantum attacks. Key transfer and automatic backups use hybrid X25519 + ML-KEM-768 | Only the protocols that use public keys needed this; passwords already ride on symmetric crypto |
| **Guessing a password** offline | Argon2id (32 MiB, 3 passes); a passkey (WebAuthn PRF) has nothing to guess | A short password is still short. Use a phrase |

## What it does not protect against

- A device that is already compromised (keylogger, a malicious extension, a rooted phone).
- Someone who watches you type the password, or who forces you to unlock.
- Deleting the data: the browser may keep the freed blocks on disk until they are overwritten, so a deleted plain database is not securely erased. This is why the safe order is to turn protection on, not to rely on deleting.
- Safari's 7-day rule on iPhone and iPad (data of a site not opened for a week is deleted); install the app to the Home Screen and keep a backup.
- Forgetting everything: there is no back door. Without the password, a passkey and the recovery key, the data is gone by design.

## How the pieces work

**Protect this device** (`src/vault/`). A random 256-bit **data key** encrypts every database row with AES-256-GCM; each sealed row is bound to its table and key (a moved or swapped row is refused). The data key is stored only wrapped: by your password (Argon2id, HKDF), by a **recovery key** shown once, and optionally by **passkeys**, whose secret is computed inside the authenticator (WebAuthn PRF) and never stored. The database itself lives in memory while the app is open; sealed records go to an encrypted journal within about 30 ms of a change and when the app is left. Locking (by hand, after inactivity, after leaving the app) reloads the page, which drops every plain value. One window at a time. What stays visible on disk: that the vault exists, table names, how many rows, their sizes.

**Backups** (`src/data/backupSeal.ts`). A file sealed with a password, or automatic daily copies into a folder you choose, sealed to a public key so that no secret is needed to write one. The matching private key exists only as a passphrase you choose (Argon2id → 96-byte seed → X25519 + ML-KEM-768 key pair).

**Encrypted cloud** (`src/cloud/e2e.ts`). A random cloud key stays on your devices; records are sealed with a key derived from it (HKDF), bound to table and id. Merging happens on the devices after opening. A device without the key reads nothing and sends nothing. A new device receives the key through `src/crypto/pairing.ts`: it shows a hybrid public key as a code with 12 check digits; the old device, after you compare the digits, seals the key to it; the answer opens only on the asker's device. The key can also be re-entered from a recovery key.

**Sync merges** (`src/cloud/merge.ts`). Not a security feature, but data safety: two devices editing different fields lose nothing; a same-field clash keeps the older value in a list (Cloud → Replaced edits).

## Cryptographic choices

| Purpose | Primitive | Why |
|---|---|---|
| Password to key | Argon2id, 32 MiB, 3 passes, 1 lane (`@noble/hashes`, pure JavaScript) | Memory-hard, so offline guessing is expensive; pure JS needs no `wasm-unsafe-eval` |
| Key separation | HKDF-SHA256 with a label per purpose | The key that encrypts is never the key that checks a password |
| Data | AES-256-GCM, 96-bit random IV, purpose and place as additional data | Authenticated, built into the browser |
| Public-key sealing | X25519 + ML-KEM-768, both secrets through one HKDF over every public value | An attacker must break both; ML-KEM is the NIST standard (FIPS 203) |
| Randomness | `crypto.getRandomValues` | |
| Passkeys | WebAuthn PRF extension | The secret never leaves the authenticator |

The libraries are `@noble/hashes`, `@noble/curves` and `@noble/post-quantum`: small, dependency-free and widely reviewed. They are
not audited as products in the way a hardware module is; if your threat model needs that, this is the place to look.

## How this was checked

- Unit tests for every primitive and protocol: tampered bytes, a moved record, a wrong purpose, a swapped header, a swapped pairing code, wrong keys.
- An end-to-end run in Chromium: with protection off every name is readable in IndexedDB; after turning it on, none is, and the plain database is gone; unlocking with the password, the recovery key and a passkey (a virtual authenticator with PRF) brings every person back; turning it off returns the data. It found a real leak while it was being built (a module that read a setting at import opened a plain database first), now covered by a test.
- Trusted Types enforced in Chromium across every screen: no violations; `innerHTML` and foreign script or worker addresses are blocked.

## Known limits, stated plainly

- The vault keeps the database in memory, so very large databases cost memory, and a crash in the first 30 ms after a change can lose that change.
- Two windows cannot share one open vault.
- Not independently audited. Review is welcome (see SECURITY.md).
- Aster does not have its own server: with the cloud on, what you trust is your Supabase project, its access rules (`supabase/migrations/`) and, with encryption on, nothing but your devices.
