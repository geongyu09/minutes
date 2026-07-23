import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from './crypto';

describe('encryptToken / decryptToken', () => {
  it('암호화한 토큰을 복호화하면 원문이 나온다', () => {
    const stored = encryptToken('secret-access-token');
    expect(decryptToken(stored)).toBe('secret-access-token');
  });

  it('저장 형식은 base64(iv).base64(authTag).base64(ciphertext)다', () => {
    const parts = encryptToken('secret').split('.');
    expect(parts).toHaveLength(3);
    // IV는 GCM 권장 12바이트, authTag는 16바이트
    expect(Buffer.from(parts[0], 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(16);
  });

  it('암호문에 원문이 노출되지 않는다', () => {
    expect(encryptToken('secret-access-token')).not.toContain('secret-access-token');
  });

  it('같은 원문도 매번 다른 암호문이 나온다 (IV 재사용 금지)', () => {
    expect(encryptToken('secret')).not.toBe(encryptToken('secret'));
  });

  it('변조된 암호문은 에러를 던진다 (GCM 인증 태그)', () => {
    const stored = encryptToken('secret');
    const [iv, tag, ciphertext] = stored.split('.');
    const flipped = Buffer.from(ciphertext, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptToken(`${iv}.${tag}.${flipped.toString('base64')}`)).toThrow();
  });

  it('형식이 아닌 값(평문 등)은 에러를 던진다', () => {
    expect(() => decryptToken('plain-legacy-token')).toThrow();
  });
});
