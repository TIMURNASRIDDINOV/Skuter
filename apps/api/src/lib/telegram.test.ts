import { describe, expect, it } from 'vitest';
import { normalisePhone, parseSharedContact, parseStartCommand, verifyInitData } from './telegram.js';

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

describe('parseSharedContact', () => {
  const chat = { id: 42 };
  const from = { id: 7, first_name: 'Aziz' };

  const update = (contact: Record<string, unknown>, sender = from) => ({
    message: { chat, from: sender, contact },
  });

  it('accepts a contact the sender shared about themselves', () => {
    const result = parseSharedContact(update({ phone_number: '998901234567', user_id: 7 }));

    expect(result).toEqual({ kind: 'shared', chatId: 42, telegramId: 7, phone: '+998901234567' });
  });

  /**
   * The check this whole flow rests on. Telegram's attachment menu lets anyone
   * forward somebody else's contact card, and it arrives in this same shape —
   * without the user_id comparison a rider could register another person's
   * number and receive their account.
   */
  it('rejects a forwarded contact belonging to somebody else', () => {
    const result = parseSharedContact(update({ phone_number: '998907654321', user_id: 999 }));

    expect(result).toEqual({ kind: 'notOwn', chatId: 42 });
  });

  it('rejects a contact card with no Telegram user behind it', () => {
    const result = parseSharedContact(update({ phone_number: '998907654321' }));

    expect(result).toEqual({ kind: 'notOwn', chatId: 42 });
  });

  it('reports a foreign number distinctly, so the bot can explain itself', () => {
    const result = parseSharedContact(update({ phone_number: '79161234567', user_id: 7 }));

    expect(result).toEqual({ kind: 'unsupportedCountry', chatId: 42 });
  });

  it('ignores updates that carry no contact at all', () => {
    expect(parseSharedContact({ message: { chat, from, text: 'hi' } })).toBeNull();
    expect(parseSharedContact(null)).toBeNull();
  });
});

describe('normalisePhone', () => {
  it.each([
    ['998901234567', '+998901234567'],
    ['+998901234567', '+998901234567'],
    ['+998 90 123 45 67', '+998901234567'],
    // Telegram sometimes omits the country code for local numbers.
    ['901234567', '+998901234567'],
  ])('normalises %j to %j', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it.each(['79161234567', '12025550123', '99890123', ''])('rejects %j', (raw) => {
    expect(normalisePhone(raw)).toBeNull();
  });
});
