import { getServerGoogleAuth } from '../src/lib/serverGoogleAuth';
import { google } from 'googleapis';

async function testMoveOrphan() {
  const authObj = await getServerGoogleAuth();
  const serviceDrive = google.drive({ version: 'v3', auth: authObj.auth });
  const sheets = google.sheets({ version: 'v4', auth: authObj.auth });
  const spreadsheetId = '1H39tuO0E_WLJUtl6ebzH4w3kd76XZa9rMLadwDuxwQs';
  const activeFolderId = '1RZHDhcGEdrEu1S1OJh24Za1qkxfU-1kE';
  const archiveFolderId = '1u3wyWZ9CgYwM2867-mLEBkEwLJ3z6oiY';

  // 1. Get DB files
  const [pengajuanRes, laporanRes, actRes, histRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Pengajuan!N2:O' }).catch(() => ({ data: { values: [] as any[][] } })),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Laporan!F2:G' }).catch(() => ({ data: { values: [] as any[][] } })),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Activity!J2:K' }).catch(() => ({ data: { values: [] as any[][] } })),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'ItemReviewHistory!N2:O' }).catch(() => ({ data: { values: [] as any[][] } }))
  ]);

  const dbFileIdSet = new Set<string>();
  const extract = (val: any) => {
    if (!val) return;
    const str = String(val).trim();
    const m = str.match(/\/d\/([a-zA-Z0-9_-]+)/) || str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    let id = m ? m[1] : (str.length > 20 && !str.startsWith('http') && !str.startsWith('MOCK_') && !str.startsWith('BBM_NOTA_') ? str : null);
    if (id) dbFileIdSet.add(id);
  };
  (pengajuanRes.data.values || []).forEach((r: any[]) => { extract(r[0]); extract(r[1]); });
  (laporanRes.data.values || []).forEach((r: any[]) => { extract(r[0]); extract(r[1]); });
  (actRes.data.values || []).forEach((r: any[]) => { extract(r[0]); extract(r[1]); });
  (histRes.data.values || []).forEach((r: any[]) => { extract(r[0]); extract(r[1]); });

  // 2. Find orphaned files (not in DB, not owned by depotel)
  const listRes: any = await serviceDrive.files.list({
    q: `'${activeFolderId}' in parents and not 'depotel@vgd4.my.id' in owners and mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: 'files(id, name, owners, parents, capabilities)',
    pageSize: 100
  });

  const orphans = (listRes.data.files || []).filter((f: any) => !dbFileIdSet.has(f.id));
  console.log('Total orphans found:', orphans.length);
  if (orphans.length === 0) return;

  const testFile = orphans[0];
  console.log('Testing move for orphan:', testFile);

  try {
    const updateRes = await serviceDrive.files.update({
      fileId: testFile.id,
      addParents: archiveFolderId,
      removeParents: activeFolderId,
      supportsAllDrives: true,
      enforceSingleParent: true
    });
    console.log('Move SUCCESS!', updateRes.data.id);
  } catch (err: any) {
    console.error('Move FAILED with error:', err.response?.data || err.message);
  }
}

testMoveOrphan().catch(console.error);
