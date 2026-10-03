/**
 * Sends an email through Resend when RESEND_API_KEY is set. Without the key
 * nothing is sent and false is returned, so callers treat email as a bonus on
 * top of the in-app notification. Failures are logged, never thrown.
 */
// EMAIL_FROM must be an address on a domain verified in Resend (e.g. "MargixIndia <no-reply@mail.margixindia.com>").
// Until one is set, Resend's shared test sender is used, which only delivers to the Resend account owner.
const TEST_FROM = 'MargixIndia <onboarding@resend.dev>';
export const fromAddress = (): string => process.env.EMAIL_FROM?.trim() || TEST_FROM;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const emailService = {
  isConfigured(): boolean {
    return !!process.env.RESEND_API_KEY;
  },

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || !to) return false;
    try {
      const { Resend } = await import('resend');
      const { error } = await new Resend(apiKey).emails.send({ from: fromAddress(), to, subject, html });
      if (error) {
        console.error('[email] Send failed:', error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[email] Send failed:', e);
      return false;
    }
  },
};
