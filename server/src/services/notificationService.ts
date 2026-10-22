import { pool, type Db } from '../db/pool';
import { notificationRepo } from '../repositories/notificationRepo';
import { messagingService } from './messagingService';
import { logger } from '../utils/logger';

/**
 * Notification types are i18n keys rendered by the client in the user's language.
 * Params must be NON-SENSITIVE (times, doctor display names). Never diagnoses or medicines.
 */
export type NotificationType =
  | 'appointment.requested'
  | 'appointment.new_request'
  | 'appointment.confirmed'
  | 'appointment.rejected'
  | 'appointment.cancelled'
  | 'appointment.reminder'
  | 'consultation.started'
  | 'prescription.available'
  | 'account.verified'
  | 'account.rejected'
  | 'account.deactivated'
  | 'security.password_changed'
  | 'security.admin_record_access';

/** Types that also trigger an SMS with a deliberately generic, non-clinical text. */
const SMS_TYPES = new Set<NotificationType>([
  'appointment.confirmed',
  'appointment.reminder',
  'consultation.started',
  'prescription.available',
  'security.password_changed',
]);
const GENERIC_SMS = 'Rural HealthConnect: You have a new update. Please open the app to see it.';

export const notificationService = {
  async notify(
    userId: string,
    type: NotificationType,
    params: Record<string, string | number> = {},
    link: string | null = null,
    db: Db = pool,
  ): Promise<void> {
    await notificationRepo.insert(db, userId, type, params, link);
    if (SMS_TYPES.has(type)) {
      // Fire-and-forget; SMS content never includes medical details.
      void notificationRepo
        .mobileFor(userId)
        .then((u) => (u?.mobile ? messagingService.sendSms(u.mobile, GENERIC_SMS) : false))
        .catch((err) => logger.warn({ err: (err as Error).message }, 'SMS notification failed'));
    }
  },
};
