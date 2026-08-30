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
