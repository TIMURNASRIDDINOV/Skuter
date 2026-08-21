import { z } from 'zod';
import { logWarn } from '../lib/logger.js';
import { SmsSendError, type SendSmsInput, type SmsGateway, type SmsGatewayName } from './provider.js';

/**
 * eskiz.uz — the SMS provider behind real rider registration.
 *
 * `fetch` and nothing else, so the same code runs on Node and on Cloudflare
 * Workers; the same constraint `lib/telegram.ts` and `lib/google.ts` respect.
 *
 * Eskiz issues a bearer token that lives 30 days. We cache it in the instance
 * and re-login on a 401 rather than tracking expiry precisely — a Worker
 * isolate is short-lived, so an occasional extra login is cheaper than getting
 * clock arithmetic wrong and hard-failing a sign-in.
 *
 * Two things about this provider that are not obvious from the API:
 *  - Message texts must be **pre-approved by moderation**. An unapproved text
 *    is accepted by the endpoint and then silently dropped by the operator.
 *  - A test-status account may only send Eskiz's own fixed test strings.
 * Both are account state, not code — see docs/deploy.md.
 */

const BASE_URL = 'https://notify.eskiz.uz/api';

const tokenResponseSchema = z.object({
  data: z.object({ token: z.string().min(1) }),
});

/** The send endpoint answers with the queued message's id and its status. */
const sendResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  status: z.string().optional(),
  message: z.string().optional(),
});

export interface EskizConfig {
  email: string;
  password: string;
  /** Sender id ("alpha name"). `4546` is Eskiz's shared default. */
  from: string;
}

export class EskizSmsGateway implements SmsGateway {
  readonly name: SmsGatewayName = 'eskiz';

  #token: string | null = null;
  /** In-flight login, so concurrent sends on a cold isolate log in once. */
  #login: Promise<string> | null = null;

  constructor(private readonly config: EskizConfig) {}

  async send(input: SendSmsInput): Promise<void> {
    const body = new FormData();
    body.set('mobile_phone', toEskizPhone(input.phone));
    body.set('message', input.message);
    body.set('from', this.config.from);

    let response = await this.#post('/message/sms/send', body, await this.#authorize());

    // The cached token outlived its welcome — log in again and retry once.
    if (response.status === 401) {
      this.#token = null;
      response = await this.#post('/message/sms/send', body, await this.#authorize());
    }

    if (!response.ok) {
      throw new SmsSendError(
        `Eskiz refused the message (${response.status}): ${await readBody(response)}`,
      );
    }

    const parsed = sendResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new SmsSendError('Eskiz returned an unrecognised response to a send');
    }

    // Eskiz queues rather than delivers: `waiting` is the success case. Any
    // other status means it will not reach the handset, so treat it as failure
    // — the rider must not be told a code is coming when it is not.
    const status = parsed.data.status ?? 'waiting';
    if (status !== 'waiting' && status !== 'success') {
      throw new SmsSendError(`Eskiz rejected the message: ${status}`);
    }
  }

  /** Cached token, logging in if we do not have one. */
  async #authorize(): Promise<string> {
    if (this.#token !== null) return this.#token;
    this.#login ??= this.#requestToken().finally(() => {
      this.#login = null;
    });
    this.#token = await this.#login;
    return this.#token;
  }

  async #requestToken(): Promise<string> {
    const body = new FormData();
    body.set('email', this.config.email);
    body.set('password', this.config.password);

    const response = await this.#post('/auth/login', body);
    if (!response.ok) {
      throw new SmsSendError(
        `Eskiz login failed (${response.status}) — check ESKIZ_EMAIL and ESKIZ_PASSWORD`,
      );
    }

    const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new SmsSendError('Eskiz login returned no token');
    }
    return parsed.data.data.token;
  }

  async #post(path: string, body: FormData, token?: string): Promise<Response> {
    try {
      return await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        body,
        headers: token === undefined ? undefined : { Authorization: `Bearer ${token}` },
      });
    } catch (cause) {
      throw new SmsSendError(`Could not reach Eskiz at ${path}`, { cause });
    }
  }
}

/** `+998901234567` → `998901234567`. Eskiz rejects the leading `+`. */
function toEskizPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

async function readBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    logWarn('Could not read the Eskiz error body');
    return '<unreadable>';
  }
}
