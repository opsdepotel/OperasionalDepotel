# Dokumen Rekomendasi & Peta Jalan Pengembangan (Roadmap Audit)

**Tanggal Penyusunan:** 13 Oktober 2026  
**Status Dokumen:** Rencana Evaluasi & Arsip Pengembangan Mendatang (Belum Dieksekusi)  
**Tujuan:** Panduan teknis bertahap untuk meningkatkan performa, efisiensi kuota API, stabilitas render mobile, dan keamanan aplikasi tanpa mengubah logika bisnis baku yang telah berjalan.

---

## 1. Tabel Skala Prioritas Rekomendasi

| Prioritas | Bidang | Rekomendasi Tindakan | Dampak & Nilai Tambah |
| :--- | :--- | :--- | :--- |
| **P1 (Tinggi)** | Kinerja & Jaringan | **Server-side Caching Layer** (TTL 15–30s) pada backend Express API (`server.ts` & `src/api/`) | Mengurangi panggilan berulang ke Google Sheets API hingga 80%, mencegah error *Rate Limit* (`HTTP 429 Too Many Requests`) saat banyak pengguna online bersamaan. |
| **P1 (Tinggi)** | Kinerja Bundel | **Dynamic Code-Splitting** dengan `React.lazy()` & `Suspense` untuk modul Leaflet (Peta), jsPDF (Ekspor PDF), dan ExcelJS | Mempercepat pemuatan awal aplikasi (*First Contentful Paint*) secara drastis di jaringan seluler lapangan yang lambat. |
| **P2 (Sedang)** | Kinerja Antarmuka | **Virtual Scrolling** (menggunakan `@tanstack/react-virtual` atau sejenis) pada tabel riwayat panjang | Mengeliminasi *DOM bloat* dan lag/patah-patah saat *scrolling* di perangkat smartphone Android *low-mid range*. |
| **P2 (Sedang)** | Keamanan & Otorisasi | **Server-Authoritative Action Proxying** untuk verifikasi hak akses (Approval, Reject, Transfer, Adjustment) | Mencegah potensi manipulasi state/token dari peramban klien (*DevTools* / *rooted device*) dengan memastikan server memvalidasi identitas sesi sebelum menulis ke sel spreadsheet. |
| **P2 (Sedang)** | Kecepatan Respon UI | **Pencarian Terjadwal (Debounce / `useDeferredValue`)** pada input filter data | Mencegah pemblokiran thread utama JavaScript saat memfilter ribuan data, sehingga ketikan pencarian terasa responsif tanpa *input lag*. |
| **P3 (Jangka Panjang)** | Arsitektur Kode | **Modularisasi Berbasis Fitur** untuk `App.tsx` (6.100+ baris) dan `DashboardStats.tsx` (4.000+ baris) | Memecah komponen raksasa menjadi sub-komponen terisolasi per peran (Manager, Finance, Admin, Direktur) agar pemeliharaan kode lebih aman dari regresi. |
| **P3 (Jangka Panjang)** | Keandalan Offline | **Perluasan Draft Offline Form** untuk pengajuan Operasional (OP) dan Dana Talangan (OPT) | Memungkinkan petugas di area *blank spot* (tanpa sinyal internet) menyimpan draf pengajuan ke penyimpanan internal sebelum terunggah otomatis saat sinyal kembali. |

---

## 2. Rincian Teknis & Rencana Eksekusi Tiap Prioritas

### Prioritas 1: Kinerja & Jaringan (P1)
1. **Express Server In-Memory Cache**:
   - Menambahkan mekanisme caching sederhana dengan TTL (Time-To-Live) singkat (misal 20 detik) pada endpoint pembacaan tabel database utama di `src/api/googleRoutes.ts`.
   - Menggunakan cache *invalidation* otomatis ketika terjadi penambahan atau perubahan data baru oleh pengguna.
2. **Code-Splitting On-Demand**:
   - Memindahkan impor statis library berat:
     - `leaflet` dan container peta interaktif -> Dimuat hanya saat modal peta/rute dibuka.
     - `jspdf` dan `jspdf-autotable` -> Dimuat hanya saat tombol cetak/ekspor PDF ditekan.
     - `exceljs` dan `xlsx` -> Dimuat hanya saat tombol ekspor spreadsheet ditekan.

---

### Prioritas 2: Kinerja UI & Penguatan Keamanan (P2)
1. **Virtualisasi DOM**:
   - Tabel riwayat transaksi atau kegiatan harian yang memiliki ratusan baris hanya merender 15–20 elemen yang sedang terlihat di layar layar pengguna (*viewport*).
   - Penggunaan memori RAM browser ponsel tetap rendah dan konstan berapa pun jumlah data yang ada.
2. **Pengecekan Akses Sisi Server**:
   - Menjadikan endpoint server Express sebagai penentu keputusan final validasi hak akses peran (Role Validation) sebelum memperbarui status dokumen di Google Sheets.
3. **Optimasi Filter Pencarian**:
   - Menggunakan hook bawaan React 19 `useDeferredValue` pada teks pencarian tabel untuk memprioritaskan kelancaran animasi antarmuka pengguna.

---

### Prioritas 3: Pemeliharaan Kode & Fitur Lanjutan (P3)
1. **Refactoring Bertahap File Monolitik**:
   - Membagi `DashboardStats.tsx` menjadi file komponen mandiri:
     - `components/dashboard/ManagerDashboardStats.tsx`
     - `components/dashboard/FinanceDashboardStats.tsx`
     - `components/dashboard/AdminDashboardStats.tsx`
     - `components/dashboard/DirectorDashboardStats.tsx`
   - Memisahkan modal-modal independen dari `App.tsx` tanpa menyentuh alur navigasi atau logika bisnis.
2. **Offline Draft Expansion**:
   - Menerapkan arsitektur IndexedDB yang serupa dengan *Laporan Kegiatan Harian* pada form pengajuan biasa, sehingga formulir tidak hilang jika jaringan terputus tiba-tiba saat pengisian.

---

## 3. Catatan Integritas & Kepatuhan Aturan Proyek (`AGENTS.md`)
Dalam setiap tahapan eksekusi di masa mendatang, pengembangan wajib **mematuhi secara ketat** aturan yang telah dikunci:
1. **Dilarang keras mengubah formula matematis saldo operasional**, aturan filter BBM Duren Sawit, dan kalkulasi `getFinanceApprovedAmount`.
2. **Dilarang memodifikasi arsitektur Device ID (Token UUID 4-Layer Vault)** dan logika binding mobile.
3. **Dilarang memodifikasi modul `fakeGpsDetector.ts`** (5 parameter evaluasi dan toleransi deteksi GPS).
4. **Dilarang mengubah alur 2-Step Form Dana Talangan Pribadi** dan aturan push notification yang telah berstatus *STRICTLY LOCKED*.
