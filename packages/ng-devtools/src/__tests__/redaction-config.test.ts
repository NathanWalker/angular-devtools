// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isSecretKey, redactReason, setRedaction } from '../forms-privacy.ts';
import { redactUrl } from '../router.ts';
import { loadSummary } from '../analog-runtime.ts';
import { previewOf } from '../analog-server-log.ts';

const page = globalThis as { __NG_DEVTOOLS_FORMS__?: unknown };

afterEach(() => {
  setRedaction();
  delete page.__NG_DEVTOOLS_FORMS__;
});

describe('redaction config', () => {
  it('adds secret names to the built-in list, matched by words', () => {
    expect(isSecretKey('passportNumber')).toBe(false);
    setRedaction({ secretNames: ['passport', 'tax id'] });
    for (const key of ['passport', 'passportNumber', 'user_passports', 'taxId', 'myTaxID']) {
      expect(isSecretKey(key), key).toBe(true);
    }
    for (const key of ['passenger', 'taxi', 'syntax_idx', 'identity']) {
      expect(isSecretKey(key), key).toBe(false);
    }
    expect(isSecretKey('password')).toBe(true);
    expect(redactReason('passportNumber')).toBe('key');
  });

  it('merges unmask with the page config', () => {
    page.__NG_DEVTOOLS_FORMS__ = { unmask: ['pin'] };
    setRedaction({ unmask: ['otp'] });
    expect(redactReason('pin')).toBeNull();
    expect(redactReason('otp')).toBeNull();
    expect(redactReason('password')).toBe('key');
    page.__NG_DEVTOOLS_FORMS__ = { mask: ['city'] };
    expect(redactReason('otp')).toBeNull();
    expect(redactReason('city')).toBe('config');
  });

  it('applies to router URLs and Analog previews', () => {
    setRedaction({ secretNames: ['voucher'] });
    expect(redactUrl('/checkout?voucher=ABC123&step=2')).toBe(
      '/checkout?voucher=[redacted]&step=2',
    );
    expect(loadSummary({ voucherCode: 'ABC123', total: 3 })!.preview).toBe(
      '{"voucherCode":"[redacted]","total":3}',
    );
    expect(previewOf('{"voucher":"ABC123","ok":true}', 'application/json')).toBe(
      '{"voucher":"[redacted]","ok":true}',
    );
  });

  it('goes back to the built-in list when reset', () => {
    setRedaction({ secretNames: ['voucher'], unmask: ['password'] });
    setRedaction();
    expect(isSecretKey('voucher')).toBe(false);
    expect(redactReason('password')).toBe('key');
  });
});
