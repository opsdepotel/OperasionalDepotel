import { getServerAccessToken } from './serverGoogleAuth.js';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1H39tuO0E_WLJUtl6ebzH4w3kd76XZa9rMLadwDuxwQs';

/**
 * Persists or updates the web push subscription directly into Column N (PushSubscriptions)
 * of the Users sheet in Google Spreadsheet.
 */
export async function syncSubscriptionToGoogleSheets(
  email: string,
  subscription: any,
  options?: { userAgent?: string; clientToken?: string }
): Promise<boolean> {
  if (!email || !subscription) return false;

  try {
    let token = options?.clientToken;
    if (!token) {
      const serverTokenRes = await getServerAccessToken();
      token = serverTokenRes.token || undefined;
    }

    if (!token) {
      return false;
    }

    // Fetch existing Users rows
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Users!A1:N`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!res.ok) {
      console.warn('[SyncSubToSheets] Failed to fetch Users sheet:', res.status, res.statusText);
      return false;
    }

    const data = await res.json();
    const rows: string[][] = data.values || [];
    if (rows.length <= 1) return false;

    // Header row
    const headers = rows[0].map(h => String(h).trim().toLowerCase());
    let emailColIdx = headers.indexOf('email');
    if (emailColIdx === -1) emailColIdx = 3;

    // Find row index
    const targetEmail = email.toLowerCase().trim();
    let targetRowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[emailColIdx] && String(row[emailColIdx]).toLowerCase().trim() === targetEmail) {
        targetRowIdx = i + 1; // 1-indexed row number in Google Sheets
        break;
      }
    }

    if (targetRowIdx === -1) {
      console.warn('[SyncSubToSheets] User not found in Users sheet for email:', email);
      return false;
    }

    // Existing subscriptions in Column N (index 13)
    const existingRow = rows[targetRowIdx - 1];
    const existingColN = existingRow[13] || '';

    let subsList: any[] = [];
    if (existingColN) {
      try {
        const parsed = JSON.parse(existingColN);
        if (Array.isArray(parsed)) {
          subsList = parsed;
        } else if (parsed && typeof parsed === 'object') {
          subsList = [parsed];
        }
      } catch {
        // invalid JSON, ignore
      }
    }

    const newEndpoint = subscription.endpoint;
    subsList = subsList.filter(s => s?.endpoint !== newEndpoint);
    subsList.push({
      ...subscription,
      userAgent: options?.userAgent || '',
      updatedAt: new Date().toISOString()
    });

    const subJsonString = JSON.stringify(subsList);

    // Update Column N directly: Users!N{targetRowIdx}
    const updateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Users!N${targetRowIdx}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: [[subJsonString]]
        })
      }
    );

    if (!updateRes.ok) {
      console.warn('[SyncSubToSheets] Failed to update Column N:', updateRes.status, updateRes.statusText);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[SyncSubToSheets] Exception during Google Sheets update:', err);
    return false;
  }
}
