/**
 * Safe localStorage utilities with quota management and fallback trimming.
 */

export const safeSetItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[SafeStorage] Failed to save key "${key}" to localStorage (quota or disabled):`, error);
  }
};

/**
 * Strips sensitive passwords before saving user profiles to local storage.
 */
export const sanitizeProfilesForStorage = (data: any): any => {
  if (Array.isArray(data)) {
    return data.map(item => {
      if (item && typeof item === 'object') {
        const clean = { ...item };
        delete clean.password;
        return clean;
      }
      return item;
    });
  }
  return data;
};

export const safeSetJson = (key: string, data: any, maxTrimItems: number = 50): void => {
  try {
    const toStore = key === 'op_app_cached_profiles' ? sanitizeProfilesForStorage(data) : data;
    localStorage.setItem(key, JSON.stringify(toStore));
  } catch (error) {
    console.warn(`[SafeStorage] localStorage quota exceeded for key "${key}", attempting fallback trimming...`, error);
    if (Array.isArray(data) && data.length > 0) {
      try {
        const sanitized = key === 'op_app_cached_profiles' ? sanitizeProfilesForStorage(data) : data;
        const trimmed = sanitized.slice(0, maxTrimItems);
        localStorage.setItem(key, JSON.stringify(trimmed));
        return;
      } catch (err2) {
        try {
          const sanitized = key === 'op_app_cached_profiles' ? sanitizeProfilesForStorage(data) : data;
          const minimalTrimmed = sanitized.slice(0, Math.min(15, maxTrimItems));
          localStorage.setItem(key, JSON.stringify(minimalTrimmed));
          return;
        } catch (err3) {
          console.warn(`[SafeStorage] Could not cache "${key}" even after trimming:`, err3);
        }
      }
    }
  }
};

export const safeGetJson = <T>(key: string, fallback: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch (error) {
    console.warn(`[SafeStorage] Failed to read or parse "${key}" from localStorage:`, error);
    return fallback;
  }
};

export const safeRemoveItem = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`[SafeStorage] Failed to remove "${key}" from localStorage:`, error);
  }
};
