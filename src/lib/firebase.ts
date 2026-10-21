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
// Add Google Sheets and Google Drive scopes
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;
// In-Memory Token Storage: Tokens are held purely in memory to prevent XSS exposure via localStorage
let cachedAccessToken: string | null = null;
let cachedTokenTimestamp: number | null = null;

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
      cachedTokenTimestamp = Date.now();

      // Clean up legacy localStorage tokens
      try {
        localStorage.removeItem('g_access_token');
        localStorage.removeItem('g_token_timestamp');
        localStorage.removeItem('g_is_service_account');
        localStorage.removeItem('g_user_oauth_token');
      } catch {}

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

  // Check in-memory token status
  if (cachedAccessToken && isGoogleTokenExpired()) {
    cachedAccessToken = null;
    cachedTokenTimestamp = null;
  }

  if (!auth) {
    if (cachedAccessToken && !isGoogleTokenExpired()) {
      const storedUserJson = localStorage.getItem('g_google_user');
      let parsedUser: User | null = null;
      if (storedUserJson) {
        try {
          parsedUser = JSON.parse(storedUserJson) as User;
        } catch (e) {}
      }
      if (parsedUser && onAuthSuccess) {
        onAuthSuccess(parsedUser, cachedAccessToken);
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
        // Silently fetch fresh Service Account token into memory
        try {
          const freshSa = await fetchServiceAccountToken(true);
          if (freshSa && freshSa.token) {
            cachedAccessToken = freshSa.token;
            cachedTokenTimestamp = Date.now();
            if (onAuthSuccess) onAuthSuccess(user, freshSa.token);
            return;
          }
        } catch {}
        cachedAccessToken = null;
        cachedTokenTimestamp = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      if (cachedAccessToken && !isGoogleTokenExpired()) {
        const storedUserJson = localStorage.getItem('g_google_user');
        let parsedUser: User | null = null;
        if (storedUserJson) {
          try {
            parsedUser = JSON.parse(storedUserJson) as User;
          } catch (e) {}
        }
        if (parsedUser && onAuthSuccess) {
          onAuthSuccess(parsedUser, cachedAccessToken);
          return;
        }
      }

      cachedAccessToken = null;
      cachedTokenTimestamp = null;
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
    cachedTokenTimestamp = Date.now();
    try {
      localStorage.removeItem('g_access_token');
      localStorage.removeItem('g_user_oauth_token');
      localStorage.removeItem('g_token_timestamp');
      localStorage.removeItem('g_is_service_account');
      window.dispatchEvent(new CustomEvent('google_user_token_updated', {
        detail: { token: cachedAccessToken, email: result.user.email }
      }));
      
      // Serialize minimal user profile for offline UI display
      const minimalUser = {
        uid: result.user.uid,
        email: result.user.email,
        displayName: result.user.displayName,
        photoURL: result.user.photoURL
      };
      localStorage.setItem('g_google_user', JSON.stringify(minimalUser));
    } catch (storageErr) {
      console.warn('Failed to clean token storage:', storageErr);
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
  if (cachedAccessToken && !isGoogleTokenExpired()) {
    return cachedAccessToken;
  }
  // If not present in memory or expired, silently refresh from Service Account
  try {
    const sa = await fetchServiceAccountToken(true);
    if (sa && sa.token) {
      cachedAccessToken = sa.token;
      cachedTokenTimestamp = Date.now();
      return cachedAccessToken;
    }
  } catch {}
  return cachedAccessToken;
};

export const getFirebaseIdToken = async (forceRefresh = false): Promise<string | null> => {
  try {
    if (auth && auth.currentUser) {
      return await auth.currentUser.getIdToken(forceRefresh);
    }
  } catch (e) {
    console.warn('Failed to get Firebase ID token:', e);
  }
  return cachedAccessToken;
};

/**
 * Checks whether the in-memory Google OAuth token is expired (older than 50 minutes, Google tokens expire in 60 minutes)
 */
export const isGoogleTokenExpired = (): boolean => {
  if (!cachedAccessToken) return true;
  if (!cachedTokenTimestamp) return false;
  return Date.now() - cachedTokenTimestamp > 3000000;
};

/**
 * Gets the remaining valid time of the current Google OAuth token in minutes (0 to 60)
 */
export const getTokenRemainingMinutes = (): number => {
  if (!cachedAccessToken) return 0;
  if (!cachedTokenTimestamp) return 60;
  const elapsedMs = Date.now() - cachedTokenTimestamp;
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
  cachedTokenTimestamp = null;
  try {
    localStorage.removeItem('g_access_token');
    localStorage.removeItem('g_token_timestamp');
    localStorage.removeItem('g_user_oauth_token');
    localStorage.removeItem('g_is_service_account');
    localStorage.removeItem('g_google_user');
  } catch {}
};

/**
 * Checks whether the active Google connection is from an authenticated personal Google account (Firebase OAuth),
 * rather than the server-managed Service Account gateway.
 */
export const isPersonalGoogleSession = (): boolean => {
  try {
    return !!(auth && auth.currentUser && auth.currentUser.uid && auth.currentUser.uid !== 'service_account');
  } catch {
    return false;
  }
};
