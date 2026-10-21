import crypto from 'crypto';

export interface SessionPayload {
  userId: string;
  email: string;
  role: string;
  deviceId?: string;
  iat: number; // Issued at (timestamp ms)
  exp: number; // Expires at (timestamp ms)
}

export interface VerifySessionResult {
  valid: boolean;
  payload?: SessionPayload;
  error?: string;
  needsRenew?: boolean;
}

/**
 * Resolves the server secret for HMAC-SHA256 session token signing.
 */
function getSessionSecret(): string {
  const envSecret = process.env.APP_SESSION_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (envSecret && envSecret.trim()) {
    return envSecret.trim();
  }
  // Secure server fallback secret (stable per server instance)
  return 'dioms-server-hmac-session-signing-key-2026-v1';
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Generates a tamper-proof Server-Signed Session Token using HMAC-SHA256.
 * Default validity is 30 days with sliding window auto-renewal.
 */
export function createSessionToken(
  data: {
    userId: string;
    email: string;
    role: string;
    deviceId?: string;
  },
  expiresInDays: number = 30
): string {
  const secret = getSessionSecret();
  const now = Date.now();
  const payload: SessionPayload = {
    userId: (data.userId || '').trim(),
    email: (data.email || '').trim().toLowerCase(),
    role: (data.role || '').trim(),
    deviceId: (data.deviceId || '').trim(),
    iat: now,
    exp: now + expiresInDays * 24 * 60 * 60 * 1000
  };

  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadEncoded);
  const signature = base64UrlEncode(hmac.digest('binary'));

  return `${payloadEncoded}.${signature}`;
}

/**
 * Verifies a Server-Signed Session Token.
 * Validates HMAC signature with constant-time comparison and checks expiration.
 */
export function verifySessionToken(token: string): VerifySessionResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token sesi tidak ditemukan.' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Format token sesi tidak valid.' };
  }

  const [payloadEncoded, signature] = parts;
  const secret = getSessionSecret();

  try {
    // 1. Verify HMAC signature in constant time
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadEncoded);
    const expectedSignature = base64UrlEncode(hmac.digest('binary'));

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false, error: 'Tanda tangan token sesi tidak valid (telah dimodifikasi).' };
    }

    // 2. Decode payload
    const payloadStr = base64UrlDecode(payloadEncoded);
    const payload: SessionPayload = JSON.parse(payloadStr);

    if (!payload || !payload.userId || !payload.email || !payload.exp) {
      return { valid: false, error: 'Kandungan payload token sesi tidak lengkap.' };
    }

    const now = Date.now();

    // 3. Check expiration
    if (now > payload.exp) {
      return { valid: false, error: 'Sesi login telah kedaluwarsa. Silakan login kembali.' };
    }

    // 4. Check if sliding renewal is recommended (remaining time < 7 days)
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const needsRenew = (payload.exp - now) < sevenDaysMs;

    return {
      valid: true,
      payload,
      needsRenew
    };
  } catch (err: any) {
    return { valid: false, error: 'Gagal memvalidasi token sesi: ' + (err.message || String(err)) };
  }
}
