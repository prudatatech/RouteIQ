import { afterEach, describe, expect, it } from 'vitest';
import { fromAddress } from '../src/services/email.service';

describe('email sender', () => {
  const saved = process.env.EMAIL_FROM;
  afterEach(() => { if (saved === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = saved; });

  it('uses the configured address', () => {
    process.env.EMAIL_FROM = ' MargixIndia <no-reply@mail.margixindia.com> ';
    expect(fromAddress()).toBe('MargixIndia <no-reply@mail.margixindia.com>');
  });
  it('falls back to the Resend test sender when none is set', () => {
    delete process.env.EMAIL_FROM;
    expect(fromAddress()).toContain('onboarding@resend.dev');
  });
});
