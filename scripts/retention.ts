/**
 * Daily data-retention job (M13-02). Schedule once a day, e.g. cron:
 *   15 3 * * *  cd /srv/menuniva && npm run retention >> /var/log/menuniva-retention.log 2>&1
 * Erases guest contact data older than each restaurant's retention period and removes expired
 * sessions, tokens, rate-limit buckets and old error logs. Prints counts only (no personal data).
 */
import { db } from '@/server/db';
import { applyRetention } from '@/server/services/privacy';

applyRetention()
  .then((r) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), ...r }));
  })
  .catch((e) => {
    console.error('retention failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
