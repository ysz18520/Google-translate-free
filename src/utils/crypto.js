const crypto = require('crypto');

const SECRET = process.env.TRANSLATION_KEY_SECRET;

if (!SECRET) {
  console.warn('[Crypto] TRANSLATION_KEY_SECRET not set, using fallback (not recommended for production)');
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret) {
  const key = crypto.createHash('sha256').update(secret || 'fallback-secret').digest();
  return key.slice(0, KEY_LENGTH);
}

function encrypt(text) {
  if (!text) return null;
  try {
    const key = deriveKey(SECRET);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const result = Buffer.concat([iv, authTag, encrypted]).toString('base64');
    return result;
  } catch (e) {
    console.error('[Crypto] Encrypt failed:', e.message);
    return null;
  }
}

function decrypt(encryptedBase64) {
  if (!encryptedBase64) return null;
  try {
    const key = deriveKey(SECRET);
    const buffer = Buffer.from(encryptedBase64, 'base64');
    const iv = buffer.slice(0, IV_LENGTH);
    const authTag = buffer.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = buffer.slice(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    console.error('[Crypto] Decrypt failed:', e.message);
    return null;
  }
}

module.exports = { encrypt, decrypt };
