/**
 * Creates an administrator account interactively. There are NO default or demo
 * admin accounts: run this once after deployment.
 *
 *   docker compose exec backend node dist/scripts/createAdmin.js
 *   (or `npm run create-admin` in development)
 *
 * The admin gets a TOTP secret (scan the otpauth URI in an authenticator app).
 * Permissions default to everything EXCEPT clinical.breakglass; pass --breakglass
 * to grant it explicitly.
 */
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { authenticator } from 'otplib';
import { ADMIN_PERMISSIONS, PASSWORD_MIN } from '../config/constants';
import { pool, withTransaction } from '../db/pool';
import { encrypt } from '../security/crypto';
import { hashPassword } from '../security/password';
import { email as emailSchema } from '../validators/common';

let muted = false;
const out = new Writable({
  write(chunk, enc, cb) {
    if (!muted) process.stdout.write(chunk, enc);
    cb();
  },
});
const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
const ask = (q: string, hidden = false) =>
  new Promise<string>((resolve) => {
    process.stdout.write(q);
    muted = hidden;
    rl.question('', (a) => {
      muted = false;
      if (hidden) process.stdout.write('\n');
      resolve(a.trim());
    });
  });

async function main() {
  const fullName = await ask('Full name: ');
  const emailRaw = await ask('Email: ');
  const email = emailSchema.parse(emailRaw);
  const password = await ask(`Password (min ${PASSWORD_MIN.ADMIN} chars, letters+numbers+symbol): `, true);
  const confirm = await ask('Confirm password: ', true);
  if (password !== confirm) throw new Error('Passwords do not match');
  if (password.length < PASSWORD_MIN.ADMIN || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error('Password does not meet the admin policy');
  }
  const perms = ADMIN_PERMISSIONS.filter((p) => p !== 'clinical.breakglass' || process.argv.includes('--breakglass'));
  const secret = authenticator.generateSecret(20);

  await withTransaction(async (db) => {
    const hash = await hashPassword(password);
    const r = await db.query(
      `INSERT INTO users (role, email, password_hash, full_name, preferred_language, mfa_enabled, mfa_secret_enc)
       VALUES ('ADMIN', $1, $2, $3, 'en', TRUE, $4) RETURNING id`,
      [email, hash, fullName, encrypt(secret)],
    );
    const id = r.rows[0].id as string;
    for (const p of perms) await db.query(`INSERT INTO user_permissions (user_id, permission_code) VALUES ($1, $2)`, [id, p]);
    await db.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id, result, metadata)
       VALUES ($1::uuid, 'ADMIN', 'ADMIN_CREATED_CLI', 'user', $2::text, 'SUCCESS', $3)`,
      [id, id, JSON.stringify({ permissions: perms })],
    );
  });

  const uri = authenticator.keyuri(email, 'Rural HealthConnect', secret);
  process.stdout.write(
    `\nAdmin created with permissions: ${perms.join(', ')}\n` +
      `Add this to your authenticator app NOW (it will not be shown again):\n  ${uri}\n` +
      `Manual key: ${secret}\n`,
  );
}

main()
  .catch((err) => {
    process.stderr.write(`Failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    void pool.end();
  });
