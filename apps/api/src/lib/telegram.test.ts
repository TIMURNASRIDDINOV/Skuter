import { describe, expect, it } from 'vitest';
import { parseStartCommand, verifyInitData } from './telegram.js';

const BOT_TOKEN = '12345:TEST_TOKEN_abcdef';

/** Build a correctly signed initData string the way Telegram does. */
async function signedInitData(
  fields: Record<string, string>,
  token = BOT_TOKEN,
): Promise<string> {
  const encoder = new TextEncoder();
  const dataCheckString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const webAppDataKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secret = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(token));
  const secretKey = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(dataCheckString));
  const hash = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function freshFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAF9tRcYAAAAAH21FxjOqLbG',
    user: JSON.stringify({ id: 42, first_name: 'Тимур', last_name: 'Т.' }),
    ...overrides,
  };
}

describe('verifyInitData', () => {
  it('accepts a correctly signed payload and extracts the identity', async () => {
    const initData = await signedInitData(freshFields());
    const identity = await verifyInitData(initData, BOT_TOKEN);
    expect(identity).toEqual({ telegramId: 42, name: 'Тимур Т.' });
  });

  it('rejects a payload signed with a different bot token', async () => {
    const initData = await signedInitData(freshFields(), 'wrong:token');
    expect(await verifyInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const initData = await signedInitData(freshFields());
    const tampered = initData.replace('%22id%22%3A42', '%22id%22%3A43');
    expect(await verifyInitData(tampered, BOT_TOKEN)).toBeNull();
  });

  it('rejects a stale auth_date', async () => {
    const staleS = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    const initData = await signedInitData(freshFields({ auth_date: String(staleS) }));
    expect(await verifyInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it('rejects a payload without a hash', async () => {
    expect(await verifyInitData('auth_date=1&user=%7B%7D', BOT_TOKEN)).toBeNull();
  });
});

describe('parseStartCommand', () => {
  const from = { id: 7, first_name: 'Aziz' };
  const chat = { id: 7 };

  it('extracts the nonce from /start', () => {
    const nonce = 'a'.repeat(43);
    const update = { message: { text: `/start ${nonce}`, chat, from } };
    expect(parseStartCommand(update)).toEqual({
      nonce,
      chatId: 7,
      identity: { telegramId: 7, name: 'Aziz' },
    });
  });

  it('ignores other messages and malformed updates', () => {
    expect(parseStartCommand({ message: { text: 'hello', chat, from } })).toBeNull();
    expect(parseStartCommand({ message: { text: '/start short', chat, from } })).toBeNull();
    expect(parseStartCommand({ callback_query: {} })).toBeNull();
    expect(parseStartCommand(null)).toBeNull();
  });
});
