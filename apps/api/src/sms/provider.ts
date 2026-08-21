/**
 * The seam between this application and an SMS provider — same shape as
 * `src/payments/provider.ts` and the vehicle gateway.
 *
 * Two implementations: `ConsoleSmsGateway` (local development, writes the
 * message to the log) and `EskizSmsGateway` (eskiz.uz, the Uzbek provider).
 * Nothing outside `src/sms/` knows which one is active.
 */
export interface SmsGateway {
  readonly name: SmsGatewayName;
  /**
   * Deliver one message. Throws `SmsSendError` when the provider refuses or is
   * unreachable — callers are expected to surface that rather than pretend a
   * code is on its way.
   */
  send(input: SendSmsInput): Promise<void>;
}

export type SmsGatewayName = 'console' | 'eskiz';

export interface SendSmsInput {
  /** E.164, as stored: `+998901234567`. Providers get whatever form they want. */
  phone: string;
  message: string;
}

/** Thrown for any provider-side failure, so callers can branch on one type. */
export class SmsSendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SmsSendError';
  }
}
