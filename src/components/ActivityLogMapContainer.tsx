/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import { UserActivity, UserProfile, SiteInfo } from '../types';
import { MapPin, Calendar, User, Filter, RefreshCw, X, ExternalLink, Camera, Compass, Navigation, Layers, ShieldCheck } from 'lucide-react';

interface ActivityLogMapContainerProps {
  activities: UserActivity[];
  profiles?: UserProfile[];
  sites?: SiteInfo[];
  selectedDate: string;
  onClose?: () => void;
  onSelectPhoto?: (act: UserActivity) => void;
}

// Helper to parse coordinate string safely
function parseCoords(coordStr?: string | null): { lat: number; lng: number } | null {
  if (!coordStr || typeof coordStr !== 'string') return null;
  const clean = coordStr.replace(/[()\[\]]/g, '').trim();
  const lower = clean.toLowerCase();
  if (
    lower.includes('tidak') ||
    lower.includes('belum') ||
    lower.includes('gagal') ||
    lower.includes('error') ||
    lower.includes('mencari') ||
    lower.includes('null') ||
    lower.includes('undefined')
  ) {
    return null;
  }
  const parts = clean.split(/[\s,]+/);
  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
      return { lat, lng };
    }
  }
  return null;
}

// Ensure Leaflet CSS is dynamically loaded in document head
function injectLeafletCss() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('leaflet-css-cdn')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css-cdn';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.crossOrigin = '';
    document.head.appendChild(link);
  }
}

export const ActivityLogMapContainer: React.FC<ActivityLogMapContainerProps> = ({
  activities,
  profiles = [],
  sites = [],
  selectedDate,
  onClose,
  onSelectPhoto,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const [filterDate, setFilterDate] = useState<string>(selectedDate || new Date().toISOString().split('T')[0]);
  const [mapMode, setMapMode] = useState<'LATEST' | 'ROUTE'>('LATEST');
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>('ALL');
  const [selectedDivisi, setSelectedDivisi] = useState<string>('ALL');

  // Inject Leaflet CSS on mount
  useEffect(() => {
    injectLeafletCss();
  }, []);

  // Filter available divisions
  const allDivisions = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach(p => {
      if (p.divisi && p.divisi.trim()) set.add(p.divisi.trim());
    });
    return Array.from(set).sort();
  }, [profiles]);

  // Unique list of users from activities or profiles
  const userList = useMemo(() => {
    const map = new Map<string, { email: string; name: string; divisi?: string }>();
    profiles.forEach(p => {
      const emailClean = p.email.toLowerCase().trim();
      if (emailClean) {
        map.set(emailClean, {
          email: emailClean,
          name: p.nama || p.userId || p.email,
          divisi: p.divisi,
        });
      }
    });

    activities.forEach(act => {
      const emailClean = (act.userEmail || '').toLowerCase().trim();
      if (emailClean && !map.has(emailClean)) {
        map.set(emailClean, {
          email: emailClean,
          name: act.userName || emailClean,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [activities, profiles]);

  // Filter activities matching the filter parameters
  const validMapActivities = useMemo(() => {
    return activities.filter(act => {
      // Date filter
      if (filterDate) {
        const actDate = act.tanggal?.trim() || '';
        if (actDate && actDate !== filterDate) {
          // Normalize check
          const normAct = actDate.replace(/\//g, '-');
          const normFilter = filterDate.replace(/\//g, '-');
          if (normAct !== normFilter && !actDate.includes(filterDate)) {
            return false;
          }
        }
      }

      // User filter
      if (selectedUserEmail !== 'ALL') {
        if (act.userEmail.toLowerCase().trim() !== selectedUserEmail.toLowerCase().trim()) {
          return false;
        }
      }

      // Division filter
      if (selectedDivisi !== 'ALL') {
        const prof = profiles.find(p => p.email.toLowerCase().trim() === act.userEmail.toLowerCase().trim());
        const userDiv = prof?.divisi?.trim().toLowerCase() || '';
        if (userDiv !== selectedDivisi.toLowerCase().trim()) {
          return false;
        }
      }

      // Must have valid actual coordinates
      const coords = parseCoords(act.coordinatesActual) || parseCoords(act.coordinatesDb);
      return !!coords;
    });
  }, [activities, filterDate, selectedUserEmail, selectedDivisi, profiles]);

  // Grouped by User to find latest position or map routes
  const activitiesByUser = useMemo(() => {
    const grouped = new Map<string, UserActivity[]>();
    validMapActivities.forEach(act => {
      const key = act.userEmail.toLowerCase().trim();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(act);
    });

    // Sort each user's activities chronologically (oldest to newest) for routes
    grouped.forEach((list) => {
      list.sort((a, b) => {
        const timeA = a.createdAt || a.timestamp || '';
        const timeB = b.createdAt || b.timestamp || '';
        return timeA.localeCompare(timeB);
      });
    });

    return grouped;
  }, [validMapActivities]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // Standard center: Indonesia default [-2.548926, 118.014863]
      const map = L.map(mapContainerRef.current, {
        center: [-2.548926, 118.014863],
        zoom: 5,
        zoomControl: true,
      });

      // OpenStreetMap clean public tile layer (100% Free & No Watermark)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const layerGroup = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
      layerGroupRef.current = layerGroup;

      // Invalidate size after modal animation finishes
      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 250);
    }

    // Cleanup on component unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        layerGroupRef.current = null;
      }
    };
  }, []);

  // Update map markers and polylines whenever data or filters change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    // Clear existing layers
    layerGroup.clearLayers();

    const bounds: L.LatLngBounds = L.latLngBounds([]);
    let totalPointsCount = 0;

    // Generate Custom SVG DivIcon
    const createMarkerIcon = (
      labelNumber: string,
      titleText: string,
      colorHex: string = '#4f46e5',
      isLatest: boolean = false
    ) => {
      const pulseRing = isLatest ? `<div style="position: absolute; top: -6px; left: -6px; width: 44px; height: 44px; border-radius: 50%; background: ${colorHex}; opacity: 0.25; animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : '';

      const svgHtml = `
        <div style="position: relative; width: 32px; height: 40px; display: flex; flex-direction: column; items-center: center; align-items: center;">
          ${pulseRing}
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${colorHex}; border: 2.5px solid #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 800; font-size: 11px; font-family: system-ui, sans-serif;">
            ${labelNumber}
          </div>
          <div style="width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid ${colorHex}; margin-top: -1px;"></div>
        </div>
      `;

      return L.divIcon({
        html: svgHtml,
        className: 'leaflet-custom-div-icon',
        iconSize: [32, 40],
        iconAnchor: [16, 40],
        popupAnchor: [0, -38],
      });
    };

    // Color palette per user for clear distinction
    const userColors = [
      '#4f46e5', // Indigo
      '#059669', // Emerald
      '#d97706', // Amber
      '#dc2626', // Red
      '#0284c7', // Sky
      '#7c3aed', // Purple
      '#db2777', // Pink
      '#0d9488', // Teal
    ];

    let userIndex = 0;

    if (mapMode === 'LATEST') {
      // Plot ONLY latest activity for each user
      activitiesByUser.forEach((userActs, emailKey) => {
        if (userActs.length === 0) return;
        const latestAct = userActs[userActs.length - 1]; // Newest
        const coords = parseCoords(latestAct.coordinatesActual) || parseCoords(latestAct.coordinatesDb);
        if (!coords) return;

        const color = userColors[userIndex % userColors.length];
        userIndex++;

        const prof = profiles.find(p => p.email.toLowerCase().trim() === emailKey);
        const displayName = prof?.nama || latestAct.userName || prof?.userId || emailKey;
        const userDivisi = prof?.divisi || 'Operasional';

        const latLng: [number, number] = [coords.lat, coords.lng];
        bounds.extend(latLng);
        totalPointsCount++;

        const initials = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U';
        const markerIcon = createMarkerIcon(initials, displayName, color, true);

        const popupContent = document.createElement('div');
        popupContent.className = 'p-1.5 space-y-2 text-xs font-sans max-w-[240px]';
        popupContent.innerHTML = `
          <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 6px;">
            <div style="font-weight: 800; color: #0f172a; font-size: 13px;">${displayName}</div>
            <div style="font-size: 10px; font-weight: 700; color: #4338ca; background: #e0e7ff; display: inline-block; padding: 2px 6px; border-radius: 4px; margin-top: 3px;">${userDivisi}</div>
          </div>
          <div style="color: #475569; line-height: 1.4;">
            <div style="font-weight: 700; color: #1e293b;">📍 Site: ${latestAct.siteId} - ${latestAct.siteName || ''}</div>
            <div style="font-size: 11px; margin-top: 4px; color: #334155;">💬 ${latestAct.keterangan || '-'}</div>
            <div style="font-size: 10px; color: #64748b; margin-top: 6px; font-weight: 600;">🕒 Waktu: ${latestAct.tanggal} ${latestAct.createdAt ? (latestAct.createdAt.includes(',') ? latestAct.createdAt.split(',')[1]?.trim() : latestAct.createdAt) : ''}</div>
          </div>
          <div style="margin-top: 10px; display: flex; gap: 6px;">
            <a href="https://www.google.com/maps?q=${coords.lat},${coords.lng}" target="_blank" rel="noopener noreferrer" style="background: #e0e7ff; color: #3730a3; font-weight: 700; font-size: 10px; padding: 4px 8px; border-radius: 6px; text-decoration: none; display: flex; align-items: center; gap: 4px;">
              Buka Google Maps ↗
            </a>
          </div>
        `;

        const marker = L.marker(latLng, { icon: markerIcon }).bindPopup(popupContent);
        layerGroup.addLayer(marker);
      });
    } else {
      // ROUTE MODE: Plot all chronological points for user(s) with polyline
      activitiesByUser.forEach((userActs, emailKey) => {
        if (userActs.length === 0) return;

        const color = userColors[userIndex % userColors.length];
        userIndex++;

        const prof = profiles.find(p => p.email.toLowerCase().trim() === emailKey);
        const displayName = prof?.nama || userActs[0]?.userName || prof?.userId || emailKey;
        const latLngs: [number, number][] = [];

        userActs.forEach((act, idx) => {
          const coords = parseCoords(act.coordinatesActual) || parseCoords(act.coordinatesDb);
          if (!coords) return;

          const latLng: [number, number] = [coords.lat, coords.lng];
          latLngs.push(latLng);
          bounds.extend(latLng);
          totalPointsCount++;

          const isLatest = idx === userActs.length - 1;
          const labelNum = String(idx + 1);
          const markerIcon = createMarkerIcon(labelNum, `${displayName} - ${idx + 1}`, color, isLatest);

          const popupContent = document.createElement('div');
          popupContent.className = 'p-1.5 space-y-2 text-xs font-sans max-w-[240px]';
          popupContent.innerHTML = `
            <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 6px;">
              <div style="font-weight: 800; color: #0f172a; font-size: 13px;">${displayName} (Titik #${idx + 1})</div>
              <div style="font-size: 10px; font-weight: 700; color: #065f46; background: #d1fae5; display: inline-block; padding: 2px 6px; border-radius: 4px; margin-top: 3px;">Site: ${act.siteId}</div>
            </div>
            <div style="color: #475569; line-height: 1.4;">
              <div style="font-weight: 700; color: #1e293b;">🏢 ${act.siteName || act.siteId}</div>
              <div style="font-size: 11px; margin-top: 4px; color: #334155;">💬 ${act.keterangan || '-'}</div>
              <div style="font-size: 10px; color: #64748b; margin-top: 6px; font-weight: 600;">🕒 Waktu: ${act.tanggal} ${act.createdAt ? (act.createdAt.includes(',') ? act.createdAt.split(',')[1]?.trim() : act.createdAt) : ''}</div>
            </div>
            <div style="margin-top: 10px;">
              <a href="https://www.google.com/maps?q=${coords.lat},${coords.lng}" target="_blank" rel="noopener noreferrer" style="background: #e0e7ff; color: #3730a3; font-weight: 700; font-size: 10px; padding: 4px 8px; border-radius: 6px; text-decoration: none; display: inline-block;">
                Buka Google Maps ↗
              </a>
            </div>
          `;

          const marker = L.marker(latLng, { icon: markerIcon }).bindPopup(popupContent);
          layerGroup.addLayer(marker);
        });

        // Draw connecting Polyline route if user has >= 2 points
        if (latLngs.length >= 2) {
          const polyline = L.polyline(latLngs, {
            color: color,
            weight: 3.5,
            opacity: 0.8,
            dashArray: '6, 8',
          });
          layerGroup.addLayer(polyline);
        }
      });
    }

    // Auto-fit bounds if we have points
    if (totalPointsCount > 0 && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } else {
      // Default fallback view if no valid points
      map.setView([-2.548926, 118.014863], 5);
    }
  }, [activitiesByUser, mapMode, profiles]);

  // Fit bounds manually
  const handleResetView = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const bounds: L.LatLngBounds = L.latLngBounds([]);
    validMapActivities.forEach(act => {
      const coords = parseCoords(act.coordinatesActual) || parseCoords(act.coordinatesDb);
      if (coords) bounds.extend([coords.lat, coords.lng]);
    });
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } else {
      map.setView([-2.548926, 118.014863], 5);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden flex flex-col mb-6" id="activity-map-container">
      {/* Container Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shrink-0">
            <Compass className="w-5 h-5 text-indigo-300" />
          </div>
          <div>
            <h3 className="font-display font-bold text-sm tracking-tight flex items-center gap-2">
              <span>Peta Lokasi Kegiatan Operasional</span>
              <span className="text-[10px] bg-indigo-500/30 border border-indigo-400/40 text-indigo-200 px-2 py-0.5 rounded-full font-mono">
                Leaflet.js
              </span>
            </h3>
            <p className="text-[11px] text-slate-300 leading-tight mt-0.5">
              Monitoring sebaran lokasi dan rute kunjungan kegiatan pengguna
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleResetView}
            className="flex items-center gap-1.5 bg-slate-800/80 hover:bg-slate-700 text-indigo-200 hover:text-white px-3 py-1.5 rounded-xl border border-slate-700 transition-all text-xs font-semibold cursor-pointer"
            title="Reset tampilan peta ke seluruh lokasi"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Zoom</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Tutup Peta"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Control Toolbar */}
      <div className="bg-slate-50 border-b border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Filter Group */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Mode Selector */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 shadow-2xs">
            <button
              onClick={() => setMapMode('LATEST')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 text-[11px] ${
                mapMode === 'LATEST'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Posisi Terakhir</span>
            </button>
            <button
              onClick={() => setMapMode('ROUTE')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 text-[11px] ${
                mapMode === 'ROUTE'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Rute Perjalanan</span>
            </button>
          </div>

          {/* Date Picker */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
            />
          </div>

          {/* User Filter Dropdown */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-2xs max-w-[200px]">
            <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <select
              value={selectedUserEmail}
              onChange={(e) => setSelectedUserEmail(e.target.value)}
              className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer w-full truncate"
            >
              <option value="ALL">Semua User ({userList.length})</option>
              {userList.map(u => (
                <option key={u.email} value={u.email}>
                  {u.name} {u.divisi ? `(${u.divisi})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Division Filter */}
          {allDivisions.length > 0 && (
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-2xs">
              <Filter className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <select
                value={selectedDivisi}
                onChange={(e) => setSelectedDivisi(e.target.value)}
                className="text-xs font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer max-w-[140px] truncate"
              >
                <option value="ALL">Semua Divisi</option>
                {allDivisions.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Stats Badge */}
        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl">
          <MapPin className="w-3.5 h-3.5 text-indigo-600" />
          <span>{validMapActivities.length} Titik Koordinat Terdeteksi</span>
        </div>
      </div>

      {/* Leaflet Map Canvas */}
      <div className="relative w-full h-[480px] bg-slate-100">
        <div ref={mapContainerRef} className="w-full h-full z-0" id="leaflet-map-element" />

        {/* Overlay empty state if no points found */}
        {validMapActivities.length === 0 && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-xs z-10 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mb-3">
              <MapPin className="w-6 h-6 text-indigo-500" />
            </div>
            <h4 className="font-display font-bold text-slate-900 text-sm">Tidak Ada Data Lokasi GPS</h4>
            <p className="text-xs text-slate-500 max-w-sm mt-1">
              Tidak ditemukan laporan kegiatan dengan koordinat GPS valid untuk filter tanggal ({filterDate}) atau user yang dipilih.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
