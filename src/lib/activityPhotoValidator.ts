/**
 * Client-side lightweight EXIF & file-origin validator for Daily Activity photos.
 * Runs 100% in browser (0 server/Vercel CPU usage) and never blocks users when
 * browser/OS strips metadata (uses silent audit flags instead of false-positive lockouts).
 */

export type ActivityPhotoCaptureSource = 'in-app-camera' | 'native-camera' | 'gallery';

export interface ParsedExifMetadata {
  isJpeg: boolean;
  hasExif: boolean;
  make?: string;
  model?: string;
  software?: string;
  dateTimeOriginalRaw?: string;
  dateTimeOriginalMs?: number;
}

export interface ActivityPhotoValidationResult {
  allowed: boolean;
  rejectReason?: string;
  auditFlags: string[];
  exif: ParsedExifMetadata;
}

const SUSPICIOUS_NON_CAMERA_FILENAME_RE =
  /^(screenshot|screen[-_\s]?shot|whatsapp|img[-_]?\d{8}[-_]?wa|fb_img|ig_|telegram|received_|snapseed|picsart|canva|photoshop|lightroom)/i;

/**
 * Parse EXIF DateTime string ("YYYY:MM:DD HH:mm:ss") into local epoch milliseconds.
 */
function parseExifDateString(raw: string): number | undefined {
  const match = raw.trim().match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    !year ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }
  const dt = new Date(year, month - 1, day, hour, minute, second);
  const ms = dt.getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function readAscii(view: DataView, start: number, length: number): string {
  let out = '';
  const max = Math.min(view.byteLength, start + length);
  for (let i = start; i < max; i++) {
    const code = view.getUint8(i);
    if (code === 0) break;
    if (code >= 32 && code <= 126) {
      out += String.fromCharCode(code);
    }
  }
  return out.trim();
}

function readIfdStringValue(
  view: DataView,
  tiffStart: number,
  entryOffset: number,
  littleEndian: boolean
): string | undefined {
  if (entryOffset + 12 > view.byteLength) return undefined;
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  if (type !== 2 || count === 0 || count > 256) return undefined;

  if (count <= 4) {
    return readAscii(view, entryOffset + 8, count) || undefined;
  }
  const valueOffset = tiffStart + view.getUint32(entryOffset + 8, littleEndian);
  if (valueOffset < tiffStart || valueOffset + count > view.byteLength) return undefined;
  return readAscii(view, valueOffset, count) || undefined;
}

/**
 * Reads only the first 64 KB of an image file to extract core camera EXIF tags
 * (Make, Model, Software, DateTimeOriginal / DateTime) without external libraries.
 */
export async function parseJpegExifMetadata(file: File): Promise<ParsedExifMetadata> {
  const emptyResult: ParsedExifMetadata = { isJpeg: false, hasExif: false };
  try {
    const headerSlice = file.slice(0, 65536);
    const buffer = await headerSlice.arrayBuffer();
    if (buffer.byteLength < 12) return emptyResult;

    const view = new DataView(buffer);
    // Check JPEG SOI marker (0xFFD8)
    if (view.getUint16(0, false) !== 0xffd8) {
      return emptyResult;
    }

    const result: ParsedExifMetadata = { isJpeg: true, hasExif: false };
    let offset = 2;

    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;

      // Start of Scan (0xFFDA) or EOI (0xFFD9) -> metadata headers have ended
      if (marker === 0xffda || marker === 0xffd9) break;
      // Standalone markers without length
      if ((marker & 0xff00) !== 0xff00) break;
      if (offset + 2 > view.byteLength) break;

      const segmentLength = view.getUint16(offset, false);
      if (segmentLength < 2 || offset + segmentLength > view.byteLength) break;

      // APP1 Exif segment (0xFFE1)
      if (marker === 0xffe1 && segmentLength >= 14) {
        const exifHeader = readAscii(view, offset + 2, 4);
        if (exifHeader === 'Exif') {
          const tiffStart = offset + 8;
          if (tiffStart + 8 <= view.byteLength) {
            const byteOrder = view.getUint16(tiffStart, false);
            const littleEndian = byteOrder === 0x4949;
            const bigEndian = byteOrder === 0x4d4d;

            if (littleEndian || bigEndian) {
              const tiffMagic = view.getUint16(tiffStart + 2, littleEndian);
              if (tiffMagic === 0x002a) {
                result.hasExif = true;
                const ifd0Offset = tiffStart + view.getUint32(tiffStart + 4, littleEndian);
                let exifIfdOffset: number | undefined;

                if (ifd0Offset >= tiffStart && ifd0Offset + 2 <= view.byteLength) {
                  const entries = view.getUint16(ifd0Offset, littleEndian);
                  for (let i = 0; i < entries; i++) {
                    const entryPos = ifd0Offset + 2 + i * 12;
                    if (entryPos + 12 > view.byteLength) break;
                    const tag = view.getUint16(entryPos, littleEndian);

                    if (tag === 0x010f) {
                      result.make = readIfdStringValue(view, tiffStart, entryPos, littleEndian);
                    } else if (tag === 0x0110) {
                      result.model = readIfdStringValue(view, tiffStart, entryPos, littleEndian);
                    } else if (tag === 0x0131) {
                      result.software = readIfdStringValue(view, tiffStart, entryPos, littleEndian);
                    } else if (tag === 0x0132 && !result.dateTimeOriginalRaw) {
                      const dtStr = readIfdStringValue(view, tiffStart, entryPos, littleEndian);
                      if (dtStr) {
                        result.dateTimeOriginalRaw = dtStr;
                        result.dateTimeOriginalMs = parseExifDateString(dtStr);
                      }
                    } else if (tag === 0x8769) {
                      const subPtr = view.getUint32(entryPos + 8, littleEndian);
                      exifIfdOffset = tiffStart + subPtr;
                    }
                  }
                }

                if (
                  exifIfdOffset !== undefined &&
                  exifIfdOffset >= tiffStart &&
                  exifIfdOffset + 2 <= view.byteLength
                ) {
                  const subEntries = view.getUint16(exifIfdOffset, littleEndian);
                  for (let i = 0; i < subEntries; i++) {
                    const entryPos = exifIfdOffset + 2 + i * 12;
                    if (entryPos + 12 > view.byteLength) break;
                    const tag = view.getUint16(entryPos, littleEndian);
                    // 0x9003 = DateTimeOriginal, 0x9004 = DateTimeDigitized
                    if (tag === 0x9003 || (tag === 0x9004 && !result.dateTimeOriginalMs)) {
                      const dtStr = readIfdStringValue(view, tiffStart, entryPos, littleEndian);
                      if (dtStr) {
                        result.dateTimeOriginalRaw = dtStr;
                        result.dateTimeOriginalMs = parseExifDateString(dtStr);
                      }
                    }
                  }
                }
              }
            }
          }
          break;
        }
      }

      offset += segmentLength;
    }

    return result;
  } catch {
    return emptyResult;
  }
}

/**
 * Validates captured daily activity photo under Option 4 (Hybrid):
 * - In-app live camera captures are directly trusted (sensor frame).
 * - Non-strict desktop users keep full flexibility.
 * - Strict mobile fallback (`native-camera`) hard-blocks clearly stale / chat / screenshot files,
 *   while applying non-blocking audit flags when OS/browser strips EXIF/lastModified so no worker is locked out.
 */
export async function validateCapturedActivityPhoto(
  file: File,
  options: {
    enforceStrictMobile: boolean;
    captureSource: ActivityPhotoCaptureSource;
  }
): Promise<ActivityPhotoValidationResult> {
  const { enforceStrictMobile, captureSource } = options;

  if (captureSource === 'in-app-camera') {
    return {
      allowed: true,
      auditFlags: [],
      exif: { isJpeg: true, hasExif: false }
    };
  }

  const exif = await parseJpegExifMetadata(file);

  if (!enforceStrictMobile) {
    return {
      allowed: true,
      auditFlags: [],
      exif
    };
  }

  const auditFlags: string[] = [];
  const fileName = (file.name || '').trim();

  // 1. Hard-block obvious screenshot / messaging / photo-editor filenames
  if (fileName && SUSPICIOUS_NON_CAMERA_FILENAME_RE.test(fileName)) {
    return {
      allowed: false,
      rejectReason:
        'Foto tidak dapat digunakan karena nama berkas terdeteksi berasal dari Screenshot / Aplikasi Chat / Editor Gambar. Anda wajib memotret secara langsung di lokasi saat ini menggunakan Kamera HP.',
      auditFlags,
      exif
    };
  }

  // 2. Hard-block stale file.lastModified (tightened to 3 minutes past, 2 minutes future tolerance)
  const nowMs = Date.now();
  if (file.lastModified && !Number.isNaN(file.lastModified) && file.lastModified > 0) {
    const ageMs = nowMs - file.lastModified;
    const maxPastAgeMs = 3 * 60 * 1000;
    const maxFutureSkewMs = 2 * 60 * 1000;

    if (ageMs > maxPastAgeMs || ageMs < -maxFutureSkewMs) {
      return {
        allowed: false,
        rejectReason:
          'Foto tidak dapat digunakan karena terdeteksi berasal dari Galeri/Penyimpanan HP (waktu berkas bukan pemotretan langsung). Anda wajib memotret secara langsung di lokasi saat ini menggunakan Kamera HP.',
        auditFlags,
        exif
      };
    }
  } else {
    // Non-blocking audit note when WebView/ContentProvider omits lastModified
    auditFlags.push('Foto Kamera Bawaan: Timestamp file (lastModified) tidak tersedia dari browser.');
  }

  // 3. Hard-block if EXIF DateTimeOriginal exists and proves the photo was shot > 10 mins ago
  if (exif.dateTimeOriginalMs !== undefined) {
    const exifDiffMs = Math.abs(nowMs - exif.dateTimeOriginalMs);
    const maxExifDiffMs = 10 * 60 * 1000;
    if (exifDiffMs > maxExifDiffMs) {
      return {
        allowed: false,
        rejectReason:
          `Foto ditolak karena waktu pemotretan asli pada metadata kamera (${exif.dateTimeOriginalRaw}) tidak sesuai dengan waktu saat ini. Harap ambil foto baru langsung di lokasi.`,
        auditFlags,
        exif
      };
    }
  } else if (exif.isJpeg && !exif.make && !exif.model) {
    // Silent audit flag (NOT hard-block) so iOS/privacy browsers that strip EXIF never lock out legitimate users
    auditFlags.push(
      'Foto Kamera Bawaan: Metadata kamera (EXIF Make/Model/Waktu Potret) kosong (indikasi foto salinan/unduhan atau disensor browser).'
    );
  }

  return {
    allowed: true,
    auditFlags,
    exif
  };
}
