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
 * Returns overall Google Auth status on the server (OAuth Refresh Token & Service Account).
 */
googleAuthRouter.get('/status', (req, res) => {
  try {
    const status = getGoogleAuthStatus();
    res.json({
      success: true,
      ...status
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
      console.error('Google Drive API upload failed:', driveErr.message || driveErr);
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

    // List all files in source folder with full pagination (Google Drive API returns max 1000 per page)
    let sourceFiles: Array<{ id: string; name: string }> = [];
    try {
      let pageToken: string | undefined = undefined;
      do {
        const listRes: any = await drive.files.list({
          q: `'${sourceFolderId}' in parents and trashed = false`,
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          fields: 'nextPageToken, files(id, name)'
        });
        const batch = (listRes.data.files as any[]) || [];
        sourceFiles.push(...batch);
        pageToken = listRes.data.nextPageToken || undefined;
      } while (pageToken);
    } catch (listErr) {
      console.warn('Could not list files in source folder:', listErr);
    }

    // List all existing files in target backup folder with full pagination
    let existingFilesInBackup: Array<{ id: string; name: string }> = [];
    try {
      let pageToken: string | undefined = undefined;
      do {
        const existingListRes: any = await drive.files.list({
          q: `'${targetBackupFolderId}' in parents and trashed = false`,
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          fields: 'nextPageToken, files(id, name)'
        });
        const batch = (existingListRes.data.files as any[]) || [];
        existingFilesInBackup.push(...batch);
        pageToken = existingListRes.data.nextPageToken || undefined;
      } while (pageToken);
    } catch (existErr) {
      console.warn('Could not list existing files in target backup folder:', existErr);
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

    // Step C: Update Photo Links in the Copied Google Sheet to point to Backup Folder Files
    if (copiedSheetResult && copiedSheetResult.id) {
      try {
        const replacementsToMake: Array<{ masterId: string; backupId: string }> = [];
        for (const sf of sourceFiles) {
          if (sf.name && sf.id) {
            const bId = backupFilesByName.get(sf.name);
            if (bId && bId !== sf.id) {
              replacementsToMake.push({ masterId: sf.id, backupId: bId });
            }
          }
        }

        if (replacementsToMake.length > 0) {
          const sheets = google.sheets({ version: 'v4', auth: authObj.auth });
          const CHUNK_SIZE = 100;
          let totalReplacedOccurrences = 0;

          for (let i = 0; i < replacementsToMake.length; i += CHUNK_SIZE) {
            const chunk = replacementsToMake.slice(i, i + CHUNK_SIZE);
            const requests = chunk.map(r => ({
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
                requestBody: {
                  requests
                }
              });

              const replies = batchRes.data.replies || [];
              for (const reply of replies) {
                if (reply.findReplace?.occurrencesChanged) {
                  totalReplacedOccurrences += reply.findReplace.occurrencesChanged;
                }
              }
            } catch (chunkErr: any) {
              console.warn(`Gagal memperbarui batch link spreadsheet cadangan (${i} - ${i + chunk.length}):`, chunkErr?.message || chunkErr);
            }
          }

          if (totalReplacedOccurrences > 0) {
            details.push(`Sinkronisasi link foto: Berhasil mengalihkan ${totalReplacedOccurrences} tautan foto di Google Sheet cadangan langsung ke Google Drive cadangan.`);
          } else {
            details.push(`Sinkronisasi link foto: ${replacementsToMake.length} pola file dicocokkan, tautan sheet cadangan telah diselaraskan.`);
          }
        } else {
          details.push(`Sinkronisasi link foto: Belum ada file foto cadangan yang cocok atau foto belum disalin sebelumnya.`);
        }
      } catch (linkUpdateErr: any) {
        console.warn('Peringatan: Gagal memperbarui link foto di Google Sheet cadangan:', linkUpdateErr?.message || linkUpdateErr);
        details.push(`Peringatan sinkronisasi link: ${linkUpdateErr?.message || 'Proses update link dilewati'}`);
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


