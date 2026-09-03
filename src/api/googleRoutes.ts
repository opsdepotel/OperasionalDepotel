import express from 'express';
import { google } from 'googleapis';
import { getServiceAccountAuth, getServiceAccountAccessToken, getServiceAccountStatus } from '../lib/serverGoogleAuth.js';

export const googleAuthRouter = express.Router();

/**
 * Returns the status of Google Service Account on the server.
 */
googleAuthRouter.get('/status', (req, res) => {
  try {
    const status = getServiceAccountStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Gagal memeriksa status Service Account'
    });
  }
});

/**
 * Returns a valid OAuth Access Token from Service Account to use for Sheets/Drive API requests.
 */
googleAuthRouter.get('/token', async (req, res) => {
  try {
    const token = await getServiceAccountAccessToken();
    if (!token) {
      return res.status(503).json({
        success: false,
        isConfigured: false,
        error: 'Google Service Account belum dikonfigurasi di server environment variable.'
      });
    }

    const status = getServiceAccountStatus();
    res.json({
      success: true,
      accessToken: token,
      serviceAccountEmail: status.serviceAccountEmail
    });
  } catch (error: any) {
    console.error('Error generating Google token from service account:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Gagal menghasilkan token dari Service Account.'
    });
  }
});

/**
 * Upload file/receipt proxy using Service Account directly to Google Drive.
 */
googleAuthRouter.post('/upload-receipt', async (req, res) => {
  try {
    const auth = getServiceAccountAuth();
    if (!auth) {
      return res.status(503).json({
        success: false,
        error: 'Google Service Account belum dikonfigurasi.'
      });
    }

    const { folderId, base64Data, fileName, mimeType } = req.body;
    if (!base64Data) {
      return res.status(400).json({
        success: false,
        error: 'Parameter base64Data gambar bukti wajib diisi.'
      });
    }

    const drive = google.drive({ version: 'v3', auth });

    // Clean base64 data
    let cleanBase64 = base64Data;
    let actualMime = mimeType || 'image/jpeg';
    if (base64Data.startsWith('data:')) {
      const match = base64Data.match(/:(.*?);/);
      if (match) actualMime = match[1];
      cleanBase64 = base64Data.split(',')[1];
    }

    const buffer = Buffer.from(cleanBase64, 'base64');
    const stream = require('stream');
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

    // Grant public read permission to anyone with link
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

    res.json({
      success: true,
      fileId,
      viewUrl: file.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`
    });
  } catch (error: any) {
    console.error('Error in /api/google/upload-receipt:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Gagal mengunggah berkas foto ke Google Drive.'
    });
  }
});
