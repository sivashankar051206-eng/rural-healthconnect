import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/pool';
import { redis, tryLock } from './redis/client';
import { logger } from './utils/logger';
import { appointmentRepo } from './repositories/appointmentRepo';
import { sessionRepo } from './repositories/sessionRepo';
import { notificationService } from './services/notificationService';

const app = createApp();
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Rural HealthConnect API listening'));
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;

/** Background jobs. A Redis lock ensures only one instance runs each tick. */
async function reminderTick() {
  if (!(await tryLock('job:reminders', 240))) return;
  const due = await appointmentRepo.dueReminders(60);
  for (const a of due) {
    await notificationService.notify(a.patientId, 'appointment.reminder', { when: new Date(a.startsAt).toISOString() }, '/patient/appointments');
  }
}
async function housekeepingTick() {
  if (!(await tryLock('job:housekeeping', 3000))) return;
  await sessionRepo.purgeExpired();
}

const timers = [
  setInterval(() => reminderTick().catch((err) => logger.error({ err }, 'Reminder job failed')), 5 * 60_000),
  setInterval(() => housekeepingTick().catch((err) => logger.error({ err }, 'Housekeeping job failed')), 60 * 60_000),
];

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  timers.forEach(clearInterval);
  server.close(async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
