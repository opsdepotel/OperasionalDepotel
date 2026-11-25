/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Format baku Plat Nomor Kendaraan:
 * - ANNNNAA  (1 huruf + 4 angka + 2 huruf, contoh: B1234XY)
 * - ANNNNAAA (1 huruf + 4 angka + 3 huruf, contoh: B1234XYZ)
 * dengan A = Huruf (A-Z) dan N = Angka (0-9), tanpa spasi atau simbol.
 */
export const PLAT_NOMOR_STANDARD_REGEX = /^[A-Z]\d{4}[A-Z]{2,3}$/;

export function sanitizePlatNomor(val: string): string {
  return String(val || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isStandardPlatNomor(val: string): boolean {
  const cleaned = sanitizePlatNomor(val);
  if (!cleaned) return false;
  return PLAT_NOMOR_STANDARD_REGEX.test(cleaned);
}
