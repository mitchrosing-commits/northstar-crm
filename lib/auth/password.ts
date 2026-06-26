import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const passwordHashAlgorithm = "scrypt";
const passwordHashVersion = "v1";
const scryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024
} as const;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, scryptOptions.keylen, scryptOptions);
  return [
    passwordHashAlgorithm,
    passwordHashVersion,
    String(scryptOptions.N),
    String(scryptOptions.r),
    String(scryptOptions.p),
    salt.toString("base64url"),
    hash.toString("base64url")
  ].join("$");
}

export function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;

  const [algorithm, version, rawN, rawR, rawP, rawSalt, rawHash] = storedHash.split("$");
  if (algorithm !== passwordHashAlgorithm || version !== passwordHashVersion || !rawSalt || !rawHash) {
    return false;
  }

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return false;
  }

  const salt = Buffer.from(rawSalt, "base64url");
  const expectedHash = Buffer.from(rawHash, "base64url");
  const actualHash = scryptSync(password, salt, expectedHash.length, {
    N,
    r,
    p,
    maxmem: scryptOptions.maxmem
  });

  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}
