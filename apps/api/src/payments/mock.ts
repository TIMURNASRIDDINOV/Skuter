import type { ChargeResult, PaymentProviderName, Tiyin } from '@ozothunder/shared';
import type { ChargeInput, PaymentProvider } from './provider.js';

/**
 * Always succeeds. There are no real payments in this demo — the client is
 * being shown how the software behaves, not being charged.
 *
 * Deliberately does *not* simulate payment failures: the failure path we want
 * visible in the demo is the 8% unlock failure, and a second unpredictable
 * failure mode would only make the demo flaky.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'mock';

  async charge(input: ChargeInput): Promise<ChargeResult> {
    // A real gateway round-trip is not instant; a little latency keeps the
    // client's loading states honest.
    await new Promise((resolve) => setTimeout(resolve, 120));
    void input;
    return {
      ok: true,
      providerRef: `mock_${crypto.randomUUID()}`,
      status: 'succeeded',
      failureReason: null,
    };
  }

  async refund(providerRef: string, amount: Tiyin): Promise<ChargeResult> {
    void providerRef;
    void amount;
    return {
      ok: true,
      providerRef: `mock_refund_${crypto.randomUUID()}`,
      status: 'refunded',
      failureReason: null,
    };
  }
}
