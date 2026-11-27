import express from 'express';
import { google, drive_v3, sheets_v4 } from 'googleapis';
import stream from 'stream';
import { getServerGoogleAuth, getServiceAccountAuth } from '../lib/serverGoogleAuth.js';
import { readServerConfig } from './expressApp.js';
import { requireFirebaseAuth } from './authMiddleware.js';
import { UserActivity } from '../types.js';

export const activityRouter = express.Router();

const SAFE_GOOGLE_ID_RE = /^[a-zA-Z0-9_-]{10,120}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB decoded limit
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// In-memory idempotency cache (30 min TTL) + in-flight deduplication to prevent duplicate uploads/rows on retries
const IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;
const completedSubmissions = new Map<string, { activity: UserActivity; expiresAt: number }>();
const inFlightSubmissions = new Map<string, Promise<UserActivity>>();

function pruneIdempotencyCache(): void {
  const now = Date.now();
  for (const [key, entry] of completedSubmissions.entries()) {
    if (entry.expiresAt <= now) {
      completedSubmissions.delete(key);
    }
  }
  if (completedSubmissions.size > 500) {
    const excess = completedSubmissions.size - 400;
    let removed = 0;
    for (const key of completedSubmissions.keys()) {
      completedSubmissions.delete(key);
      removed++;
      if (removed >= excess) break;
    }
  }
}

function getTodayJakartaYmd(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value || String(new Date().getFullYear());
    const m = parts.find(p => p.type === 'month')?.value || '01';
    const d = parts.find(p => p.type === 'day')?.value || '01';
    return `${y}-${m}-${d}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function sanitizeFreeTextForSheets(value: unknown, maxLen: number): string {
  const str = String(value ?? '').trim().slice(0, maxLen);
  if (!str) return '';
  // Guard against spreadsheet formula injection on untrusted free-text cells (leave '-' untouched for coordinates/dates)
  if (/^[=+@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function sanitizeSafeFileName(rawName: unknown, fallbackExt = '.jpg'): string {
  const cleaned = String(rawName ?? '')
    .trim()
    .replace(/^.*[\\/]/, '') // strip any directory segments
    .replace(/^\.+/, '') // strip leading dots
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  if (!cleaned) {
    return `ACT_${Date.now()}${fallbackExt}`;
  }
  return cleaned;
}

function parseValidatedPhoto(
  photoBase64: unknown,
  photoFileName: unknown
): { buffer: Buffer; mimeType: string; fileName: string } | null {
  if (!photoBase64 || typeof photoBase64 !== 'string') return null;
  const trimmed = photoBase64.trim();
  if (!trimmed) return null;

  let mimeType = 'image/jpeg';
  let rawBase64 = trimmed;

  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/s);
    if (!match) {
      throw new Error('Format data gambar tidak valid.');
    }
    mimeType = match[1].toLowerCase().trim();
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
    rawBase64 = match[2].trim();
  }

  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw new Error(`Format gambar (${mimeType}) tidak didukung. Gunakan JPEG, PNG, atau WebP.`);
  }

  const buffer = Buffer.from(rawBase64, 'base64');
  if (!buffer || buffer.length === 0) {
    throw new Error('Berkas gambar kosong atau rusak.');
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error('Ukuran berkas foto melebihi batas maksimal 12 MB.');
  }

  const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
  const fileName = sanitizeSafeFileName(photoFileName, ext);

  return { buffer, mimeType, fileName };
}

async function uploadPhotoToDrive(
  primaryAuth: any,
  saAuth: any,
  folderId: string,
  photo: { buffer: Buffer; mimeType: string; fileName: string }
): Promise<{ fileId: string; viewUrl: string; driveClient: drive_v3.Drive }> {
  const attemptUpload = async (
    authClient: any
  ): Promise<{ fileId: string; viewUrl: string; driveClient: drive_v3.Drive }> => {
    const drive = google.drive({ version: 'v3', auth: authClient });
    const metadata: any = { name: photo.fileName };
    if (folderId) {
      metadata.parents = [folderId];
    }

    let createdFile;
    try {
      const s1 = new stream.PassThrough();
      s1.end(photo.buffer);
      createdFile = await drive.files.create({
        requestBody: metadata,
        media: { mimeType: photo.mimeType, body: s1 },
        supportsAllDrives: true,
        fields: 'id, webViewLink'
      });
    } catch (parentErr: any) {
      console.warn('[ActivityAPI] Drive upload with folder failed, trying Drive root:', parentErr?.message || parentErr);
      delete metadata.parents;
      const s2 = new stream.PassThrough();
      s2.end(photo.buffer);
      createdFile = await drive.files.create({
        requestBody: metadata,
        media: { mimeType: photo.mimeType, body: s2 },
        supportsAllDrives: true,
        fields: 'id, webViewLink'
      });
    }

    const fileId = createdFile.data.id || '';
    if (!fileId) {
      throw new Error('Google Drive tidak mengembalikan ID berkas yang valid.');
    }
    const viewUrl = createdFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

    // Best-effort public read permission so reviewers can inspect photo
    try {
      await drive.permissions.create({
        fileId,
        supportsAllDrives: true,
        requestBody: { role: 'reader', type: 'anyone' }
      });
    } catch (permErr: any) {
      console.warn('[ActivityAPI] Could not set public permission on Drive file:', permErr?.message || permErr);
    }

    return { fileId, viewUrl, driveClient: drive };
  };

  try {
    return await attemptUpload(primaryAuth);
  } catch (primaryErr: any) {
    if (saAuth && saAuth !== primaryAuth) {
      console.warn('[ActivityAPI] Primary Drive upload failed, trying Service Account fallback:', primaryErr?.message || primaryErr);
      return await attemptUpload(saAuth);
    }
    throw primaryErr;
  }
}

async function rollbackDriveFile(
  driveClient: drive_v3.Drive | null,
  fileId: string
): Promise<boolean> {
  if (!driveClient || !fileId) return false;
  try {
    await driveClient.files.delete({
      fileId,
      supportsAllDrives: true
    });
    console.log(`[ActivityAPI] Rolled back orphan Drive file ${fileId} after Sheet write failure.`);
    return true;
  } catch (deleteErr: any) {
    console.warn(`[ActivityAPI] Hard delete failed for ${fileId}, attempting trash fallback:`, deleteErr?.message || deleteErr);
    try {
      await driveClient.files.update({
        fileId,
        supportsAllDrives: true,
        requestBody: { trashed: true }
      });
      console.log(`[ActivityAPI] Trashed orphan Drive file ${fileId} after Sheet write failure.`);
      return true;
    } catch (trashErr: any) {
      console.error(`[ActivityAPI] Failed to rollback Drive file ${fileId}:`, trashErr?.message || trashErr);
      return false;
    }
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * POST /api/activities
 * Unified, server-authenticated atomic Activity submission:
 * 1. Verifies user identity from signed session/Firebase token.
 * 2. Pre-verifies Activity sheet availability & generates unique ActivityID BEFORE uploading to Drive.
 * 3. Uploads photo via server Google auth (OAuth -> Service Account fallback).
 * 4. Appends row to Google Sheet Activity!A1:append (with retry & SA fallback).
 * 5. Automatically deletes/trashes uploaded Drive file if Sheet write fails (zero orphan files).
 */
activityRouter.post('/', requireFirebaseAuth, async (req, res) => {
  try {
    const authenticatedEmail = String(req.user?.email || '').trim().toLowerCase();
    if (!authenticatedEmail) {
      return res.status(401).json({
        success: false,
        error: 'Identitas pengguna tidak ditemukan pada sesi login (HTTP 401).'
      });
    }

    const body = req.body || {};
    const serverConfig = readServerConfig();

    const rawSpreadsheetId = typeof body.spreadsheetId === 'string' ? body.spreadsheetId.trim() : '';
    const spreadsheetId = SAFE_GOOGLE_ID_RE.test(rawSpreadsheetId)
      ? rawSpreadsheetId
      : serverConfig.spreadsheetId;

    const rawDriveFolderId = typeof body.driveFolderId === 'string' ? body.driveFolderId.trim() : '';
    const driveFolderId = SAFE_GOOGLE_ID_RE.test(rawDriveFolderId)
      ? rawDriveFolderId
      : serverConfig.driveFolderId;

    // Validate required activity fields
    const rawTanggal = String(body.tanggal || '').trim();
    const tanggal = YMD_RE.test(rawTanggal) ? rawTanggal : getTodayJakartaYmd();

    const siteId = String(body.siteId || '').trim().slice(0, 120);
    if (!siteId) {
      return res.status(400).json({
        success: false,
        error: 'Site ID wajib diisi untuk menyimpan Log Kegiatan Harian.'
      });
    }

    const coordinatesActual = String(body.coordinatesActual || '').trim().slice(0, 100);
    const rawCoordLower = coordinatesActual.toLowerCase();
    const isInvalidGps =
      !rawCoordLower ||
      rawCoordLower.includes('tidak') ||
      rawCoordLower.includes('belum') ||
      rawCoordLower.includes('gagal') ||
      rawCoordLower.includes('error');
    if (isInvalidGps) {
      return res.status(400).json({
        success: false,
        error: 'Data koordinat GPS wajib ada untuk menyimpan Log Kegiatan Harian.'
      });
    }

    const siteName = sanitizeFreeTextForSheets(body.siteName, 250);
    const coordinatesDb = String(body.coordinatesDb || '').trim().slice(0, 100);
    const keterangan = sanitizeFreeTextForSheets(body.keterangan, 2000);
    const jenisKendaraan = String(body.jenisKendaraan || '').trim().slice(0, 80);
    const platNomor = String(body.platNomor || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 20);
    const isBackup: boolean | undefined =
      typeof body.isBackup === 'boolean' ? body.isBackup : undefined;
    const indikasiFake = Boolean(body.indikasiFake);
    const fakeReason = sanitizeFreeTextForSheets(body.fakeReason, 500);

    let parsedPhoto: { buffer: Buffer; mimeType: string; fileName: string } | null = null;
    try {
      parsedPhoto = parseValidatedPhoto(body.photoBase64, body.photoFileName);
    } catch (photoValErr: any) {
      return res.status(400).json({
        success: false,
        error: photoValErr?.message || 'Berkas foto tidak valid.'
      });
    }

    // Idempotency key prevents duplicate Drive files or duplicate Sheet rows on network timeouts/retries
    const rawClientSubId =
      typeof body.clientSubmissionId === 'string' ? body.clientSubmissionId.trim().slice(0, 160) : '';
    const idempotencyKey = rawClientSubId ? `${authenticatedEmail}::${rawClientSubId}` : '';

    if (idempotencyKey) {
      pruneIdempotencyCache();
      const cached = completedSubmissions.get(idempotencyKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json({
          success: true,
          deduplicated: true,
          activity: cached.activity
        });
      }
      const existingFlight = inFlightSubmissions.get(idempotencyKey);
      if (existingFlight) {
        const sharedActivity = await existingFlight;
        return res.json({
          success: true,
          deduplicated: true,
          activity: sharedActivity
        });
      }
    }

    const executeAtomicSave = async (): Promise<UserActivity> => {
      const primaryAuthObj = await getServerGoogleAuth();
      const saAuth = getServiceAccountAuth();

      if (!primaryAuthObj && !saAuth) {
        throw Object.assign(
          new Error('Koneksi database server tidak aktif (Google Auth belum dikonfigurasi).'),
          { statusCode: 503 }
        );
      }

      const primaryAuth = primaryAuthObj ? primaryAuthObj.auth : saAuth;
      let activeSheetsAuth = primaryAuth;
      let sheetsClient: sheets_v4.Sheets = google.sheets({ version: 'v4', auth: activeSheetsAuth });

      // STEP 1: Pre-verify Activity sheet accessibility & fetch existing IDs BEFORE touching Google Drive.
      // If Sheets is down or quota-limited, we fail fast with ZERO orphan files created in Drive.
      let existingIds = new Set<string>();
      try {
        const checkRes = await sheetsClient.spreadsheets.values.get({
          spreadsheetId,
          range: 'Activity!A:A'
        });
        const rows = checkRes.data.values || [];
        for (const row of rows) {
          if (row && row[0]) {
            existingIds.add(String(row[0]).trim().toUpperCase());
          }
        }
      } catch (primaryReadErr: any) {
        if (saAuth && activeSheetsAuth !== saAuth) {
          console.warn(
            '[ActivityAPI] Primary Sheets read failed, switching to Service Account:',
            primaryReadErr?.message || primaryReadErr
          );
          activeSheetsAuth = saAuth;
          sheetsClient = google.sheets({ version: 'v4', auth: saAuth });
          try {
            const checkRes = await sheetsClient.spreadsheets.values.get({
              spreadsheetId,
              range: 'Activity!A:A'
            });
            const rows = checkRes.data.values || [];
            for (const row of rows) {
              if (row && row[0]) {
                existingIds.add(String(row[0]).trim().toUpperCase());
              }
            }
          } catch (saReadErr: any) {
            throw Object.assign(
              new Error(
                `Koneksi database Google Sheet gagal sebelum unggah foto (${saReadErr?.message || 'network error'}).`
              ),
              { statusCode: 503 }
            );
          }
        } else {
          throw Object.assign(
            new Error(
              `Koneksi database Google Sheet gagal sebelum unggah foto (${primaryReadErr?.message || 'network error'}).`
            ),
            { statusCode: 503 }
          );
        }
      }

      // Generate unique ActivityID
      const todayStr = tanggal.replace(/-/g, '');
      let activityId = `ACT-${todayStr}-${Math.floor(1000 + Math.random() * 9000)}`;
      let attempts = 0;
      while (existingIds.has(activityId.toUpperCase()) && attempts < 20) {
        activityId = `ACT-${todayStr}-${Math.floor(1000 + Math.random() * 9000)}`;
        attempts++;
      }
      if (existingIds.has(activityId.toUpperCase())) {
        activityId = `ACT-${todayStr}-${Date.now().toString().slice(-6)}`;
      }

      // STEP 2: Upload photo to Google Drive (only after Sheets pre-check succeeded)
      let finalBuktiUrl = '';
      let finalBuktiFileId = '';
      let uploadedDriveClient: drive_v3.Drive | null = null;

      if (parsedPhoto) {
        try {
          const uploadRes = await uploadPhotoToDrive(primaryAuth, saAuth, driveFolderId, parsedPhoto);
          finalBuktiFileId = uploadRes.fileId;
          finalBuktiUrl = uploadRes.viewUrl;
          uploadedDriveClient = uploadRes.driveClient;
        } catch (upErr: any) {
          throw Object.assign(
            new Error(
              `Gagal mengunggah foto ke Google Drive (koneksi terganggu: ${upErr?.message || 'upload failed'}).`
            ),
            { statusCode: 502 }
          );
        }
      }

      const nowTimestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      const newActivity: UserActivity = {
        id: activityId,
        userEmail: authenticatedEmail,
        tanggal,
        createdAt: nowTimestamp,
        timestamp: nowTimestamp,
        siteId,
        siteName,
        coordinatesDb,
        coordinatesActual,
        keterangan,
        buktiUrl: finalBuktiUrl,
        buktiFileId: finalBuktiFileId || undefined,
        indikasiFake,
        fakeReason,
        jenisKendaraan,
        platNomor,
        isBackup
      };

      // Exact 22-column ACTIVITY_HEADERS order (A..V)
      const rowData = [
        newActivity.id, // A: ActivityID
        newActivity.userEmail, // B: UserEmail
        newActivity.tanggal, // C: Tanggal
        newActivity.createdAt, // D: CreatedAt
        newActivity.siteId, // E: SiteID
        newActivity.siteName, // F: SiteName
        newActivity.coordinatesDb, // G: CoordinatesDb
        newActivity.coordinatesActual, // H: CoordinatesActual
        newActivity.keterangan, // I: Keterangan
        newActivity.buktiUrl, // J: BuktiUrl
        newActivity.buktiFileId || '', // K: BuktiFileId
        newActivity.indikasiFake ? 'TRUE' : 'FALSE', // L: IndikasiFake
        newActivity.fakeReason || '', // M: FakeReason
        '', // N: AiRecaptureVerdict
        '', // O: AiRecaptureConfidence
        '', // P: AiRecaptureSummary
        '', // Q: AiRecaptureIndicators
        '', // R: AiRecaptureCheckedAt
        nowTimestamp, // S: Timestamp
        newActivity.jenisKendaraan || '', // T: JenisKendaraan
        newActivity.platNomor || '', // U: PlatNomor
        newActivity.isBackup === true ? 'TRUE' : newActivity.isBackup === false ? 'FALSE' : '' // V: IsBackup
      ];

      // STEP 3: Append row to Activity Sheet with transient retry & SA fallback
      const appendRowWithClient = async (client: sheets_v4.Sheets) => {
        await client.spreadsheets.values.append({
          spreadsheetId,
          range: 'Activity!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [rowData]
          }
        });
      };

      let sheetWriteSucceeded = false;
      let lastSheetErr: any = null;

      for (let tryNum = 1; tryNum <= 2; tryNum++) {
        try {
          await appendRowWithClient(sheetsClient);
          sheetWriteSucceeded = true;
          break;
        } catch (err: any) {
          lastSheetErr = err;
          console.warn(
            `[ActivityAPI] Sheet append attempt ${tryNum} failed for ${activityId}:`,
            err?.message || err
          );

          // Try switching to Service Account on first failure if available
          if (tryNum === 1 && saAuth && activeSheetsAuth !== saAuth) {
            activeSheetsAuth = saAuth;
            sheetsClient = google.sheets({ version: 'v4', auth: saAuth });
          }
          if (tryNum < 2) {
            await sleep(800);
          }
        }
      }

      // STEP 4: Atomic Rollback — delete/trash uploaded Drive file if Sheet write failed (ZERO orphan files!)
      if (!sheetWriteSucceeded) {
        const rolledBack = finalBuktiFileId
          ? await rollbackDriveFile(uploadedDriveClient, finalBuktiFileId)
          : false;
        throw Object.assign(
          new Error(
            `Gagal menyimpan ke Sheet Activity (koneksi database terganggu: ${lastSheetErr?.message || 'append failed'}).`
          ),
          { statusCode: 502, rolledBackDriveFile: rolledBack }
        );
      }

      return newActivity;
    };

    const runPromise = executeAtomicSave();
    if (idempotencyKey) {
      inFlightSubmissions.set(idempotencyKey, runPromise);
    }

    try {
      const savedActivity = await runPromise;
      if (idempotencyKey) {
        completedSubmissions.set(idempotencyKey, {
          activity: savedActivity,
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
        });
      }
      return res.json({
        success: true,
        activity: savedActivity
      });
    } finally {
      if (idempotencyKey && inFlightSubmissions.get(idempotencyKey) === runPromise) {
        inFlightSubmissions.delete(idempotencyKey);
      }
    }
  } catch (error: any) {
    const statusCode =
      typeof error?.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    console.error('[ActivityAPI] POST /api/activities error:', error?.message || error);
    return res.status(statusCode).json({
      success: false,
      rolledBackDriveFile: Boolean(error?.rolledBackDriveFile),
      error: error?.message || 'Gagal menyimpan Laporan Kegiatan Harian (koneksi terganggu).'
    });
  }
});
