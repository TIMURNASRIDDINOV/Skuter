import type { ChargeResult, PaymentProviderName, Tiyin } from '@scoot/shared';

/**
 * The seam between this application and a payment gateway.
 *
 * Only `MockPaymentProvider` exists today. When a real gateway is wired in —
 * Payme, Click or Uzum, all of which are common in Uzbekistan — it implements
 * this interface and nothing outside `src/payments/` changes.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  charge(input: ChargeInput): Promise<ChargeResult>;
  refund(providerRef: string, amount: Tiyin): Promise<ChargeResult>;
}

export interface ChargeInput {
  userId: string;
  /** Amount in tiyin. */
  amount: Tiyin;
  /** Human-readable reason, e.g. "Ride SCOOT-0042" — shown on statements. */
  description: string;
  /** Set for a ride settlement. */
  rideId?: string;
  /** Set for a subscription purchase. */
  subscriptionId?: string;
}
