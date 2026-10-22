import argon2 from 'argon2';

/** Argon2id with OWASP-recommended minimum parameters (19 MiB, t=2, p=1). */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, OPTIONS);

let dummyHash: Promise<string> | null = null;

/**
 * Verifies a password. When the account does not exist we still run a full
 * Argon2 verification against a dummy hash so response time does not reveal
 * whether the identifier is registered.
 */
export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (!hash) {
    dummyHash ??= argon2.hash('timing-equalisation-dummy-value', OPTIONS);
    await argon2.verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
