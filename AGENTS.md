# Project Guidelines & Architecture Rules

## Mandatory Rules
- **No Unapproved Changes**: Never modify business rules, workflows, role hierarchies, or core logic without explicit approval from the user.
- **Role-Based Scope Rule**: When a prompt or sentence begins with a specific **ROLE** (e.g., `MANAGER`, `FINANCE`, `DIREKTUR`, `ADMIN`, etc.), apply any modifications, UI changes, logic updates, or actions strictly and exclusively for that specified role.

## Hierarchy & Approval Rules
- **DIREKTUR Approval Role**: The direct supervisor for **MANAGER** and **FINANCE** roles is **DIREKTUR**.
  - Requests created by **MANAGER** or **FINANCE** must be approved by **DIREKTUR** (under the `DIREKTUR_APPROVAL` flow).
  - Reconciliations / Usage reports submitted by **MANAGER** or **FINANCE** must be reviewed under the `DIREKTUR_RECONCILIATION` flow.

## Fuel Request Logic (BBM Duren Sawit)
- BBM Duren Sawit items (`OPT-` prefix / `BBMDS` / `DUREN SAWIT`) represent physical fuel purchase logs at Duren Sawit.
- **Form Pre-fill**: Default `siteId` is `OPT-DUREN SAWIT` and `siteName` is `BBM DUREN SAWIT`.
- **Reporting Flow**:
  - When fuel is filled at Duren Sawit, the report is submitted directly.
  - Status transitions to `REPORTING` once submitted.
- **Multiple Refills Allowed**: Tidak ada batasan 1 kali pengisian per hari untuk BBM Duren Sawit. Pengguna berwenang dapat mencatat pengisian BBM lebih dari 1 kali dalam sehari.
- **Role Privileges**:
  - `MANAGER`, `FINANCE`, and `DIREKTUR` have direct access to view, log, and process BBM Duren Sawit entries.

## Daily Activity Log & Offline Mode Rules (Laporan Kegiatan Harian) - [LOCKED]
- **Status: STRICTLY LOCKED**: The flow, watermark tagging, GPS validation, and IndexedDB offline mode logic for Laporan Kegiatan Harian are strictly **LOCKED**. No changes are allowed without explicit approval from the user.
- **Real-time GPS & Watermarking**:
  - Activity photos must be compressed and stamped with permanent watermarks (Timestamp, GPS Coordinates, Site ID, Site Name, User Email).
- **Offline Mode (IndexedDB Internal Device Storage)**:
  - When offline or when network errors occur, activity logs (with watermarked photos) are saved to **IndexedDB (Internal HP Storage)**.
- **User UI Terminology**: User interface must show clean, simple status text:
  - `BELUM DISINKRONKAN` / `Laporan Belum Disinkronkan` (when saved on device awaiting network connection).
  - `Disinkronkan` / `Menyinkronkan Laporan...` (during/after sync).
  - Avoid technical developer jargon like `IndexedDB`, `LocalStorage`, `Base64`, or `Database Server` in user notifications.
- **Auto-Sync**: Automatically syncs pending offline reports to server when network connection is restored.
- **Auto-Cleanup**: Offline entries are deleted from device storage only after successful upload to the server database.

## Finance Approved Amount Logic (`getFinanceApprovedAmount`) - [LOCKED]
- **Status: STRICTLY LOCKED**: Logika fungsi `getFinanceApprovedAmount` telah dikunci. Tidak boleh ada perubahan pada fungsi ini dalam kode maupun alurnya tanpa konfirmasi/persetujuan eksplisit dari pengguna.
- **Rules**:
  - **Prefix `OPT-` (Dana Talangan)**: Nominal diambil murni dari total nominal database Laporan (`UsageReportItem`) dengan `statusManager === ItemStatus.APPROVED` dan `statusAdmin === ItemStatus.APPROVED`.
  - **Prefix `OP-` (Operasional Biasa)**: Nominal diambil murni dari database `ItemReviewHistory` (Prioritas Utama saja) dengan `actorRole === Role.FINANCE`, `actionType === 'APPROVAL_FINANCE'`, `status` disetujui, dan `nominal > 0`. Jika belum ada, mengembalikan `0`.

## Transfer Bertahap Logic (`getTransferBertahap`) - [LOCKED]
- **Status: STRICTLY LOCKED**: Logika fungsi `getTransferBertahap` telah dikunci. Tidak boleh ada perubahan pada fungsi ini dalam kode maupun alurnya tanpa konfirmasi/persetujuan eksplisit dari pengguna.
- **Rules**:
  - Mengembalikan `TRUE` jika `req.adminActionAmount` kurang dari `getFinanceApprovedAmount`.
  - Mengembalikan `FALSE` jika `req.adminActionAmount` sama dengan `getFinanceApprovedAmount`.

## Dashboard & UI Card Rules
- **Transfer Status Label**: Use strictly **"SUDAH DITRANSFER"** for `TRANSFERRED` status cards.
- **Self-Approve Restriction**: On `SUBMISSION` tab (Pengajuan Saya), do NOT display review/approve buttons to prevent self-approval. Review actions are strictly located on the `APPROVAL` tab.

## Web Push Notification Feature - [LOCKED]
- **Status: STRICTLY LOCKED**: Fitur Push Notifikasi (pengaturan token, service worker, alur subscribe/unsubscribe, blast/broadcast, dan endpoint `/api/push/*`) telah dikunci. Tidak boleh ada modifikasi, penambahan UI blast/broadcast, atau perubahan alur tanpa konfirmasi/persetujuan eksplisit dari pengguna.
- **BBM Duren Sawit Excluded**: Transaksi / pengisian BBM Duren Sawit (prefix `BBMDS`, `OPT-DUREN SAWIT`, atau keterangan `BBM DUREN SAWIT`) dikecualikan dari pengiriman push notifikasi. Sistem tidak akan mengirimkan push notifikasi ke Finance, Manager, Direktur, maupun pemohon untuk aktivitas pengisian BBM Duren Sawit.

## Lapor Dana Talangan Pribadi Flow (2-Step Form) - [LOCKED]
- **Status: STRICTLY LOCKED**: Alur pengisian dan pemisahan form Lapor Dana Talangan Pribadi menjadi 2 bagian berurutan telah **DIKUNCI**. Tidak boleh ada perubahan pada struktur 2 bagian, tombol navigasi, validasi, maupun alurnya tanpa konfirmasi/persetujuan eksplisit dari pengguna.
- **Rules & Form Structure**:
  - **Bagian 1 (Informasi Kegiatan & Lokasi)**:
    - Berisi: Tanggal Laporan (terkunci otomatis ke hari ini / `readOnly`), Site ID / Lokasi Pemakaian, dan Keterangan Umum Kegiatan / Tujuan Talangan.
    - Tombol aksi: `Lanjutkan Isi Item Laporan >>`.
    - Validasi: Memvalidasi kelengkapan Site ID dan Keterangan sebelum beralih ke Bagian 2.
  - **Bagian 2 (Rincian Item Pertama Dana Talangan)**:
    - Tampil setelah Bagian 1 divalidasi dan tombol `Lanjutkan Isi Item Laporan >>` diklik.
    - Menampilkan ringkasan data Bagian 1 dengan tombol `Ubah` jika pemohon ingin kembali mengedit.
    - Berisi: Tanggal Nota / Kuitansi, Nominal Pengeluaran (Rupiah), Keterangan, dan Foto Bukti Nota / Kuitansi (Kamera HP Native / Galeri).
    - Tombol aksi: `<< Kembali` untuk kembali ke Bagian 1 dan `Simpan Laporan Dana Talangan` untuk menyimpan pengajuan ke database.
    - Penyimpanan hanya dapat dilakukan setelah item pertama diisi lengkap (nominal > 0, keterangan, dan foto bukti nota).

## Device ID Logic & Persistence Flow - [LOCKED]
- **Status: STRICTLY LOCKED**: Alur, logika, dan arsitektur persistensi Device ID telah dikunci secara ketat. Tidak boleh ada perubahan pada fungsi, alur pengikatan (binding), validasi, maupun media penyimpanan tanpa konfirmasi dan persetujuan eksplisit dari pengguna.
- **Rules & Specifications**:
  - **Generation**: Format Device ID menggunakan kombinasi hardware fingerprint: `DEV-MOB-${screenWidth}x${screenHeight}-${randomSeed}` (dengan `crypto.randomUUID()` 8 karakter alfanumerik acak).
  - **Multi-Vault Storage**: Device ID disimpan secara redundan dan sinkron pada:
    1. `localStorage` (`op_app_device_id` & `op_app_device_id_backup`)
    2. `sessionStorage` (`op_app_device_id`)
    3. Document Cookie (`SameSite=Lax`, path `/`, masa berlaku 10 tahun / 3650 hari)
    4. `IndexedDB` internal (`DIOMS_DEVICE_DB`, store `device_meta` dengan kunci `op_device_id` dan `bound_device_{userEmail}`)
    5. StorageManager Persistent Storage Lock (`navigator.storage.persist()`) otomatis saat aplikasi dimuat dan saat sinkronisasi Device ID.
  - **Self-Healing / Auto-Recovery**: Jika Device ID hilang dari salah satu penyimpanan (misal pembersihan cache parsial), sistem otomatis memulihkan nilainya dari lapisan cadangan (IndexedDB/Cookie) dan menyinkronkan kembali ke seluruh lapisan.
  - **Binding & Access Control (`validateDeviceAccessAndBind`)**:
    - Pengguna dengan `Mobile = TRUE` wajib login dari perangkat mobile (Android/iOS). Login dari PC ditolak.
    - Pada login pertama di mobile, Device ID perangkat dikunci ke profil pengguna di database (Google Sheets kolom `DeviceID`).
    - Login berikutnya mencocokkan Device ID fisik dengan database. Jika berbeda, akses diblokir dan hanya dapat dibuka kembali melalui Reset Device ID oleh Administrator.
    - Satu perangkat mobile yang telah terikat tidak dapat digunakan oleh akun lain yang juga berstatus `Mobile = TRUE`.

