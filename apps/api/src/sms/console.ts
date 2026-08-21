import { logInfo } from '../lib/logger.js';
import type { SendSmsInput, SmsGateway, SmsGatewayName } from './provider.js';

/**
 * Local development: the "SMS" goes to the log. The demo never waits on a
 * carrier, and nobody spends provider credit while iterating on the flow.
 */
export class ConsoleSmsGateway implements SmsGateway {
  readonly name: SmsGatewayName = 'console';

  async send({ phone, message }: SendSmsInput): Promise<void> {
    logInfo(`SMS → ${phone}: ${message}`);
  }
}
