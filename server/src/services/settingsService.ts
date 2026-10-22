import { one, rows } from '../db/pool';
import { SETTINGS_SCHEMA, type SettingKey } from '../validators/adminSchemas';

const DEFAULTS: { [K in SettingKey]: unknown } = {
  cancellation_window_hours: 2,
  max_booking_days_ahead: 30,
  consultation_join_early_minutes: 15,
  patient_self_upload_enabled: true,
};

let cache: { at: number; values: Record<string, unknown> } | null = null;
const TTL_MS = 30_000;

export const settingsService = {
  async all(): Promise<Record<SettingKey, unknown>> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.values as Record<SettingKey, unknown>;
    const r = await rows<{ key: string; value: unknown }>(`SELECT key, value FROM system_settings`);
    const values: Record<string, unknown> = { ...DEFAULTS };
    for (const { key, value } of r) {
      if (key in SETTINGS_SCHEMA) {
        const parsed = SETTINGS_SCHEMA[key as SettingKey].safeParse(value);
        if (parsed.success) values[key] = parsed.data;
      }
    }
    cache = { at: Date.now(), values };
    return values as Record<SettingKey, unknown>;
  },

  async number(key: 'cancellation_window_hours' | 'max_booking_days_ahead' | 'consultation_join_early_minutes') {
    return Number((await this.all())[key]);
  },

  async bool(key: 'patient_self_upload_enabled') {
    return Boolean((await this.all())[key]);
  },

  async update(values: Partial<Record<SettingKey, unknown>>, adminId: string): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      await one(
        `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(value), adminId],
      );
    }
    cache = null;
  },
};
