/**
 * Utility for Front-End Web Browser / Geolocation API Fake GPS & Mock Location Detection
 *
 * Menggabungkan 3 Kombinasi Parameter Evaluasi Hardware:
 * 1. Timestamp Sensor Hardware (Inkonsistensi & Latency Clock Drift)
 * 2. Akurasi Radius Horizontal (Accuracy Pattern & Zero-Accuracy Injection)
 * 3. Data Elevasi Vertikal 3D (Altitude & Altitude Accuracy Fix)
 */

export interface ParameterEvaluation {
  parameterName: string;
  status: 'VALID' | 'ANOMALI' | 'WARNING';
  score: number; // 0 - 100
  detailValue: string;
  analysisNote: string;
}

export interface FakeGpsCheckResult {
  isFake: boolean;
  reason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  overallScore: number; // 0 - 100
  evaluations?: {
    timestamp: ParameterEvaluation;
    accuracy: ParameterEvaluation;
    elevation: ParameterEvaluation;
  };
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
  const now = Date.now();

  const defaultEvaluations = {
    timestamp: {
      parameterName: 'Timestamp Sensor Hardware',
      status: 'WARNING' as const,
      score: 50,
      detailValue: 'Tidak Ada Timestamp',
      analysisNote: 'Objek Geolocation Position tidak tersedia.'
    },
    accuracy: {
      parameterName: 'Akurasi Radius (Accuracy)',
      status: 'WARNING' as const,
      score: 50,
      detailValue: 'Akurasi Tidak Terbaca',
      analysisNote: 'Nilai akurasi horizontal tidak dapat diakses.'
    },
    elevation: {
      parameterName: 'Data Elevasi Vertikal (Altitude)',
      status: 'WARNING' as const,
      score: 50,
      detailValue: 'Elevasi Tidak Terbaca',
      analysisNote: 'Data ketinggian vertikal tidak dapat diakses.'
    }
  };

  if (!position) {
    if (!coordsActualStr || coordsActualStr.includes('tidak') || coordsActualStr.includes('gagal')) {
      return {
        isFake: false,
        reason: 'GPS tidak aktif / tidak tersedia',
        confidence: 'NONE',
        overallScore: 50,
        evaluations: defaultEvaluations
      };
    }
    return {
      isFake: true,
      reason: 'Koordinat GPS didapatkan tanpa objek Geolocation API bawaan browser',
      confidence: 'HIGH',
      overallScore: 0,
      evaluations: defaultEvaluations
    };
  }

  const { coords, timestamp } = position;
  const reasons: string[] = [];

  // 1. PARAMETER 1: TIMESTAMP SENSOR HARDWARE
  let tsStatus: 'VALID' | 'ANOMALI' | 'WARNING' = 'VALID';
  let tsScore = 100;
  let tsDetail = '';
  let tsNote = '';

  if (timestamp && typeof timestamp === 'number' && timestamp > 0) {
    const timeDeltaMs = now - timestamp;
    const absDeltaMs = Math.abs(timeDeltaMs);
    const deltaSec = (absDeltaMs / 1000).toFixed(1);

    if (timeDeltaMs < -5000) {
      tsStatus = 'ANOMALI';
      tsScore = 20;
      tsDetail = `Future Timestamp (+${deltaSec}s)`;
      tsNote = 'Timestamp sensor GPS berada di masa depan relatif terhadap jam sistem (Indikasi manipulasi timer provider).';
      reasons.push(`Timestamp hardware di masa depan (+${deltaSec}s)`);
    } else if (absDeltaMs > 45000) {
      tsStatus = 'ANOMALI';
      tsScore = 30;
      tsDetail = `Latensi/Drift Tinggi (${deltaSec}s)`;
      tsNote = 'Terdapat lag tinggi antara fix GPS hardware dan sistem (Indikasi rekam ulang lokasi/mock provider).';
      reasons.push(`Inkonsistensi waktu GPS hardware & sistem (${deltaSec} detik delta)`);
    } else if (absDeltaMs > 15000) {
      tsStatus = 'WARNING';
      tsScore = 75;
      tsDetail = `Drift Sedang (${deltaSec}s)`;
      tsNote = 'Waktu fix GPS agak lambat direkam sistem, namun masih dalam toleransi latensi jaringan/hardware.';
    } else {
      tsStatus = 'VALID';
      tsScore = 100;
      tsDetail = `Tersinkronisasi (${deltaSec}s delta)`;
      tsNote = 'Timestamp hardware GPS terasinkronisasi presisi dengan jam sistem (< 15 detik delta).';
    }
  } else {
    tsStatus = 'ANOMALI';
    tsScore = 0;
    tsDetail = 'Null / Invalid Timestamp';
    tsNote = 'Hardware tidak memancarkan timestamp perbaikan sinyal satelit.';
    reasons.push('Timestamp GPS hardware tidak valid / null');
  }

  // 2. PARAMETER 2: AKURASI RADIUS HORIZONTAL (ACCURACY)
  let accStatus: 'VALID' | 'ANOMALI' | 'WARNING' = 'VALID';
  let accScore = 100;
  let accDetail = '';
  let accNote = '';

  if (coords.accuracy !== null && coords.accuracy !== undefined) {
    const acc = coords.accuracy;
    accDetail = `${acc.toFixed(2)} Meter`;

    if (acc === 0) {
      accStatus = 'ANOMALI';
      accScore = 0;
      accNote = 'Akurasi 0 meter merujuk pada pemotongan nilai estimasi error pada Fake GPS / Mock Location Spoofer.';
      reasons.push('Akurasi GPS bernilai 0m (Injeksi Provider Mock Location)');
    } else if (acc <= 0.8) {
      accStatus = 'ANOMALI';
      accScore = 25;
      accNote = `Akurasi ${acc.toFixed(2)}m terlalu presisi secara tidak alami tanpa perlengkapan RTK/DGPS industri.`;
      reasons.push(`Akurasi GPS tidak alami/terlalu presisi (${acc.toFixed(1)}m)`);
    } else if (Number.isInteger(acc) && acc <= 2) {
      accStatus = 'WARNING';
      accScore = 60;
      accNote = `Akurasi bernilai bulat konstan (${acc}m). Umum ditemukan pada beberapa software penguji lokasi.`;
      reasons.push(`Akurasi GPS bernilai bulat konstan (${acc}m)`);
    } else if (acc > 3000) {
      accStatus = 'WARNING';
      accScore = 50;
      accNote = `Akurasi radius sangat luas (${Math.round(acc)}m). Kemungkinan fallback BTS / IP Geolocation.`;
      reasons.push(`Akurasi GPS sangat rendah/anomali (${Math.round(acc)}m)`);
    } else {
      accStatus = 'VALID';
      accScore = 100;
      accNote = 'Akurasi radius berada pada rentang fluktuasi alami penerima GPS fisik hardware.';
    }
  } else {
    accStatus = 'ANOMALI';
    accScore = 0;
    accDetail = 'Null Accuracy';
    accNote = 'Browser tidak menerima estimasi radius kesalahan dari sensor.';
    reasons.push('Akurasi GPS bernilai null/kosong');
  }

  // 3. PARAMETER 3: DATA ELEVASI VERTIKAL (ALTITUDE)
  let altStatus: 'VALID' | 'ANOMALI' | 'WARNING' = 'VALID';
  let altScore = 100;
  let altDetail = '';
  let altNote = '';

  const alt = coords.altitude;
  const altAcc = coords.altitudeAccuracy;

  if (alt !== null && alt !== undefined && !isNaN(alt)) {
    if (altAcc !== null && altAcc !== undefined && !isNaN(altAcc)) {
      altDetail = `Alt: ${alt.toFixed(1)}m (Acc: ${altAcc.toFixed(1)}m)`;
    } else {
      altDetail = `Alt: ${alt.toFixed(1)}m (Acc: -)`;
    }

    if (alt === 0 && (altAcc === 0 || altAcc === null || altAcc === undefined)) {
      altStatus = 'ANOMALI';
      altScore = 30;
      altNote = 'Elevasi bernilai 0.0m konstan tanpa deviasi vertikal. Pola umum injector lokasi tiruan 2D.';
      reasons.push('Elevasi/Altitude bernilai 0 konstan tanpa akurasi ketinggian');
    } else {
      altStatus = 'VALID';
      altScore = 100;
      altNote = 'Sensor memancarkan data Ketinggian/Elevasi 3D Fix hardware yang valid.';
    }
  } else {
    altStatus = 'WARNING';
    altScore = 70;
    altDetail = 'Ketinggian Tidak Tersedia (Null)';
    altNote = 'Sinyal satelit 3D Fix vertikal tidak tersedia (Perangkat Indoor / Browser Standar).';
  }

  const overallScore = Math.round((tsScore * 0.35) + (accScore * 0.40) + (altScore * 0.25));
  const isFake = reasons.length > 0 && overallScore < 60;
  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' =
    overallScore < 30 ? 'HIGH' : overallScore < 60 ? 'MEDIUM' : overallScore < 80 ? 'LOW' : 'NONE';

  const evaluations = {
    timestamp: {
      parameterName: 'Timestamp Sensor Hardware',
      status: tsStatus,
      score: tsScore,
      detailValue: tsDetail,
      analysisNote: tsNote
    },
    accuracy: {
      parameterName: 'Akurasi Radius (Accuracy)',
      status: accStatus,
      score: accScore,
      detailValue: accDetail,
      analysisNote: accNote
    },
    elevation: {
      parameterName: 'Data Elevasi Vertikal (Altitude)',
      status: altStatus,
      score: altScore,
      detailValue: altDetail,
      analysisNote: altNote
    }
  };

  return {
    isFake,
    reason: isFake ? reasons.join('; ') : (reasons.length > 0 ? `Perhatian: ${reasons.join('; ')}` : 'GPS Valid'),
    confidence,
    overallScore,
    evaluations
  };
}

