/**
 * Google Client-Side OAuth Service (Google Identity Services - GIS)
 * 
 * Provides direct client-side OAuth 2.0 token acquisition without requiring
 * a backend Client Secret. Complies with Google AI Studio constraints where
 * Google Workspace APIs must be client-side only.
 */

import firebaseConfig from '../../firebase-applet-config.json';

const GOOGLE_GSI_URL = 'https://accounts.google.com/gsi/client';
const CLIENT_ID =
  (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
  firebaseConfig?.oAuthClientId ||
  '17397890860-2711psbh5k50qulg8jasqbbosa2qjhse.apps.googleusercontent.com';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid'
].join(' ');

let gsiLoadPromise: Promise<void> | null = null;

export function loadGoogleGsiScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gsiLoadPromise) {
    return gsiLoadPromise;
  }

  gsiLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_GSI_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Gagal memuat Google Identity Services script.')));
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_GSI_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Gagal memuat Google Identity Services script dari Google.'));
    document.head.appendChild(script);
  });

  return gsiLoadPromise;
}

export interface GoogleClientUser {
  email: string;
  name?: string;
  picture?: string;
  sub?: string;
}

export interface GoogleClientAuthResult {
  accessToken: string;
  user: GoogleClientUser;
}

/**
 * Requests an OAuth 2.0 Access Token directly in browser using Google Identity Services.
 * Does NOT require a Client Secret, avoiding Firebase auth/invalid-credential errors.
 */
export async function requestGoogleAccessTokenClientSide(
  loginHint?: string
): Promise<GoogleClientAuthResult> {
  await loadGoogleGsiScript();

  if (!(window as any).google?.accounts?.oauth2) {
    throw new Error('Google Identity Services SDK tidak tersedia di peramban.');
  }

  return new Promise<GoogleClientAuthResult>((resolve, reject) => {
    try {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        hint: loginHint || 'depotel@vgd4.my.id',
        callback: async (tokenResponse: any) => {
          if (!tokenResponse) {
            reject(new Error('Tidak ada respon token dari Google.'));
            return;
          }
          if (tokenResponse.error) {
            reject(new Error(`Google OAuth error: ${tokenResponse.error_description || tokenResponse.error}`));
            return;
          }

          const accessToken = tokenResponse.access_token;
          if (!accessToken) {
            reject(new Error('Akses token kosong dari Google.'));
            return;
          }

          // Fetch user profile from userinfo endpoint
          let userProfile: GoogleClientUser = {
            email: loginHint || 'depotel@vgd4.my.id'
          };

          try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (userInfoRes.ok) {
              const info = await userInfoRes.json();
              userProfile = {
                email: String(info.email || '').toLowerCase().trim(),
                name: info.name,
                picture: info.picture,
                sub: info.sub
              };
            }
          } catch (fetchErr) {
            console.warn('Could not fetch userinfo, using fallback email:', fetchErr);
          }

          // Cache in memory and dispatch update event
          try {
            localStorage.setItem('g_user_oauth_token', accessToken);
            localStorage.setItem(
              'g_google_user',
              JSON.stringify({
                uid: userProfile.sub || 'gis_user',
                email: userProfile.email,
                displayName: userProfile.name || userProfile.email,
                photoURL: userProfile.picture || ''
              })
            );
            window.dispatchEvent(
              new CustomEvent('google_user_token_updated', {
                detail: { token: accessToken, email: userProfile.email }
              })
            );
          } catch {}

          resolve({
            accessToken,
            user: userProfile
          });
        },
        error_callback: (err: any) => {
          reject(new Error(err?.message || 'Dialog otentikasi Google dibatalkan atau ditutup.'));
        }
      });

      // Request token with account selection prompt
      client.requestAccessToken({ prompt: 'select_account' });
    } catch (initErr: any) {
      reject(initErr);
    }
  });
}
