import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const ivBytes = 12;
const tokenPayloadVersion = "v1";

type EnvInput = Record<string, string | undefined>;

export class EmailTokenEncryptionKeyError extends Error {
  constructor(message = "EMAIL_TOKEN_ENCRYPTION_KEY is required for email token encryption.") {
    super(message);
    this.name = "EmailTokenEncryptionKeyError";
  }
}

export class EmailTokenDecryptionError extends Error {
  constructor(message = "Encrypted email token payload could not be decrypted.") {
    super(message);
    this.name = "EmailTokenDecryptionError";
  }
}

export function encryptEmailToken(plaintext: unknown, env: EnvInput = process.env) {
  if (typeof plaintext !== "string" || !plaintext) {
    throw new Error("Cannot encrypt an empty email token.");
  }

  const key = deriveEmailTokenEncryptionKey(env);
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(Buffer.from(tokenPayloadVersion));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [tokenPayloadVersion, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptEmailToken(payload: unknown, env: EnvInput = process.env) {
  if (typeof payload !== "string") {
    throw new EmailTokenDecryptionError("Encrypted email token payload is malformed.");
  }
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== tokenPayloadVersion) {
    throw new EmailTokenDecryptionError("Encrypted email token payload is malformed.");
  }

  try {
    const [, iv, tag, ciphertext] = parts;
    const key = deriveEmailTokenEncryptionKey(env);
    const decipher = createDecipheriv(algorithm, key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(tokenPayloadVersion));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof EmailTokenEncryptionKeyError) throw error;
    throw new EmailTokenDecryptionError();
  }
}

export function canUseEmailTokenEncryptionKey(env: EnvInput = process.env) {
  try {
    deriveEmailTokenEncryptionKey(env);
    return true;
  } catch {
    return false;
  }
}

function deriveEmailTokenEncryptionKey(env: EnvInput) {
  const rawKey = env.EMAIL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!rawKey) {
    throw new EmailTokenEncryptionKeyError();
  }

  const source = decodeConfiguredKey(rawKey);
  if (source.length < 32) {
    throw new EmailTokenEncryptionKeyError("EMAIL_TOKEN_ENCRYPTION_KEY must decode to at least 32 bytes.");
  }

  return createHash("sha256").update(source).digest();
}

function decodeConfiguredKey(rawKey: string) {
  if (rawKey.startsWith("hex:")) return Buffer.from(rawKey.slice(4), "hex");
  if (rawKey.startsWith("base64:")) return Buffer.from(rawKey.slice(7), "base64");
  if (rawKey.startsWith("base64url:")) return Buffer.from(rawKey.slice(10), "base64url");
  return Buffer.from(rawKey, "utf8");
}
