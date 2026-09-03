import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { getServerGoogleAuth } from '../../src/lib/serverGoogleAuth.js';
import stream from 'stream';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const authObj = await getServerGoogleAuth();
    if (!authObj) {
      return res.status(503).json({
        success: false,
        error: 'Google Auth tidak dapat memverifikasi token (invalid_grant atau belum dikonfigurasi). Silakan periksa GOOGLE_REFRESH_TOKEN.'
      });
    }

    const { folderId, base64Data, fileName, mimeType } = req.body || {};
    if (!base64Data) {
      return res.status(400).json({
        success: false,
        error: 'Parameter base64Data gambar bukti wajib diisi.'
      });
    }

    const drive = google.drive({ version: 'v3', auth: authObj.auth });

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
      name: fileName || `bukti_${Date.now()}.jpg`
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

      return res.status(200).json({
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
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal mengunggah berkas foto ke Google Drive.'
    });
  }
}

