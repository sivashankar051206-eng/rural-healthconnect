import { env, isProduction } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Out-of-band delivery (SMS / email). Integrate your provider here (e.g. an Indian
 * DLT-registered SMS gateway). Messages sent through this service must NEVER
 * contain diagnoses, medicine names or other clinical details (spec §30-31).
 */
async function postJson(url: string, apiKey: string, payload: unknown): Promise<boolean> {
  // Only the operator-configured provider URL is ever called (no user-controlled URLs => no SSRF).
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Messaging provider call failed');
    return false;
  }
}

export const messagingService = {
  async sendSms(to: string, message: string): Promise<boolean> {
    if (env.SMS_API_URL && env.SMS_API_KEY) return postJson(env.SMS_API_URL, env.SMS_API_KEY, { to, message });
    return false;
  },

  async sendEmail(to: string, subject: string, message: string): Promise<boolean> {
    if (env.EMAIL_API_URL && env.EMAIL_API_KEY) return postJson(env.EMAIL_API_URL, env.EMAIL_API_KEY, { to, subject, message });
    return false;
  },

  /** Delivers a one-time code. In local development only, it may be printed if DEV_PRINT_OTP=true. */
  async sendOneTimeCode(target: { email: string | null; mobile: string | null }, code: string): Promise<void> {
    const text = `Rural HealthConnect code: ${code}. Valid for 10 minutes. Do not share it with anyone.`;
    let delivered = false;
    if (target.mobile) delivered = await this.sendSms(target.mobile, text);
    if (!delivered && target.email) delivered = await this.sendEmail(target.email, 'Your verification code', text);
    if (!delivered) {
      if (!isProduction && env.DEV_PRINT_OTP) {
        // eslint-disable-next-line no-console
        console.warn(`[DEV ONLY] one-time code: ${code}`);
      } else {
        logger.warn('No SMS/email provider configured: one-time code could not be delivered');
      }
    }
  },
};
