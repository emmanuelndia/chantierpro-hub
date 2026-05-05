import { compare, hash } from 'bcrypt';

const BCRYPT_ROUNDS = 10;
const PASSWORD_STRENGTH_PATTERN = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

export function hashPassword(password: string) {
  return hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}

export function isStrongPassword(password: string) {
  return PASSWORD_STRENGTH_PATTERN.test(password);
}
