/**
 * Utility for Front-End Web Browser / Geolocation API Fake GPS & Mock Location Detection
 */

export interface FakeGpsCheckResult {
  isFake: boolean;
  reason: string;
}

/**
 * Detects potential Fake GPS / Mock Location usage based on browser Geolocation API signals:
 * 1. Accuracy Parameter Analysis (accuracy)
 * 2. Altitude & Elevation Analysis (altitude, altitudeAccuracy)
 * 3. Timestamp Delta Analysis (Hardware timestamp vs System/Server submission time)
 */
export function detectFakeGps(
  position: GeolocationPosition | null,
  coordsActualStr: string = ''
): FakeGpsCheckResult {
  const reasons: string[] = [];

  // If no position object exists or coordinates were manually forced/invalid
  if (!position) {
    if (!coordsActualStr || coordsActualStr.includes('tidak') || coordsActualStr.includes('gagal')) {
      return { isFake: false, reason: 'GPS tidak aktif/tidak tersedia' };
    }
    return {
      isFake: true,
      reason: 'Koordinat GPS didapatkan tanpa objek Geolocation API bawaan browser'
    };
  }

  const { coords, timestamp } = position;
  const now = Date.now();

  // 1. Analisis Parameter Akurasi (accuracy)
  if (coords.accuracy !== null && coords.accuracy !== undefined) {
    const acc = coords.accuracy;
    if (acc === 0) {
      reasons.push('Akurasi GPS bernilai 0m (Injeksi Provider Mock Location)');
    } else if (acc <= 0.8) {
      reasons.push(`Akurasi GPS tidak alami/terlalu presisi (${acc.toFixed(1)}m)`);
    } else if (Number.isInteger(acc) && acc <= 2) {
      reasons.push(`Akurasi GPS bernilai bulat konstan (${acc}m)`);
    } else if (acc > 3000) {
      reasons.push(`Akurasi GPS sangat rendah/anomali (${Math.round(acc)}m)`);
    }
  } else {
    reasons.push('Akurasi GPS bernilai null/kosong');
  }

  // 2. Analisis Altitude & Elevasi (altitude, altitudeAccuracy)
  // Aplikasi Fake GPS di Android / Browser biasanya hanya menginjeksikan lat/lon tetapi mengabaikan altitude/elevasi (bernilai 0 konstan dengan altitudeAccuracy 0 atau null)
  if (coords.altitude === 0 && (coords.altitudeAccuracy === 0 || coords.altitudeAccuracy === null)) {
    reasons.push('Elevasi/Altitude bernilai 0 konstan tanpa akurasi ketinggian');
  }

  // 3. Inkonsistensi Waktu Hardware vs Server/System Time (Timestamp Delta)
  if (timestamp && typeof timestamp === 'number' && timestamp > 0) {
    const timeDeltaMs = Math.abs(now - timestamp);
    // Selisih > 30 detik antara timestamp fix lokasi GPS hardware dan waktu submit sistem
    if (timeDeltaMs > 30000) {
      const deltaSec = Math.round(timeDeltaMs / 1000);
      reasons.push(`Inkonsistensi waktu GPS hardware & sistem (${deltaSec} detik delta)`);
    }
  } else {
    reasons.push('Timestamp GPS hardware tidak valid / tidak terekam');
  }

  const isFake = reasons.length > 0;
  return {
    isFake,
    reason: isFake ? reasons.join('; ') : 'GPS Valid'
  };
}
