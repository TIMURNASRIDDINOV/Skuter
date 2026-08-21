import { eskizConfig, smsGatewayName } from '../env.js';
import { ConsoleSmsGateway } from './console.js';
import { EskizSmsGateway } from './eskiz.js';
import type { SmsGateway } from './provider.js';

/**
 * The only module that knows which SMS provider is active — same pattern as
 * `src/payments/index.ts` and the vehicle gateway. Everything else takes an
 * `SmsGateway` and programs against the interface.
 */
let instance: SmsGateway | null = null;

export function getSmsGateway(): SmsGateway {
  instance ??=
    smsGatewayName === 'eskiz' && eskizConfig !== null
      ? new EskizSmsGateway(eskizConfig)
      : new ConsoleSmsGateway();
  return instance;
}

export { SmsSendError } from './provider.js';
export type { SendSmsInput, SmsGateway, SmsGatewayName } from './provider.js';
