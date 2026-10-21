import express from 'express';
import { getServerAccessToken } from '../lib/serverGoogleAuth.js';
import { readServerConfig } from './expressApp.js';
import { Role, UserProfile } from '../types.js';
import { createSessionToken, verifySessionToken } from './sessionToken.js';

export const authRouter = express.Router();

/**
 * Normalizes string for flexible column header matching.
 */
function normalizeHeader(h: string): string {
  return (h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Backend Login Verification Endpoint: /api/auth/login
 * 
 * Verifies credentials directly on the server against Google Sheets (Users tab).
 * This ensures the client browser never receives or stores plaintext passwords
 * or credentials of other user accounts.
 */
authRouter.post('/login', async (req, res) => {
  try {
    const { userId, password, spreadsheetId: customSheetId } = req.body;

    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'User ID wajib diisi.'
      });
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Password wajib diisi.'
      });
    }

    const cleanInputId = userId.trim().toLowerCase();
    const cleanInputPassword = password.trim();

    // 1. Obtain Server Google Access Token (Refresh Token / Service Account)
    const tokenResult = await getServerAccessToken();
    const token = tokenResult.token;
    if (!token) {
      return res.status(503).json({
        success: false,
        error: 'Google Auth token tidak tersedia di server. Pastikan Service Account atau OAuth telah dikonfigurasi.'
      });
    }

    // 2. Resolve Spreadsheet ID
    const config = readServerConfig();
    const spreadsheetId = (customSheetId && typeof customSheetId === 'string' && customSheetId.trim())
      ? customSheetId.trim()
      : config.spreadsheetId;

    // 3. Fetch Users sheet rows from Google Sheets
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A1:Z`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!sheetRes.ok) {
      let errTxt = '';
      try {
        const errJson = await sheetRes.json();
        errTxt = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        errTxt = await sheetRes.text().catch(() => '');
      }
      console.error('[AuthLogin] Error reading Users sheet:', sheetRes.status, errTxt);
      return res.status(502).json({
        success: false,
        error: 'Database operasional Google Sheets sedang tidak dapat dijangkau. Silakan periksa koneksi internet atau hubungi Administrator.'
      });
    }

    const sheetData = await sheetRes.json();
    const values: any[][] = sheetData.values || [];

    if (values.length < 2) {
      return res.status(401).json({
        success: false,
        error: 'Data pengguna tidak ditemukan di database.'
      });
    }

    // Row 0 is headers
    const rawHeaders: string[] = values[0].map(h => String(h || '').trim());
    const headerNorms = rawHeaders.map(normalizeHeader);

    const findCol = (...keywords: string[]) => {
      return headerNorms.findIndex(h => {
        return keywords.some(k => {
          const kNorm = normalizeHeader(k);
          return h === kNorm || h.includes(kNorm);
        });
      });
    };

    const colIdx = {
      userId: findCol('userid', 'user_id', 'uid'),
      password: findCol('password', 'pass', 'katasandi', 'sandi'),
      nama: findCol('nama', 'name'),
      email: findCol('email'),
      role: findCol('role', 'peran', 'jabatan'),
      managerEmail: findCol('manageremail', 'manager_email', 'atasan', 'approver'),
      divisi: findCol('divisi', 'division'),
      subDivisi: findCol('subdivisi', 'subdivision'),
      aksesBBM: findCol('aksesbbm', 'bbm'),
      mobile: findCol('mobile'),
      deviceId: findCol('deviceid', 'device_id'),
      fotoProfile: findCol('fotoprofile', 'fotoprofileurl', 'photo'),
      fotoProfileFileId: findCol('fotoprofilefileid', 'photofileid', 'fileid'),
      pushSubscriptions: findCol('pushsubscriptions', 'pushsubscription', 'subscription')
    };

    // Find user matching cleanInputId (by UserID or Email)
    let foundUser: any = null;

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!row || row.length === 0) continue;

      const rawEmail = (colIdx.email !== -1 && row[colIdx.email] !== undefined ? String(row[colIdx.email]) : '').trim();
      const rawUserId = (colIdx.userId !== -1 && row[colIdx.userId] !== undefined ? String(row[colIdx.userId]) : '').trim();
      const uEmail = rawEmail.toLowerCase();
      const uId = (rawUserId || (rawEmail ? rawEmail.split('@')[0] : '')).toLowerCase();

      if ((uId && uId === cleanInputId) || (uEmail && uEmail === cleanInputId)) {
        // Parse role
        const rawRole = (colIdx.role !== -1 && row[colIdx.role] !== undefined ? String(row[colIdx.role]) : '').trim().toUpperCase();
        let roleVal: Role = Role.USER;
        if (rawRole === 'ADMIN' || rawRole === 'ADMINISTRATOR') {
          roleVal = Role.ADMINISTRATOR;
        } else if (rawRole === 'FINANCE' || rawRole === 'KEUANGAN') {
          roleVal = Role.FINANCE;
        } else if (rawRole === 'MANAGER') {
          roleVal = Role.MANAGER;
        } else if (rawRole === 'DIREKTUR' || rawRole === 'DIRECTOR') {
          roleVal = Role.DIREKTUR;
        }

        const rawPassword = (colIdx.password !== -1 && row[colIdx.password] !== undefined ? String(row[colIdx.password]) : '').trim();

        const rawAksesBBM = colIdx.aksesBBM !== -1 && row[colIdx.aksesBBM] !== undefined ? String(row[colIdx.aksesBBM]).trim().toUpperCase() : '';
        const isAksesBBM = rawAksesBBM === 'TRUE' || rawAksesBBM === 'YA' || rawAksesBBM === '1';

        const rawMobile = colIdx.mobile !== -1 && row[colIdx.mobile] !== undefined ? String(row[colIdx.mobile]).trim().toUpperCase() : '';
        const isMobile = rawMobile === 'TRUE' || rawMobile === 'YA' || rawMobile === '1';

        const rawSubDiv = (colIdx.subDivisi !== -1 && row[colIdx.subDivisi] !== undefined ? String(row[colIdx.subDivisi]) : '').trim();
        const subUpper = rawSubDiv.toUpperCase();
        const cleanSubDiv = (subUpper === 'TRUE' || subUpper === 'FALSE' || subUpper === 'YA' || subUpper === 'TIDAK' || subUpper === '1' || subUpper === '0' || subUpper === 'NULL' || subUpper === 'UNDEFINED' || subUpper === '-') ? '' : rawSubDiv;

        foundUser = {
          userId: rawUserId || (rawEmail ? rawEmail.split('@')[0] : ''),
          storedPassword: rawPassword,
          nama: (colIdx.nama !== -1 && row[colIdx.nama] !== undefined ? String(row[colIdx.nama]) : '').trim(),
          email: rawEmail,
          role: roleVal,
          managerEmail: (colIdx.managerEmail !== -1 && row[colIdx.managerEmail] !== undefined ? String(row[colIdx.managerEmail]) : '').trim(),
          divisi: (colIdx.divisi !== -1 && row[colIdx.divisi] !== undefined ? String(row[colIdx.divisi]) : '').trim(),
          subDivisi: cleanSubDiv,
          aksesBBM: isAksesBBM,
          mobile: isMobile,
          deviceId: (colIdx.deviceId !== -1 && row[colIdx.deviceId] !== undefined ? String(row[colIdx.deviceId]) : '').trim(),
          fotoProfile: (colIdx.fotoProfile !== -1 && row[colIdx.fotoProfile] !== undefined ? String(row[colIdx.fotoProfile]) : '').trim(),
          fotoProfileFileId: (colIdx.fotoProfileFileId !== -1 && row[colIdx.fotoProfileFileId] !== undefined ? String(row[colIdx.fotoProfileFileId]) : '').trim(),
          pushSubscriptions: (colIdx.pushSubscriptions !== -1 && row[colIdx.pushSubscriptions] !== undefined ? String(row[colIdx.pushSubscriptions]) : '').trim()
        };
        break;
      }
    }

    if (!foundUser) {
      return res.status(401).json({
        success: false,
        error: 'User ID atau Password salah. Silakan periksa kembali.'
      });
    }

    // Check Password
    // Rule 1: Menghapus celah default '123456' untuk akun berkata sandi kosong.
    if (!foundUser.storedPassword) {
      return res.status(401).json({
        success: false,
        error: 'Kata sandi untuk akun ini belum diatur. Silakan hubungi Administrator.'
      });
    }

    if (foundUser.storedPassword !== cleanInputPassword) {
      return res.status(401).json({
        success: false,
        error: 'User ID atau Password salah. Silakan periksa kembali.'
      });
    }

    // Password matches! Return ONLY this authenticated user's profile
    // Credentials of other users are never returned to or received by the browser.
    const { storedPassword, ...safeUserProfile } = foundUser;

    // Issue Server-Signed Session Token (HMAC-SHA256, 30 days validity)
    const sessionToken = createSessionToken({
      userId: foundUser.userId,
      email: foundUser.email,
      role: foundUser.role,
      deviceId: foundUser.deviceId
    });

    return res.json({
      success: true,
      sessionToken,
      user: {
        ...safeUserProfile,
        password: cleanInputPassword
      }
    });
  } catch (error: any) {
    console.error('[AuthLogin] Internal error during login:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Terjadi kesalahan sistem di server login.'
    });
  }
});

/**
 * Session Verification Endpoint: /api/auth/verify-session
 * 
 * Verifies the cryptographic signature of the session token and re-syncs the active user profile.
 * Automatically renews the token if within the sliding expiration window (remaining < 7 days).
 */
authRouter.post('/verify-session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.slice(7).trim() : '';
    const sessionToken = req.body.sessionToken || bearerToken;
    const customSheetId = req.body.spreadsheetId;
    const legacyUserId = req.body.legacyUserId;

    if (!sessionToken && !legacyUserId) {
      return res.status(401).json({
        success: false,
        error: 'Token sesi tidak ditemukan.'
      });
    }

    let verifiedPayload: any = null;
    let needsRenewal = false;

    if (sessionToken) {
      const verifyResult = verifySessionToken(sessionToken);
      if (!verifyResult.valid || !verifyResult.payload) {
        return res.status(401).json({
          success: false,
          error: verifyResult.error || 'Sesi login tidak valid atau telah berakhir.'
        });
      }
      verifiedPayload = verifyResult.payload;
      needsRenewal = !!verifyResult.needsRenew;
    }

    const targetId = verifiedPayload ? (verifiedPayload.userId || verifiedPayload.email) : legacyUserId;
    const cleanTargetId = String(targetId || '').trim().toLowerCase();

    // 1. Obtain Server Google Access Token
    const tokenResult = await getServerAccessToken();
    const token = tokenResult.token;
    if (!token) {
      if (verifiedPayload) {
        // If server token temporarily unreachable but token signature is valid, gracefully allow session
        return res.json({
          success: true,
          user: {
            userId: verifiedPayload.userId,
            email: verifiedPayload.email,
            role: verifiedPayload.role,
            deviceId: verifiedPayload.deviceId
          },
          sessionToken
        });
      }
      return res.status(503).json({
        success: false,
        error: 'Koneksi Google Sheets server belum siap.'
      });
    }

    // 2. Resolve Spreadsheet ID
    const config = readServerConfig();
    const spreadsheetId = (customSheetId && typeof customSheetId === 'string' && customSheetId.trim())
      ? customSheetId.trim()
      : config.spreadsheetId;

    // 3. Fetch Users sheet
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A1:Z`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!sheetRes.ok) {
      if (verifiedPayload) {
        return res.json({
          success: true,
          user: {
            userId: verifiedPayload.userId,
            email: verifiedPayload.email,
            role: verifiedPayload.role,
            deviceId: verifiedPayload.deviceId
          },
          sessionToken
        });
      }
      return res.status(502).json({
        success: false,
        error: 'Database operasional Google Sheets sedang tidak dapat dijangkau. Silakan coba beberapa saat lagi.'
      });
    }

    const sheetData = await sheetRes.json();
    const values: any[][] = sheetData.values || [];
    if (values.length < 2) {
      return res.status(401).json({
        success: false,
        error: 'Data pengguna tidak ditemukan di database.'
      });
    }

    const rawHeaders: string[] = values[0].map(h => String(h || '').trim());
    const headerNorms = rawHeaders.map(normalizeHeader);

    const findCol = (...keywords: string[]) => {
      return headerNorms.findIndex(h => {
        return keywords.some(k => {
          const kNorm = normalizeHeader(k);
          return h === kNorm || h.includes(kNorm);
        });
      });
    };

    const colIdx = {
      userId: findCol('userid', 'user_id', 'uid'),
      password: findCol('password', 'pass', 'katasandi', 'sandi'),
      nama: findCol('nama', 'name'),
      email: findCol('email'),
      role: findCol('role', 'peran', 'jabatan'),
      managerEmail: findCol('manageremail', 'manager_email', 'atasan', 'approver'),
      divisi: findCol('divisi', 'division'),
      subDivisi: findCol('subdivisi', 'subdivision'),
      aksesBBM: findCol('aksesbbm', 'bbm'),
      mobile: findCol('mobile'),
      deviceId: findCol('deviceid', 'device_id'),
      fotoProfile: findCol('fotoprofile', 'fotoprofileurl', 'photo'),
      fotoProfileFileId: findCol('fotoprofilefileid', 'photofileid', 'fileid'),
      pushSubscriptions: findCol('pushsubscriptions', 'pushsubscription', 'subscription')
    };

    let foundUser: any = null;
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!row || row.length === 0) continue;

      const rawEmail = (colIdx.email !== -1 && row[colIdx.email] !== undefined ? String(row[colIdx.email]) : '').trim();
      const rawUserId = (colIdx.userId !== -1 && row[colIdx.userId] !== undefined ? String(row[colIdx.userId]) : '').trim();
      const uEmail = rawEmail.toLowerCase();
      const uId = (rawUserId || (rawEmail ? rawEmail.split('@')[0] : '')).toLowerCase();

      if ((uId && uId === cleanTargetId) || (uEmail && uEmail === cleanTargetId)) {
        const rawRole = (colIdx.role !== -1 && row[colIdx.role] !== undefined ? String(row[colIdx.role]) : '').trim().toUpperCase();
        let roleVal: Role = Role.USER;
        if (rawRole === 'ADMIN' || rawRole === 'ADMINISTRATOR') {
          roleVal = Role.ADMINISTRATOR;
        } else if (rawRole === 'FINANCE' || rawRole === 'KEUANGAN') {
          roleVal = Role.FINANCE;
        } else if (rawRole === 'MANAGER') {
          roleVal = Role.MANAGER;
        } else if (rawRole === 'DIREKTUR' || rawRole === 'DIRECTOR') {
          roleVal = Role.DIREKTUR;
        }

        const rawAksesBBM = colIdx.aksesBBM !== -1 && row[colIdx.aksesBBM] !== undefined ? String(row[colIdx.aksesBBM]).trim().toUpperCase() : '';
        const isAksesBBM = rawAksesBBM === 'TRUE' || rawAksesBBM === 'YA' || rawAksesBBM === '1';

        const rawMobile = colIdx.mobile !== -1 && row[colIdx.mobile] !== undefined ? String(row[colIdx.mobile]).trim().toUpperCase() : '';
        const isMobile = rawMobile === 'TRUE' || rawMobile === 'YA' || rawMobile === '1';

        const rawSubDiv = (colIdx.subDivisi !== -1 && row[colIdx.subDivisi] !== undefined ? String(row[colIdx.subDivisi]) : '').trim();
        const subUpper = rawSubDiv.toUpperCase();
        const cleanSubDiv = (subUpper === 'TRUE' || subUpper === 'FALSE' || subUpper === 'YA' || subUpper === 'TIDAK' || subUpper === '1' || subUpper === '0' || subUpper === 'NULL' || subUpper === 'UNDEFINED' || subUpper === '-') ? '' : rawSubDiv;

        foundUser = {
          userId: rawUserId || (rawEmail ? rawEmail.split('@')[0] : ''),
          nama: (colIdx.nama !== -1 && row[colIdx.nama] !== undefined ? String(row[colIdx.nama]) : '').trim(),
          email: rawEmail,
          role: roleVal,
          managerEmail: (colIdx.managerEmail !== -1 && row[colIdx.managerEmail] !== undefined ? String(row[colIdx.managerEmail]) : '').trim(),
          divisi: (colIdx.divisi !== -1 && row[colIdx.divisi] !== undefined ? String(row[colIdx.divisi]) : '').trim(),
          subDivisi: cleanSubDiv,
          aksesBBM: isAksesBBM,
          mobile: isMobile,
          deviceId: (colIdx.deviceId !== -1 && row[colIdx.deviceId] !== undefined ? String(row[colIdx.deviceId]) : '').trim(),
          fotoProfile: (colIdx.fotoProfile !== -1 && row[colIdx.fotoProfile] !== undefined ? String(row[colIdx.fotoProfile]) : '').trim(),
          fotoProfileFileId: (colIdx.fotoProfileFileId !== -1 && row[colIdx.fotoProfileFileId] !== undefined ? String(row[colIdx.fotoProfileFileId]) : '').trim(),
          pushSubscriptions: (colIdx.pushSubscriptions !== -1 && row[colIdx.pushSubscriptions] !== undefined ? String(row[colIdx.pushSubscriptions]) : '').trim(),
          password: ''
        };
        break;
      }
    }

    if (!foundUser) {
      return res.status(401).json({
        success: false,
        error: 'Akun pengguna tidak ditemukan di database.'
      });
    }

    // Auto-renew token if sliding window reached or if one-time legacy migration
    let currentTokenStr = sessionToken;
    if (needsRenewal || !currentTokenStr) {
      currentTokenStr = createSessionToken({
        userId: foundUser.userId,
        email: foundUser.email,
        role: foundUser.role,
        deviceId: foundUser.deviceId
      });
    }

    return res.json({
      success: true,
      user: foundUser,
      sessionToken: currentTokenStr
    });
  } catch (error: any) {
    console.error('[VerifySession] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal memverifikasi sesi.'
    });
  }
});
