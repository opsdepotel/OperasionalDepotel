/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { fetchServiceAccountToken } from './serviceAccountClient';

let app: any = null;
let auth: any = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (e) {
  console.error('Firebase initialization error:', e);
}

export { auth };

export const provider = new GoogleAuthProvider();
// Add Google Sheets and Google Drive file scopes
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Initialize auth state listener. Call this on app load.
export const initAuth = async (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // First, check if backend has a configured Google Service Account
  try {
    const saData = await fetchServiceAccountToken();
    if (saData && saData.token) {
      cachedAccessToken = saData.token;
      localStorage.setItem('g_access_token', saData.token);
      localStorage.setItem('g_token_timestamp', Date.now().toString());
      localStorage.setItem('g_is_service_account', 'true');
      
      const saUser = {
        uid: 'service_account',
        email: saData.email || 'service-account@google.iam.gserviceaccount.com',
        displayName: 'Google Service Account (Auto)',
        photoURL: ''
      } as unknown as User;
      
      if (onAuthSuccess) {
        onAuthSuccess(saUser, saData.token);
        return () => {};
      }
    }
  } catch (saErr) {
    console.warn('Service account auto-auth check skipped:', saErr);
  }

  // If we have a stored token, check if it's already expired
  const storedToken = localStorage.getItem('g_access_token');
  if (storedToken) {
    if (isGoogleTokenExpired()) {
      cachedAccessToken = null;
      localStorage.removeItem('g_access_token');
      localStorage.removeItem('g_token_timestamp');
    } else {
      cachedAccessToken = storedToken;
    }
  }

  if (!auth) {
    const backupToken = localStorage.getItem('g_access_token');
    if (backupToken && !isGoogleTokenExpired()) {
      cachedAccessToken = backupToken;
      const storedUserJson = localStorage.getItem('g_google_user');
      let parsedUser: User | null = null;
      if (storedUserJson) {
        try {
          parsedUser = JSON.parse(storedUserJson) as User;
        } catch (e) {
          // ignore
        }
      }
      if (parsedUser && onAuthSuccess) {
        onAuthSuccess(parsedUser, backupToken);
        return () => {};
      }
    }
    if (onAuthFailure) onAuthFailure();
    return () => {};
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken && !isGoogleTokenExpired()) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // If we don't have the cached access token in memory or localStorage,
        // we check if there's any stored token
        const backupToken = localStorage.getItem('g_access_token');
        if (backupToken && !isGoogleTokenExpired()) {
          cachedAccessToken = backupToken;
          if (onAuthSuccess) onAuthSuccess(user, backupToken);
        } else {
          cachedAccessToken = null;
          localStorage.removeItem('g_access_token');
          if (onAuthFailure) onAuthFailure();
        }
      }
    } else {
      // If there's no auth user, but we have a stored token, we can still use it!
      // This is helpful if we want to bypass Google login completely for daily use.
      const backupToken = localStorage.getItem('g_access_token');
      if (backupToken && !isGoogleTokenExpired()) {
        cachedAccessToken = backupToken;
        // Mock a user object or retrieve from localStorage
        const storedUserJson = localStorage.getItem('g_google_user');
        let parsedUser: User | null = null;
        if (storedUserJson) {
          try {
            parsedUser = JSON.parse(storedUserJson) as User;
          } catch (e) {
            // ignore
          }
        }
        if (parsedUser && onAuthSuccess) {
          onAuthSuccess(parsedUser, backupToken);
          return;
        }
      }

      cachedAccessToken = null;
      localStorage.removeItem('g_access_token');
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Must be called from a button click or user interaction
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (!auth) {
    throw new Error('Firebase Auth gagal diinisialisasi. Silakan periksa file konfigurasi Firebase Anda di Settings atau pilih "Mode Demo (Offline)".');
  }
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal mendapatkan token akses dari Google.');
    }

    cachedAccessToken = credential.accessToken;
    const nowTs = Date.now().toString();
    try {
      localStorage.setItem('g_access_token', cachedAccessToken);
      localStorage.setItem('g_token_timestamp', nowTs);
      
      // Serialize some of the user profile so we can restore it offline / on bypass
      const minimalUser = {
        uid: result.user.uid,
        email: result.user.email,
        displayName: result.user.displayName,
        photoURL: result.user.photoURL
      };
      localStorage.setItem('g_google_user', JSON.stringify(minimalUser));
    } catch (storageErr) {
      console.warn('Failed to cache token to localStorage:', storageErr);
    }

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    const isUserCancelled = 
      error?.code === 'auth/popup-closed-by-user' || 
      error?.code === 'auth/cancelled-popup-request' || 
      error?.code === 'auth/popup-blocked' ||
      error?.message?.includes('popup-closed-by-user');

    if (isUserCancelled) {
      console.log('Google sign-in popup was closed/cancelled by user.');
    } else {
      console.error('Sign in error:', error);
    }
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken || localStorage.getItem('g_access_token');
};

/**
 * Checks whether the stored Google OAuth token is expired (older than 55 minutes, as Google tokens expire in 60 minutes)
 */
export const isGoogleTokenExpired = (): boolean => {
  // If running via server-side Service Account, token is managed & auto-renewed by server
  if (localStorage.getItem('g_is_service_account') === 'true') {
    return false;
  }
  const token = localStorage.getItem('g_access_token');
  if (!token) return true;
  const tsStr = localStorage.getItem('g_token_timestamp');
  if (!tsStr) return false; // If no timestamp was recorded, assume valid until an API call fails
  const ts = parseInt(tsStr, 10);
  if (isNaN(ts)) return false;
  // Google OAuth tokens expire in 3600s (60 mins). Flag as expired if older than 55 mins (3300000ms)
  return Date.now() - ts > 3300000;
};

/**
 * Gets the remaining valid time of the current Google OAuth token in minutes (0 to 60)
 */
export const getTokenRemainingMinutes = (): number => {
  const token = localStorage.getItem('g_access_token');
  if (!token) return 0;
  const tsStr = localStorage.getItem('g_token_timestamp');
  if (!tsStr) return 60;
  const ts = parseInt(tsStr, 10);
  if (isNaN(ts)) return 60;
  const elapsedMs = Date.now() - ts;
  const totalMs = 3600000; // 60 minutes
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  return Math.floor(remainingMs / 60000);
};

export const logout = async () => {
  try {
    if (auth) {
      await auth.signOut();
    }
  } catch (e) {
    // Ignore signOut errors if we were not fully logged in to Firebase
  }
  cachedAccessToken = null;
  localStorage.removeItem('g_access_token');
  localStorage.removeItem('g_token_timestamp');
  localStorage.removeItem('g_google_user');
};
