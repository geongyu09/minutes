import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '@/config';

// 저장 형식: base64(iv).base64(authTag).base64(ciphertext)
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM 권장 IV 길이 — 매 암호화마다 새로 뽑는다 (재사용 시 안전성 붕괴)

function encryptionKey(): Buffer {
  const raw = config.security.tokenEncryptionKey;
  if (!raw) {
    throw new Error('MINUTES_ENCRYPTION_KEY가 설정되지 않았습니다');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('MINUTES_ENCRYPTION_KEY는 32바이트 base64여야 합니다');
  }
  return key;
}

/** 서버 기동 시 호출 — 키 미설정·형식 오류를 조용히 넘기지 않고 기동을 실패시킨다. */
export function assertEncryptionKey(): void {
  encryptionKey();
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64')).join('.');
}

/** 복호화 실패(키 교체·변조·형식 오류)는 삼키지 않고 던진다 — 호출부가 재연결을 유도한다. */
export function decryptToken(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 3) {
    throw new Error('암호화된 토큰 형식이 아닙니다');
  }
  const [iv, authTag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
