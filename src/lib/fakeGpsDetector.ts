/**
 * Utility for Front-End Web Browser / Geolocation API Fake GPS & Mock Location Detection
 *
 * Implementasi GPS Integrity & Risk Scoring System:
 * 1. Movement & Speed Analysis (Haversine Geodesic Distance, Elapsed Time, Speed in km/h)
 * 2. Accuracy Pattern Analysis (Zero-Accuracy, Unnatural Precision vs Sinyal Buruk)
 * 3. Timestamp Progression Analysis (Dinamika Fix vs Caching Browser vs Future Time)
 * 4. Altitude & 3D Fix Evidence (Supporting Evidence)
 * 5. Historical Pattern & Anomaly Accumulation (Buffer 10 fix terakhir)
 */

export type GpsRiskLevel = 'NORMAL' | 'WARNING' | 'SUSPICIOUS' | 'HIGH_RISK';
export type GpsQualityGrade = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';

export interface SignalEvaluation {
  status: 'VALID' | 'ANOMALI' | 'WARNING';
  score: number; // 0 - 100 (100 = Sangat Bagus/Valid)
  detail: string;
  note: string;
}

export interface ParameterEvaluation {
  parameterName: string;
  status: 'VALID' | 'ANOMALI' | 'WARNING';
  score: number; // 0 - 100
  detailValue: string;
  analysisNote: string;
}

export interface FakeGpsCheckResult {
  // === FIELD COMPATIBILITY LAMA (Mencegah Breaking Change) ===
  isFake: boolean;                  // true jika riskLevel === 'HIGH_RISK'
  reason: string;                   // Ringkasan penjelasan
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  overallScore: number;             // Skor Validitas Hardware (100 - riskScore)
  timeDeltaMs?: number | null;
  isTimestampStagnant?: boolean;
  evaluations?: {
    timestamp: ParameterEvaluation;
    accuracy: ParameterEvaluation;
    elevation: ParameterEvaluation;
  };

  // === FIELD INTEGRITAS & RISIKO BARU ===
  riskLevel: GpsRiskLevel;          // 'NORMAL' | 'WARNING' | 'SUSPICIOUS' | 'HIGH_RISK'
  riskScore: number;                // 0 (Sangat Aman) - 100 (Sangat Berisiko)
  qualityGrade: GpsQualityGrade;    // 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR'
  reasons: string[];                // Array detail alasan anomali
  
  signals: {
    movement: SignalEvaluation & { calculatedSpeedKmh?: number | null; distanceMeters?: number | null };
    timestamp: SignalEvaluation & { timeDeltaMs?: number | null; isStagnant?: boolean };
    accuracy: SignalEvaluation & { currentAccuracyMeters?: number | null; isZeroAccuracy?: boolean };
    altitude: SignalEvaluation & { altitudeMeters?: number | null };
    consistency: SignalEvaluation & { patternNotes?: string };
  };

  diagnostics: {
    speedKmh: number | null;
    distanceMeters: number | null;
    elapsedSeconds: number | null;
    fixCountInHistory: number;
    summaryText: string;
  };

  capturedAt: number;               // Timestamp lokal saat GPS diambil (Offline Ready)
}

// Memory Buffer untuk menyimpan histori fix GPS terakhir (Maksimal 10 fix)
interface GpsFixHistoryItem {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  timestamp: number;
}

const gpsFixHistory: GpsFixHistoryItem[] = [];
const MAX_HISTORY_ITEMS = 10;

/**
 * Menghitung jarak geodesic antar dua koordinat (Latitude, Longitude) menggunakan rumus Haversine.
 * Hasil dalam satuan meter.
 */
export function calculateHaversineDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Radius bumi dalam meter
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Clear history buffer (Bermanfaat untuk testing / reset session)
 */
export function resetGpsHistoryBuffer(): void {
  gpsFixHistory.length = 0;
}

/**
 * Detects GPS Integrity & Risk Score based on Geolocation API signals:
 * 1. Movement & Speed Analysis (Haversine Distance, Elapsed Time, Speed km/h)
 * 2. Accuracy Pattern Analysis (Zero-Accuracy, Unnatural Precision vs Poor Signal)
 * 3. Timestamp Progression Analysis (Dynamic Fix vs Browser Caching)
 * 4. Elevation 3D Fix Evidence
 * 5. Historical Consistency Analysis
 */
export function detectFakeGps(
  position: GeolocationPosition | null,
  coordsActualStr: string = '',
  previousPosition?: GeolocationPosition | null,
  checkHistoryCount: number = 1
): FakeGpsCheckResult {
  const now = Date.now();
  const capturedAt = now;

  const defaultEvaluations = {
    timestamp: {
      parameterName: 'Timestamp Hardware Delta (ms)',
      status: 'WARNING' as const,
      score: 50,
      detailValue: 'Delta: - ms (Null)',
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

  const defaultSignals = {
    movement: { status: 'VALID' as const, score: 100, detail: 'Tidak Ada Data Pergerakan', note: 'Fix awal / tidak ada pembanding' },
    timestamp: { status: 'WARNING' as const, score: 50, detail: 'Tidak Ada Data Timestamp', note: 'Objek position tidak tersedia' },
    accuracy: { status: 'WARNING' as const, score: 50, detail: 'Akurasi Tidak Terbaca', note: 'Tidak ada data akurasi' },
    altitude: { status: 'VALID' as const, score: 100, detail: 'Ketinggian Tidak Tersedia', note: 'Browser standar / Indoor' },
    consistency: { status: 'VALID' as const, score: 100, detail: 'Histori Terbatas', note: 'Membutuhkan polling berulang' }
  };

  // Kasus: Objek Geolocation null/kosong
  if (!position) {
    if (!coordsActualStr || coordsActualStr.includes('tidak') || coordsActualStr.includes('gagal')) {
      return {
        isFake: false,
        reason: 'GPS tidak aktif / tidak tersedia',
        confidence: 'NONE',
        overallScore: 50,
        timeDeltaMs: null,
        isTimestampStagnant: false,
        evaluations: defaultEvaluations,
        riskLevel: 'NORMAL',
        riskScore: 0,
        qualityGrade: 'POOR',
        reasons: [],
        signals: defaultSignals,
        diagnostics: {
          speedKmh: null,
          distanceMeters: null,
          elapsedSeconds: null,
          fixCountInHistory: gpsFixHistory.length,
          summaryText: 'GPS tidak aktif atau izin lokasi ditolak'
        },
        capturedAt
      };
    }

    return {
      isFake: true,
      reason: 'Koordinat GPS didapatkan tanpa objek Geolocation API bawaan browser',
      confidence: 'HIGH',
      overallScore: 0,
      timeDeltaMs: null,
      isTimestampStagnant: false,
      evaluations: defaultEvaluations,
      riskLevel: 'HIGH_RISK',
      riskScore: 90,
      qualityGrade: 'POOR',
      reasons: ['Koordinat didapatkan tanpa objek Geolocation API resmi browser'],
      signals: {
        ...defaultSignals,
        timestamp: { status: 'ANOMALI', score: 0, detail: 'Non-API Fix', note: 'Injeksi koordinat eksternal' }
      },
      diagnostics: {
        speedKmh: null,
        distanceMeters: null,
        elapsedSeconds: null,
        fixCountInHistory: gpsFixHistory.length,
        summaryText: 'Injeksi koordinat eksternal tanpa objek Geolocation API'
      },
      capturedAt
    };
  }

  const { coords, timestamp } = position;
  const lat = coords.latitude;
  const lon = coords.longitude;
  const acc = coords.accuracy;
  const alt = coords.altitude;
  const altAcc = coords.altitudeAccuracy;

  const reasons: string[] = [];
  let riskScoreCumulative = 0; // Cumulative risk (0 - 100)

  // Determine prevFix either from parameter or from internal buffer
  let prevFix: GpsFixHistoryItem | null = null;
  if (previousPosition && previousPosition.coords) {
    prevFix = {
      latitude: previousPosition.coords.latitude,
      longitude: previousPosition.coords.longitude,
      accuracy: previousPosition.coords.accuracy ?? null,
      altitude: previousPosition.coords.altitude ?? null,
      timestamp: previousPosition.timestamp || now
    };
  } else if (gpsFixHistory.length > 0) {
    prevFix = gpsFixHistory[gpsFixHistory.length - 1];
  }

  // Save current fix to internal history buffer
  const currentFixTs = timestamp && typeof timestamp === 'number' && timestamp > 0 ? timestamp : now;
  gpsFixHistory.push({
    latitude: lat,
    longitude: lon,
    accuracy: acc,
    altitude: alt,
    timestamp: currentFixTs
  });
  if (gpsFixHistory.length > MAX_HISTORY_ITEMS) {
    gpsFixHistory.shift();
  }

  // --------------------------------------------------------------------------
  // 1. MOVEMENT & SPEED ANALYSIS (Haversine Distance & Speed)
  // --------------------------------------------------------------------------
  let distanceMeters: number | null = null;
  let elapsedSeconds: number | null = null;
  let calculatedSpeedKmh: number | null = null;
  let moveStatus: 'VALID' | 'ANOMALI' | 'WARNING' = 'VALID';
  let moveScore = 100;
  let moveDetail = 'Fix Awal / Diam';
  let moveNote = 'Lokasi stasioner atau fix pertama.';

  if (prevFix) {
    distanceMeters = calculateHaversineDistanceInMeters(
      prevFix.latitude,
      prevFix.longitude,
      lat,
      lon
    );
    const elapsedMs = Math.abs(currentFixTs - prevFix.timestamp);
    elapsedSeconds = elapsedMs / 1000;

    if (elapsedSeconds > 0) {
      // Speed in km/h = (meters / seconds) * 3.6
      calculatedSpeedKmh = (distanceMeters / elapsedSeconds) * 3.6;
    } else {
      calculatedSpeedKmh = distanceMeters > 50 ? 9999 : 0;
    }

    if (distanceMeters > 5) {
      moveDetail = `${distanceMeters.toFixed(1)}m dalam ${elapsedSeconds.toFixed(1)}s (${calculatedSpeedKmh !== null ? calculatedSpeedKmh.toFixed(1) : 0} km/h)`;

      if (calculatedSpeedKmh !== null && calculatedSpeedKmh > 800) {
        // Teleportasi ekstrim (> 800 km/h)
        moveStatus = 'ANOMALI';
        moveScore = 10;
        moveNote = `Teleportasi ekstrim: pergerakan ${distanceMeters.toFixed(0)}m dalam ${elapsedSeconds.toFixed(1)}s (kecepatan ${calculatedSpeedKmh.toFixed(0)} km/h) di luar batas fisik.`;
        reasons.push(`Teleportasi lokasi (${distanceMeters.toFixed(0)}m dalam ${elapsedSeconds.toFixed(1)}s, ${calculatedSpeedKmh.toFixed(0)} km/h)`);
        riskScoreCumulative += 75;
      } else if (calculatedSpeedKmh !== null && calculatedSpeedKmh > 250) {
        // Kecepatan di luar batas kendaraan darat (> 250 km/h)
        moveStatus = 'ANOMALI';
        moveScore = 30;
        moveNote = `Pergerakan sangat cepat (${calculatedSpeedKmh.toFixed(0)} km/h, ${distanceMeters.toFixed(0)}m dalam ${elapsedSeconds.toFixed(1)}s). Indikasi lompatan koordinat.`;
        reasons.push(`Lompatan koordinat tidak wajar (${calculatedSpeedKmh.toFixed(0)} km/h)`);
        riskScoreCumulative += 40;
      } else if (calculatedSpeedKmh !== null && calculatedSpeedKmh > 130) {
        // Kecepatan jalan tol / kendaraan cepat (130 - 250 km/h)
        moveStatus = 'WARNING';
        moveScore = 70;
        moveNote = `Pergerakan kendaraan cepat (${calculatedSpeedKmh.toFixed(0)} km/h). Normal pada perjalanan tol / kereta cepat.`;
        riskScoreCumulative += 10;
      } else {
        moveStatus = 'VALID';
        moveScore = 100;
        moveNote = `Pergerakan normal dalam batas fisik (${calculatedSpeedKmh !== null ? calculatedSpeedKmh.toFixed(1) : 0} km/h).`;
      }
    } else {
      moveDetail = `Stasioner (${distanceMeters.toFixed(1)}m)`;
      moveNote = 'Pengguna diam di lokasi yang sama.';
    }
  }

  // --------------------------------------------------------------------------
  // 2. ACCURACY PATTERN ANALYSIS
  // --------------------------------------------------------------------------
  let accStatus: 'VALID' | 'ANOMALI' | 'WARNING' = 'VALID';
  let accScore = 100;
  let accDetail = '';
  let accNote = '';
  let isZeroAcc = false;

  if (acc !== null && acc !== undefined && !isNaN(acc)) {
    accDetail = `${acc.toFixed(2)} Meter`;

    if (acc === 0) {
      isZeroAcc = true;
      accStatus = 'ANOMALI';
      accScore = 0;
      accNote = 'Akurasi 0 meter merujuk pada pemotongan nilai estimasi error pada Fake GPS / Mock Location Spoofer.';
      reasons.push('Akurasi GPS 0m (Injeksi Provider Mock Location)');
      riskScoreCumulative += 80;
    } else if (acc <= 0.8) {
      accStatus = 'ANOMALI';
      accScore = 25;
      accNote = `Akurasi ${acc.toFixed(2)}m terlalu presisi secara tidak alami tanpa perlengkapan RTK/DGPS industri.`;
      reasons.push(`Akurasi GPS terlalu presisi (${acc.toFixed(1)}m)`);
      riskScoreCumulative += 30;
    } else if (Number.isInteger(acc) && acc <= 2) {
      accStatus = 'WARNING';
      accScore = 60;
      accNote = `Akurasi bernilai bulat konstan (${acc}m). Umum ditemukan pada beberapa software penguji lokasi.`;
      riskScoreCumulative += 15;
    } else if (acc > 500) {
      // Sinyal Buruk (Indoor / Urban Canyon / BTS) -> Terapkan Kualitas POOR, tetapi BUKAN Fake GPS
      accStatus = 'WARNING';
      accScore = 50;
      accNote = `Akurasi radius sangat luas (${Math.round(acc)}m). Pengguna kemungkinan berada di dalam gedung / area sinyal GPS lemah.`;
      // TIDAK menambah riskScoreCumulative untuk menghindari False Positive
    } else {
      accStatus = 'VALID';
      accScore = 100;
      accNote = 'Akurasi radius berada pada rentang fluktuasi alami penerima GPS fisik hardware.';
    }
  } else {
    accStatus = 'ANOMALI';
    accScore = 20;
    accDetail = 'Null Accuracy';
    accNote = 'Browser tidak menerima estimasi radius kesalahan dari sensor.';
    riskScoreCumulative += 25;
  }

  // --------------------------------------------------------------------------
  // 3. TIMESTAMP PROGRESSION ANALYSIS
  // --------------------------------------------------------------------------
  let tsStatus: 'VALID' | 'ANOMALI' | 'WARNING' = 'VALID';
  let tsScore = 100;
  let tsDetail = '';
  let tsNote = '';
  let calculatedDeltaMs: number | null = null;
  let isStagnant = false;

  if (timestamp && typeof timestamp === 'number' && timestamp > 0) {
    calculatedDeltaMs = now - timestamp;
    const absDeltaMs = Math.abs(calculatedDeltaMs);
    const formattedDeltaMs = `${calculatedDeltaMs.toLocaleString('id-ID')} ms`;

    // Evaluasi apakah timestamp stagnan saat polling berulang
    const prevTimestamp = prevFix?.timestamp;
    const isTimestampUnchanged = prevTimestamp !== undefined && prevTimestamp !== null && prevTimestamp === timestamp;

    if (checkHistoryCount > 1 && isTimestampUnchanged) {
      isStagnant = true;
      if (distanceMeters !== null && distanceMeters > 50) {
        // Stagnan padahal posisi berpindah jauh -> ANOMALI SANGAT KUAT
        tsStatus = 'ANOMALI';
        tsScore = 10;
        tsDetail = `${formattedDeltaMs} (STAGNAN DENGAN LOMPATAN)`;
        tsNote = `Timestamp hardware (${timestamp}) tidak diperbarui saat lokasi berpindah sejauh ${distanceMeters.toFixed(0)}m. Indikasi replay attack/mock.`;
        reasons.push(`Timestamp stagnan saat koordinat berpindah (${distanceMeters.toFixed(0)}m)`);
        riskScoreCumulative += 60;
      } else {
        // Stagnan saat pengguna diam -> Caching browser wajar (Bukan Fake GPS)
        tsStatus = 'WARNING';
        tsScore = 70;
        tsDetail = `${formattedDeltaMs} (Caching Browser)`;
        tsNote = `Timestamp hardware stagnan karena pengguna diam di tempat. Browser menghemat daya dengan caching fix terakhir.`;
      }
    } else if (calculatedDeltaMs < -5000) {
      tsStatus = 'ANOMALI';
      tsScore = 20;
      tsDetail = `${formattedDeltaMs} (Masa Depan)`;
      tsNote = `Timestamp hardware berada di masa depan (+${(absDeltaMs / 1000).toFixed(1)}s) relatif terhadap jam sistem.`;
      reasons.push(`Timestamp hardware di masa depan (+${(absDeltaMs / 1000).toFixed(1)}s)`);
      riskScoreCumulative += 60;
    } else if (absDeltaMs > 60000) {
      tsStatus = 'ANOMALI';
      tsScore = 40;
      tsDetail = `${formattedDeltaMs} (Latensi Sangat Tinggi)`;
      tsNote = `Delta waktu sangat besar (${formattedDeltaMs}). Terdapat lag tinggi antara fix hardware dan waktu sistem.`;
      riskScoreCumulative += 20;
    } else if (absDeltaMs > 20000) {
      tsStatus = 'WARNING';
      tsScore = 80;
      tsDetail = `${formattedDeltaMs} (Drift Sedang)`;
      tsNote = `Delta waktu ${formattedDeltaMs}. Fix GPS agak lambat direkam sistem, namun masih dalam toleransi jaringan.`;
    } else {
      tsStatus = 'VALID';
      tsScore = 100;
      tsDetail = `${formattedDeltaMs} (Dinami Fresh Fix)`;
      tsNote = `Timestamp hardware terus diperbarui secara dinamis oleh satelit.`;
    }
  } else {
    tsStatus = 'ANOMALI';
    tsScore = 10;
    tsDetail = 'Null / Invalid Timestamp';
    tsNote = 'Hardware tidak memancarkan timestamp perbaikan sinyal satelit.';
    reasons.push('Timestamp GPS hardware tidak valid / null');
    riskScoreCumulative += 30;
  }

  // --------------------------------------------------------------------------
  // 4. ALTITUDE & ELEVATION ANALYSIS (Supporting Evidence)
  // --------------------------------------------------------------------------
  let altStatus: 'VALID' | 'ANOMALI' | 'WARNING' = 'VALID';
  let altScore = 100;
  let altDetail = '';
  let altNote = '';

  if (alt !== null && alt !== undefined && !isNaN(alt)) {
    if (altAcc !== null && altAcc !== undefined && !isNaN(altAcc)) {
      altDetail = `Alt: ${alt.toFixed(1)}m (Acc: ${altAcc.toFixed(1)}m)`;
    } else {
      altDetail = `Alt: ${alt.toFixed(1)}m (Acc: -)`;
    }

    if (alt === 0 && (altAcc === 0 || altAcc === null || altAcc === undefined) && isZeroAcc) {
      altStatus = 'ANOMALI';
      altScore = 30;
      altNote = 'Elevasi bernilai 0.0m konstan tanpa deviasi vertikal dikombinasikan dengan akurasi horizontal 0m.';
      reasons.push('Elevasi 0m konstan tanpa akurasi ketinggian');
      riskScoreCumulative += 25;
    } else {
      altStatus = 'VALID';
      altScore = 100;
      altNote = 'Sensor memancarkan data Ketinggian/Elevasi 3D Fix hardware yang valid.';
    }
  } else {
    // Altitude null adalah hal NORMAL pada banyak browser / perangkat indoor.
    altStatus = 'VALID';
    altScore = 100;
    altDetail = 'Ketinggian Tidak Tersedia (Null)';
    altNote = 'Sinyal satelit 3D Fix vertikal tidak tersedia (Perangkat Indoor / Browser Standar). Normal.';
  }

  // --------------------------------------------------------------------------
  // 5. HISTORICAL CONSISTENCY ANALYSIS
  // --------------------------------------------------------------------------
  let consStatus: 'VALID' | 'ANOMALI' | 'WARNING' = 'VALID';
  let consScore = 100;
  let consDetail = `${gpsFixHistory.length} Fix Terakumulasi`;
  let consNote = 'Pola histori konsisten.';

  if (gpsFixHistory.length >= 3) {
    // Cek apakah akurasi persis sama/beku pada 5 fix berturut-turut
    const recentAccs = gpsFixHistory.map(item => item.accuracy).filter(a => a !== null);
    if (recentAccs.length >= 4) {
      const allSame = recentAccs.every(val => val === recentAccs[0]);
      if (allSame && recentAccs[0] !== null && recentAccs[0] < 5) {
        consStatus = 'WARNING';
        consScore = 60;
        consNote = `Nilai akurasi (${recentAccs[0]}m) beku konstan dalam ${recentAccs.length} fix berturut-turut.`;
        riskScoreCumulative += 15;
      }
    }
  }

  // --------------------------------------------------------------------------
  // FINAL RISK SCORE & LEVEL DETERMINATION
  // --------------------------------------------------------------------------
  // Cap risk score between 0 and 100
  const finalRiskScore = Math.min(100, Math.max(0, riskScoreCumulative));
  const overallScore = Math.max(0, 100 - finalRiskScore);

  let riskLevel: GpsRiskLevel = 'NORMAL';
  if (finalRiskScore >= 70) {
    riskLevel = 'HIGH_RISK';
  } else if (finalRiskScore >= 50) {
    riskLevel = 'SUSPICIOUS';
  } else if (finalRiskScore >= 30) {
    riskLevel = 'WARNING';
  } else {
    riskLevel = 'NORMAL';
  }

  // Determine GPS Quality Grade based on horizontal accuracy & availability
  let qualityGrade: GpsQualityGrade = 'EXCELLENT';
  if (acc === null || acc > 500) {
    qualityGrade = 'POOR';
  } else if (acc > 100) {
    qualityGrade = 'FAIR';
  } else if (acc > 25) {
    qualityGrade = 'GOOD';
  } else {
    qualityGrade = 'EXCELLENT';
  }

  // isFake is TRUE ONLY for HIGH_RISK or strong SUSPICIOUS with explicit reasons
  const isFake = riskLevel === 'HIGH_RISK' || (riskLevel === 'SUSPICIOUS' && reasons.length >= 2);

  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' =
    finalRiskScore >= 70 ? 'HIGH' : finalRiskScore >= 50 ? 'MEDIUM' : finalRiskScore >= 30 ? 'LOW' : 'NONE';

  const evaluations: {
    timestamp: ParameterEvaluation;
    accuracy: ParameterEvaluation;
    elevation: ParameterEvaluation;
  } = {
    timestamp: {
      parameterName: 'Timestamp Hardware Delta (ms)',
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

  const signals = {
    movement: {
      status: moveStatus,
      score: moveScore,
      detail: moveDetail,
      note: moveNote,
      calculatedSpeedKmh,
      distanceMeters
    },
    timestamp: {
      status: tsStatus,
      score: tsScore,
      detail: tsDetail,
      note: tsNote,
      timeDeltaMs: calculatedDeltaMs,
      isStagnant
    },
    accuracy: {
      status: accStatus,
      score: accScore,
      detail: accDetail,
      note: accNote,
      currentAccuracyMeters: acc,
      isZeroAccuracy: isZeroAcc
    },
    altitude: {
      status: altStatus,
      score: altScore,
      detail: altDetail,
      note: altNote,
      altitudeMeters: alt
    },
    consistency: {
      status: consStatus,
      score: consScore,
      detail: consDetail,
      note: consNote,
      patternNotes: `Histori: ${gpsFixHistory.length} fix terekam.`
    }
  };

  const summaryText = isFake
    ? `Anomali GPS Terdeteksi (${riskLevel}): ${reasons.join(', ')}`
    : riskLevel === 'SUSPICIOUS' || riskLevel === 'WARNING'
    ? `Kualitas GPS ${qualityGrade} (${riskLevel}): ${reasons.length > 0 ? reasons.join(', ') : 'Pergerakan / sinyal agak tidak teratur'}`
    : `GPS Valid (${qualityGrade} - Risk Score: ${finalRiskScore}/100)`;

  return {
    isFake,
    reason: isFake ? reasons.join('; ') : (reasons.length > 0 ? `Perhatian: ${reasons.join('; ')}` : 'GPS Valid'),
    confidence,
    overallScore,
    timeDeltaMs: calculatedDeltaMs,
    isTimestampStagnant: isStagnant,
    evaluations,

    riskLevel,
    riskScore: finalRiskScore,
    qualityGrade,
    reasons,
    signals,
    diagnostics: {
      speedKmh: calculatedSpeedKmh,
      distanceMeters,
      elapsedSeconds,
      fixCountInHistory: gpsFixHistory.length,
      summaryText
    },
    capturedAt
  };
}



