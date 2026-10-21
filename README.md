# Dashboard Toko H Endun

## Panel pembeli (etalase)

Pengunjung pertama kali melihat **etalase** (toko online):

- Produk diambil dari **satu dokumen publik** `katalog/etalase` (daftar nama, harga jual, jenis kemasan — tanpa harga modal), sehingga satu kunjungan pembeli hanya memakai **1 pembacaan** Firestore. Dokumen ini diperbarui otomatis dari panel admin (perubahan beruntun digabung jadi satu penulisan) dan dicek ulang setiap admin login. Batas 5.000 produk.
- Gambar produk berupa model 3D otomatis (`produk3d.js`) sesuai jenis kemasan yang ditebak dari nama/satuan: botol, kaleng, karung, bungkus, kotak/dus. Saat kartu disorot mouse, model 3D berputar mengikuti kursor.
- Barang dengan harga jual 0 tampil "Hubungi toko" dan tidak bisa dimasukkan ke keranjang.
- Saat admin menaikkan/menurunkan harga jual, selama 7 hari kartu produk menampilkan badge **▲ Naik** / **▼ Turun**, harga lama dicoret, dan harga berhitung (animasi counting) dari harga lama ke harga baru. Harga sebelumnya disimpan di field `hargaJualSebelumnya` dokumen barang.
- **Aset sendiri:** foto (`.jpg/.png/.webp`, ditempel jadi label kemasan 3D) atau model 3D (`.glb/.gltf/.obj`) di folder `aset-produk/` menggantikan model otomatis. Bisa diunggah langsung dari panel admin (Harga Jual → **📷 Aset**) lewat GitHub API; token GitHub (fine-grained, hanya repo website, izin *Contents: Read and write*) disimpan di browser perangkat admin saja. Nama file mengikuti nama barang (mis. `aqua-300ml.glb`) dan wajib didaftarkan di `aset-produk/daftar.json` — jalankan `node buat-daftar-aset.js` untuk membuatnya otomatis. Panduan lengkap: `aset-produk/README.md`.
- Keranjang disimpan di perangkat pembeli. **Checkout wajib login/daftar**; setelah login pembeli langsung kembali ke checkout (nama penerima, nomor HP, catatan).
- Pesanan disimpan di koleksi `pesanan` berstatus `baru`. Pembeli melihat & bisa membatalkan pesanannya lewat **Pesanan Saya** selama masih `baru`.

Form login dipakai bersama: akun yang terdaftar sebagai admin di `firestore.rules` masuk ke panel admin, akun lain masuk sebagai pembeli.

Di panel admin, tombol **Pesanan** (dengan jumlah pesanan baru) membuka daftar pesanan masuk untuk diubah statusnya: Baru → Diproses → Selesai, atau Dibatalkan. Tombol **Lihat Toko** menampilkan etalase seperti yang dilihat pembeli.

Pendaftaran akun pembeli memerlukan **Enable create (sign-up)** aktif di Firebase Console → Authentication → Settings → User actions.

## Notifikasi pesanan (admin)

- Selama panel admin terbuka, pesanan dipantau **real-time**: badge di tombol **Pesanan** langsung bertambah & tombolnya berdenyut, judul tab menjadi "(3) Admin Toko H Endun", dan halaman Pesanan ikut diperbarui tanpa refresh.
- Tombol **lonceng** di samping tombol logout menyalakan notifikasi sistem PC/HP: "Ada 3 pesanan baru" (berisi kode, nama, total) dan "Pesanan #KODE dibatalkan" (saat pembeli membatalkan). Mengklik notifikasi membuka halaman Pesanan.
- `sw.js` (service worker) diperlukan agar notifikasi tampil di Chrome Android; `manifest.json` + `ikon-192.png`/`ikon-512.png` membuat website bisa dipasang ke Layar Utama (di iPhone notifikasi web hanya berjalan dari website yang sudah ditambahkan ke Layar Utama, iOS 16.4+).
- Batasan: notifikasi hanya dikirim selama panel admin terbuka di browser (boleh di tab belakang/diperkecil). Di HP, browser bisa menidurkan halaman di latar sehingga notifikasi tertunda. Notifikasi saat website tertutup sama sekali memerlukan Firebase Cloud Messaging + Cloud Functions (paket Blaze).

## Struk belanja grosir (admin)

Tombol **🧾 Foto Struk Belanja** di dashboard:

1. **Foto Struk** (kamera HP) atau **Pilih dari Galeri**.
2. Kejelasan foto diperiksa (resolusi, terang, kontras, buram). Bila kurang jelas → diminta **Foto Ulang** (atau "Tetap Baca").
3. Area kertas dipotong otomatis dari latar (dikenali dari warnanya yang putih/netral, jadi meja kayu atau lantai marmer oranye tidak ikut), lalu diubah hitam-putih dengan ambang adaptif (bayangan & tinta thermal pudar tetap terbaca). Teks dibaca **di browser** dengan Tesseract.js (gratis, bahasa Indonesia + Inggris; unduhan pertama ±5 MB) dua kali bersamaan dengan setelan berbeda; baris yang hasilnya berbeda dibaca ulang dari dua varian gambar lain lalu diputuskan dengan suara terbanyak — ±15–25 detik di PC, lebih lama di HP. Bila tulisan sulit dibaca / tidak ada baris harga → diminta foto ulang.
4. Mendukung format "nama di satu baris, lalu `qty SATUAN harga total` di baris berikutnya" (PAK, BKS, PCS, RCG, DUS, STRI, KLG, BOX, …; umum di grosir) maupun "nama + harga dalam satu baris". Baris "bon di buku" / "bon lanjutan" / subtotal dilewati. Harga dianggap **pasti** hanya bila harga × qty = total **dan** minimal dua pembacaan sepakat tanpa ada yang menyangkal (huruf dot-matrix sering tertukar 6↔4, 5↔3). Selain itu baris ditandai **⚠ angka kurang jelas** dengan tombol pilihan angka — ketuk angka yang sesuai foto — dan tidak dicentang otomatis.

   Uji pada 6 struk grosir asli (190 barang): 73% harga pasti & semuanya benar, 21% ragu dengan angka benar ada di pilihan, sisanya tidak terbaca / perlu diisi manual; tidak ada harga salah yang dianggap pasti.
5. Setiap barang dicocokkan dengan barang di website dan dibandingkan dengan **harga modal**: ▲ naik, ▼ turun, = sama. Harga struk per pcs untuk barang per dus otomatis dikalikan isi per dus; harga per pak/slop untuk barang per bungkus ditebak dibagi 10/12/20/... (ditandai "tebakan").
6. Periksa tabel: yang cocoknya meyakinkan & angkanya pasti sudah dicentang. Nama barang & harga bisa dikoreksi; baris yang tidak dicentang tidak diubah. Selisih > 40% tidak dicentang otomatis.
7. **Terapkan** → harga modal diperbarui + tercatat di riwayat harga (`sumber: "struk"`), foto asli & **foto bertanda** (kotak merah ▲ / hijau ▼ pada baris yang berubah) diunggah ke folder `struk/` di repo GitHub, dan catatan struk (beserta foto kecil) disimpan di koleksi Firestore `struk`.

Nama di struk yang sudah dicek diingat di `meta/alias_struk` (mis. "MINYAK GRG BIMOLI 2L" → "Minyak Goreng Bimoli 2L"), sehingga struk berikutnya dari grosir yang sama otomatis cocok. Upload foto memakai token GitHub yang sama dengan upload aset (Harga Jual → 📷 Aset → Pengaturan GitHub); tanpa token, hanya foto kecil di database yang disimpan. Harga jual tidak diubah otomatis — cek halaman Harga Jual untuk barang yang modalnya naik.

## Hemat kuota Firestore

Paket gratis Firestore dibatasi 50.000 pembacaan/hari. Agar tidak cepat habis:

- **Data barang admin disimpan di perangkat** (maks. 6 jam). Saat halaman admin dibuka lagi, hanya barang yang berubah (field `diubah`, waktu server) dan 1 dokumen `meta/barang` (catatan barang yang dihapus) yang dibaca. Setelah 6 jam dibaca penuh sekali. Cache dihapus saat logout.
- **Etalase** membaca 1 dokumen `katalog/etalase`.
- **Riwayat harga** (statistik) dibaca sekali per sesi.
- **Pesanan**: jumlah pesanan baru dihitung di server (`count`); halaman Pesanan hanya memuat pesanan aktif atau 150 pesanan terbaru.

Perubahan barang yang dibuat di luar website ini (mis. langsung di Firebase Console) baru terlihat setelah cache 6 jam habis atau setelah logout-login.

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
- Halaman **Harga Jual** (tombol di dashboard): daftar barang dengan harga modal per pcs, harga jual per pcs, dan keterangan untung/rugi. Tombol **Sesuaikan** membuka popup untuk mengisi harga jual (untung dihitung langsung saat mengetik). Harga jual yang belum diisi bernilai 0 ("Belum diatur"). Disimpan di field `hargaJual` pada dokumen `barang`, ikut ke Export Excel, Backup, dan bisa dipulihkan lewat Import Excel (kolom opsional "Harga Jual").
- Histori perubahan harga (`price_history`) + daftar statistik + grafik.
- Maintenance overlay melalui `maintenance-config.json`.
- Tema minimalis krem · hitam · oranye (bagian "TEMA MINIMALIS" di akhir `style.css`; hapus bagian itu untuk kembali ke tema hijau).
- Label pojok berisi jam & tanggal **WIB** (zona `Asia/Jakarta`, tetap WIB walau perangkat memakai zona waktu lain) dan status koneksi Online/Offline.
- Efek interaktif Three.js di `background.js`: gelombang titik yang terangkat di bawah kursor dan beriak saat diklik/disentuh, bentuk geometris yang menoleh ke kursor & menyingkir saat didekati, grid 3D, kamera mengikuti scroll, logo "H" 3D di halaman login, kursor kustom (khusus mouse), layar loading, tombol 3D yang miring & berkilau mengikuti kursor (khusus mouse), serta ledakan kepingan 3D saat tombol diklik (hijau; merah untuk tombol hapus/logout). Hanya dekorasi; otomatis hemat (jumlah titik dikurangi di HP, berhenti saat tab tidak terlihat, statis bila pengguna memilih "kurangi gerakan"). Bila Three.js/WebGL tidak tersedia, latar biasa dipakai. Untuk mematikannya, hapus baris `<script type="module" src="background.js">` di `index.html`.
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

Akses dibatasi dengan **daftar email admin** di fungsi `adminEmails()` pada `firestore.rules`:

- Hanya email di daftar itu yang dapat membaca/mengubah `barang`, `price_history`, dan `stock_opname`.
- Email wajib terverifikasi. Login Google otomatis terverifikasi; akun email/password akan dikirimi link verifikasi saat pertama login.
- Akun lain tetap bisa login ke Firebase, tetapi langsung ditolak dan dikeluarkan dengan pesan "tidak terdaftar sebagai admin".
- Rules juga memvalidasi isi data (nama tidak kosong, harga angka ≥ 0, isi per satuan ≥ 1, dsb.).

Ada dua daftar admin:

- `adminEmails()`: email sungguhan (mis. Gmail). Wajib terverifikasi; login Google otomatis terverifikasi.
- `akunAdminManual()`: akun yang dibuat manual di Firebase Console → Authentication → Users → **Add user** (mis. `admin@admin.admin`). Tidak perlu verifikasi email. Buat akunnya di Console **sebelum** Publish rules.

Menambah/menghapus admin: ubah daftar yang sesuai (huruf kecil semua), lalu Publish ulang rules. Password tidak pernah disimpan di kode atau repository; password diatur di Firebase Console.

Tombol "Daftar" di halaman login disembunyikan. Agar pendaftaran benar-benar tertutup, matikan juga di Firebase Console → Authentication → Settings → User actions → hilangkan centang **Enable create (sign-up)**.

## Format Excel Import

File `.xlsx` / `.xlsm` didukung. Header dapat berada pada salah satu dari 10 baris pertama.

Kolom wajib:

- `Nama Barang` atau `Nama`
- `Harga Total` atau `Harga`

Kolom opsional:

- `Satuan`
- `Isi per Satuan` atau `Isi`

Jika kolom opsional tidak tersedia, item otomatis dianggap `pcs` dengan isi `1`.

## Backup

Tombol **💾 Backup Semua Data** di dashboard mengunduh satu file `Backup_Toko_H_Endun_YYYY-MM-DD.xlsx` berisi:

- **Barang**: seluruh daftar barang (format sama dengan Import Excel).
- **Riwayat Harga**: seluruh catatan perubahan harga.
- **Stock Opname**: semua dokumen stock opname milik akun yang sedang login (tiap baris = satu barang di lembar Kurang/Lebih).
- **Info Backup**: tanggal, pembuat, jumlah data, dan cara memulihkan.

Memulihkan daftar barang: Dashboard → pilih file backup → **Upload Excel**. Barang yang sudah ada diperbarui, yang hilang ditambahkan kembali. Riwayat harga dan stock opname disimpan sebagai arsip (tidak dipulihkan otomatis).

Karena riwayat stock opname bersifat pribadi per akun, lakukan backup dari setiap akun admin agar semua stock opname ikut tersimpan. Sarankan backup rutin, misalnya setiap minggu atau sebelum import Excel besar.

## Maintenance

Saat aktif, seluruh website tertutup halaman pemeliharaan bergaya tema (krem · hitam · oranye) dengan adegan 3D Three.js (`maintenance3d.js`, hanya dimuat saat maintenance aktif): tiga roda gigi yang saling mengait, cincin progres, balok yang mengorbit, dan titik bergelombang. Adegan mengikuti kursor; klik/sentuh membuat roda berputar kencang. Di HP roda tampil di atas & teks di bawah. Status diperiksa ulang otomatis tiap 30 detik (atau tombol **Cek Lagi**), jadi halaman terbuka sendiri begitu maintenance dimatikan. Latar 3D biasa (`background.js`) dijeda selama mode ini.

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
