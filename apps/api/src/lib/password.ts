import bcrypt from 'bcryptjs';

/**
 * Password and OTP hashing.
 *
 * bcryptjs rather than argon2: it is pure JavaScript, so there is no native
 * binary to fail installing on a demo machine. For a production deployment,
 * argon2id via @node-rs/argon2 would be the better choice.
 */

const COST = 10;

export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
