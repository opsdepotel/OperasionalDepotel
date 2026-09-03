import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { getServiceAccountAuth } from '../../src/lib/serverGoogleAuth.js';
import stream from 'stream';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const auth = getServiceAccountAuth();
    if (!auth) {
      return res.status(503).json({
        success: false,
        error: 'Google Service Account belum dikonfigurasi.'
      });
    }

    const { folderId, base64Data, fileName, mimeType } = req.body || {};
    if (!base64Data) {
      return res.status(400).json({
        success: false,
        error: 'Parameter base64Data gambar bukti wajib diisi.'
      });
    }

    const drive = google.drive({ version: 'v3', auth });

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

    const fileMetadata: any = {
      name: fileName || `bukti_${Date.now()}.jpg`,
    };
    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    const fileMedia = {
      mimeType: actualMime,
      body: bufferStream
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: fileMedia,
      fields: 'id, webViewLink, webContentLink'
    });

    const fileId = file.data.id;

    try {
      if (fileId) {
        await drive.permissions.create({
          fileId,
          requestBody: {
            role: 'reader',
            type: 'anyone'
          }
        });
      }
    } catch (permErr) {
      console.warn('Warning: Could not set public permission on uploaded file:', permErr);
    }

    return res.status(200).json({
      success: true,
      fileId,
      viewUrl: file.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`
    });
  } catch (error: any) {
    console.error('Error in /api/google/upload-receipt:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal mengunggah berkas foto ke Google Drive.'
    });
  }
}
