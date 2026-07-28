import { MockPaymentProvider } from './mock.js';
import type { PaymentProvider } from './provider.js';

/**
 * The only module that knows which payment provider is active — same pattern
 * as the vehicle gateway. Everything else takes a `PaymentProvider`.
 */
let instance: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  instance ??= new MockPaymentProvider();
  return instance;
}

export type { ChargeInput, PaymentProvider } from './provider.js';
