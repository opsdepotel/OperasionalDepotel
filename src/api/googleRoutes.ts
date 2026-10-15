import express from 'express';
import { google } from 'googleapis';
import stream from 'stream';
import {
  getServerGoogleAuth,
  getServerAccessToken,
  getGoogleAuthStatus,
  getServiceAccountAuth,
  getServiceAccountStatus
} from '../lib/serverGoogleAuth.js';

export const googleAuthRouter = express.Router();

/**
 * Returns overall Google Auth status on the server and live verified Google account details.
 */
googleAuthRouter.get('/status', async (req, res) => {
  try {
    const status = getGoogleAuthStatus();
    let verifiedAccount: { email?: string; displayName?: string; photoLink?: string } | null = null;

    try {
      const tokenResult = await getServerAccessToken();
      if (tokenResult.token) {
        const driveRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
          headers: { Authorization: `Bearer ${tokenResult.token}` },
          signal: AbortSignal.timeout(6000)
        });
        if (driveRes.ok) {
          const driveData = await driveRes.json();
          if (driveData?.user) {
            verifiedAccount = {
              email: driveData.user.emailAddress,
              displayName: driveData.user.displayName,
              photoLink: driveData.user.photoLink
            };
          }
        }
      }
    } catch (e) {
      // Non-blocking, fallback to static status
    }

    res.json({
      success: true,
      ...status,
      verifiedAccountEmail: verifiedAccount?.email || status.serviceAccountEmail || null,
      verifiedAccountName: verifiedAccount?.displayName || null,
      verifiedAccountPhoto: verifiedAccount?.photoLink || null
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Gagal memeriksa status Google Auth server.'
    });
  }
});

/**
 * Returns a valid OAuth Access Token from Server Refresh Token or Service Account.
 */
googleAuthRouter.get('/token', async (req, res) => {
  try {
    const tokenResult = await getServerAccessToken();
    if (!tokenResult.token) {
      return res.status(503).json({
        success: false,
        isConfigured: false,
        error: 'Google Auth (Refresh Token / Service Account) belum dikonfigurasi di server environment variables.'
      });
    }

    const status = getGoogleAuthStatus();
    res.json({
      success: true,
      token: tokenResult.token,
      accessToken: tokenResult.token,
      authMode: tokenResult.type,
      serviceAccountEmail: status.serviceAccountEmail
    });
  } catch (error: any) {
    console.error('Error generating Google token:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Gagal menghasilkan token dari Google Auth.'
    });
  }
});

/**
 * Streams photo file binary for cross-account browser migration fallback.
 */
googleAuthRouter.get('/photo-file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId || fileId.includes('/') || fileId.includes('..')) {
      return res.status(400).send('Invalid file ID');
    }

    const authObj = await getServerGoogleAuth();
    if (!authObj) {
      return res.status(500).send('Server Google Auth unavailable');
    }

    const serviceDrive = google.drive({ version: 'v3', auth: authObj.auth });
    
    // Get metadata for content-type
    const meta = await serviceDrive.files.get({
      fileId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true
    }).catch(() => null);

    const streamRes = await serviceDrive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', meta?.data?.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    streamRes.data.pipe(res);
  } catch (err: any) {
    console.warn(`Could not serve photo binary for file ${req.params.fileId}:`, err?.message || err);
    res.status(404).send('Photo not found');
  }
});

/**
 * Generates OAuth Authorization URL for Admin to generate a GOOGLE_REFRESH_TOKEN
 */
googleAuthRouter.get('/oauth-auth-url', (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        error: 'GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET belum dikonfigurasi di Environment Variable.'
      });
    }

    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const redirectUri = `${protocol}://${host}/api/google/oauth-callback`;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    });

    res.json({
      success: true,
      authUrl,
      redirectUri
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Gagal membuat URL Otorisasi OAuth Google.'
    });
  }
});

/**
 * OAuth Callback endpoint to exchange code for Refresh Token
 */
googleAuthRouter.get('/oauth-callback', async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.status(400).send('<h3>Error: Parameter "code" dari Google tidak ditemukan.</h3>');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const redirectUri = `${protocol}://${host}/api/google/oauth-callback`;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    const refreshToken = tokens.refresh_token;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google OAuth Refresh Token Generator</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; padding: 2rem; display: flex; justify-content: center; }
          .card { background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 2rem; max-width: 600px; width: 100%; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          h2 { color: #1e293b; margin-top: 0; }
          .code-box { background: #0f172a; color: #38bdf8; padding: 1rem; border-radius: 8px; font-family: monospace; word-break: break-all; margin: 1rem 0; position: relative; }
          .btn { background: #0284c7; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; font-weight: bold; cursor: pointer; text-decoration: none; display: inline-block; }
          .note { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 1rem; border-radius: 8px; margin-top: 1rem; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>✅ Refresh Token Berhasil Dihasilkan!</h2>
          <p>Salin <strong>GOOGLE_REFRESH_TOKEN</strong> di bawah ini dan tambahkan ke Environment Variable (di Vercel / .env file):</p>
          <div class="code-box" id="tokenBox">${refreshToken || tokens.access_token || 'Refresh Token tidak terbit (Coba hapus akses aplikasi di myaccount.google.com/permissions lalu coba lagi).'}</div>
          <button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('tokenBox').innerText); alert('Refresh Token telah disalin!');">Salin Refresh Token</button>
          
          <div class="note">
            <strong>Langkah Selanjutnya:</strong><br>
            1. Buka Vercel Settings -> Environment Variables (atau file <code>.env</code>).<br>
            2. Set <code>GOOGLE_REFRESH_TOKEN=${refreshToken || ''}</code><br>
            3. Pengunggahan foto ke Google Drive akan berjalan otomatis permanen tanpa 60 menit expired.
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err: any) {
    res.status(500).send(`<h3>Gagal menukar kode otorisasi Google: ${err.message || err}</h3>`);
  }
});

/**
 * Upload file/receipt proxy using Server OAuth (Primary) or Service Account (Secondary) directly to Google Drive.
 */
googleAuthRouter.post('/upload-receipt', async (req, res) => {
  try {
    const authObj = await getServerGoogleAuth();
    if (!authObj) {
      return res.status(503).json({
        success: false,
        error: 'Google Auth tidak dapat memverifikasi token (invalid_grant atau belum dikonfigurasi). Silakan periksa GOOGLE_REFRESH_TOKEN.'
      });
    }

    const { folderId, base64Data, fileName, mimeType } = req.body;
    if (!base64Data) {
      return res.status(400).json({
        success: false,
        error: 'Parameter base64Data gambar bukti wajib diisi.'
      });
    }

    const drive = google.drive({ version: 'v3', auth: authObj.auth });

    // Clean base64 data
    let cleanBase64 = base64Data;
    let actualMime = mimeType || 'image/jpeg';
    if (base64Data.startsWith('data:')) {
      const match = base64Data.match(/:(.*?);/);
      if (match) actualMime = match[1];
      cleanBase64 = base64Data.split(',')[1];
    }

    const buffer = Buffer.from(cleanBase64, 'base64');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const targetFolderId = folderId || '1RZHDhcGEdrEu1S1OJh24Za1qkxfU-1kE';
    const fileMetadata: any = {
      name: fileName || `bukti_${Date.now()}.jpg`,
    };
    if (targetFolderId) {
      fileMetadata.parents = [targetFolderId];
    }

    const fileMedia = {
      mimeType: actualMime,
      body: bufferStream
    };

    let fileId = '';
    let viewUrl = '';

    try {
      let file;
      try {
        file = await drive.files.create({
          requestBody: fileMetadata,
          media: fileMedia,
          supportsAllDrives: true,
          fields: 'id, webViewLink, webContentLink'
        });
      } catch (parentErr: any) {
        console.warn('Upload with parent folder failed, attempting Drive root upload:', parentErr.message || parentErr);
        delete fileMetadata.parents;
        const rootStream = new stream.PassThrough();
        rootStream.end(buffer);
        file = await drive.files.create({
          requestBody: fileMetadata,
          media: { mimeType: actualMime, body: rootStream },
          supportsAllDrives: true,
          fields: 'id, webViewLink, webContentLink'
        });
      }

      fileId = file.data.id || '';
      viewUrl = file.data.webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : '');

      if (fileId) {
        try {
          await drive.permissions.create({
            fileId,
            supportsAllDrives: true,
            requestBody: {
              role: 'reader',
              type: 'anyone'
            }
          });
        } catch (permErr) {
          console.warn('Warning: Could not set public permission on uploaded file:', permErr);
        }
      }

      return res.json({
        success: true,
        fileId,
        viewUrl,
        storageMode: authObj.type
      });
    } catch (driveErr: any) {
      console.warn('Primary Drive API upload failed, attempting Service Account fallback:', driveErr.message || driveErr);

      // Fallback: If primary auth failed (e.g. OAuth missing drive scope or invalid_grant), attempt Service Account
      const saAuth = getServiceAccountAuth();
      if (saAuth) {
        try {
          const saDrive = google.drive({ version: 'v3', auth: saAuth });
          const saMetadata: any = {
            name: fileName || `bukti_${Date.now()}.jpg`,
          };
          if (targetFolderId) {
            saMetadata.parents = [targetFolderId];
          }

          const saBufferStream = new stream.PassThrough();
          saBufferStream.end(buffer);

          let saFile;
          try {
            saFile = await saDrive.files.create({
              requestBody: saMetadata,
              media: { mimeType: actualMime, body: saBufferStream },
              supportsAllDrives: true,
              fields: 'id, webViewLink, webContentLink'
            });
          } catch (saParentErr: any) {
            console.warn('Service Account upload with parent folder failed, attempting Drive root upload:', saParentErr.message || saParentErr);
            delete saMetadata.parents;
            const saRootStream = new stream.PassThrough();
            saRootStream.end(buffer);
            saFile = await saDrive.files.create({
              requestBody: saMetadata,
              media: { mimeType: actualMime, body: saRootStream },
              supportsAllDrives: true,
              fields: 'id, webViewLink, webContentLink'
            });
          }

          const saFileId = saFile.data.id || '';
          const saViewUrl = saFile.data.webViewLink || (saFileId ? `https://drive.google.com/file/d/${saFileId}/view` : '');

          if (saFileId) {
            try {
              await saDrive.permissions.create({
                fileId: saFileId,
                supportsAllDrives: true,
                requestBody: {
                  role: 'reader',
                  type: 'anyone'
                }
              });
            } catch (permErr) {
              console.warn('Warning: Could not set public permission on SA uploaded file:', permErr);
            }
          }

          return res.json({
            success: true,
            fileId: saFileId,
            viewUrl: saViewUrl,
            storageMode: 'service_account'
          });
        } catch (saErr: any) {
          console.error('Service Account fallback upload also failed:', saErr.message || saErr);
        }
      }

      return res.status(500).json({
        success: false,
        error: `Gagal mengunggah foto ke Google Drive: ${driveErr.message || driveErr}`
      });
    }
  } catch (error: any) {
    console.error('Error in /api/google/upload-receipt:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Gagal mengunggah berkas foto ke Google Drive.'
    });
  }
});

interface FolderCacheEntry {
  files: Array<{ id: string; name: string }>;
  timestamp: number;
}
const folderFilesCache = new Map<string, FolderCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

async function getFolderFilesCached(
  drive: any,
  folderId: string,
  forceRefresh = false
): Promise<Array<{ id: string; name: string }>> {
  const now = Date.now();
  const cached = folderFilesCache.get(folderId);
  if (!forceRefresh && cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.files;
  }

  const files: Array<{ id: string; name: string }> = [];
  let pageToken: string | undefined = undefined;
  do {
    const listRes: any = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'nextPageToken, files(id, name)'
    });
    const batch = (listRes.data.files as any[]) || [];
    files.push(...batch);
    pageToken = listRes.data.nextPageToken || undefined;
  } while (pageToken);

  folderFilesCache.set(folderId, {
    files,
    timestamp: now
  });

  return files;
}

/**
 * Backup endpoint to copy Google Sheet database and Photos to Google Drive Cadangan.
 * Target Folder ID: 1_XLMT5VIqctS1EyPlhHs0JzggzT39RZ2
 */
googleAuthRouter.post('/backup', async (req, res) => {
  try {
    let authObj = await getServerGoogleAuth();
    const {
      action = 'run',
      targetBackupFolderId = '1_XLMT5VIqctS1EyPlhHs0JzggzT39RZ2',
      spreadsheetId = '1H39tuO0E_WLJUtl6ebzH4w3kd76XZa9rMLadwDuxwQs',
      sourceFolderId = '1RZHDhcGEdrEu1S1OJh24Za1qkxfU-1kE',
      copySpreadsheet = true,
      copyPhotos = true,
      forceRefresh = false,
      userToken
    } = req.body || {};

    if (!authObj && userToken) {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: userToken });
      authObj = { auth: oauth2Client, type: 'oauth' };
    }

    if (!authObj) {
      return res.status(503).json({
        success: false,
        error: 'Google Auth belum terkonfigurasi di server atau token tidak valid. Silakan hubungkan akun Google Anda.'
      });
    }

    const drive = google.drive({ version: 'v3', auth: authObj.auth });

    // 1. Verify Target Backup Folder accessibility
    let targetFolderName = 'Google Drive Cadangan';
    try {
      const targetFolderRes = await drive.files.get({
        fileId: targetBackupFolderId,
        supportsAllDrives: true,
        fields: 'id, name, mimeType'
      });
      targetFolderName = targetFolderRes.data.name || targetFolderName;
    } catch (folderErr: any) {
      const status = folderErr?.response?.status || folderErr?.status || 403;
      if (status === 401) {
        return res.status(401).json({
          success: false,
          error: `Sesi otorisasi Google telah kedaluwarsa (HTTP 401). Silakan refresh halaman.`
        });
      }
      return res.status(403).json({
        success: false,
        error: `Folder Google Drive cadangan (ID: ${targetBackupFolderId}) tidak dapat diakses atau belum dibagikan. Pastikan folder cadangan sudah dibagikan (Akses Editor) ke akun Google atau Service Account.`
      });
    }

    // 2. Fetch master spreadsheet metadata
    let spreadsheetName = 'Operasional Perusahaan DB';
    try {
      const sheetRes = await drive.files.get({
        fileId: spreadsheetId,
        supportsAllDrives: true,
        fields: 'id, name'
      });
      spreadsheetName = sheetRes.data.name || spreadsheetName;
    } catch (sheetErr) {
      console.warn('Could not read master spreadsheet metadata:', sheetErr);
    }

    // List files in source and target folders only if needed (for scan or when copying photos)
    let sourceFiles: Array<{ id: string; name: string }> = [];
    let existingFilesInBackup: Array<{ id: string; name: string }> = [];

    if (action === 'scan' || copyPhotos) {
      try {
        sourceFiles = await getFolderFilesCached(drive, sourceFolderId, Boolean(forceRefresh));
      } catch (listErr) {
        console.warn('Could not list files in source folder:', listErr);
      }

      try {
        existingFilesInBackup = await getFolderFilesCached(drive, targetBackupFolderId, Boolean(forceRefresh));
      } catch (existErr) {
        console.warn('Could not list existing files in target backup folder:', existErr);
      }
    }

    const existingNamesSet = new Set(existingFilesInBackup.map(f => f.name));
    const newPhotosToCopy = sourceFiles.filter(f => !existingNamesSet.has(f.name));

    // If action is scan, return preview info immediately
    if (action === 'scan') {
      return res.json({
        success: true,
        targetFolderId: targetBackupFolderId,
        targetFolderName,
        spreadsheetId,
        spreadsheetName,
        totalSourcePhotos: sourceFiles.length,
        alreadyInBackupPhotos: sourceFiles.length - newPhotosToCopy.length,
        newPhotosToCopy: newPhotosToCopy.length
      });
    }

    // Execute Backup
    const details: string[] = [];
    let copiedSheetResult: any = null;

    // Step A: Copy Spreadsheet
    if (copySpreadsheet) {
      try {
        const now = new Date();
        const dateTag = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
        const backupSheetTitle = `[BACKUP] ${spreadsheetName} (${dateTag})`;

        const copyRes = await drive.files.copy({
          fileId: spreadsheetId,
          requestBody: {
            name: backupSheetTitle,
            parents: [targetBackupFolderId]
          },
          supportsAllDrives: true,
          fields: 'id, name, webViewLink'
        });

        copiedSheetResult = {
          id: copyRes.data.id,
          name: copyRes.data.name,
          webViewLink: copyRes.data.webViewLink || (copyRes.data.id ? `https://docs.google.com/spreadsheets/d/${copyRes.data.id}/edit` : undefined)
        };
        details.push(`Google Sheet berhasil disalin: ${copyRes.data.name}`);

      } catch (sheetCopyErr: any) {
        console.error('Failed to copy spreadsheet to backup folder:', sheetCopyErr);
        throw new Error(`Gagal menyalin Google Sheet master ke Google Drive cadangan: ${sheetCopyErr.message || sheetCopyErr}`);
      }
    }

    // Step B: Copy Photos
    let copiedPhotosCount = 0;
    let failedPhotosCount = 0;
    const alreadyPresentCount = sourceFiles.length - newPhotosToCopy.length;
    const maxPhotos = req.body?.maxPhotos ? Number(req.body.maxPhotos) : 50;
    const photosToProcess = newPhotosToCopy.slice(0, maxPhotos);
    const remainingToCopy = newPhotosToCopy.length - photosToProcess.length;

    const backupFilesByName = new Map<string, string>();
    for (const bf of existingFilesInBackup) {
      if (bf.name && bf.id && !backupFilesByName.has(bf.name)) {
        backupFilesByName.set(bf.name, bf.id);
      }
    }

    if (copyPhotos && photosToProcess.length > 0) {
      // Process in concurrent chunks of 5 for optimal performance
      const chunkSize = 5;
      for (let i = 0; i < photosToProcess.length; i += chunkSize) {
        const chunk = photosToProcess.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (photo) => {
            try {
              const copiedPhoto = await drive.files.copy({
                fileId: photo.id,
                requestBody: {
                  name: photo.name,
                  parents: [targetBackupFolderId],
                  description: `Salinan cadangan dari berkas ${photo.id}`
                },
                supportsAllDrives: true,
                fields: 'id, name'
              });
              copiedPhotosCount++;
              if (copiedPhoto.data.id && photo.name) {
                backupFilesByName.set(photo.name, copiedPhoto.data.id);
                const targetCache = folderFilesCache.get(targetBackupFolderId);
                if (targetCache && Array.isArray(targetCache.files)) {
                  targetCache.files.push({ id: copiedPhoto.data.id, name: photo.name });
                }
              }
            } catch (photoCopyErr) {
              failedPhotosCount++;
              console.warn(`Gagal menyalin foto ${photo.name}:`, photoCopyErr);
            }
          })
        );
      }
      details.push(
        `Menyalin foto bukti: ${copiedPhotosCount} berhasil, ${alreadyPresentCount} dilewati (sudah ada)${failedPhotosCount > 0 ? `, ${failedPhotosCount} gagal` : ''}.${remainingToCopy > 0 ? ` Masih ada ${remainingToCopy} foto antrean berikutnya.` : ''}`
      );
    } else if (copyPhotos) {
      details.push(`Semua foto bukti (${sourceFiles.length} berkas) sudah lengkap ada di Google Drive cadangan.`);
    }

    // Step C: Update Photo Links in the Copied Google Sheet to point to Backup Folder Files (only for processed photos)
    if (copiedSheetResult && copiedSheetResult.id && photosToProcess.length > 0) {
      try {
        const replacementsToMake: Array<{ masterId: string; backupId: string }> = [];
        for (const sf of photosToProcess) {
          if (sf.name && sf.id) {
            const bId = backupFilesByName.get(sf.name);
            if (bId && bId !== sf.id) {
              replacementsToMake.push({ masterId: sf.id, backupId: bId });
            }
          }
        }

        if (replacementsToMake.length > 0) {
          const sheets = google.sheets({ version: 'v4', auth: authObj.auth });
          const requests = replacementsToMake.slice(0, 100).map(r => ({
            findReplace: {
              find: r.masterId,
              replacement: r.backupId,
              allSheets: true,
              matchCase: true,
              matchEntireCell: false,
              includeFormulas: true
            }
          }));

          try {
            const batchRes = await sheets.spreadsheets.batchUpdate({
              spreadsheetId: copiedSheetResult.id,
              requestBody: { requests }
            });
            let totalReplacedOccurrences = 0;
            const replies = batchRes.data.replies || [];
            for (const reply of replies) {
              if (reply.findReplace?.occurrencesChanged) {
                totalReplacedOccurrences += reply.findReplace.occurrencesChanged;
              }
            }
            if (totalReplacedOccurrences > 0) {
              details.push(`Sinkronisasi link foto: Berhasil mengalihkan ${totalReplacedOccurrences} tautan foto di Google Sheet cadangan langsung ke Google Drive cadangan.`);
            }
          } catch (chunkErr: any) {
            console.warn('Gagal memperbarui batch link spreadsheet cadangan:', chunkErr?.message || chunkErr);
          }
        }
      } catch (linkUpdateErr: any) {
        console.warn('Peringatan: Gagal memperbarui link foto di Google Sheet cadangan:', linkUpdateErr?.message || linkUpdateErr);
      }
    }

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      backupFolderId: targetBackupFolderId,
      backupFolderName: targetFolderName,
      copiedSheet: copiedSheetResult,
      photosSummary: {
        totalSource: sourceFiles.length,
        copied: copiedPhotosCount,
        alreadyPresent: alreadyPresentCount,
        failed: failedPhotosCount,
        remaining: remainingToCopy
      },
      details
    });
  } catch (error: any) {
    console.error('Error in /api/google/backup:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal menjalankan proses backup ke Google Drive cadangan.'
    });
  }
});

/**
 * Route: /api/google/photo-migration
 * Handles scanning Google Drive photo ownership and batch migrating files to depotel@vgd4.my.id.
 */
googleAuthRouter.post('/photo-migration', async (req, res) => {
  try {
    const {
      action = 'scan',
      userToken,
      batchSize = 10,
      activeFolderId = '1RZHDhcGEdrEu1S1OJh24Za1qkxfU-1kE',
      archiveFolderId = '1u3wyWZ9CgYwM2867-mLEBkEwLJ3z6oiY',
      batchMappings = [],
      fileIds = []
    } = req.body || {};

    const authObj = await getServerGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth: authObj.auth });
    const serviceDrive = google.drive({ version: 'v3', auth: authObj.auth });
    const spreadsheetId = '1H39tuO0E_WLJUtl6ebzH4w3kd76XZa9rMLadwDuxwQs';

    // Helper to extract file ID from URL or ID string
    const extractId = (url?: any, fid?: any): string | null => {
      let id = String(fid || '').trim();
      if (!id && url) {
        const m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/) || String(url).match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m) id = m[1];
      }
      return id && !id.startsWith('BBM_NOTA_') && !id.startsWith('MOCK_') && !id.startsWith('http') ? id : null;
    };

    if (action === 'scan') {
      // 1. Fetch 4 sheets in parallel
      const [pengajuanRes, laporanRes, actRes, histRes] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'Pengajuan!N2:O' }).catch(() => ({ data: { values: [] as any[][] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'Laporan!F2:G' }).catch(() => ({ data: { values: [] as any[][] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'Activity!J2:K' }).catch(() => ({ data: { values: [] as any[][] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'ItemReviewHistory!N2:O' }).catch(() => ({ data: { values: [] as any[][] } }))
      ]);

      const dbFileIdSet = new Set<string>();
      (pengajuanRes.data.values || []).forEach((r: any[]) => { const id = extractId(r[0], r[1]); if (id) dbFileIdSet.add(id); });
      (laporanRes.data.values || []).forEach((r: any[]) => { const id = extractId(r[0], r[1]); if (id) dbFileIdSet.add(id); });
      (actRes.data.values || []).forEach((r: any[]) => { const id = extractId(r[0], r[1]); if (id) dbFileIdSet.add(id); });
      (histRes.data.values || []).forEach((r: any[]) => { const id = extractId(r[1], r[0]); if (id) dbFileIdSet.add(id); });

      const dbFileIds = Array.from(dbFileIdSet);

      // 2. Fetch all physical files in active Drive folder NOT owned by depotel@vgd4.my.id
      const nonDepotelFiles: Array<{
        id: string;
        name?: string;
        owners?: Array<{ displayName?: string; emailAddress?: string }>;
        webViewLink?: string;
        createdTime?: string;
        size?: string;
      }> = [];
      let pageToken: string | undefined = undefined;

      try {
        do {
          const listRes: any = await serviceDrive.files.list({
            q: `'${activeFolderId}' in parents and not 'depotel@vgd4.my.id' in owners and mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.spreadsheet' and trashed = false`,
            fields: 'nextPageToken, files(id, name, owners, webViewLink, createdTime, size)',
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
          });
          const fetched = (listRes.data.files || []).filter((f: any) => Boolean(f?.id));
          nonDepotelFiles.push(...fetched);
          pageToken = listRes.data.nextPageToken;
        } while (pageToken);
      } catch (listErr) {
        console.warn('Could not list non-depotel files in active folder:', listErr);
      }

      // Filter: files still in Google Sheets that are NOT owned by depotel@vgd4.my.id (need duplication)
      const nonDepotelDbFiles = nonDepotelFiles.filter(f => dbFileIdSet.has(f.id));
      const nonDepotelDbFileIds = nonDepotelDbFiles.map(f => f.id);

      // Filter: files NOT in Google Sheets and NOT owned by depotel@vgd4.my.id (orphaned files, ready for backup)
      const orphanedFiles = nonDepotelFiles.filter(f => !dbFileIdSet.has(f.id));
      const orphanedFileIds = orphanedFiles.map(f => f.id);

      // Total files already owned by depotel@vgd4.my.id in database
      const migratedDbFilesCount = Math.max(0, dbFileIds.length - nonDepotelDbFileIds.length);

      const orphanedList = orphanedFiles.map(f => ({
        id: f.id,
        name: f.name || `foto_${f.id}.jpg`,
        ownerEmail: f.owners?.[0]?.emailAddress || 'Tidak diketahui',
        ownerName: f.owners?.[0]?.displayName || '',
        webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        createdTime: f.createdTime,
        size: f.size
      }));

      const unmigratedDbList = nonDepotelDbFiles.map(f => ({
        id: f.id,
        name: f.name || `foto_${f.id}.jpg`,
        ownerEmail: f.owners?.[0]?.emailAddress || 'Tidak diketahui',
        ownerName: f.owners?.[0]?.displayName || '',
        webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        createdTime: f.createdTime,
        size: f.size
      }));

      return res.json({
        success: true,
        totalDbFiles: dbFileIds.length,
        dbFileIds: nonDepotelDbFileIds,
        migratedDbFilesCount,
        totalDriveFiles: nonDepotelFiles.length,
        orphanedFileIds,
        orphanedList,
        unmigratedDbList,
        activeFolderId,
        archiveFolderId
      });
    }

    if (action === 'verify-ownership') {
      const [pengajuanRes, laporanRes, actRes, histRes] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'Pengajuan!N2:O' }).catch(() => ({ data: { values: [] as any[][] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'Laporan!F2:G' }).catch(() => ({ data: { values: [] as any[][] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'Activity!J2:K' }).catch(() => ({ data: { values: [] as any[][] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'ItemReviewHistory!N2:O' }).catch(() => ({ data: { values: [] as any[][] } }))
      ]);

      const sheetFileEntries: Array<{ sheet: string; fileId: string }> = [];
      const dbFileIdSet = new Set<string>();

      const extractEntry = (val: any, sheet: string) => {
        if (!val) return;
        const str = String(val).trim();
        const m = str.match(/\/d\/([a-zA-Z0-9_-]+)/) || str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        let id: string | null = null;
        if (m) id = m[1];
        else if (str.length > 20 && !str.startsWith('http') && !str.startsWith('MOCK_') && !str.startsWith('BBM_NOTA_')) {
          id = str;
        }
        if (id) {
          dbFileIdSet.add(id);
          sheetFileEntries.push({ sheet, fileId: id });
        }
      };

      (pengajuanRes.data.values || []).forEach((r: any[]) => { extractEntry(r[0], 'Pengajuan'); extractEntry(r[1], 'Pengajuan'); });
      (laporanRes.data.values || []).forEach((r: any[]) => { extractEntry(r[0], 'Laporan'); extractEntry(r[1], 'Laporan'); });
      (actRes.data.values || []).forEach((r: any[]) => { extractEntry(r[0], 'Activity'); extractEntry(r[1], 'Activity'); });
      (histRes.data.values || []).forEach((r: any[]) => { extractEntry(r[1], 'ItemReviewHistory'); extractEntry(r[0], 'ItemReviewHistory'); });

      // 2. Query ALL files in Drive active folder that are NOT owned by depotel@vgd4.my.id
      const nonDepotelFiles: Array<{
        id: string;
        name?: string;
        owners?: Array<{ displayName?: string; emailAddress?: string }>;
        webViewLink?: string;
        createdTime?: string;
        size?: string;
      }> = [];
      let pageToken: string | undefined = undefined;

      try {
        do {
          const listRes: any = await serviceDrive.files.list({
            q: `'${activeFolderId}' in parents and not 'depotel@vgd4.my.id' in owners and mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.spreadsheet' and trashed = false`,
            fields: 'nextPageToken, files(id, name, owners, webViewLink, createdTime, size)',
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
          });
          const fetched = (listRes.data.files || []).filter((f: any) => Boolean(f?.id));
          nonDepotelFiles.push(...fetched);
          pageToken = listRes.data.nextPageToken;
        } while (pageToken);
      } catch (listErr) {
        console.warn('Could not list non-depotel files in active folder:', listErr);
      }

      const nonDepotelSet = new Set(nonDepotelFiles.map(f => f.id));

      // 3. Cross-check 100% of all Google Sheet links against non-depotel files
      const sheetMatches = sheetFileEntries.filter(e => nonDepotelSet.has(e.fileId));
      const uniqueNonDepotelSheetIds = new Set(sheetMatches.map(e => e.fileId));

      const totalUniqueFiles = dbFileIdSet.size;
      const unmigratedCount = uniqueNonDepotelSheetIds.size;
      const verifiedCount = Math.max(0, totalUniqueFiles - unmigratedCount);
      const percentage = totalUniqueFiles > 0 ? Number(((verifiedCount / totalUniqueFiles) * 100).toFixed(1)) : 100;

      // Detailed itemized lists for administrator inspection
      const orphanedList = nonDepotelFiles
        .filter(f => !dbFileIdSet.has(f.id))
        .map(f => ({
          id: f.id,
          name: f.name || `foto_${f.id}.jpg`,
          ownerEmail: f.owners?.[0]?.emailAddress || 'Tidak diketahui',
          ownerName: f.owners?.[0]?.displayName || '',
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          createdTime: f.createdTime,
          size: f.size
        }));

      const unmigratedDbList = nonDepotelFiles
        .filter(f => dbFileIdSet.has(f.id))
        .map(f => {
          const occ = sheetMatches.filter(m => m.fileId === f.id);
          const sheetsUsed = Array.from(new Set(occ.map(o => o.sheet)));
          return {
            id: f.id,
            name: f.name || `foto_${f.id}.jpg`,
            ownerEmail: f.owners?.[0]?.emailAddress || 'Tidak diketahui',
            ownerName: f.owners?.[0]?.displayName || '',
            webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
            createdTime: f.createdTime,
            size: f.size,
            sheets: sheetsUsed
          };
        });

      return res.json({
        success: true,
        isFullAudit: true,
        database: {
          totalCells: sheetFileEntries.length,
          totalUniqueFiles,
          verifiedFilesCount: verifiedCount,
          unmigratedFilesCount: unmigratedCount,
          percentage,
          unmigratedFileIds: Array.from(uniqueNonDepotelSheetIds),
          sheetBreakdown: {
            Pengajuan: {
              total: sheetFileEntries.filter(e => e.sheet === 'Pengajuan').length,
              unmigrated: sheetMatches.filter(e => e.sheet === 'Pengajuan').length
            },
            Laporan: {
              total: sheetFileEntries.filter(e => e.sheet === 'Laporan').length,
              unmigrated: sheetMatches.filter(e => e.sheet === 'Laporan').length
            },
            Activity: {
              total: sheetFileEntries.filter(e => e.sheet === 'Activity').length,
              unmigrated: sheetMatches.filter(e => e.sheet === 'Activity').length
            },
            ItemReviewHistory: {
              total: sheetFileEntries.filter(e => e.sheet === 'ItemReviewHistory').length,
              unmigrated: sheetMatches.filter(e => e.sheet === 'ItemReviewHistory').length
            }
          }
        },
        folder: {
          nonDepotelTotal: nonDepotelFiles.length,
          nonDepotelInDatabase: unmigratedCount,
          orphanedReadyForBackup: Math.max(0, nonDepotelFiles.length - unmigratedCount)
        },
        orphanedList,
        unmigratedDbList,
        databaseSample: {
          sampled: totalUniqueFiles,
          ownedByDepotel: verifiedCount,
          ownedByOther: unmigratedCount,
          depotelPercentage: Math.round(percentage)
        },
        folderSample: {
          sampled: nonDepotelFiles.length,
          ownedByDepotel: verifiedCount,
          ownedByOther: unmigratedCount,
          depotelPercentage: Math.round(percentage)
        }
      });
    }

    if (action === 'commit-batch') {
      const mappings: Array<{ oldFileId: string; newFileId: string; newWebViewLink: string; fileName?: string }> = batchMappings || [];
      if (mappings.length === 0) {
        return res.json({ success: true, updatedCells: 0, movedFiles: 0, results: [] });
      }

      // Fetch 4 sheets
      const [pengajuanRes, laporanRes, actRes, histRes] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'Pengajuan!N2:O' }).catch(() => ({ data: { values: [] as any[][] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'Laporan!F2:G' }).catch(() => ({ data: { values: [] as any[][] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'Activity!J2:K' }).catch(() => ({ data: { values: [] as any[][] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: 'ItemReviewHistory!N2:O' }).catch(() => ({ data: { values: [] as any[][] } }))
      ]);

      const sheetUpdateRequests: any[] = [];
      const movedResults: any[] = [];

      for (const item of mappings) {
        const { oldFileId, newFileId, newWebViewLink } = item;
        if (!oldFileId || !newFileId) continue;

        // Queue cell updates
        // 1. Pengajuan
        (pengajuanRes.data.values || []).forEach((row: any[], idx: number) => {
          const rowIdx = idx + 2;
          if (row[0]?.includes(oldFileId) || row[1]?.trim() === oldFileId) {
            sheetUpdateRequests.push({
              range: `Pengajuan!N${rowIdx}:O${rowIdx}`,
              values: [[newWebViewLink, newFileId]]
            });
          }
        });

        // 2. Laporan
        (laporanRes.data.values || []).forEach((row: any[], idx: number) => {
          const rowIdx = idx + 2;
          if (row[0]?.includes(oldFileId) || row[1]?.trim() === oldFileId) {
            sheetUpdateRequests.push({
              range: `Laporan!F${rowIdx}:G${rowIdx}`,
              values: [[newWebViewLink, newFileId]]
            });
          }
        });

        // 3. Activity
        (actRes.data.values || []).forEach((row: any[], idx: number) => {
          const rowIdx = idx + 2;
          if (row[0]?.includes(oldFileId) || row[1]?.trim() === oldFileId) {
            sheetUpdateRequests.push({
              range: `Activity!J${rowIdx}:K${rowIdx}`,
              values: [[newWebViewLink, newFileId]]
            });
          }
        });

        // 4. ItemReviewHistory
        (histRes.data.values || []).forEach((row: any[], idx: number) => {
          const rowIdx = idx + 2;
          if (row[1]?.includes(oldFileId) || row[0]?.trim() === oldFileId) {
            sheetUpdateRequests.push({
              range: `ItemReviewHistory!N${rowIdx}:O${rowIdx}`,
              values: [[newFileId, newWebViewLink]]
            });
          }
        });

        // Move old file to archive folder
        let moved = false;
        try {
          await serviceDrive.files.update({
            fileId: oldFileId,
            addParents: archiveFolderId,
            removeParents: activeFolderId,
            supportsAllDrives: true
          });
          moved = true;
        } catch (mvErr) {
          console.warn(`Could not move old file ${oldFileId} to archive folder:`, mvErr);
        }

        movedResults.push({ oldFileId, newFileId, moved });
      }

      // Execute atomic batch update on Google Sheets
      if (sheetUpdateRequests.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: sheetUpdateRequests
          }
        });
      }

      return res.json({
        success: true,
        updatedCells: sheetUpdateRequests.length,
        movedFiles: movedResults.filter(r => r.moved).length,
        results: movedResults
      });
    }

    if (action === 'archive-orphaned') {
      const itemsToMove: string[] = (fileIds || []).slice(0, 50);
      let movedCount = 0;

      // Prioritize userToken (depotel@vgd4.my.id, the activeFolderId owner) for authority to move/remove children
      let driveClient = serviceDrive;
      if (userToken && userToken !== 'mock_demo_token') {
        const userAuth = new google.auth.OAuth2();
        userAuth.setCredentials({ access_token: userToken });
        driveClient = google.drive({ version: 'v3', auth: userAuth });
      }

      for (const fId of itemsToMove) {
        let moved = false;
        // Attempt 1: Move from activeFolderId to archiveFolderId
        try {
          await driveClient.files.update({
            fileId: fId,
            addParents: archiveFolderId,
            removeParents: activeFolderId,
            supportsAllDrives: true,
            enforceSingleParent: true
          });
          moved = true;
        } catch (mErr: any) {
          // Attempt 2: If addParents to archiveFolder fails (cross-domain restrictions on external files),
          // remove the file from activeFolderId directly since depotel@vgd4.my.id owns activeFolderId
          try {
            await driveClient.files.update({
              fileId: fId,
              removeParents: activeFolderId,
              supportsAllDrives: true
            });
            moved = true;
          } catch (rErr: any) {
            console.warn(`Could not move/remove orphaned file ${fId}:`, rErr?.message || mErr?.message);
          }
        }

        if (moved) {
          movedCount++;
        }
      }

      return res.json({
        success: true,
        movedCount,
        remainingCount: Math.max(0, (fileIds || []).length - itemsToMove.length)
      });
    }

    return res.status(400).json({ success: false, error: 'Aksi tidak dikenali.' });
  } catch (err: any) {
    console.error('Error in /api/google/photo-migration:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Gagal memproses migrasi foto.'
    });
  }
});


