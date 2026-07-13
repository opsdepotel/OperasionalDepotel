/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

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
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // If we already have a cached token in memory, use it immediately
  const storedToken = localStorage.getItem('g_access_token');
  if (storedToken) {
    cachedAccessToken = storedToken;
  }

  if (!auth) {
    const backupToken = localStorage.getItem('g_access_token');
    if (backupToken) {
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
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // If we don't have the cached access token in memory or localStorage,
        // we check if there's any stored token
        const backupToken = localStorage.getItem('g_access_token');
        if (backupToken) {
          cachedAccessToken = backupToken;
          if (onAuthSuccess) onAuthSuccess(user, backupToken);
        } else if (!isSigningIn) {
          cachedAccessToken = null;
          localStorage.removeItem('g_access_token');
          if (onAuthFailure) onAuthFailure();
        }
      }
    } else {
      // If there's no auth user, but we have a stored token, we can still use it!
      // This is helpful if we want to bypass Google login completely for daily use.
      const backupToken = localStorage.getItem('g_access_token');
      if (backupToken) {
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

      if (!isSigningIn) {
        cachedAccessToken = null;
        localStorage.removeItem('g_access_token');
        if (onAuthFailure) onAuthFailure();
      }
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
    localStorage.setItem('g_access_token', cachedAccessToken);
    
    // Serialize some of the user profile so we can restore it offline / on bypass
    const minimalUser = {
      uid: result.user.uid,
      email: result.user.email,
      displayName: result.user.displayName,
      photoURL: result.user.photoURL
    };
    localStorage.setItem('g_google_user', JSON.stringify(minimalUser));

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const startDemoMode = () => {
  const mockToken = 'mock_demo_token';
  const minimalUser = {
    uid: 'demo_user_uid',
    email: 'ops.depotel@gmail.com',
    displayName: 'Administrator Depotel (Offline)',
    photoURL: ''
  };
  localStorage.setItem('g_access_token', mockToken);
  localStorage.setItem('g_google_user', JSON.stringify(minimalUser));
  window.location.reload();
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken || localStorage.getItem('g_access_token');
};

export const logout = async () => {
  try {
    await auth.signOut();
  } catch (e) {
    // Ignore signOut errors if we were not fully logged in to Firebase
  }
  cachedAccessToken = null;
  localStorage.removeItem('g_access_token');
  localStorage.removeItem('g_google_user');
};
