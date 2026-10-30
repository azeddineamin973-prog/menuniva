import 'server-only';
/**
 * Email delivery status (audit follow-up EXT-04). MenuNiva has NO email sender yet: setting
 * SMTP_URL alone sends nothing. Until a sender is implemented and tested, invitations and password
 * resets are always shown as links on screen for the owner / Super Admin to pass on.
 */
export const EMAIL_DELIVERY_AVAILABLE = false;
