# Dashboard Toko H Endun

Dashboard toko berbasis HTML/CSS/JavaScript + Firebase yang siap di-host sebagai static site di GitHub Pages.

## Fitur

- Login email/password dan Google melalui Firebase Authentication.
- CRUD barang dengan satuan pcs/box/dus/karton/custom.
- Harga total, isi per satuan, dan harga per pcs otomatis.
- Search barang memakai cache lokal sehingga tidak melakukan Firestore read setiap ketikan.
- Stock opname Kurang/Lebih dengan input qty dalam pcs atau kemasan.
- Riwayat stock opname per akun, lihat/edit/hapus/export Excel.
- Import Excel menggunakan ExcelJS dan normalisasi data lama.
- Export daftar barang ke Excel.
- Histori perubahan harga (`price_history`) + daftar statistik + grafik.
- Maintenance overlay melalui `maintenance-config.json`.
- Data lama yang belum memiliki `satuan`, `isiPerSatuan`, `barangId`, atau `entryId` tetap dibaca dengan fallback.

## Upload ke GitHub Pages

1. Upload **isi folder ini** ke root repository GitHub, bukan folder pembungkus ZIP-nya.
2. Buka repository → **Settings → Pages**.
3. Pada **Build and deployment**, pilih **Deploy from a branch**.
4. Pilih branch `main` dan folder `/ (root)` lalu Save.
5. Tunggu deployment GitHub Pages selesai, lalu buka URL Pages repository.

Tidak ada build step, `npm install`, atau framework yang diperlukan untuk website utama.

## Firebase

Konfigurasi Firebase web berada di `main.js` dan tetap menggunakan project `toko-eaa04` yang sudah dipakai proyek lama.

Aktifkan provider yang digunakan pada Firebase Console → Authentication:

- Email/Password
- Google

### Firestore Rules

File `firestore.rules` disertakan sebagai rules yang direkomendasikan. **GitHub Pages tidak dapat mendeploy Firestore Rules.** Salin isi file tersebut ke Firebase Console → Firestore Database → Rules lalu Publish, atau deploy dengan Firebase CLI.

Rules bawaan proyek ini mempertahankan perilaku aplikasi sekarang: semua akun Firebase yang berhasil login dapat mengelola koleksi `barang`, sedangkan `stock_opname` hanya dapat dibaca/diubah oleh pemilik (`uid`). Jika website hanya boleh dipakai admin tertentu, nonaktifkan pendaftaran publik atau tambahkan sistem role/allowlist pada Firebase sebelum dipakai untuk lingkungan sensitif.

## Format Excel Import

File `.xlsx` / `.xlsm` didukung. Header dapat berada pada salah satu dari 10 baris pertama.

Kolom wajib:

- `Nama Barang` atau `Nama`
- `Harga Total` atau `Harga`

Kolom opsional:

- `Satuan`
- `Isi per Satuan` atau `Isi`

Jika kolom opsional tidak tersedia, item otomatis dianggap `pcs` dengan isi `1`.

## Maintenance

Edit langsung:

```json
{"maintenance":true}
```

atau lokal dengan Node.js 18+:

```bash
node perbaikan.js on
node perbaikan.js off
```

Untuk mengubah file langsung melalui GitHub API:

```bash
GITHUB_TOKEN=token_kamu node perbaikan.js on --github
```

Token tidak pernah disimpan di source code dan tidak diminta sebagai input terminal yang terlihat.

## Struktur data utama

### `barang/{barangId}`

- `nama`
- `harga`
- `satuan`
- `isiPerSatuan`
- `hargaSatuan`
- `editedAt`
- `editedBy`
- `hargaLama` (compatibility / perubahan terakhir)

### `price_history/{historyId}`

- `barangId`
- `namaLama`
- `nama`
- `hargaLama`
- `hargaBaru`
- `timestamp`
- `uid`
- `editedBy`

### `stock_opname/{opnameId}`

- `judul`
- `uid`
- `timestamp`
- `updatedAt`
- `kurang[]`
- `lebih[]`

Item stock opname baru menyimpan `entryId`, `barangId`, qty dasar dalam pcs, satuan, harga kemasan, harga per pcs, dan total.

## Catatan keamanan

Firebase Web API key memang boleh berada di frontend. Yang menentukan keamanan database adalah Authentication dan Firestore Security Rules. Jangan menaruh GitHub Personal Access Token, password admin, atau secret lain di repository.
