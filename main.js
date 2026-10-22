import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  writeBatch,
  setDoc,
  limit,
  orderBy,
  serverTimestamp,
  Timestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCEng2Zpss0ATs3wkGs_vgy1YViSzkf07E",
  authDomain: "toko-eaa04.firebaseapp.com",
  projectId: "toko-eaa04",
  storageBucket: "toko-eaa04.appspot.com",
  messagingSenderId: "761393852069",
  appId: "1:761393852069:web:c9250f50038028d255e74c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
window.db = db;

const $ = (id) => document.getElementById(id);
const DEFAULT_PHOTO = "https://i.postimg.cc/Prtd1GD9/635bd3ab46e8e675e7a840481d0eef50.jpg";

let barangCache = [];
let daftarKurang = [];
let daftarLebih = [];
let currentEditId = null;
let currentRiwayatId = null;
let currentHargaJualId = null;
let stopUpload = false;
let confirmResolver = null;
let qtyResolver = null;
let qtyCurrentItem = null;
let alertTimer = null;
let priceDiffTimer = null;
let priceChart = null;
let priceHistoryCache = [];

// Panel pembeli
let peran = "tamu"; // "tamu" (belum login) | "pembeli" | "admin"
let katalogCache = null; // null = belum dimuat
let lanjutCheckout = false; // tamu menekan Checkout → setelah login langsung ke checkout
let pesananAdminCache = [];
let sumberPesananAdmin = null; // "aktif" | "terbaru"
let riwayatHargaMentah = null; // riwayat harga dibaca sekali per sesi

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getUserNameFromEmail(email = "") {
  return email.includes("@") ? email.split("@")[0] : (email || "Admin");
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, withTime = false) {
  const date = toDate(value);
  if (!date) return "-";
  return withTime
    ? date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function formatRupiah(value) {
  return `Rp ${Math.round(Number(value) || 0).toLocaleString("id-ID")}`;
}

function normalizeBarang(id, raw = {}) {
  const harga = Number(raw.harga) || 0;
  const isiPerSatuan = Math.max(1, Number(raw.isiPerSatuan) || 1);
  const satuanRaw = String(raw.satuan || "pcs").trim();
  const satuan = !satuanRaw || satuanRaw === "undefined" || satuanRaw === "null" ? "pcs" : satuanRaw;
  return {
    id,
    ...raw,
    nama: String(raw.nama || "Tanpa Nama").trim(),
    harga,
    satuan,
    isiPerSatuan,
    // Selalu dihitung ulang agar tidak memakai hargaSatuan lama yang sudah basi.
    hargaSatuan: harga / isiPerSatuan,
    // Harga jual per pcs; 0 = belum diatur.
    hargaJual: Math.max(0, Number(raw.hargaJual) || 0)
  };
}

function barangKey(nama, satuan = "pcs") {
  const clean = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
  return `${clean(nama)}|${clean(satuan) || "pcs"}`;
}

function findBarangByKey(nama, satuan, exceptId = null) {
  const key = barangKey(nama, satuan);
  return barangCache.find((item) => item.id !== exceptId && barangKey(item.nama, item.satuan) === key);
}

function upsertBarangCache(id, data) {
  const index = barangCache.findIndex((item) => item.id === id);
  const merged = normalizeBarang(id, { ...(index >= 0 ? barangCache[index] : {}), ...data });
  if (index >= 0) barangCache[index] = merged;
  else barangCache.push(merged);
}

function refreshBarangViews() {
  barangCache.sort((a, b) => a.nama.localeCompare(b.nama, "id", { sensitivity: "base" }));
  renderBarang();
  renderSidebarBarang();
  renderHargaJual();
  simpanCacheBarang();
}

// ===================== Katalog etalase (publik) =====================
// Salinan ringkas semua barang untuk pembeli (nama, harga jual, jenis kemasan) dalam
// SATU dokumen `katalog/etalase`, sehingga satu kunjungan pembeli = 1 pembacaan Firestore.
// Harga modal & data admin TIDAK ikut, karena dokumen ini bisa dibaca siapa saja.
const REF_KATALOG = () => doc(db, "katalog", "etalase");
const MAKS_PRODUK_KATALOG = 5000; // batas aman ukuran 1 dokumen Firestore (1 MB)

// Jenis kemasan untuk model 3D, ditebak dari nama & satuan barang.
function deteksiJenis(nama, satuan = "pcs") {
  const teks = `${nama} ${satuan}`.toLocaleLowerCase("id-ID");
  if (/\b(dus|karton|box|kotak|pak|pack)\b/.test(String(satuan).toLocaleLowerCase("id-ID"))) return "kotak";
  if (/kaleng|sarden|kornet|susu kental|cola|sprite|fanta|bir|\bcan\b/.test(teks)) return "kaleng";
  if (/beras|gula|tepung|terigu|karung|garam|\bpakan\b/.test(teks)) return "karung";
  if (/botol|aqua|air mineral|le minerale|teh botol|minyak|kecap|saos|saus|sirup|\bml\b|\d+\s?ml|liter|\d+\s?l\b|susu uht|yakult/.test(teks)) return "botol";
  if (/indomie|mie|mi |snack|chitato|keripik|kerupuk|biskuit|wafer|permen|kopi|sachet|bungkus|sabun cuci|deterjen|rinso|roti|cokelat|coklat/.test(teks)) return "bungkus";
  return "kotak";
}

function susunKatalog() {
  return barangCache
    .map((item) => {
      const produk = { id: item.id, nama: item.nama, hargaJual: item.hargaJual, jenis: deteksiJenis(item.nama, item.satuan) };
      // Harga jual sebelumnya + waktu perubahan → etalase menampilkan tanda naik/turun.
      const sebelum = Number(item.hargaJualSebelumnya) || 0;
      if (sebelum > 0 && item.hargaJual > 0 && sebelum !== item.hargaJual) {
        produk.sebelum = sebelum;
        produk.berubah = keMilis(item.hargaJualDiubah);
      }
      return produk;
    })
    .sort((a, b) => a.nama.localeCompare(b.nama, "id", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

// ===================== Katalog game WARUNK =====================
// Dokumen `katalog/warunk` untuk game WARUNK: semua barang yang punya harga modal, lengkap dengan
// harga MODAL (dipakai game sebagai harga grosir) dan harga jual eceran (0 = belum diisi).
// Game hanya membaca dokumen ini lewat 1 listener onSnapshot; hanya admin yang bisa menulisnya.
// MODE_KATALOG_GAME:
//   "A" = modal asli, dokumen bisa dibaca publik (aturan katalog yang ada)
//   "B" = modal asli, tapi baca katalog/warunk dibatasi di firestore.rules (game wajib login)
//   "C" = modal disamarkan: harga jual × faktor tetap per barang (0,80–0,92)
const MODE_KATALOG_GAME = "A";
const REF_KATALOG_GAME = () => doc(db, "katalog", "warunk");

// Faktor tetap per barang (hash id) untuk mode C, agar modal samaran tidak berubah-ubah.
function faktorModalSamaran(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return 0.8 + ((h >>> 0) % 1000) / 1000 * 0.12;
}

function susunKatalogGame() {
  return barangCache
    .filter((item) => Number(item.harga) > 0 && (MODE_KATALOG_GAME !== "C" || Number(item.hargaJual) > 0))
    .map((item) => {
      const modal = MODE_KATALOG_GAME === "C"
        ? Math.round(item.hargaJual * item.isiPerSatuan * faktorModalSamaran(item.id))
        : item.harga;
      const p = {
        id: item.id,
        nama: item.nama,
        satuan: item.satuan,
        isi: item.isiPerSatuan,
        modal,
        jual: item.hargaJual,
        jenis: deteksiJenis(item.nama, item.satuan)
      };
      const sebelum = Number(item.hargaJualSebelumnya) || 0;
      if (sebelum > 0 && item.hargaJual > 0 && sebelum !== item.hargaJual) {
        p.sebelum = sebelum;
        p.berubah = keMilis(item.hargaJualDiubah);
      }
      return p;
    })
    .sort((a, b) => a.nama.localeCompare(b.nama, "id", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

// Gagal menulis katalog game tidak membatalkan perubahan barang (cukup peringatan).
async function sinkronKatalogGame({ bandingkan = true } = {}) {
  const produk = susunKatalogGame();
  if (produk.length > MAKS_PRODUK_KATALOG) {
    console.warn(`Katalog game dibatasi ${MAKS_PRODUK_KATALOG} produk; ${produk.length - MAKS_PRODUK_KATALOG} produk tidak dikirim.`);
    produk.length = MAKS_PRODUK_KATALOG;
  }
  try {
    if (bandingkan) {
      const snap = await getDoc(REF_KATALOG_GAME());
      if (snap.exists() && JSON.stringify(snap.data().produk) === JSON.stringify(produk)) return;
    }
    await setDoc(REF_KATALOG_GAME(), { produk, jumlah: produk.length, diperbarui: serverTimestamp() });
  } catch (error) {
    console.warn("Sinkronisasi katalog game WARUNK gagal (periksa Firestore Rules).", error);
  }
}

// Sebelum katalog ditulis, ambil barang yang diubah dari perangkat admin lain (hanya dokumen yang
// `diubah`-nya lebih baru), supaya cache lama di perangkat ini tidak menimpa harga terbaru.
async function segarkanBarangCache() {
  if (!(metaCacheBarang.lastSync > 0) || !barangCache.length) return;
  const sidik = (b) => `${b.nama}|${b.harga}|${b.hargaJual}|${b.satuan}|${b.isiPerSatuan}`;
  const lama = new Map(barangCache.map((b) => [b.id, sidik(b)]));
  try {
    await muatBarangPerubahan({ items: barangCache, lastSync: metaCacheBarang.lastSync, penuhPada: metaCacheBarang.penuhPada });
    const beda = barangCache.length !== lama.size || barangCache.some((b) => lama.get(b.id) !== sidik(b));
    if (beda) refreshBarangViews();
  } catch (error) {
    console.warn("Gagal menyegarkan barang sebelum sinkron katalog; memakai data yang ada.", error);
  }
}

// Sinkronkan katalog etalase pembeli dan katalog game sekaligus.
async function sinkronKatalog({ bandingkan = true } = {}) {
  await segarkanBarangCache();
  await Promise.all([sinkronKatalogEtalase({ bandingkan }), sinkronKatalogGame({ bandingkan })]);
}

// Jaring pengaman selama admin membuka dashboard: cek ulang katalog berkala (hanya menulis kalau berbeda),
// agar perubahan dari luar dashboard ini (perangkat lain / Firebase Console) tetap sampai ke website & game.
const JEDA_SINKRON_BERKALA = 5 * 60 * 1000;
let timerSinkronBerkala = null;
function mulaiSinkronBerkala() {
  if (timerSinkronBerkala) return;
  timerSinkronBerkala = setInterval(() => {
    if (peran === "admin" && !document.hidden) sinkronKatalog({ bandingkan: true });
  }, JEDA_SINKRON_BERKALA);
}

// Tulis ulang dokumen katalog bila isinya berbeda (bandingkan = 1 pembacaan, tulis = 1 penulisan).
async function sinkronKatalogEtalase({ bandingkan = true } = {}) {
  const produk = susunKatalog();
  if (produk.length > MAKS_PRODUK_KATALOG) {
    console.warn(`Katalog etalase dibatasi ${MAKS_PRODUK_KATALOG} produk; ${produk.length - MAKS_PRODUK_KATALOG} produk tidak ditampilkan.`);
    produk.length = MAKS_PRODUK_KATALOG;
  }
  try {
    if (bandingkan) {
      const snap = await getDoc(REF_KATALOG());
      if (snap.exists() && JSON.stringify(snap.data().produk) === JSON.stringify(produk)) return;
    }
    await setDoc(REF_KATALOG(), { produk, jumlah: produk.length, diperbarui: serverTimestamp() });
    katalogCache = null; // etalase memuat versi terbaru saat dibuka
  } catch (error) {
    console.warn("Sinkronisasi katalog etalase gagal (periksa Firestore Rules).", error);
  }
}

// Banyak perubahan beruntun (mis. mengisi harga jual satu per satu) digabung jadi satu penulisan.
let jadwalKatalog = null;
function jadwalkanSinkronKatalog() {
  clearTimeout(jadwalKatalog);
  jadwalKatalog = setTimeout(() => sinkronKatalog({ bandingkan: false }), 1500);
}

// Dipanggil setelah barang ditambah/diubah/dihapus. Gagal sinkron tidak membatalkan perubahan barang.
function simpanKatalog() {
  jadwalkanSinkronKatalog();
}
function hapusKatalog() {
  jadwalkanSinkronKatalog();
}

// ===================== PANEL PEMBELI =====================
// Etalase tampil pertama untuk semua pengunjung. Keranjang disimpan di perangkat.
// Checkout wajib login; akun admin yang login dari form yang sama masuk ke panel admin.

const KUNCI_KERANJANG = "toko-h-endun:keranjang";
const KUNCI_PEMBELI = "toko-h-endun:pembeli";
const LABEL_STATUS = { baru: "Baru", diproses: "Diproses", selesai: "Selesai", dibatalkan: "Dibatalkan" };

function bacaPenyimpanan(kunci) {
  try {
    const data = JSON.parse(localStorage.getItem(kunci) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch (error) {
    return {};
  }
}

function tulisPenyimpanan(kunci, nilai) {
  try {
    localStorage.setItem(kunci, JSON.stringify(nilai));
  } catch (error) {
    console.warn("Penyimpanan browser tidak tersedia.", error);
  }
}

// { [idBarang]: jumlah }
let keranjang = bacaPenyimpanan(KUNCI_KERANJANG);
let produk3d = null;
let pratinjauTerpasang = false;

function kodePesanan(id) {
  return `#${String(id).slice(0, 6).toUpperCase()}`;
}

function simpanKeranjang() {
  tulisPenyimpanan(KUNCI_KERANJANG, keranjang);
  perbaruiJumlahKeranjang();
}

function perbaruiJumlahKeranjang() {
  const jumlah = Object.values(keranjang).reduce((total, qty) => total + qty, 0);
  $("keranjang-jumlah").textContent = jumlah;
  $("keranjang-jumlah").classList.toggle("ada", jumlah > 0);
}

function perbaruiHeaderToko() {
  const user = auth.currentUser;
  $("toko-masuk-btn").style.display = peran === "tamu" ? "" : "none";
  $("toko-keluar-btn").style.display = peran === "tamu" ? "none" : "";
  $("toko-pesanan-btn").style.display = peran === "pembeli" ? "" : "none";
  $("toko-admin-btn").style.display = peran === "admin" ? "" : "none";
  $("toko-sapaan").textContent = peran === "tamu" || !user ? "" : `Masuk sebagai ${user.email || "pembeli"}`;
  perbaruiJumlahKeranjang();
}

async function masukSebagaiPembeli() {
  $("login-info").textContent = "";
  await tampilkanToko();
  if (lanjutCheckout) {
    lanjutCheckout = false;
    bukaCheckout();
  }
}

async function tampilkanToko() {
  setView("toko");
  perbaruiHeaderToko();
  if (katalogCache) renderToko();
  else await muatKatalog();
}

async function muatKatalog() {
  const grid = $("toko-grid");
  grid.replaceChildren(createText("p", "⏳ Memuat produk...", "toko-kosong"));
  try {
    const snap = await getDoc(REF_KATALOG()); // 1 pembacaan untuk seluruh etalase
    katalogCache = (snap.exists() && Array.isArray(snap.data().produk) ? snap.data().produk : [])
      .map((data) => ({
        id: String(data.id),
        nama: String(data.nama || "Tanpa Nama"),
        hargaJual: Math.max(0, Number(data.hargaJual) || 0),
        jenis: String(data.jenis || "kotak"),
        sebelum: Math.max(0, Number(data.sebelum) || 0),
        berubah: Number(data.berubah) || 0
      }))
      .sort((a, b) => a.nama.localeCompare(b.nama, "id", { sensitivity: "base" }));
    renderToko();
  } catch (error) {
    console.error(error);
    katalogCache = null;
    grid.replaceChildren(createText("p", "Katalog belum bisa dimuat. Coba muat ulang halaman beberapa saat lagi.", "toko-kosong"));
  }
}

// Modul 3D dimuat terpisah; bila gagal, kartu tetap tampil dengan huruf awal produk.
function muatModul3D() {
  if (!produk3d) {
    produk3d = import("./produk3d.js").catch((error) => {
      console.warn("Gambar 3D produk tidak tersedia.", error);
      return null;
    });
  }
  return produk3d;
}

// ---------- Tanda harga naik/turun ----------
// Tampil selama 7 hari setelah admin mengubah harga jual.
const LAMA_TANDA_HARGA = 7 * 24 * 60 * 60 * 1000;
const hargaSudahDianimasikan = new Set(); // animasi counting cukup sekali per kunjungan
let pengamatHarga = null;

function perubahanHarga(item) {
  if (!(item.sebelum > 0) || !(item.hargaJual > 0) || item.sebelum === item.hargaJual) return null;
  if (item.berubah && Date.now() - item.berubah > LAMA_TANDA_HARGA) return null;
  return { arah: item.hargaJual > item.sebelum ? "naik" : "turun", sebelum: item.sebelum, selisih: Math.abs(item.hargaJual - item.sebelum) };
}

// Angka harga berhitung dari harga lama ke harga baru.
function animasikanHarga(el) {
  const dari = Number(el.dataset.dari);
  const ke = Number(el.dataset.ke);
  hargaSudahDianimasikan.add(el.dataset.id);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = formatRupiah(ke);
    el.classList.add("selesai");
    return;
  }
  const durasi = 1400;
  const mulai = performance.now();
  el.classList.add("berhitung");
  const langkah = (sekarang) => {
    const p = Math.min(1, (sekarang - mulai) / durasi);
    const halus = 1 - Math.pow(1 - p, 3);
    el.textContent = formatRupiah(dari + (ke - dari) * halus);
    if (p < 1) requestAnimationFrame(langkah);
    else {
      el.classList.remove("berhitung");
      el.classList.add("selesai");
    }
  };
  requestAnimationFrame(langkah);
}

// Animasi dimulai saat harga terlihat di layar (harga lama tampil sebentar lebih dulu).
function amatiHarga(grid) {
  pengamatHarga?.disconnect();
  const daftar = grid.querySelectorAll(".harga-angka:not(.selesai)");
  if (!daftar.length) return;
  pengamatHarga = new IntersectionObserver((entri) => {
    entri.forEach((e) => {
      if (!e.isIntersecting) return;
      pengamatHarga.unobserve(e.target);
      setTimeout(() => animasikanHarga(e.target), 450);
    });
  }, { threshold: 0.6 });
  daftar.forEach((el) => pengamatHarga.observe(el));
}

function buatKartuProduk(item) {
  const kartu = document.createElement("article");
  kartu.className = "produk-kartu";
  kartu.dataset.id = item.id;
  kartu.dataset.nama = item.nama;
  kartu.dataset.jenis = item.jenis;

  const gambar = document.createElement("div");
  gambar.className = "produk-gambar memuat";
  const img = document.createElement("img");
  img.alt = item.nama;
  img.decoding = "async";
  gambar.append(img, createText("span", item.nama.charAt(0).toUpperCase(), "produk-inisial"));

  const perubahan = perubahanHarga(item);
  if (perubahan) {
    const badge = createText(
      "span",
      perubahan.arah === "naik" ? "▲ Naik" : "▼ Turun",
      `harga-badge ${perubahan.arah}`
    );
    badge.title = `Harga ${perubahan.arah} ${formatRupiah(perubahan.selisih)} dari ${formatRupiah(perubahan.sebelum)}`;
    gambar.appendChild(badge);
    kartu.classList.add(`harga-${perubahan.arah}`);
  }

  const info = document.createElement("div");
  info.className = "produk-info";
  const harga = document.createElement("p");
  harga.className = "produk-harga";
  if (item.hargaJual > 0 && perubahan) {
    const sudah = hargaSudahDianimasikan.has(item.id);
    const angka = createText("span", formatRupiah(sudah ? item.hargaJual : perubahan.sebelum), `harga-angka ${perubahan.arah}${sudah ? " selesai" : ""}`);
    angka.dataset.id = item.id;
    angka.dataset.dari = perubahan.sebelum;
    angka.dataset.ke = item.hargaJual;
    harga.append(createText("s", formatRupiah(perubahan.sebelum), "harga-sebelum"), angka, createText("small", " /pcs"));
  } else if (item.hargaJual > 0) {
    harga.append(formatRupiah(item.hargaJual), createText("small", " /pcs"));
  } else {
    harga.textContent = "Hubungi toko";
    harga.classList.add("kosong");
  }
  info.append(createText("h3", item.nama, "produk-nama"), harga);

  const tersedia = item.hargaJual > 0;
  const qty = keranjang[item.id] || 0;
  const tombol = createButton(
    tersedia ? (qty ? `+ Keranjang (${qty})` : "+ Keranjang") : "Belum tersedia",
    "produk-tambah",
    () => tambahKeKeranjang(item.id)
  );
  tombol.disabled = !tersedia;

  kartu.append(gambar, info, tombol);
  return kartu;
}

function renderToko() {
  const grid = $("toko-grid");
  const semua = katalogCache || [];
  const keyword = $("toko-cari").value.trim().toLocaleLowerCase("id-ID");
  $("toko-jumlah-produk").textContent = semua.length;

  const items = semua.filter((item) => item.nama.toLocaleLowerCase("id-ID").includes(keyword));
  if (!items.length) {
    grid.replaceChildren(createText("p", semua.length ? "Produk tidak ditemukan." : "Belum ada produk di etalase.", "toko-kosong"));
    return;
  }

  const kartuList = items.map(buatKartuProduk);
  grid.replaceChildren(...kartuList);
  isiGambarProduk(kartuList);
  amatiHarga(grid);
  if (!pratinjauTerpasang) {
    pratinjauTerpasang = true;
    muatModul3D().then((modul) => modul?.pasangPratinjau(grid));
  }
}

// Gambar produk dibuat satu per satu, hanya untuk kartu yang terlihat di layar,
// agar aset 3D/foto yang besar tidak memperlambat halaman.
let pengamatGambar = null;
let antrianGambar = [];
let prosesGambarBerjalan = false;

async function prosesAntrianGambar() {
  if (prosesGambarBerjalan) return;
  prosesGambarBerjalan = true;
  const modul = await muatModul3D();
  while (antrianGambar.length) {
    const kartu = antrianGambar.shift();
    if (!kartu.isConnected) continue; // etalase sudah dirender ulang
    const wadah = kartu.querySelector(".produk-gambar");
    if (modul) {
      try {
        const hasil = await modul.gambarProduk(kartu.dataset.jenis, kartu.dataset.nama);
        wadah.querySelector("img").src = hasil.url;
        wadah.classList.add("siap");
      } catch (error) {
        console.warn("Gambar produk gagal dibuat untuk", kartu.dataset.nama, error);
      }
    }
    wadah.classList.remove("memuat");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  prosesGambarBerjalan = false;
}

function isiGambarProduk(kartuList) {
  pengamatGambar?.disconnect();
  antrianGambar = [];
  pengamatGambar = new IntersectionObserver((entri) => {
    entri.forEach((e) => {
      if (!e.isIntersecting) return;
      pengamatGambar.unobserve(e.target);
      antrianGambar.push(e.target);
    });
    prosesAntrianGambar();
  }, { rootMargin: "200px 0px" });
  kartuList.forEach((kartu) => pengamatGambar.observe(kartu));
}

// ---------- Keranjang ----------
function isiKeranjang() {
  return Object.entries(keranjang).map(([id, qty]) => {
    const item = (katalogCache || []).find((produk) => produk.id === id);
    const tersedia = Boolean(item && item.hargaJual > 0);
    return {
      id,
      qty,
      item,
      tersedia,
      subtotal: tersedia ? item.hargaJual * qty : 0
    };
  });
}

function tambahKeKeranjang(id) {
  const item = (katalogCache || []).find((produk) => produk.id === id);
  if (!item || !(item.hargaJual > 0)) return;
  keranjang[id] = Math.min(999, (keranjang[id] || 0) + 1);
  simpanKeranjang();
  const tombol = $("toko-grid").querySelector(`.produk-kartu[data-id="${CSS.escape(id)}"] .produk-tambah`);
  if (tombol) tombol.textContent = `+ Keranjang (${keranjang[id]})`;
  showAlert(`${item.nama} masuk keranjang.`);
}

function ubahJumlahKeranjang(id, selisih) {
  const baru = (keranjang[id] || 0) + selisih;
  if (baru <= 0) delete keranjang[id];
  else keranjang[id] = Math.min(999, baru);
  simpanKeranjang();
  renderKeranjang();
  if (katalogCache) renderToko();
}

function renderKeranjang() {
  const wadah = $("keranjang-isi");
  const baris = isiKeranjang();
  const total = baris.reduce((jumlah, b) => jumlah + b.subtotal, 0);
  $("keranjang-total").textContent = formatRupiah(total);
  $("keranjang-checkout").disabled = total <= 0;

  if (!baris.length) {
    wadah.replaceChildren(createText("p", "Keranjang masih kosong.", "toko-kosong"));
    return;
  }

  wadah.replaceChildren(...baris.map((b) => {
    const el = document.createElement("div");
    el.className = `keranjang-baris${b.tersedia ? "" : " tidak-tersedia"}`;

    const info = document.createElement("div");
    info.className = "kb-info";
    info.append(
      createText("strong", b.item ? b.item.nama : "Produk tidak ditemukan"),
      createText("small", b.tersedia ? `${formatRupiah(b.item.hargaJual)} /pcs` : "Tidak tersedia lagi")
    );

    const jumlah = document.createElement("div");
    jumlah.className = "kb-jumlah";
    jumlah.append(
      createButton("−", "kb-tombol", () => ubahJumlahKeranjang(b.id, -1)),
      createText("span", String(b.qty), "kb-qty"),
      createButton("+", "kb-tombol", () => ubahJumlahKeranjang(b.id, 1))
    );
    jumlah.lastChild.disabled = !b.tersedia;

    el.append(info, jumlah, createText("strong", formatRupiah(b.subtotal), "kb-subtotal"));
    return el;
  }));
}

async function bukaKeranjang() {
  if (!katalogCache) await muatKatalog();
  renderKeranjang();
  $("keranjang-popup").style.display = "flex";
}

function mulaiCheckout() {
  if (!isiKeranjang().some((b) => b.tersedia)) return showAlert("Keranjang masih kosong.", "warning");
  $("keranjang-popup").style.display = "none";
  if (peran === "tamu") {
    lanjutCheckout = true;
    $("login-info").textContent = "Masuk atau daftar dulu untuk melanjutkan checkout.";
    setView("login");
    return;
  }
  bukaCheckout();
}

function bukaCheckout() {
  const baris = isiKeranjang().filter((b) => b.tersedia);
  if (!baris.length) return showAlert("Keranjang masih kosong.", "warning");
  const total = baris.reduce((jumlah, b) => jumlah + b.subtotal, 0);

  const ringkasan = $("checkout-ringkasan");
  ringkasan.replaceChildren(
    ...baris.map((b) => {
      const el = document.createElement("div");
      el.className = "ck-baris";
      el.append(createText("span", `${b.qty}× ${b.item.nama}`), createText("span", formatRupiah(b.subtotal)));
      return el;
    }),
    (() => {
      const el = document.createElement("div");
      el.className = "ck-baris ck-total";
      el.append(createText("span", "Total"), createText("strong", formatRupiah(total)));
      return el;
    })()
  );

  const tersimpan = bacaPenyimpanan(KUNCI_PEMBELI);
  if (!$("checkout-nama").value) $("checkout-nama").value = tersimpan.nama || "";
  if (!$("checkout-hp").value) $("checkout-hp").value = tersimpan.telepon || "";
  $("checkout-popup").style.display = "flex";
  setTimeout(() => $(tersimpan.nama ? "checkout-catatan" : "checkout-nama").focus(), 0);
}

async function kirimPesanan() {
  const user = auth.currentUser;
  if (!user) return mulaiCheckout();
  if ($("checkout-kirim").disabled) return;

  const namaPembeli = $("checkout-nama").value.trim();
  const telepon = $("checkout-hp").value.replace(/[^\d+]/g, "");
  const catatan = $("checkout-catatan").value.trim().slice(0, 300);
  if (!namaPembeli) return showAlert("Nama penerima wajib diisi.", "warning");
  if (telepon.length < 8 || telepon.length > 20) return showAlert("Nomor HP tidak valid.", "warning");

  const baris = isiKeranjang().filter((b) => b.tersedia);
  if (!baris.length) return showAlert("Keranjang masih kosong.", "warning");
  const items = baris.map((b) => ({ barangId: b.id, nama: b.item.nama, harga: b.item.hargaJual, qty: b.qty, subtotal: b.subtotal }));
  const total = items.reduce((jumlah, item) => jumlah + item.subtotal, 0);

  $("checkout-kirim").disabled = true;
  try {
    const ref = await addDoc(collection(db, "pesanan"), {
      uid: user.uid,
      email: user.email || "",
      namaPembeli: namaPembeli.slice(0, 100),
      telepon,
      catatan,
      items,
      jumlahBarang: items.reduce((jumlah, item) => jumlah + item.qty, 0),
      total,
      status: "baru",
      dibuat: new Date(),
      diperbarui: new Date()
    });
    tulisPenyimpanan(KUNCI_PEMBELI, { nama: namaPembeli, telepon });
    keranjang = {};
    simpanKeranjang();
    $("checkout-catatan").value = "";
    $("checkout-popup").style.display = "none";
    if (katalogCache) renderToko();
    showAlert(`Pesanan ${kodePesanan(ref.id)} berhasil dibuat. Total ${formatRupiah(total)}.`, "success", 6000);
  } catch (error) {
    console.error(error);
    const pesan = error?.code === "permission-denied" ? "pesanan ditolak server, coba lagi nanti" : errorText(error);
    showAlert(`Gagal membuat pesanan: ${pesan}`, "error", 6000);
  } finally {
    $("checkout-kirim").disabled = false;
  }
}

// ---------- Kartu pesanan (dipakai pembeli & admin) ----------
function buatKartuPesanan(pesanan, { admin = false } = {}) {
  const kartu = document.createElement("article");
  kartu.className = `pesanan-kartu status-${pesanan.status}`;

  const kepala = document.createElement("div");
  kepala.className = "pk-kepala";
  kepala.append(
    createText("strong", kodePesanan(pesanan.id), "pk-kode"),
    createText("span", LABEL_STATUS[pesanan.status] || pesanan.status, `status-pill ${pesanan.status}`)
  );
  kartu.append(kepala, createText("small", formatDate(pesanan.dibuat, true), "pk-tanggal"));

  if (admin) {
    kartu.append(createText("p", `${pesanan.namaPembeli || "-"} · ${pesanan.telepon || "-"} · ${pesanan.email || "-"}`, "pk-pembeli"));
  }
  if (pesanan.catatan) kartu.append(createText("p", `Catatan: ${pesanan.catatan}`, "pk-catatan"));

  const daftar = document.createElement("ul");
  daftar.className = "pk-item";
  (pesanan.items || []).forEach((item) => {
    const li = document.createElement("li");
    li.append(createText("span", `${item.qty}× ${item.nama}`), createText("span", formatRupiah(item.subtotal)));
    daftar.appendChild(li);
  });
  const total = document.createElement("div");
  total.className = "pk-total";
  total.append(createText("span", "Total"), createText("strong", formatRupiah(pesanan.total)));
  kartu.append(daftar, total);

  const aksi = document.createElement("div");
  aksi.className = "pk-aksi";
  if (admin) {
    if (pesanan.status === "baru") aksi.append(createButton("Proses", "", () => ubahStatusPesanan(pesanan.id, "diproses", true)));
    if (pesanan.status === "diproses") aksi.append(createButton("Selesai", "", () => ubahStatusPesanan(pesanan.id, "selesai", true)));
    if (pesanan.status === "baru" || pesanan.status === "diproses") {
      aksi.append(createButton("Batalkan", "hapus-btn", () => ubahStatusPesanan(pesanan.id, "dibatalkan", true)));
    }
  } else if (pesanan.status === "baru") {
    aksi.append(createButton("Batalkan Pesanan", "hapus-btn", () => ubahStatusPesanan(pesanan.id, "dibatalkan", false)));
  }
  if (aksi.childElementCount) kartu.append(aksi);
  return kartu;
}

function urutkanPesanan(snapshot) {
  return snapshot.docs
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .sort((a, b) => (toDate(b.dibuat)?.getTime() || 0) - (toDate(a.dibuat)?.getTime() || 0));
}

async function ubahStatusPesanan(id, status, admin) {
  if (status === "dibatalkan" && !(await showConfirm(`Batalkan pesanan ${kodePesanan(id)}?`))) return;
  try {
    const perubahan = { status, diperbarui: new Date() };
    if (status === "dibatalkan") {
      // Dicatat agar admin bisa diberi notifikasi saat pembeli membatalkan pesanan.
      perubahan.dibatalkanPada = serverTimestamp();
      perubahan.dibatalkanOleh = admin ? "admin" : "pembeli";
    }
    await updateDoc(doc(db, "pesanan", id), perubahan);
    showAlert(`Pesanan ${kodePesanan(id)}: ${LABEL_STATUS[status]}.`);
    if (admin) await muatPesananAdmin();
    else await bukaPesananSaya();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal mengubah pesanan: ${errorText(error)}`, "error");
  }
}

// ---------- Pesanan Saya (pembeli) ----------
async function bukaPesananSaya() {
  const user = auth.currentUser;
  if (!user) return;
  const isi = $("pesanan-saya-isi");
  $("pesanan-saya-popup").style.display = "flex";
  isi.replaceChildren(createText("p", "⏳ Memuat pesanan...", "toko-kosong"));
  try {
    const daftar = urutkanPesanan(await getDocs(query(collection(db, "pesanan"), where("uid", "==", user.uid))));
    isi.replaceChildren(...(daftar.length
      ? daftar.map((p) => buatKartuPesanan(p))
      : [createText("p", "Belum ada pesanan.", "toko-kosong")]));
  } catch (error) {
    console.error(error);
    isi.replaceChildren(createText("p", "Pesanan gagal dimuat.", "toko-kosong"));
  }
}

// ---------- Pesanan masuk (admin) ----------
let jumlahPesananBaru = 0;

function setBadgePesanan(jumlah) {
  jumlahPesananBaru = jumlah;
  const badge = $("pesanan-baru-badge");
  badge.textContent = jumlah;
  badge.hidden = !jumlah;
  $("btn-pesanan").classList.toggle("ada-baru", jumlah > 0);
  perbaruiJudulTab();
}

// Judul tab: "(3) Admin Toko H Endun" saat ada pesanan baru, "Toko H Endun" di etalase.
function perbaruiJudulTab() {
  if (peran !== "admin") {
    document.title = "Toko H Endun";
    return;
  }
  document.title = `${jumlahPesananBaru ? `(${jumlahPesananBaru}) ` : ""}Admin Toko H Endun`;
}

async function showPesananAdmin() {
  setView("pesanan");
  await muatPesananAdmin();
}

// ===================== Pantau pesanan real-time + notifikasi (admin) =====================
// Selama panel admin terbuka, pesanan aktif dipantau langsung (onSnapshot): biaya awal =
// jumlah pesanan aktif, lalu hanya 1 pembacaan per perubahan. Tidak perlu refresh.
let hentikanPantauAktif = null;
let hentikanPantauBatal = null;
let pesananAktifLive = null;
let antrianPesananBaru = [];
let timerPesananBaru = null;

function berhentiPantauPesanan() {
  hentikanPantauAktif?.();
  hentikanPantauBatal?.();
  hentikanPantauAktif = null;
  hentikanPantauBatal = null;
  pesananAktifLive = null;
  antrianPesananBaru = [];
  clearTimeout(timerPesananBaru);
}

function mulaiPantauPesanan() {
  berhentiPantauPesanan();

  let snapshotPertama = true;
  hentikanPantauAktif = onSnapshot(
    query(collection(db, "pesanan"), where("status", "in", ["baru", "diproses"])),
    (snapshot) => {
      pesananAktifLive = urutkanPesanan(snapshot);
      const baru = pesananAktifLive.filter((p) => p.status === "baru");
      setBadgePesanan(baru.length);

      if (snapshotPertama) {
        snapshotPertama = false;
        if (baru.length) beritahuPesananBaru(baru, { langsung: true });
      } else {
        const masuk = snapshot.docChanges()
          .filter((c) => c.type === "added" && c.doc.data().status === "baru")
          .map((c) => ({ id: c.doc.id, ...c.doc.data() }));
        if (masuk.length) beritahuPesananBaru(masuk);
      }

      // Halaman Pesanan yang sedang terbuka ikut diperbarui otomatis.
      if (sumberPesananAdmin === "aktif" && $("pesanan-container").style.display === "block") {
        pesananAdminCache = pesananAktifLive;
        renderPesananAdmin();
      }
    },
    (error) => console.warn("Pemantauan pesanan berhenti.", error)
  );

  // Pembatalan sejak panel dibuka (field dibatalkanPada diisi saat pesanan dibatalkan).
  let snapshotBatalPertama = true;
  hentikanPantauBatal = onSnapshot(
    // Mundur 1 menit untuk toleransi jam perangkat; isi awal (snapshot pertama) dilewati.
    query(collection(db, "pesanan"), where("dibatalkanPada", ">", Timestamp.fromMillis(Date.now() - 60 * 1000))),
    (snapshot) => {
      if (snapshotBatalPertama) {
        snapshotBatalPertama = false;
        return;
      }
      snapshot.docChanges()
        .filter((c) => c.type === "added")
        .map((c) => ({ id: c.doc.id, ...c.doc.data() }))
        .filter((p) => p.dibatalkanOleh === "pembeli")
        .forEach(beritahuPembatalan);
    },
    (error) => console.warn("Pemantauan pembatalan berhenti.", error)
  );
}

// Beberapa pesanan yang masuk berdekatan digabung jadi satu notifikasi.
function beritahuPesananBaru(daftar, { langsung = false } = {}) {
  antrianPesananBaru.push(...daftar);
  clearTimeout(timerPesananBaru);
  timerPesananBaru = setTimeout(() => {
    const unik = [...new Map(antrianPesananBaru.map((p) => [p.id, p])).values()];
    antrianPesananBaru = [];
    if (!unik.length) return;
    const judul = `Ada ${unik.length} pesanan baru`;
    const rincian = unik.slice(0, 3)
      .map((p) => `${kodePesanan(p.id)} · ${p.namaPembeli || "-"} · ${formatRupiah(p.total)}`)
      .join("\n") + (unik.length > 3 ? `\n+${unik.length - 3} pesanan lainnya` : "");
    showAlert(`${judul}.`, "info", 6000);
    tampilkanNotifikasi(judul, rincian, "pesanan-baru");
  }, langsung ? 0 : 1500);
}

function beritahuPembatalan(pesanan) {
  const judul = `Pesanan ${kodePesanan(pesanan.id)} dibatalkan`;
  const isi = `Dibatalkan oleh pembeli${pesanan.namaPembeli ? ` (${pesanan.namaPembeli})` : ""} · ${formatRupiah(pesanan.total)}`;
  showAlert(`${judul}.`, "warning", 6000);
  tampilkanNotifikasi(judul, isi, `batal-${pesanan.id}`);
}

// ---------- Notifikasi sistem (PC/HP) ----------
const KUNCI_NOTIFIKASI = "toko-h-endun:notifikasi-pesanan";

function notifikasiDidukung() {
  return "Notification" in window;
}

function notifikasiAktif() {
  return notifikasiDidukung() && Notification.permission === "granted" && bacaPenyimpanan(KUNCI_NOTIFIKASI).aktif === true;
}

// Service worker diperlukan agar notifikasi bisa tampil di Chrome Android.
async function daftarkanServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("sw.js");
  } catch (error) {
    console.warn("Service worker gagal didaftarkan; notifikasi memakai cara biasa.", error);
    return null;
  }
}

async function tampilkanNotifikasi(judul, isi, tag) {
  if (!notifikasiAktif()) return;
  const opsi = { body: isi, tag, renotify: true, icon: "ikon-192.png", badge: "ikon-192.png", data: { tujuan: "pesanan" } };
  try {
    const registrasi = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (registrasi) {
      await registrasi.showNotification(judul, opsi);
      return;
    }
    const notif = new Notification(judul, opsi);
    notif.onclick = () => {
      window.focus();
      showPesananAdmin();
      notif.close();
    };
  } catch (error) {
    console.warn("Notifikasi gagal ditampilkan.", error);
  }
}

function perbaruiTombolNotifikasi() {
  const tombol = $("notif-btn");
  const aktif = notifikasiAktif();
  tombol.classList.toggle("aktif", aktif);
  tombol.setAttribute("aria-pressed", String(aktif));
  tombol.title = aktif ? "Notifikasi pesanan menyala (klik untuk mematikan)" : "Nyalakan notifikasi pesanan";
}

async function aturNotifikasi() {
  if (!notifikasiDidukung()) {
    return showAlert("Browser ini tidak mendukung notifikasi. Di iPhone, tambahkan website ke Layar Utama dulu.", "warning", 7000);
  }
  if (notifikasiAktif()) {
    tulisPenyimpanan(KUNCI_NOTIFIKASI, { aktif: false });
    perbaruiTombolNotifikasi();
    return showAlert("Notifikasi pesanan dimatikan.");
  }
  let izin = Notification.permission;
  if (izin === "default") izin = await Notification.requestPermission();
  if (izin !== "granted") {
    perbaruiTombolNotifikasi();
    return showAlert("Izin notifikasi ditolak. Izinkan lewat pengaturan situs di browser (ikon gembok di samping alamat website).", "warning", 8000);
  }
  await daftarkanServiceWorker();
  tulisPenyimpanan(KUNCI_NOTIFIKASI, { aktif: true });
  perbaruiTombolNotifikasi();
  showAlert("Notifikasi pesanan menyala.");
  tampilkanNotifikasi("Notifikasi pesanan aktif", "Anda akan diberi tahu saat ada pesanan baru atau pesanan dibatalkan.", "uji-notifikasi");
}

// Hemat kuota: filter "aktif/baru/diproses" hanya membaca pesanan yang belum selesai;
// filter lain membaca 150 pesanan terbaru saja (bukan seluruh riwayat pesanan).
const JUMLAH_PESANAN_TERBARU = 150;
function sumberUntukFilter(filter) {
  return ["aktif", "baru", "diproses"].includes(filter) ? "aktif" : "terbaru";
}

async function muatPesananAdmin() {
  const isi = $("pesanan-admin-isi");
  const sumber = sumberUntukFilter($("pesanan-filter").value);
  // Pesanan aktif sudah dipantau langsung → tidak perlu membaca ulang dari server.
  if (sumber === "aktif" && pesananAktifLive) {
    pesananAdminCache = pesananAktifLive;
    sumberPesananAdmin = sumber;
    renderPesananAdmin();
    return;
  }
  isi.replaceChildren(createText("p", "⏳ Memuat pesanan...", "toko-kosong"));
  try {
    const q = sumber === "aktif"
      ? query(collection(db, "pesanan"), where("status", "in", ["baru", "diproses"]))
      : query(collection(db, "pesanan"), orderBy("dibuat", "desc"), limit(JUMLAH_PESANAN_TERBARU));
    pesananAdminCache = urutkanPesanan(await getDocs(q));
    sumberPesananAdmin = sumber;
    if (sumber === "aktif") setBadgePesanan(pesananAdminCache.filter((p) => p.status === "baru").length);
    renderPesananAdmin();
  } catch (error) {
    console.error(error);
    isi.replaceChildren(createText("p", `Pesanan gagal dimuat: ${errorText(error)}`, "toko-kosong"));
  }
}

function gantiFilterPesanan() {
  // Baca ulang dari server hanya bila jenis sumbernya berubah.
  if (sumberUntukFilter($("pesanan-filter").value) !== sumberPesananAdmin) muatPesananAdmin();
  else renderPesananAdmin();
}

function renderPesananAdmin() {
  const filter = $("pesanan-filter").value;
  const hitung = (status) => pesananAdminCache.filter((p) => p.status === status).length;
  $("pesanan-ringkasan").textContent = sumberPesananAdmin === "aktif"
    ? `${hitung("baru")} baru · ${hitung("diproses")} diproses`
    : `${pesananAdminCache.length} pesanan terbaru ditampilkan`;

  const daftar = pesananAdminCache.filter((p) =>
    filter === "semua" ? true : filter === "aktif" ? p.status === "baru" || p.status === "diproses" : p.status === filter);
  $("pesanan-admin-isi").replaceChildren(...(daftar.length
    ? daftar.map((p) => buatKartuPesanan(p, { admin: true }))
    : [createText("p", "Tidak ada pesanan.", "toko-kosong")]));
}

function normalizeHistoryItem(raw = {}) {
  const isiPerSatuan = Math.max(1, Number(raw.isiPerSatuan) || 1);
  const hargaKemasan = Number(raw.hargaKemasan ?? raw.harga) || 0;
  const hargaPerPcs = Number(raw.hargaPerPcs ?? raw.hargaSatuan) || hargaKemasan / isiPerSatuan;
  const qtyPcs = Math.max(0, Number(raw.qtyPcs ?? raw.qty) || 0);
  const satuan = String(raw.satuan || "pcs");
  return {
    ...raw,
    entryId: raw.entryId || makeId(),
    barangId: raw.barangId || null,
    nama: String(raw.nama || "Tanpa Nama"),
    satuan,
    isiPerSatuan,
    qtyPcs,
    qty: qtyPcs,
    hargaKemasan,
    harga: hargaKemasan,
    hargaPerPcs,
    hargaSatuan: hargaPerPcs,
    total: Math.round(qtyPcs * hargaPerPcs),
    displayQty: raw.displayQty || formatQty(qtyPcs, satuan, isiPerSatuan)
  };
}

function setView(name) {
  const views = {
    login: $("login-form"),
    signup: $("signup-form"),
    dashboard: $("dashboard-container"),
    stock: $("stock-opname-container"),
    hargaJual: $("harga-jual-container"),
    riwayat: $("riwayat-container"),
    toko: $("toko-container"),
    pesanan: $("pesanan-container"),
    struk: $("struk-container")
  };
  Object.entries(views).forEach(([key, el]) => {
    if (el) el.style.display = key === name ? "block" : "none";
  });
  document.body.classList.add("app-siap"); // sembunyikan layar loading
  perbaruiJudulTab();
  const halamanAdmin = !["toko", "login", "signup"].includes(name);
  document.querySelector(".sudut-merek").textContent = halamanAdmin ? "Toko H Endun — Panel Admin" : "Toko H Endun — Toko Online";
  window.scrollTo({ top: 0 });
}

async function checkMaintenance() {
  try {
    const response = await fetch(`maintenance-config.json?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    aturModePerbaikan(Boolean(config.maintenance));
  } catch (error) {
    console.warn("Maintenance config tidak dapat dibaca. Aplikasi tetap dibuka.", error);
    aturModePerbaikan(false);
  }
}

// Mode pemeliharaan: overlay + adegan 3D (maintenance3d.js, dimuat hanya saat dibutuhkan).
// Selama aktif, status diperiksa ulang tiap 30 detik; overlay hilang sendiri saat maintenance dimatikan.
let perbaikan3D = null;
let timerCekPerbaikan = null;

function aturModePerbaikan(aktif) {
  $("maintenance-overlay").hidden = !aktif;
  document.body.classList.toggle("mode-perbaikan", aktif);
  window.dispatchEvent(new CustomEvent("mode-perbaikan", { detail: aktif }));
  clearInterval(timerCekPerbaikan);
  if (aktif) {
    timerCekPerbaikan = setInterval(checkMaintenance, 30000);
    perbaikan3D ||= import("./maintenance3d.js")
      .then((modul) => modul.mulaiPerbaikan3D($("perbaikan-kanvas")))
      .catch((error) => {
        console.warn("Adegan 3D pemeliharaan tidak dapat dimuat.", error);
        return null;
      });
  } else if (perbaikan3D) {
    perbaikan3D.then((adegan) => adegan?.hentikan());
    perbaikan3D = null;
  }
}

async function cekUlangPerbaikan() {
  const tombol = $("maintenance-cek");
  tombol.disabled = true;
  $("maintenance-info").textContent = "Memeriksa...";
  await checkMaintenance();
  tombol.disabled = false;
  const jam = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date()).replace(".", ":");
  $("maintenance-info").textContent = `Masih dalam pemeliharaan · dicek ${jam} WIB`;
}

function showAlert(message, type = "success", duration = 2800) {
  const popup = $("alert-popup");
  const card = popup.querySelector(".alert-card");
  $("alert-message").textContent = String(message);
  card.className = `alert-card ${type}`;
  popup.style.display = "flex";

  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => {
    card.classList.add("closing");
    setTimeout(() => {
      popup.style.display = "none";
      card.classList.remove("closing");
    }, 500);
  }, duration);
}

function errorText(error) {
  if (error?.code === "permission-denied") return "akses ditolak, akun ini tidak punya izin mengubah data toko";
  if (error?.code === "auth/admin-restricted-operation") return "pendaftaran akun baru sedang ditutup";
  if (error?.code === "auth/email-already-in-use") return "email sudah terdaftar, silakan masuk";
  if (error?.code === "auth/invalid-credential" || error?.code === "auth/wrong-password" || error?.code === "auth/user-not-found") return "email atau password salah";
  if (error?.code === "auth/weak-password") return "password minimal 6 karakter";
  if (error?.code === "auth/invalid-email") return "format email tidak valid";
  return error?.message || String(error);
}

function showConfirm(message) {
  if (confirmResolver) confirmResolver(false);
  $("confirm-message").textContent = message;
  $("confirm-popup").style.display = "flex";
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  $("confirm-popup").style.display = "none";
  if (confirmResolver) confirmResolver(result);
  confirmResolver = null;
}

function updatePriceDiff(nama, hargaLama, hargaBaru) {
  const diff = Number(hargaBaru) - Number(hargaLama);
  $("diff-nama").textContent = nama;
  $("harga-lama").textContent = Math.round(hargaLama).toLocaleString("id-ID");
  $("harga-baru").textContent = Math.round(hargaBaru).toLocaleString("id-ID");
  $("selisih-harga").textContent = `${diff >= 0 ? "+" : ""}${Math.round(diff).toLocaleString("id-ID")}`;
  $("price-diff-container").style.display = "block";
  clearTimeout(priceDiffTimer);
  priceDiffTimer = setTimeout(() => {
    $("price-diff-container").style.display = "none";
  }, 7000);
}

// ===================== Cache data barang (hemat kuota Firestore) =====================
// Dulu setiap kali halaman admin dibuka, SEMUA dokumen barang dibaca ulang dari server.
// Sekarang daftar barang disimpan di perangkat admin; saat dibuka lagi hanya barang yang
// berubah (field `diubah`, waktu server) yang dibaca, ditambah 1 dokumen catatan penghapusan.
// Pembacaan penuh tetap dilakukan bila cache tidak ada / lebih tua dari 6 jam.
const KUNCI_CACHE_BARANG = "toko-h-endun:cache-barang";
const UMUR_MAKS_CACHE_BARANG = 6 * 60 * 60 * 1000;
const UMUR_CATATAN_HAPUS = 24 * 60 * 60 * 1000;
const REF_META_BARANG = () => doc(db, "meta", "barang");
let metaCacheBarang = { lastSync: 0, penuhPada: 0 };

// Stempel waktu server untuk setiap penulisan barang (dipakai sinkron perubahan).
function stempel(data) {
  return { ...data, diubah: serverTimestamp() };
}

function keMilis(nilai) {
  if (!nilai) return 0;
  if (typeof nilai.toMillis === "function") return nilai.toMillis();
  if (nilai instanceof Date) return nilai.getTime();
  return Number(nilai) || 0;
}

// Timestamp/Date diubah ke angka agar bisa disimpan sebagai JSON.
function barangUntukCache(item) {
  const hasil = {};
  Object.entries(item).forEach(([kunci, nilai]) => {
    if (kunci === "diubah") return;
    hasil[kunci] = nilai && (typeof nilai.toMillis === "function" || nilai instanceof Date) ? keMilis(nilai) : nilai;
  });
  return hasil;
}

function simpanCacheBarang() {
  if (peran !== "admin" || !metaCacheBarang.penuhPada) return;
  tulisPenyimpanan(KUNCI_CACHE_BARANG, { ...metaCacheBarang, items: barangCache.map(barangUntukCache) });
}

function hapusCacheBarang() {
  metaCacheBarang = { lastSync: 0, penuhPada: 0 };
  try { localStorage.removeItem(KUNCI_CACHE_BARANG); } catch (error) { /* abaikan */ }
}

function bacaCacheBarang() {
  const cache = bacaPenyimpanan(KUNCI_CACHE_BARANG);
  const masihBaru = Date.now() - Number(cache.penuhPada || 0) < UMUR_MAKS_CACHE_BARANG;
  return Array.isArray(cache.items) && cache.lastSync > 0 && masihBaru ? cache : null;
}

// Catat id barang yang dihapus agar perangkat admin lain ikut menghapus dari cache-nya.
async function catatPenghapusan(ids) {
  try {
    const snap = await getDoc(REF_META_BARANG());
    const batas = Date.now() - UMUR_CATATAN_HAPUS;
    const lama = (snap.exists() ? snap.data().dihapus || [] : [])
      .filter((entri) => Number(String(entri).split("|")[1]) > batas);
    const baru = ids.map((id) => `${id}|${Date.now()}`);
    await setDoc(REF_META_BARANG(), { dihapus: [...lama, ...baru].slice(-2000), diperbarui: serverTimestamp() });
  } catch (error) {
    console.warn("Catatan penghapusan barang belum tersimpan.", error);
  }
}

async function muatBarangPenuh() {
  const snapshot = await getDocs(collection(db, "barang"));
  barangCache = snapshot.docs.map((snap) => normalizeBarang(snap.id, snap.data()));
  // Titik awal sinkron berikutnya: waktu server terbaru yang terlihat, atau (bila belum ada) jam perangkat dikurangi 10 menit.
  const terbaru = Math.max(0, ...snapshot.docs.map((snap) => keMilis(snap.data().diubah)));
  metaCacheBarang = { lastSync: terbaru || Date.now() - 10 * 60 * 1000, penuhPada: Date.now() };
}

async function muatBarangPerubahan(cache) {
  const [snapshot, metaSnap] = await Promise.all([
    getDocs(query(collection(db, "barang"), where("diubah", ">", Timestamp.fromMillis(cache.lastSync)))),
    getDoc(REF_META_BARANG())
  ]);
  const peta = new Map(cache.items.map((item) => [item.id, normalizeBarang(item.id, item)]));
  let lastSync = cache.lastSync;
  snapshot.docs.forEach((snap) => {
    const data = snap.data();
    peta.set(snap.id, normalizeBarang(snap.id, data));
    lastSync = Math.max(lastSync, keMilis(data.diubah));
  });
  (metaSnap.exists() ? metaSnap.data().dihapus || [] : []).forEach((entri) => peta.delete(String(entri).split("|")[0]));
  barangCache = [...peta.values()];
  metaCacheBarang = { lastSync, penuhPada: cache.penuhPada };
}

async function fetchBarang({ penuh = false } = {}) {
  const cache = penuh ? null : bacaCacheBarang();
  if (cache) {
    try {
      await muatBarangPerubahan(cache);
    } catch (error) {
      if (error?.code === "permission-denied") throw error;
      console.warn("Sinkron perubahan gagal, memuat semua barang.", error);
      await muatBarangPenuh();
    }
  } else {
    await muatBarangPenuh();
  }
  await selesaikanProgressMuat();
  refreshBarangViews();
  return barangCache;
}

// label dipakai sebagai keterangan kolom saat tabel tampil sebagai kartu di HP.
function createCell(text, label = "", className = "") {
  const td = document.createElement("td");
  td.textContent = String(text);
  if (label) td.dataset.label = label;
  if (className) td.className = className;
  return td;
}

function createButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", handler);
  return button;
}

// Harga total + keterangan harga per pcs (keterangan hanya tampil di HP,
// karena di HP kolom "Harga Satuan" disembunyikan).
function createHargaCell(item) {
  const td = createCell(formatRupiah(item.harga), "Harga Total", "num");
  if (item.isiPerSatuan > 1) {
    const sub = document.createElement("small");
    sub.className = "sub-harga";
    sub.textContent = `${formatRupiah(item.hargaSatuan)}/pcs`;
    td.appendChild(sub);
  }
  return td;
}

function createEmptyRow(text, colSpan, extraClass = "") {
  const tr = document.createElement("tr");
  const td = createCell(text, "", `empty-row ${extraClass}`.trim());
  td.colSpan = colSpan;
  tr.appendChild(td);
  return tr;
}

// ---------- Bar loading 1–100% saat data barang dimuat ----------
// Firestore tidak memberi progres unduhan, jadi bar berjalan perlahan mendekati 90%
// selama menunggu, lalu langsung 100% begitu data benar-benar selesai diambil.
let progressMuat = null;

function createBarisProgress(colSpan) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = colSpan;
  td.className = "empty-row loading-row";

  const wadah = document.createElement("div");
  wadah.className = "muat-wadah";
  const teks = document.createElement("div");
  teks.className = "muat-teks";
  teks.append(createText("span", "Memuat data barang"), createText("span", "1%", "muat-persen"));
  const bar = document.createElement("div");
  bar.className = "muat-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.appendChild(createText("div", "", "muat-isi"));
  wadah.append(teks, bar);

  td.appendChild(wadah);
  tr.appendChild(td);
  return tr;
}

function terapkanProgressMuat() {
  if (!progressMuat) return;
  const persen = Math.round(progressMuat.nilai);
  document.querySelectorAll(".muat-isi").forEach((el) => { el.style.width = `${persen}%`; });
  document.querySelectorAll(".muat-persen").forEach((el) => { el.textContent = `${persen}%`; });
  document.querySelectorAll(".muat-bar").forEach((el) => el.setAttribute("aria-valuenow", String(persen)));
}

function hentikanProgressMuat() {
  if (progressMuat) clearInterval(progressMuat.timer);
  progressMuat = null;
}

// Naikkan ke 100%, beri jeda singkat agar angka 100% sempat terlihat.
async function selesaikanProgressMuat() {
  if (!progressMuat) return;
  clearInterval(progressMuat.timer);
  progressMuat.nilai = 100;
  terapkanProgressMuat();
  await new Promise((resolve) => setTimeout(resolve, 380));
  progressMuat = null;
}

function showBarangLoading() {
  hentikanProgressMuat();
  $("barangList").replaceChildren(createBarisProgress(7));
  $("sidebarBarangBody").replaceChildren(createBarisProgress(4));
  $("hargaJualList").replaceChildren(createBarisProgress(5));

  progressMuat = { nilai: 1, timer: null };
  progressMuat.timer = setInterval(() => {
    // Makin dekat ke 90%, makin lambat naiknya.
    progressMuat.nilai = Math.min(90, progressMuat.nilai + Math.max(0.25, (90 - progressMuat.nilai) * 0.07));
    terapkanProgressMuat();
  }, 80);
  terapkanProgressMuat();
}

function showBarangError() {
  hentikanProgressMuat();
  const pesan = "Gagal memuat data barang. Periksa koneksi lalu muat ulang halaman.";
  $("barangList").replaceChildren(createEmptyRow(pesan, 7));
  $("sidebarBarangBody").replaceChildren(createEmptyRow(pesan, 4));
  $("hargaJualList").replaceChildren(createEmptyRow(pesan, 5));
}

function createActionCell(...buttons) {
  const td = document.createElement("td");
  td.className = "col-aksi";
  const group = document.createElement("div");
  group.className = "action-group";
  group.append(...buttons);
  td.appendChild(group);
  return td;
}

function renderBarang() {
  const tbody = $("barangList");
  const keyword = $("searchBarang").value.trim().toLocaleLowerCase("id-ID");
  tbody.replaceChildren();

  const items = barangCache.filter((item) => item.nama.toLocaleLowerCase("id-ID").includes(keyword));
  if (!items.length) {
    tbody.appendChild(createEmptyRow(barangCache.length ? "Barang tidak ditemukan." : "Belum ada barang. Tambahkan barang pertama di atas.", 7));
    return;
  }

  items.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.append(
      createCell(index + 1, "No", "col-no"),
      createCell(item.nama, "Nama Barang", "cell-title"),
      createCell(item.isiPerSatuan > 1 ? `${item.satuan} (${item.isiPerSatuan} pcs)` : item.satuan, "Satuan"),
      createHargaCell(item),
      createCell(formatRupiah(item.hargaSatuan), "Harga Satuan", "num"),
      createCell(formatDate(item.editedAt), "Terakhir Diedit", "cell-muted"),
      createActionCell(
        createButton("Edit", "btn-edit", () => openEditPopup(item.id)),
        createButton("Hapus", "hapus-btn", () => hapusBarang(item.id))
      )
    );
    tbody.appendChild(tr);
  });
}

function renderSidebarBarang() {
  const tbody = $("sidebarBarangBody");
  const keyword = $("searchSidebarBarang").value.trim().toLocaleLowerCase("id-ID");
  tbody.replaceChildren();

  const items = barangCache.filter((item) => item.nama.toLocaleLowerCase("id-ID").includes(keyword));
  if (!items.length) {
    tbody.appendChild(createEmptyRow(barangCache.length ? "Barang tidak ditemukan." : "Belum ada barang.", 4));
    return;
  }

  items.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.append(
      createCell(index + 1, "No", "col-no"),
      createCell(item.nama, "Nama", "cell-title"),
      createCell(formatRupiah(item.harga), `Harga / ${item.satuan}`, "num"),
      createActionCell(
        createButton("Kurang", "btn-kurang", () => tambahKeLembarOpname("kurang", item)),
        createButton("Lebih", "btn-lebih", () => tambahKeLembarOpname("lebih", item))
      )
    );
    tbody.appendChild(tr);
  });
}

function getSelectedUnit() {
  const select = $("satuanBarang");
  if (select.value === "custom") {
    const satuan = $("namaCustom").value.trim();
    const isi = Math.max(1, parseInt($("isiCustom").value, 10) || 0);
    if (!satuan || !Number($("isiCustom").value)) return null;
    return { satuan, isiPerSatuan: isi };
  }
  const option = select.options[select.selectedIndex];
  return {
    satuan: select.value,
    isiPerSatuan: Math.max(1, Number(option.dataset.isi) || 1)
  };
}

function resetFormBarang() {
  $("namaBarang").value = "";
  $("hargaBarang").value = "";
  $("satuanBarang").value = "pcs";
  $("namaCustom").value = "";
  $("isiCustom").value = "";
  $("customWrapper").style.display = "none";
  $("namaBarang").focus();
}

async function tambahBarang() {
  if ($("btnTambah").disabled) return;
  const nama = $("namaBarang").value.trim();
  const harga = parseMoney($("hargaBarang").value);
  const unit = getSelectedUnit();

  if (!nama) return showAlert("Nama barang wajib diisi.", "warning");
  if (!Number.isFinite(harga) || harga < 0) return showAlert("Harga harus berupa angka yang valid.", "warning");
  if (!unit) return showAlert("Satuan custom dan isi per satuan harus diisi.", "warning");

  const existing = findBarangByKey(nama, unit.satuan);
  if (existing) {
    const yes = await showConfirm(`Barang “${existing.nama}” (${existing.satuan}) sudah ada dengan harga ${formatRupiah(existing.harga)}. Tetap tambahkan sebagai barang baru?`);
    if (!yes) return;
  }

  $("btnTambah").disabled = true;
  try {
    const data = {
      nama,
      harga,
      satuan: unit.satuan,
      isiPerSatuan: unit.isiPerSatuan,
      hargaSatuan: harga / unit.isiPerSatuan,
      editedAt: new Date(),
      editedBy: auth.currentUser?.email || "anonymous"
    };
    const ref = await addDoc(collection(db, "barang"), stempel(data));
    upsertBarangCache(ref.id, data);
    simpanKatalog(ref.id);
    refreshBarangViews();
    resetFormBarang();
    showAlert("Barang berhasil ditambahkan.");
  } catch (error) {
    console.error(error);
    showAlert(`Gagal menambah barang: ${errorText(error)}`, "error");
  } finally {
    $("btnTambah").disabled = false;
  }
}

function openEditPopup(id) {
  const item = barangCache.find((barang) => barang.id === id);
  if (!item) return showAlert("Data barang tidak ditemukan.", "error");
  currentEditId = id;
  $("edit-namaBarang").value = item.nama;
  $("edit-hargaBarang").value = item.harga;
  $("edit-namaSatuan").value = item.satuan;
  $("edit-isiSatuan").value = item.isiPerSatuan;
  $("edit-popup").style.display = "flex";
}

function closeEdit() {
  $("edit-popup").style.display = "none";
  currentEditId = null;
}

async function syncRiwayatForBarang(barangId, oldData, newData) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const snapshot = await getDocs(query(collection(db, "stock_opname"), where("uid", "==", user.uid)));
    const jobs = [];

    snapshot.forEach((snap) => {
      const data = snap.data();
      let changed = false;
      const updateList = (list = []) => list.map((raw) => {
        const item = normalizeHistoryItem(raw);
        const match = item.barangId === barangId || (!item.barangId && item.nama === oldData.nama);
        if (!match) return raw;
        changed = true;
        const hargaPerPcs = newData.harga / newData.isiPerSatuan;
        return {
          ...item,
          barangId,
          nama: newData.nama,
          satuan: newData.satuan,
          isiPerSatuan: newData.isiPerSatuan,
          hargaKemasan: newData.harga,
          harga: newData.harga,
          hargaPerPcs,
          hargaSatuan: hargaPerPcs,
          total: Math.round(item.qtyPcs * hargaPerPcs),
          displayQty: formatQty(item.qtyPcs, newData.satuan, newData.isiPerSatuan)
        };
      });

      const kurang = updateList(data.kurang);
      const lebih = updateList(data.lebih);
      if (changed) jobs.push(updateDoc(doc(db, "stock_opname", snap.id), { kurang, lebih, updatedAt: new Date() }));
    });

    await Promise.all(jobs);
  } catch (error) {
    console.warn("Sinkronisasi riwayat tidak selesai. Data barang utama tetap tersimpan.", error);
  }
}

async function simpanEditBarang() {
  const editId = currentEditId;
  if (!editId || $("save-edit-btn").disabled) return;
  const oldData = barangCache.find((item) => item.id === editId);
  if (!oldData) return showAlert("Data lama tidak ditemukan.", "error");

  const nama = $("edit-namaBarang").value.trim();
  const harga = parseMoney($("edit-hargaBarang").value);
  const satuan = $("edit-namaSatuan").value.trim() || "pcs";
  const isiPerSatuan = Math.max(1, parseInt($("edit-isiSatuan").value, 10) || 0);

  if (!nama) return showAlert("Nama barang wajib diisi.", "warning");
  if (!Number.isFinite(harga) || harga < 0) return showAlert("Harga tidak valid.", "warning");
  if (!Number($("edit-isiSatuan").value)) return showAlert("Isi per satuan minimal 1.", "warning");

  const duplicate = findBarangByKey(nama, satuan, editId);
  if (duplicate) {
    const yes = await showConfirm(`Sudah ada barang lain “${duplicate.nama}” (${duplicate.satuan}). Tetap simpan dengan nama yang sama?`);
    if (!yes) return;
  }

  const newData = { nama, harga, satuan, isiPerSatuan, hargaSatuan: harga / isiPerSatuan };
  $("save-edit-btn").disabled = true;

  try {
    const changes = {
      ...newData,
      hargaLama: oldData.harga,
      editedAt: new Date(),
      editedBy: auth.currentUser?.email || "anonymous"
    };
    await updateDoc(doc(db, "barang", editId), stempel(changes));
    upsertBarangCache(editId, changes);
    simpanKatalog(editId);

    let riwayatGagal = null;
    if (oldData.harga !== harga) {
      updatePriceDiff(nama, oldData.harga, harga);
      try {
        const entriRiwayat = {
          barangId: editId,
          namaLama: oldData.nama,
          nama,
          hargaLama: oldData.harga,
          hargaBaru: harga,
          timestamp: new Date(),
          uid: auth.currentUser?.uid || null,
          editedBy: auth.currentUser?.email || "anonymous"
        };
        await addDoc(collection(db, "price_history"), entriRiwayat);
        tambahRiwayatHargaLokal(entriRiwayat);
      } catch (historyError) {
        riwayatGagal = historyError;
        console.warn("Histori harga belum dapat disimpan. Edit barang utama tetap berhasil.", historyError);
      }
    }

    await syncRiwayatForBarang(editId, oldData, newData);
    closeEdit();
    refreshBarangViews();
    if (riwayatGagal) {
      showAlert(`Harga tersimpan, tapi riwayat harga GAGAL dicatat (${riwayatGagal.code || riwayatGagal.message}). Periksa Firestore Rules.`, "warning");
    } else {
      showAlert("Data barang berhasil diperbarui.");
    }
  } catch (error) {
    console.error(error);
    showAlert(`Gagal memperbarui barang: ${errorText(error)}`, "error");
  } finally {
    $("save-edit-btn").disabled = false;
  }
}

async function hapusBarang(id) {
  const item = barangCache.find((barang) => barang.id === id);
  if (!item) return;
  const yes = await showConfirm(`Hapus barang “${item.nama}”? Riwayat stock opname yang sudah tersimpan tetap dipertahankan.`);
  if (!yes) return;
  try {
    await deleteDoc(doc(db, "barang", id));
    hapusKatalog(id);
    catatPenghapusan([id]);
    barangCache = barangCache.filter((barang) => barang.id !== id);
    refreshBarangViews();
    showAlert("Barang berhasil dihapus.");
  } catch (error) {
    console.error(error);
    showAlert(`Gagal menghapus barang: ${errorText(error)}`, "error");
  }
}

function formatQty(qtyPcs, satuan = "pcs", isiPerSatuan = 1) {
  qtyPcs = Math.max(0, Number(qtyPcs) || 0);
  isiPerSatuan = Math.max(1, Number(isiPerSatuan) || 1);
  if (isiPerSatuan === 1 || satuan === "pcs") return `${qtyPcs} pcs`;
  const kemasan = Math.floor(qtyPcs / isiPerSatuan);
  const sisa = qtyPcs % isiPerSatuan;
  if (kemasan && sisa) return `${kemasan} ${satuan} + ${sisa} pcs`;
  if (kemasan) return `${kemasan} ${satuan}`;
  return `${sisa} pcs`;
}

function askQuantity(item) {
  qtyCurrentItem = item;
  $("qty-title").textContent = `Jumlah ${item.nama}`;
  $("qty-input").value = "1";
  const select = $("qty-unit-mode");
  select.replaceChildren();

  const pcsOption = document.createElement("option");
  pcsOption.value = "pcs";
  pcsOption.textContent = "pcs";
  select.appendChild(pcsOption);

  if (item.isiPerSatuan > 1) {
    const packageOption = document.createElement("option");
    packageOption.value = "package";
    packageOption.textContent = `${item.satuan} (${item.isiPerSatuan} pcs)`;
    select.appendChild(packageOption);
  }

  $("qty-help").textContent = item.isiPerSatuan > 1
    ? `Pilih pcs atau ${item.satuan}. Sistem akan menyimpan jumlah dasar dalam pcs.`
    : "Jumlah disimpan dalam pcs.";
  $("qty-popup").style.display = "flex";
  setTimeout(() => $("qty-input").focus(), 0);

  return new Promise((resolve) => {
    qtyResolver = resolve;
  });
}

function resolveQuantity(ok) {
  if (!qtyResolver) return;
  let result = null;
  if (ok) {
    const amount = parseInt($("qty-input").value, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      showAlert("Jumlah minimal 1.", "warning");
      return;
    }
    const mode = $("qty-unit-mode").value;
    const qtyPcs = mode === "package" ? amount * qtyCurrentItem.isiPerSatuan : amount;
    result = { qtyPcs };
  }
  $("qty-popup").style.display = "none";
  qtyResolver(result);
  qtyResolver = null;
  qtyCurrentItem = null;
}

async function tambahKeLembarOpname(tipe, item) {
  const answer = await askQuantity(item);
  if (!answer) return;
  const hargaPerPcs = item.harga / item.isiPerSatuan;
  const entry = {
    entryId: makeId(),
    barangId: item.id,
    nama: item.nama,
    satuan: item.satuan,
    isiPerSatuan: item.isiPerSatuan,
    qtyPcs: answer.qtyPcs,
    qty: answer.qtyPcs,
    displayQty: formatQty(answer.qtyPcs, item.satuan, item.isiPerSatuan),
    hargaKemasan: item.harga,
    harga: item.harga,
    hargaPerPcs,
    hargaSatuan: hargaPerPcs,
    total: Math.round(answer.qtyPcs * hargaPerPcs)
  };

  if (tipe === "kurang") daftarKurang.push(entry);
  else daftarLebih.push(entry);
  renderLembarOpname();
}

function renderLembarTable(tipe, items) {
  const tbody = tipe === "kurang" ? $("lembarKurang") : $("lembarLebih");
  tbody.replaceChildren();
  const total = items.reduce((sum, item) => sum + normalizeHistoryItem(item).total, 0);
  $(tipe === "kurang" ? "total-kurang" : "total-lebih").textContent = formatRupiah(total);
  items.forEach((item) => {
    const normalized = normalizeHistoryItem(item);
    const tr = document.createElement("tr");
    tr.append(
      createCell(normalized.displayQty, "Qty", "nowrap"),
      createCell(normalized.nama, "Nama Barang", "cell-title"),
      createCell(formatRupiah(normalized.total), "Total", "num"),
      createActionCell(createButton("Hapus", "hapus-btn", () => {
        if (tipe === "kurang") daftarKurang = daftarKurang.filter((entry) => entry.entryId !== normalized.entryId);
        else daftarLebih = daftarLebih.filter((entry) => entry.entryId !== normalized.entryId);
        renderLembarOpname();
      }))
    );
    tbody.appendChild(tr);
  });
}

function renderLembarOpname() {
  daftarKurang = daftarKurang.map(normalizeHistoryItem);
  daftarLebih = daftarLebih.map(normalizeHistoryItem);
  renderLembarTable("kurang", daftarKurang);
  renderLembarTable("lebih", daftarLebih);
  simpanDraf();
}

function resetStockForm() {
  daftarKurang = [];
  daftarLebih = [];
  currentRiwayatId = null;
  $("judulDokumen").value = "";
  $("judul-dokumen-terpilih").textContent = "";
  $("btnSimpanOpname").textContent = "Simpan Hasil Stock Opname";
  renderLembarOpname();
}

// Draf stock opname disimpan di browser (per akun) agar isian tidak hilang
// saat halaman tertutup, di-refresh, atau HP mati.
function drafKey() {
  return auth.currentUser ? `stock-opname-draf:${auth.currentUser.uid}` : null;
}

function simpanDraf() {
  const key = drafKey();
  if (!key) return;
  const judul = $("judulDokumen").value;
  try {
    if (!daftarKurang.length && !daftarLebih.length && !judul.trim() && !currentRiwayatId) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({
      kurang: daftarKurang,
      lebih: daftarLebih,
      judul,
      currentRiwayatId,
      judulTerpilih: $("judul-dokumen-terpilih").textContent,
      savedAt: Date.now()
    }));
  } catch (error) {
    console.warn("Draf stock opname tidak dapat disimpan di browser ini.", error);
  }
}

function pulihkanDraf() {
  const key = drafKey();
  if (!key) return false;
  let draf = null;
  try {
    draf = JSON.parse(localStorage.getItem(key) || "null");
  } catch (error) {
    console.warn("Draf stock opname tidak dapat dibaca.", error);
  }
  if (!draf) return false;

  daftarKurang = (draf.kurang || []).map(normalizeHistoryItem);
  daftarLebih = (draf.lebih || []).map(normalizeHistoryItem);
  currentRiwayatId = draf.currentRiwayatId || null;
  $("judulDokumen").value = draf.judul || "";
  $("judul-dokumen-terpilih").textContent = draf.judulTerpilih || "";
  $("btnSimpanOpname").textContent = currentRiwayatId ? "Update Riwayat Stock Opname" : "Simpan Hasil Stock Opname";
  renderLembarOpname();
  showAlert(`Draf stock opname terakhir dipulihkan (${formatDate(draf.savedAt, true)}).`, "info", 4000);
  return true;
}

async function showStockOpname({ reset = false } = {}) {
  if (reset && !pulihkanDraf()) resetStockForm();
  setView("stock");
  if (barangCache.length) return renderSidebarBarang();
  showBarangLoading();
  try {
    await fetchBarang();
  } catch (error) {
    console.error(error);
    showBarangError();
  }
}

// ===================== Harga Jual =====================
// Harga jual & modal dihitung per pcs. Untung = harga jual - harga modal per pcs.

function infoUntung(modalPerPcs, hargaJual) {
  if (!(hargaJual > 0)) return { teks: "Belum diatur", kelas: "kosong" };
  const selisih = hargaJual - modalPerPcs;
  if (selisih > 0) return { teks: `Untung ${formatRupiah(selisih)}`, kelas: "untung" };
  if (selisih < 0) return { teks: `Rugi ${formatRupiah(Math.abs(selisih))}`, kelas: "rugi" };
  return { teks: "Impas (untung Rp 0)", kelas: "impas" };
}

function renderHargaJual() {
  const tbody = $("hargaJualList");
  if (!tbody) return;
  const keyword = $("searchHargaJual").value.trim().toLocaleLowerCase("id-ID");
  const sudahDiatur = barangCache.filter((item) => item.hargaJual > 0).length;
  $("hj-ringkasan").textContent = barangCache.length
    ? `${sudahDiatur} dari ${barangCache.length} barang sudah punya harga jual`
    : "";
  tbody.replaceChildren();

  const items = barangCache.filter((item) => item.nama.toLocaleLowerCase("id-ID").includes(keyword));
  if (!items.length) {
    tbody.appendChild(createEmptyRow(barangCache.length ? "Barang tidak ditemukan." : "Belum ada barang.", 5));
    return;
  }

  items.forEach((item, index) => {
    const modalTd = createCell(`${formatRupiah(item.hargaSatuan)}`, "Harga Modal", "num");
    if (item.isiPerSatuan > 1) {
      modalTd.appendChild(createText("small", `1 ${item.satuan} = ${formatRupiah(item.harga)}`, "sub-info"));
    }

    const untung = infoUntung(item.hargaSatuan, item.hargaJual);
    const jualTd = createCell(formatRupiah(item.hargaJual), "Harga Jual", `num${item.hargaJual > 0 ? "" : " belum-diatur"}`);
    jualTd.appendChild(createText("small", untung.teks, `sub-untung ${untung.kelas}`));

    const tr = document.createElement("tr");
    tr.append(
      createCell(index + 1, "No", "col-no"),
      createCell(item.nama, "Nama Barang", "cell-title"),
      modalTd,
      jualTd,
      createActionCell(
        createButton("Sesuaikan", "btn-sesuaikan", () => bukaHargaJual(item.id)),
        createButton("📷 Aset", "btn-aset", () => bukaAsetProduk(item.id))
      )
    );
    tbody.appendChild(tr);
  });
}

async function showHargaJual() {
  setView("hargaJual");
  if (barangCache.length) return renderHargaJual();
  showBarangLoading();
  try {
    await fetchBarang();
  } catch (error) {
    console.error(error);
    showBarangError();
  }
}

function perbaruiPratinjauUntung() {
  const item = barangCache.find((barang) => barang.id === currentHargaJualId);
  if (!item) return;
  const nilai = $("hj-input").value.trim();
  const hargaJual = nilai ? parseMoney(nilai) : 0;
  const el = $("hj-untung");
  if (nilai && !Number.isFinite(hargaJual)) {
    el.textContent = "Format harga tidak valid";
    el.className = "hj-untung rugi";
    return;
  }
  const untung = infoUntung(item.hargaSatuan, hargaJual);
  el.textContent = untung.teks;
  el.className = `hj-untung ${untung.kelas}`;
}

function bukaHargaJual(id) {
  const item = barangCache.find((barang) => barang.id === id);
  if (!item) return showAlert("Data barang tidak ditemukan.", "error");
  currentHargaJualId = id;
  $("hj-nama").textContent = item.nama;
  $("hj-modal").textContent = item.isiPerSatuan > 1
    ? `Harga modal: ${formatRupiah(item.hargaSatuan)} / pcs (1 ${item.satuan} = ${formatRupiah(item.harga)})`
    : `Harga modal: ${formatRupiah(item.hargaSatuan)} / pcs`;
  $("hj-input").value = item.hargaJual > 0 ? String(item.hargaJual) : "";
  perbaruiPratinjauUntung();
  $("harga-jual-popup").style.display = "flex";
  setTimeout(() => $("hj-input").focus(), 0);
}

function tutupHargaJual() {
  $("harga-jual-popup").style.display = "none";
  currentHargaJualId = null;
}

async function simpanHargaJual() {
  const id = currentHargaJualId;
  if (!id || $("hj-simpan").disabled) return;
  const item = barangCache.find((barang) => barang.id === id);
  if (!item) return showAlert("Data barang tidak ditemukan.", "error");

  const nilai = $("hj-input").value.trim();
  const hargaJual = nilai ? parseMoney(nilai) : 0;
  if (!Number.isFinite(hargaJual) || hargaJual < 0 || hargaJual >= 1000000000) {
    return showAlert("Harga jual harus berupa angka yang valid.", "warning");
  }

  $("hj-simpan").disabled = true;
  try {
    // Nama/harga/satuan/isi ikut dikirim agar data lama yang belum lengkap tetap lolos validasi rules.
    const perubahan = {
      nama: item.nama,
      harga: item.harga,
      satuan: item.satuan,
      isiPerSatuan: item.isiPerSatuan,
      hargaJual
    };
    // Harga sebelumnya dicatat agar etalase bisa menampilkan tanda naik/turun.
    if (hargaJual !== item.hargaJual) {
      perubahan.hargaJualSebelumnya = item.hargaJual;
      perubahan.hargaJualDiubah = new Date();
      perubahan.hargaJualDiubahOleh = auth.currentUser?.email || "anonymous";
    }
    await updateDoc(doc(db, "barang", id), stempel(perubahan));
    upsertBarangCache(id, perubahan);
    simpanKatalog(id);
    tutupHargaJual();
    renderHargaJual();
    const untung = infoUntung(item.hargaSatuan, hargaJual);
    showAlert(hargaJual > 0 ? `Harga jual ${item.nama} disimpan. ${untung.teks}.` : `Harga jual ${item.nama} dikosongkan.`);
  } catch (error) {
    console.error(error);
    showAlert(`Gagal menyimpan harga jual: ${errorText(error)}`, "error");
  } finally {
    $("hj-simpan").disabled = false;
  }
}
// ======================================================

// ===================== Aset produk (upload ke repo GitHub) =====================
// File foto/model disimpan di folder aset-produk/ repo website lewat GitHub API, dinamai
// sesuai nama barang (mis. aqua-600ml.glb), dan aset-produk/daftar.json ikut diperbarui.
// Token GitHub hanya disimpan di browser perangkat admin ini (tidak di repo / Firestore).
const KUNCI_GITHUB = "toko-h-endun:github";
const FOLDER_ASET_REPO = "aset-produk";
const MAKS_UKURAN_ASET = 15 * 1024 * 1024;
let asetProdukId = null;
let asetDipilih = null;
let penampilAset = null;

// Website di https://pemilik.github.io/nama-repo/ → repo "pemilik/nama-repo".
function deteksiRepoGitHub() {
  if (!location.hostname.endsWith(".github.io")) return "";
  const pemilik = location.hostname.split(".")[0];
  const segmen = location.pathname.split("/").filter(Boolean)[0];
  return segmen && !segmen.includes(".") ? `${pemilik}/${segmen}` : `${pemilik}/${pemilik}.github.io`;
}

function konfigGitHub() {
  const simpanan = bacaPenyimpanan(KUNCI_GITHUB);
  return { repo: simpanan.repo || deteksiRepoGitHub(), branch: simpanan.branch || "main", token: simpanan.token || "" };
}

async function githubApi(jalur, { method = "GET", body } = {}) {
  const { repo, token } = konfigGitHub();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Nama repo GitHub belum diisi (format pemilik/nama-repo) di Pengaturan GitHub.");
  if (!token) throw new Error("Token GitHub belum diisi di Pengaturan GitHub.");
  const res = await fetch(`https://api.github.com/repos/${repo}${jalur ? `/${jalur}` : ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 404 && method === "GET" && jalur) return null;
  if (!res.ok) {
    const pesan = {
      401: "token tidak valid atau sudah kedaluwarsa",
      403: "token tidak punya izin menulis ke repo ini",
      404: "repo atau branch tidak ditemukan",
      409: "file berubah bersamaan, coba lagi",
      422: "file berubah bersamaan, coba lagi"
    }[res.status] || `HTTP ${res.status}`;
    const error = new Error(`GitHub: ${pesan}`);
    error.status = res.status;
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

const jalurIsiRepo = (path) => `contents/${path.split("/").map(encodeURIComponent).join("/")}`;

async function ambilIsiRepo(path) {
  return githubApi(`${jalurIsiRepo(path)}?ref=${encodeURIComponent(konfigGitHub().branch)}`);
}

async function tulisFileRepo(path, base64, pesan, sha) {
  return githubApi(jalurIsiRepo(path), {
    method: "PUT",
    body: { message: pesan, content: base64, branch: konfigGitHub().branch, ...(sha ? { sha } : {}) }
  });
}

async function hapusFileRepo(path, sha, pesan) {
  return githubApi(jalurIsiRepo(path), { method: "DELETE", body: { message: pesan, sha, branch: konfigGitHub().branch } });
}

function teksKeBase64(teks) {
  let biner = "";
  new TextEncoder().encode(teks).forEach((b) => { biner += String.fromCharCode(b); });
  return btoa(biner);
}

function base64KeTeks(b64) {
  const biner = atob(String(b64).replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(biner, (c) => c.charCodeAt(0)));
}

function fileKeBase64(file) {
  return new Promise((resolve, reject) => {
    const pembaca = new FileReader();
    pembaca.onload = () => resolve(String(pembaca.result).split(",")[1] || "");
    pembaca.onerror = () => reject(pembaca.error);
    pembaca.readAsDataURL(file);
  });
}

// daftar.json dibaca → diubah → ditulis; diulang sekali bila ada perubahan bersamaan.
async function ubahDaftarAsetRepo(ubah, pesan) {
  for (let percobaan = 0; percobaan < 2; percobaan++) {
    const lama = await ambilIsiRepo(`${FOLDER_ASET_REPO}/daftar.json`);
    let daftar = [];
    if (lama?.content) {
      try { daftar = JSON.parse(base64KeTeks(lama.content)); } catch (error) { daftar = []; }
    }
    try {
      await tulisFileRepo(`${FOLDER_ASET_REPO}/daftar.json`, teksKeBase64(`${JSON.stringify(ubah(daftar), null, 2)}\n`), pesan, lama?.sha);
      return;
    } catch (error) {
      if (percobaan === 0 && (error.status === 409 || error.status === 422)) continue;
      throw error;
    }
  }
}

// Ganti entri barang ini di daftar.json dengan file baru (kosong = hapus entri).
function gantiEntriDaftar(daftar, { slug, namaBarang, fileBaru, slugNama }) {
  const slugFile = (f) => slugNama(String(f).replace(/\.[^.\/]+$/, ""));
  if (Array.isArray(daftar)) {
    return [...daftar.filter((f) => slugFile(f) !== slug), ...fileBaru].sort((a, b) => String(a).localeCompare(String(b)));
  }
  const hasil = { ...daftar };
  Object.keys(hasil).forEach((kunci) => { if (slugNama(kunci) === slug) delete hasil[kunci]; });
  if (fileBaru.length) hasil[namaBarang] = fileBaru.length > 1 ? fileBaru : fileBaru[0];
  return hasil;
}

function setProgresAset(teks) {
  const el = $("aset-progres");
  el.hidden = !teks;
  el.textContent = teks || "";
}

function setTombolAsetSibuk(sibuk) {
  ["aset-unggah", "aset-hapus", "aset-file", "gh-simpan", "gh-tes"].forEach((id) => { $(id).disabled = sibuk; });
  if (!sibuk) $("aset-unggah").disabled = !asetDipilih;
}

function isiFormGitHub() {
  const konfig = konfigGitHub();
  $("gh-repo").value = konfig.repo;
  $("gh-branch").value = konfig.branch;
  $("gh-token").value = "";
  $("gh-token").placeholder = konfig.token ? "Token tersimpan (isi untuk mengganti)" : "Token GitHub (github_pat_...)";
  $("aset-pengaturan").open = !konfig.token || !konfig.repo;
}

// Hanya pratinjau yang diminta terakhir yang ditampilkan (yang lebih lambat selesai diabaikan).
let versiPratinjauAset = 0;
async function tampilkanPratinjauAset(aset, label) {
  const versi = ++versiPratinjauAset;
  const modul = await muatModul3D();
  const item = barangCache.find((barang) => barang.id === asetProdukId);
  if (!modul || !item) return;
  $("aset-label-pratinjau").textContent = "⏳ Memuat pratinjau...";
  try {
    penampilAset = penampilAset || await modul.buatPenampil($("aset-kanvas"));
    const model = await modul.modelProduk({ jenis: deteksiJenis(item.nama, item.satuan), nama: item.nama, aset });
    if (versi !== versiPratinjauAset || asetProdukId !== item.id) return;
    penampilAset.tampilkan(model);
    $("aset-label-pratinjau").textContent = label;
  } catch (error) {
    console.warn(error);
    if (versi === versiPratinjauAset) $("aset-label-pratinjau").textContent = `File tidak bisa ditampilkan: ${error.message || error}`;
  }
}

async function bukaAsetProduk(id) {
  const item = barangCache.find((barang) => barang.id === id);
  if (!item) return showAlert("Data barang tidak ditemukan.", "error");
  asetProdukId = id;
  asetDipilih = null;
  $("aset-file").value = "";
  $("aset-nama").textContent = item.nama;
  setProgresAset("");
  setTombolAsetSibuk(false);
  isiFormGitHub();
  $("aset-popup").style.display = "flex";

  const modul = await muatModul3D();
  if (!modul) return;
  const slug = modul.slugNama(item.nama);
  const aset = await modul.asetUntuk(item.nama);
  if (asetProdukId !== id || asetDipilih) return; // popup ditutup / file baru sudah dipilih
  $("aset-status").textContent = aset
    ? `Aset di website: ${aset.file} (${aset.jenis === "model" ? "model 3D" : "foto → label 3D"}). Nama file baru: ${slug}.*`
    : `Belum ada aset, memakai model otomatis. File akan disimpan sebagai ${slug}.*`;
  $("aset-hapus").hidden = !aset;
  await tampilkanPratinjauAset(aset, aset ? "Tampilan saat ini" : "Model otomatis");
}

function tutupAsetProduk() {
  $("aset-popup").style.display = "none";
  penampilAset?.hentikan();
  asetProdukId = null;
  asetDipilih = null;
}

async function pilihFileAset() {
  const files = [...$("aset-file").files];
  if (!files.length) return;
  const terlaluBesar = files.find((f) => f.size > MAKS_UKURAN_ASET);
  if (terlaluBesar) {
    $("aset-file").value = "";
    return showAlert(`${terlaluBesar.name} terlalu besar (maks. 15 MB). Perkecil dulu model/fotonya.`, "warning", 6000);
  }
  const modul = await muatModul3D();
  asetDipilih = modul?.asetDariFile(files) || null;
  if (!asetDipilih) {
    $("aset-file").value = "";
    return showAlert("Pilih file .glb, .gltf, .obj, .jpg, .png, atau .webp.", "warning");
  }
  asetDipilih.berkas = files;
  setTombolAsetSibuk(false);
  const ukuran = files.reduce((total, f) => total + f.size, 0);
  await tampilkanPratinjauAset(asetDipilih, `Pratinjau ${asetDipilih.file} (${(ukuran / 1024 / 1024).toFixed(2)} MB) — belum diunggah`);
}

// Daftar file di folder aset-produk/ milik barang ini (semua ekstensi).
async function fileAsetBarang(slug, slugNama) {
  const isi = (await ambilIsiRepo(FOLDER_ASET_REPO)) || [];
  return (Array.isArray(isi) ? isi : []).filter((f) =>
    f.type === "file" && !["daftar.json", "readme.md"].includes(f.name.toLowerCase())
    && slugNama(f.name.replace(/\.[^.]+$/, "")) === slug);
}

async function unggahAsetProduk() {
  const item = barangCache.find((barang) => barang.id === asetProdukId);
  if (!item || !asetDipilih) return;
  const modul = await muatModul3D();
  const slug = modul.slugNama(item.nama);
  const ext = asetDipilih.ext === "jpeg" ? "jpg" : asetDipilih.ext;
  const berkas = asetDipilih.berkas;
  const utama = berkas.find((f) => f.name === asetDipilih.file);
  const mtl = ext === "obj" ? berkas.find((f) => f.name.toLowerCase().endsWith(".mtl")) : null;
  const unggahan = [{ file: utama, nama: `${slug}.${ext}` }, ...(mtl ? [{ file: mtl, nama: `${slug}.mtl` }] : [])];
  if (ext === "gltf") showAlert("Catatan: .gltf yang memakai file .bin/tekstur terpisah tidak akan tampil. Gunakan .glb bila bisa.", "warning", 6000);

  setTombolAsetSibuk(true);
  try {
    setProgresAset("Memeriksa folder aset di GitHub...");
    const lama = await fileAsetBarang(slug, modul.slugNama);

    for (const [i, u] of unggahan.entries()) {
      setProgresAset(`Mengunggah ${u.nama} (${i + 1}/${unggahan.length})...`);
      const ada = lama.find((f) => f.name === u.nama);
      await tulisFileRepo(`${FOLDER_ASET_REPO}/${u.nama}`, await fileKeBase64(u.file), `Aset produk: ${item.nama} (${u.nama})`, ada?.sha);
    }

    // Aset lama barang ini dengan ekstensi lain dihapus agar tidak tertukar.
    const namaBaru = unggahan.map((u) => u.nama);
    for (const f of lama.filter((f) => !namaBaru.includes(f.name))) {
      setProgresAset(`Menghapus aset lama ${f.name}...`);
      await hapusFileRepo(f.path, f.sha, `Hapus aset lama: ${f.name}`);
    }

    setProgresAset("Memperbarui daftar.json...");
    await ubahDaftarAsetRepo(
      (daftar) => gantiEntriDaftar(daftar, { slug, namaBarang: item.nama, fileBaru: namaBaru, slugNama: modul.slugNama }),
      `Daftar aset: ${item.nama}`
    );
    modul.aturUlangDaftarAset();
    setProgresAset(`✓ ${namaBaru.join(" + ")} terunggah. Tampil di etalase dalam beberapa menit (GitHub Pages memperbarui situs).`);
    showAlert(`Aset ${item.nama} berhasil diunggah.`, "success", 5000);
    asetDipilih = null;
    $("aset-file").value = "";
  } catch (error) {
    console.error(error);
    setProgresAset(`✕ Gagal: ${error.message || error}`);
    showAlert(`Upload aset gagal: ${error.message || error}`, "error", 7000);
  } finally {
    setTombolAsetSibuk(false);
  }
}

async function hapusAsetProduk() {
  const item = barangCache.find((barang) => barang.id === asetProdukId);
  if (!item) return;
  if (!(await showConfirm(`Hapus aset ${item.nama}? Etalase akan kembali memakai model otomatis.`))) return;
  const modul = await muatModul3D();
  const slug = modul.slugNama(item.nama);
  setTombolAsetSibuk(true);
  try {
    const lama = await fileAsetBarang(slug, modul.slugNama);
    for (const f of lama) {
      setProgresAset(`Menghapus ${f.name}...`);
      await hapusFileRepo(f.path, f.sha, `Hapus aset: ${f.name}`);
    }
    setProgresAset("Memperbarui daftar.json...");
    await ubahDaftarAsetRepo(
      (daftar) => gantiEntriDaftar(daftar, { slug, namaBarang: item.nama, fileBaru: [], slugNama: modul.slugNama }),
      `Daftar aset: hapus ${item.nama}`
    );
    modul.aturUlangDaftarAset();
    setProgresAset("✓ Aset dihapus. Etalase kembali ke model otomatis dalam beberapa menit.");
    $("aset-hapus").hidden = true;
    await tampilkanPratinjauAset(null, "Model otomatis");
  } catch (error) {
    console.error(error);
    setProgresAset(`✕ Gagal: ${error.message || error}`);
  } finally {
    setTombolAsetSibuk(false);
  }
}

function simpanPengaturanGitHub() {
  const lama = konfigGitHub();
  const repo = $("gh-repo").value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  const branch = $("gh-branch").value.trim() || "main";
  const token = $("gh-token").value.trim() || lama.token;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return showAlert("Isi repo dengan format pemilik/nama-repo.", "warning");
  tulisPenyimpanan(KUNCI_GITHUB, { repo, branch, token });
  isiFormGitHub();
  showAlert("Pengaturan GitHub disimpan di perangkat ini.");
}

async function tesKoneksiGitHub() {
  setTombolAsetSibuk(true);
  setProgresAset("Menguji koneksi ke GitHub...");
  try {
    const { repo, branch } = konfigGitHub();
    const info = await githubApi("");
    const cabang = await githubApi(`branches/${encodeURIComponent(branch)}`);
    if (!cabang) throw new Error(`branch "${branch}" tidak ditemukan`);
    const bisaTulis = info.permissions ? info.permissions.push : true;
    setProgresAset(bisaTulis
      ? `✓ Terhubung ke ${repo} (branch ${branch}). Siap mengunggah.`
      : `✕ Terhubung ke ${repo}, tetapi token tidak punya izin menulis (Contents: Read and write).`);
  } catch (error) {
    setProgresAset(`✕ ${error.message || error}`);
  } finally {
    setTombolAsetSibuk(false);
  }
}

function hapusTokenGitHub() {
  const konfig = konfigGitHub();
  tulisPenyimpanan(KUNCI_GITHUB, { repo: konfig.repo, branch: konfig.branch, token: "" });
  isiFormGitHub();
  showAlert("Token GitHub dihapus dari perangkat ini.");
}
// ======================================================

// ===================== Struk belanja grosir =====================
// Foto struk → cek kejelasan → baca teks (Tesseract, di browser) → cocokkan dengan barang →
// tampilkan harga naik/turun untuk dicek → 1 klik "Terapkan" memperbarui harga modal,
// mencatat riwayat harga, menyimpan foto (asli & bertanda) ke repo GitHub folder struk/,
// dan menyimpan catatan struk di Firestore (koleksi `struk`).
// Nama di struk yang sudah dicocokkan diingat di meta/alias_struk agar struk berikutnya otomatis.
const FOLDER_STRUK_REPO = "struk";
const REF_ALIAS_STRUK = () => doc(db, "meta", "alias_struk");
let modulStruk = null;
let strukSesi = null; // { file, gambar, url, ocr, skalaOcr, baris: [...] }
let aliasStruk = null; // { kunciAlias: barangId }
let riwayatStruk = null;

const muatModulStruk = () => (modulStruk ||= import("./struk.js").catch((error) => { modulStruk = null; throw error; }));

function labelBarangStruk(item) {
  return `${item.nama} — ${item.satuan}`;
}

function setStatusStruk(teks) {
  const el = $("struk-status");
  el.hidden = !teks;
  el.textContent = teks || "";
}

function setStrukSibuk(sibuk) {
  ["struk-foto", "struk-pilih", "struk-terapkan", "struk-batal", "struk-ulang-foto", "struk-tetap-baca"].forEach((id) => { $(id).disabled = sibuk; });
  if (!sibuk) perbaruiTombolTerapkanStruk();
}

async function showStruk() {
  setView("struk");
  perbaruiOpsiFotoStruk();
  muatModulStruk().catch(() => {});
  if (!barangCache.length) {
    try { await fetchBarang(); } catch (error) { console.error(error); }
  }
  muatRiwayatStruk();
}

function perbaruiOpsiFotoStruk() {
  const { repo, token } = konfigGitHub();
  const siap = Boolean(token && repo);
  $("struk-simpan-foto").disabled = !siap;
  $("struk-simpan-foto").checked = siap;
  $("struk-simpan-foto").parentElement.title = siap
    ? `Disimpan ke ${repo}/${FOLDER_STRUK_REPO}/`
    : "Isi token GitHub dulu: Harga Jual → 📷 Aset → Pengaturan GitHub. Tanpa token, hanya foto kecil yang disimpan di database.";
}

function muatGambar(url) {
  return new Promise((resolve, reject) => {
    const gambar = new Image();
    gambar.onload = () => resolve(gambar);
    gambar.onerror = () => reject(new Error("Foto tidak bisa dibuka. Gunakan format JPG/PNG."));
    gambar.src = url;
  });
}

function resetStruk() {
  if (strukSesi?.url) URL.revokeObjectURL(strukSesi.url);
  strukSesi = null;
  $("struk-kerja").hidden = true;
  $("struk-hasil").hidden = true;
  $("struk-ulang").hidden = true;
  $("struk-list").innerHTML = "";
  $("struk-teks-mentah").textContent = "";
  setStatusStruk("");
}

async function pilihFotoStruk(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return showAlert("File harus berupa foto struk.", "warning");
  resetStruk();
  const url = URL.createObjectURL(file);
  const sesi = { file, url };
  strukSesi = sesi;
  $("struk-pratinjau").src = url;
  $("struk-kerja").hidden = false;
  setStatusStruk("Memeriksa kejelasan foto...");
  try {
    const [gambar, m] = await Promise.all([muatGambar(url), muatModulStruk()]);
    if (sesi !== strukSesi) return;
    sesi.gambar = gambar;
    const kualitas = m.periksaKualitas(gambar);
    if (!kualitas.ok) {
      return mintaFotoUlang(`Foto kurang jelas: ${kualitas.alasan.join(", ")}. Silakan foto ulang agar harga terbaca dengan benar.`, bacaStruk);
    }
    await bacaStruk();
  } catch (error) {
    console.error(error);
    setStatusStruk(`✕ ${error.message || error}`);
  }
}

function mintaFotoUlang(pesan, lanjut) {
  setStatusStruk("");
  $("struk-ulang-pesan").textContent = pesan;
  $("struk-ulang").hidden = false;
  $("struk-tetap-baca").hidden = !lanjut;
  strukSesi.lanjut = lanjut || null;
  $("struk-ulang").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function bacaStruk() {
  const sesi = strukSesi;
  if (!sesi?.gambar) return;
  $("struk-ulang").hidden = true;
  $("struk-hasil").hidden = true;
  setStrukSibuk(true);
  try {
    const m = await muatModulStruk();
    setStatusStruk("Menyiapkan foto...");
    const { ocr, skala, potong, items } = await m.bacaStrukGanda(sesi.gambar, (teks, progres) => {
      if (sesi === strukSesi) setStatusStruk(`${teks} ${Math.round((progres || 0) * 100)}%`);
    });
    if (sesi !== strukSesi) return;
    sesi.ocr = ocr;
    sesi.skalaOcr = skala;
    sesi.potong = potong;
    $("struk-teks-mentah").textContent = ocr.teks;
    await muatAliasStruk();
    sesi.baris = items.map((item) => barisStrukBaru(m, item));
    setStatusStruk("");

    if (!items.length || ocr.yakin < 45) {
      return mintaFotoUlang(
        !items.length
          ? "Tidak ada baris harga yang terbaca. Foto ulang lebih dekat & terang, pastikan seluruh struk masuk bingkai."
          : `Tulisan sulit dibaca (keyakinan ${ocr.yakin}%). Sebaiknya foto ulang lebih dekat & terang.`,
        items.length ? () => { $("struk-ulang").hidden = true; renderHasilStruk(); } : null
      );
    }
    renderHasilStruk();
  } catch (error) {
    console.error(error);
    setStatusStruk(`✕ Gagal membaca struk: ${error.message || error}`);
  } finally {
    setStrukSibuk(false);
  }
}

async function muatAliasStruk() {
  if (aliasStruk) return aliasStruk;
  try {
    const snap = await getDoc(REF_ALIAS_STRUK());
    aliasStruk = snap.exists() ? (snap.data().alias || {}) : {};
  } catch (error) {
    console.warn("Alias struk belum bisa dibaca.", error);
    aliasStruk = {};
  }
  return aliasStruk;
}

function barisStrukBaru(m, item) {
  const cocok = m.cocokkanBarang(item, barangCache, aliasStruk || {});
  const baris = { item, barangId: cocok.terpilih?.id || null, sumber: cocok.sumber, skor: cocok.skor, hargaStruk: item.harga, manual: false };
  hitungBarisStruk(m, baris);
  // Dicentang otomatis hanya bila cocoknya meyakinkan & selisihnya wajar.
  const p = baris.perubahan;
  baris.dipilih = Boolean(p && p.arah !== "tetap" && !p.mencurigakan && !p.tebakan && !item.ragu && item.yakin >= 60
    && (cocok.sumber === "alias" || cocok.skor >= 0.75));
  return baris;
}

function hitungBarisStruk(m, baris) {
  const barang = barangCache.find((b) => b.id === baris.barangId);
  baris.perubahan = barang ? m.hitungPerubahan({ ...baris.item, harga: baris.hargaStruk }, barang) : null;
  if (baris.perubahan && baris.manual) baris.perubahan = { ...baris.perubahan, baru: baris.hargaStruk, konversi: null, ...arahHarga(barang.harga, baris.hargaStruk) };
  if (!baris.perubahan || baris.perubahan.arah === "tetap") baris.dipilih = false;
}

function arahHarga(lama, baru) {
  const selisih = baru - lama;
  return {
    selisih,
    persen: lama > 0 ? (selisih / lama) * 100 : 0,
    arah: selisih > 0 ? "naik" : selisih < 0 ? "turun" : "tetap",
    mencurigakan: lama > 0 && Math.abs(selisih / lama) > 0.4
  };
}

function teksPerubahan(p) {
  if (!p) return { teks: "—", kelas: "kosong" };
  if (p.arah === "tetap") return { teks: "= sama", kelas: "tetap" };
  const persen = `${p.persen > 0 ? "+" : ""}${p.persen.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
  return {
    teks: `${p.arah === "naik" ? "▲" : "▼"} ${formatRupiah(Math.abs(p.selisih))} (${persen})`,
    kelas: p.arah
  };
}

function renderHasilStruk() {
  const sesi = strukSesi;
  if (!sesi?.baris) return;
  // Satu datalist bersama untuk memilih barang secara manual.
  let datalist = $("struk-datalist");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "struk-datalist";
    document.body.appendChild(datalist);
  }
  datalist.replaceChildren(...barangCache.map((b) => {
    const opsi = document.createElement("option");
    opsi.value = labelBarangStruk(b);
    return opsi;
  }));

  const tbody = $("struk-list");
  tbody.innerHTML = "";
  sesi.baris.forEach((baris, index) => {
    const barang = barangCache.find((b) => b.id === baris.barangId);
    const p = baris.perubahan;
    const tr = document.createElement("tr");
    tr.className = `${p?.arah || ""} ${baris.dipilih ? "" : "lewati"}`.trim();

    const tdCek = document.createElement("td");
    const cek = document.createElement("input");
    cek.type = "checkbox";
    cek.checked = baris.dipilih;
    cek.disabled = !p || p.arah === "tetap";
    cek.setAttribute("aria-label", `Terapkan ${baris.item.nama}`);
    cek.addEventListener("change", () => { baris.dipilih = cek.checked; renderHasilStruk(); });
    tdCek.appendChild(cek);

    const tdStruk = document.createElement("td");
    tdStruk.className = "td-left";
    tdStruk.textContent = baris.item.nama;
    const infoStruk = document.createElement("small");
    infoStruk.textContent = baris.item.ragu
      ? `${baris.item.qty} × ? · ⚠ angka kurang jelas, cek di foto`
      : `${baris.item.qty} × ${formatRupiah(baris.item.harga)}${baris.item.yakin < 60 ? " · ⚠ kurang jelas" : ""}`;
    if (baris.item.yakin < 60 || baris.item.ragu) infoStruk.classList.add("struk-peringatan");
    tdStruk.appendChild(infoStruk);
    // Angka ragu: tiap kemungkinan jadi tombol; ketuk yang sesuai foto untuk memakainya.
    if (baris.item.ragu && baris.item.alternatif.length > 1) {
      const pilihan = document.createElement("div");
      pilihan.className = "struk-pilihan";
      baris.item.alternatif.forEach((nilai) => {
        const tombol = document.createElement("button");
        tombol.type = "button";
        tombol.textContent = Math.round(nilai).toLocaleString("id-ID");
        tombol.classList.toggle("aktif", baris.manual && baris.hargaStruk === nilai);
        tombol.addEventListener("click", async () => {
          baris.hargaStruk = nilai;
          baris.manual = true;
          const m = await muatModulStruk();
          hitungBarisStruk(m, baris);
          baris.dipilih = Boolean(baris.perubahan && baris.perubahan.arah !== "tetap");
          renderHasilStruk();
        });
        pilihan.appendChild(tombol);
      });
      tdStruk.appendChild(pilihan);
    }

    const tdBarang = document.createElement("td");
    tdBarang.className = "td-left";
    const masukan = document.createElement("input");
    masukan.type = "text";
    masukan.setAttribute("list", "struk-datalist");
    masukan.placeholder = "Ketik nama barang...";
    masukan.value = barang ? labelBarangStruk(barang) : "";
    masukan.className = "struk-barang";
    masukan.addEventListener("change", async () => {
      const nilai = masukan.value.trim();
      const pilihan = barangCache.find((b) => labelBarangStruk(b) === nilai)
        || barangCache.find((b) => b.nama.toLocaleLowerCase("id-ID") === nilai.toLocaleLowerCase("id-ID"));
      baris.barangId = pilihan?.id || null;
      baris.sumber = pilihan ? "manual" : null;
      const m = await muatModulStruk();
      hitungBarisStruk(m, baris);
      baris.dipilih = Boolean(baris.perubahan && baris.perubahan.arah !== "tetap");
      renderHasilStruk();
    });
    tdBarang.appendChild(masukan);
    const infoCocok = document.createElement("small");
    infoCocok.textContent = !barang ? "belum dicocokkan — lewati atau pilih barang"
      : baris.sumber === "alias" ? "✓ dari ingatan struk sebelumnya"
      : baris.sumber === "manual" ? "✓ dipilih manual"
      : `kemiripan ${Math.round(baris.skor * 100)}%`;
    if (barang && baris.sumber === "mirip" && baris.skor < 0.75) infoCocok.classList.add("struk-peringatan");
    tdBarang.appendChild(infoCocok);

    const tdLama = document.createElement("td");
    tdLama.className = "num";
    tdLama.textContent = barang ? formatRupiah(barang.harga) : "—";
    if (barang) {
      const kecil = document.createElement("small");
      kecil.textContent = `/ ${barang.satuan}`;
      tdLama.appendChild(kecil);
    }

    const tdBaru = document.createElement("td");
    tdBaru.className = "num";
    const harga = document.createElement("input");
    harga.type = "text";
    harga.inputMode = "numeric";
    harga.className = "struk-harga";
    harga.value = Math.round(p?.baru ?? baris.hargaStruk).toLocaleString("id-ID");
    harga.setAttribute("aria-label", `Harga struk ${baris.item.nama}`);
    harga.addEventListener("change", async () => {
      const nilai = parseMoney(harga.value);
      if (!Number.isFinite(nilai) || nilai <= 0) return renderHasilStruk();
      baris.hargaStruk = nilai;
      baris.manual = true;
      const m = await muatModulStruk();
      hitungBarisStruk(m, baris);
      baris.dipilih = Boolean(baris.perubahan && baris.perubahan.arah !== "tetap");
      renderHasilStruk();
    });
    tdBaru.appendChild(harga);
    if (p?.konversi) {
      const kecil = document.createElement("small");
      kecil.textContent = p.konversi;
      tdBaru.appendChild(kecil);
    }

    const tdUbah = document.createElement("td");
    const tag = teksPerubahan(p);
    const span = document.createElement("span");
    span.className = `struk-tag ${tag.kelas}`;
    span.textContent = tag.teks;
    tdUbah.appendChild(span);
    if (p?.mencurigakan) {
      const kecil = document.createElement("small");
      kecil.className = "struk-peringatan";
      kecil.textContent = "selisih besar, cek lagi";
      tdUbah.appendChild(kecil);
    }

    tr.dataset.index = index;
    tr.append(tdCek, tdStruk, tdBarang, tdLama, tdBaru, tdUbah);
    tbody.appendChild(tr);
  });

  const naik = sesi.baris.filter((b) => b.perubahan?.arah === "naik").length;
  const turun = sesi.baris.filter((b) => b.perubahan?.arah === "turun").length;
  const sama = sesi.baris.filter((b) => b.perubahan?.arah === "tetap").length;
  const belum = sesi.baris.filter((b) => !b.barangId).length;
  $("struk-ringkasan").innerHTML = "";
  $("struk-ringkasan").append(
    `${sesi.baris.length} barang terbaca · `,
    Object.assign(document.createElement("b"), { className: "naik", textContent: `▲ ${naik} naik` }),
    " · ",
    Object.assign(document.createElement("b"), { className: "turun", textContent: `▼ ${turun} turun` }),
    ` · ${sama} sama · ${belum} belum dicocokkan`
  );
  const bisaDipilih = sesi.baris.filter((b) => b.perubahan && b.perubahan.arah !== "tetap");
  $("struk-centang-semua").checked = bisaDipilih.length > 0 && bisaDipilih.every((b) => b.dipilih);
  $("struk-hasil").hidden = false;
  perbaruiTombolTerapkanStruk();
}

function perbaruiTombolTerapkanStruk() {
  const tombol = $("struk-terapkan");
  const jumlah = strukSesi?.baris?.filter((b) => b.dipilih).length || 0;
  tombol.textContent = jumlah ? `Terapkan ${jumlah} perubahan harga` : "Simpan struk saja";
  tombol.disabled = !strukSesi?.baris;
}

// Foto diperkecil (sisi terpanjang ≤ maks) lalu diubah ke JPEG base64.
function kanvasKeJpeg(sumber, maks, mutu) {
  const lebar = sumber.naturalWidth || sumber.width;
  const tinggi = sumber.naturalHeight || sumber.height;
  const skala = Math.min(1, maks / Math.max(lebar, tinggi));
  const kanvas = document.createElement("canvas");
  kanvas.width = Math.round(lebar * skala);
  kanvas.height = Math.round(tinggi * skala);
  const ctx = kanvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, kanvas.width, kanvas.height);
  ctx.drawImage(sumber, 0, 0, kanvas.width, kanvas.height);
  return kanvas.toDataURL("image/jpeg", mutu);
}

function namaFileStruk(id) {
  const bagian = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${bagian.year}-${bagian.month}-${bagian.day}_${bagian.hour}${bagian.minute}_${id.slice(0, 6).toLowerCase()}`;
}

async function terapkanStruk() {
  const sesi = strukSesi;
  if (!sesi?.baris || $("struk-terapkan").disabled) return;
  const user = auth.currentUser;
  const editedBy = user?.email || "anonymous";
  const dipilih = sesi.baris.filter((b) => b.dipilih && b.perubahan && b.perubahan.arah !== "tetap");
  setStrukSibuk(true);

  try {
    const m = await muatModulStruk();
    const refStruk = doc(collection(db, "struk"));
    const tanda = sesi.baris
      .filter((b) => b.dipilih || b.perubahan?.arah === "tetap")
      .filter((b) => b.perubahan && b.item.kotak)
      .map((b) => ({
        kotak: b.item.kotak,
        arah: b.dipilih ? b.perubahan.arah : "tetap",
        label: b.dipilih
          ? `${b.perubahan.arah === "naik" ? "▲ +" : "▼ -"}${Math.abs(Math.round(b.perubahan.selisih)).toLocaleString("id-ID")}`
          : "= sama"
      }));
    const grosir = $("struk-grosir").value.trim().slice(0, 100);
    const judul = `${grosir || "Struk belanja"} · ${formatDate(new Date(), true)}`;
    const kanvasTag = m.gambarBertag(sesi.gambar, tanda, { skalaOcr: sesi.skalaOcr, potong: sesi.potong, judul });

    // 1) Foto asli & bertanda ke repo GitHub (bila token tersedia).
    let foto = null;
    let fotoTag = null;
    let pesanFoto = "";
    if ($("struk-simpan-foto").checked && !$("struk-simpan-foto").disabled) {
      const dasar = `${FOLDER_STRUK_REPO}/${namaFileStruk(refStruk.id)}`;
      try {
        setStatusStruk("Mengunggah foto struk ke GitHub (1/2)...");
        await tulisFileRepo(`${dasar}.jpg`, kanvasKeJpeg(sesi.gambar, 2000, 0.85).split(",")[1], `Struk belanja ${judul}`);
        foto = `${dasar}.jpg`;
        setStatusStruk("Mengunggah foto bertanda ke GitHub (2/2)...");
        await tulisFileRepo(`${dasar}_tag.jpg`, kanvasKeJpeg(kanvasTag, 2000, 0.85).split(",")[1], `Struk belanja ${judul} (bertanda)`);
        fotoTag = `${dasar}_tag.jpg`;
      } catch (error) {
        console.warn("Foto struk gagal diunggah ke GitHub.", error);
        pesanFoto = ` Foto gagal diunggah ke GitHub (${error.message || error}); foto kecil tetap disimpan di database.`;
      }
    }

    // 2) Harga barang + riwayat harga + ingatan nama + catatan struk dalam satu batch.
    setStatusStruk("Menyimpan perubahan harga...");
    const batch = writeBatch(db);
    const rencana = dipilih.map((b) => {
      const barang = barangCache.find((x) => x.id === b.barangId);
      const hargaBaru = Math.round(b.perubahan.baru);
      const changes = {
        nama: barang.nama,
        harga: hargaBaru,
        satuan: barang.satuan,
        isiPerSatuan: barang.isiPerSatuan,
        hargaSatuan: hargaBaru / barang.isiPerSatuan,
        hargaLama: barang.harga,
        editedAt: new Date(),
        editedBy,
        sumberHarga: "struk"
      };
      const history = {
        barangId: barang.id,
        namaLama: barang.nama,
        nama: barang.nama,
        hargaLama: barang.harga,
        hargaBaru,
        timestamp: new Date(),
        uid: user?.uid || null,
        editedBy,
        sumber: "struk",
        strukId: refStruk.id
      };
      batch.update(doc(db, "barang", barang.id), stempel(changes));
      batch.set(doc(collection(db, "price_history")), history);
      return { barang, changes, history, baris: b };
    });

    // Nama struk yang sudah dicek (diterapkan / harganya sama) diingat untuk struk berikutnya.
    const aliasBaru = {};
    sesi.baris.forEach((b) => {
      if (b.barangId && (b.dipilih || b.perubahan?.arah === "tetap")) aliasBaru[m.kunciAlias(b.item.nama)] = b.barangId;
    });

    let fotoMini = kanvasKeJpeg(kanvasTag, 700, 0.6);
    if (fotoMini.length > 350000) fotoMini = kanvasKeJpeg(kanvasTag, 500, 0.45);
    const catatan = {
      uid: user?.uid || null,
      oleh: editedBy,
      dibuat: serverTimestamp(),
      grosir,
      repo: foto ? konfigGitHub().repo : null,
      branch: foto ? konfigGitHub().branch : null,
      foto,
      fotoTag,
      fotoMini,
      keyakinanBaca: sesi.ocr?.yakin ?? null,
      naik: dipilih.filter((b) => b.perubahan.arah === "naik").length,
      turun: dipilih.filter((b) => b.perubahan.arah === "turun").length,
      items: sesi.baris.slice(0, 200).map((b) => {
        const barang = barangCache.find((x) => x.id === b.barangId);
        return {
          teks: b.item.nama.slice(0, 120),
          qty: b.item.qty,
          hargaStruk: Math.round(b.perubahan?.baru ?? b.hargaStruk),
          barangId: barang?.id || null,
          namaBarang: barang?.nama || null,
          hargaLama: barang ? barang.harga : null,
          arah: b.perubahan?.arah || null,
          diterapkan: Boolean(b.dipilih)
        };
      })
    };
    // Harga dulu; catatan struk ditulis terpisah agar kegagalan catatan (mis. rules `struk` belum
    // di-publish) tidak membatalkan perubahan harga.
    await batch.commit();
    Object.assign(aliasStruk || (aliasStruk = {}), aliasBaru);
    if (Object.keys(aliasBaru).length) {
      setDoc(REF_ALIAS_STRUK(), { alias: aliasBaru, diperbarui: serverTimestamp() }, { merge: true })
        .catch((error) => console.warn("Ingatan nama struk gagal disimpan (periksa rules meta).", error));
    }
    rencana.forEach(({ barang, changes, history }) => {
      upsertBarangCache(barang.id, changes);
      tambahRiwayatHargaLokal(history);
    });
    refreshBarangViews();
    // Modal baru dari struk ikut ke katalog etalase & katalog game WARUNK
    if (rencana.length) jadwalkanSinkronKatalog();

    let pesanCatatan = "";
    try {
      await setDoc(refStruk, catatan);
      riwayatStruk = [{ id: refStruk.id, ...catatan, dibuat: new Date() }, ...(riwayatStruk || [])];
      renderRiwayatStruk();
    } catch (error) {
      console.warn("Catatan struk gagal disimpan.", error);
      pesanCatatan = error?.code === "permission-denied"
        ? " Catatan struk TIDAK tersimpan: publish ulang isi firestore.rules (bagian struk) di Firebase Console."
        : ` Catatan struk gagal disimpan (${errorText(error)}).`;
    }

    const naik = catatan.naik;
    const turun = catatan.turun;
    resetStruk();
    const peringatan = pesanFoto + pesanCatatan;
    showAlert(
      (dipilih.length
        ? `Harga diperbarui: ${naik} naik, ${turun} turun. Cek juga Harga Jual barang yang naik.`
        : pesanCatatan ? "Tidak ada perubahan harga." : "Struk disimpan tanpa perubahan harga.") + peringatan,
      peringatan ? "warning" : "success",
      peringatan ? 9000 : 4500
    );
  } catch (error) {
    console.error(error);
    const pesan = error?.code === "permission-denied"
      ? "akses ditolak oleh Firestore Rules. Publish ulang isi firestore.rules terbaru di Firebase Console."
      : errorText(error);
    setStatusStruk(`✕ Gagal menyimpan: ${pesan}`);
    showAlert(`Gagal menyimpan struk: ${pesan}`, "error", 9000);
  } finally {
    setStrukSibuk(false);
  }
}

async function muatRiwayatStruk() {
  if (riwayatStruk) return renderRiwayatStruk();
  const el = $("struk-riwayat");
  el.textContent = "Memuat riwayat struk...";
  try {
    const snap = await getDocs(query(collection(db, "struk"), orderBy("dibuat", "desc"), limit(10)));
    riwayatStruk = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderRiwayatStruk();
  } catch (error) {
    console.warn("Riwayat struk belum bisa dibaca.", error);
    el.textContent = error?.code === "permission-denied"
      ? "Riwayat struk belum bisa dibaca. Publish isi firestore.rules terbaru di Firebase Console."
      : "Riwayat struk belum bisa dimuat.";
  }
}

function renderRiwayatStruk() {
  const el = $("struk-riwayat");
  el.innerHTML = "";
  if (!riwayatStruk?.length) {
    el.textContent = "Belum ada struk yang disimpan.";
    return;
  }
  riwayatStruk.forEach((s) => {
    const kartu = document.createElement("div");
    kartu.className = "pesanan-kartu";

    const kepala = document.createElement("div");
    kepala.className = "pk-kepala";
    const judul = document.createElement("strong");
    judul.className = "pk-kode";
    judul.textContent = s.grosir || "Struk belanja";
    const tanggal = document.createElement("span");
    tanggal.className = "pk-tanggal";
    tanggal.textContent = formatDate(s.dibuat, true);
    kepala.append(judul, tanggal);

    const ringkas = document.createElement("p");
    ringkas.className = "pk-pembeli";
    ringkas.append(
      Object.assign(document.createElement("span"), { className: "struk-tag naik", textContent: `▲ ${s.naik || 0} naik` }),
      "  ",
      Object.assign(document.createElement("span"), { className: "struk-tag turun", textContent: `▼ ${s.turun || 0} turun` }),
      `  · ${(s.items || []).length} barang · oleh ${s.oleh || "-"}`
    );
    kartu.append(kepala, ringkas);

    if (s.fotoMini) {
      const img = document.createElement("img");
      img.src = s.fotoMini;
      img.alt = "Foto struk bertanda";
      img.loading = "lazy";
      img.title = "Klik untuk memperbesar";
      img.addEventListener("click", () => img.classList.toggle("besar"));
      kartu.appendChild(img);
    }

    const daftar = document.createElement("ul");
    daftar.className = "pk-item";
    (s.items || []).filter((i) => i.diterapkan).forEach((i) => {
      const li = document.createElement("li");
      const nama = document.createElement("span");
      nama.textContent = `${i.arah === "naik" ? "▲" : "▼"} ${i.namaBarang || i.teks}`;
      nama.className = `struk-tag ${i.arah}`;
      const harga = document.createElement("span");
      harga.textContent = `${formatRupiah(i.hargaLama)} → ${formatRupiah(i.hargaStruk)}`;
      li.append(nama, harga);
      daftar.appendChild(li);
    });
    if (daftar.children.length) kartu.appendChild(daftar);

    if (s.foto && s.repo) {
      const aksi = document.createElement("div");
      aksi.className = "pk-aksi";
      [["Foto asli", s.foto], ["Foto bertanda", s.fotoTag]].forEach(([teks, path]) => {
        if (!path) return;
        const a = document.createElement("a");
        a.href = `https://github.com/${s.repo}/blob/${encodeURIComponent(s.branch || "main")}/${path.split("/").map(encodeURIComponent).join("/")}`;
        a.target = "_blank";
        a.rel = "noopener";
        a.className = "toko-garis struk-tautan";
        a.textContent = teks;
        aksi.appendChild(a);
      });
      kartu.appendChild(aksi);
    }
    el.appendChild(kartu);
  });
}
// ======================================================

async function kembaliKeDashboard() {
  // Dulu lembar langsung dikosongkan tanpa peringatan; sekarang minta konfirmasi bila ada isian.
  const adaIsi = daftarKurang.length || daftarLebih.length;
  if (adaIsi && !(await showConfirm("Kembali ke dashboard? Isian stock opname yang belum disimpan akan hilang."))) return;
  resetStockForm();
  setView("dashboard");
}

async function simpanHasilStockOpname() {
  const user = auth.currentUser;
  if (!user) return showAlert("Anda harus login terlebih dahulu.", "error");
  if (!daftarKurang.length && !daftarLebih.length) return showAlert("Belum ada barang kurang atau lebih.", "warning");

  const judul = $("judulDokumen").value.trim() || "Tanpa Judul";
  const payload = {
    judul,
    kurang: daftarKurang.map(normalizeHistoryItem),
    lebih: daftarLebih.map(normalizeHistoryItem),
    uid: user.uid,
    updatedAt: new Date()
  };

  $("btnSimpanOpname").disabled = true;
  try {
    if (currentRiwayatId) {
      await updateDoc(doc(db, "stock_opname", currentRiwayatId), payload);
      showAlert("Riwayat stock opname berhasil diperbarui.");
    } else {
      await addDoc(collection(db, "stock_opname"), { ...payload, timestamp: new Date() });
      showAlert("Data stock opname berhasil disimpan.");
    }
    resetStockForm();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal menyimpan stock opname: ${errorText(error)}`, "error");
  } finally {
    $("btnSimpanOpname").disabled = false;
  }
}

async function getRiwayatUser() {
  const user = auth.currentUser;
  if (!user) return [];
  const snapshot = await getDocs(query(collection(db, "stock_opname"), where("uid", "==", user.uid)));
  return snapshot.docs
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .sort((a, b) => (toDate(b.timestamp)?.getTime() || 0) - (toDate(a.timestamp)?.getTime() || 0));
}

async function showRiwayat() {
  if (!auth.currentUser) return showAlert("Anda belum login.", "error");
  setView("riwayat");
  const list = $("riwayat-list");
  list.replaceChildren(createText("p", "⏳ Memuat riwayat..."));

  try {
    const items = await getRiwayatUser();
    if (!items.length) {
      list.replaceChildren(createText("p", "Belum ada riwayat stock opname."));
      return;
    }

    list.replaceChildren(...items.map((item) => {
      const card = document.createElement("div");
      card.className = "riwayat-item";
      const date = createText("small", formatDate(item.timestamp, true));
      const title = createText("strong", item.judul || "Tanpa Judul");
      title.style.display = "block";
      const actions = document.createElement("div");
      actions.className = "riwayat-actions";
      actions.append(
        createButton("Lihat / Edit", "", () => loadRiwayat(item.id)),
        createButton("Export Excel", "", () => exportRiwayatToExcel(item.id)),
        createButton("Hapus", "hapus-btn", () => hapusRiwayat(item.id))
      );
      card.append(date, title, actions);
      return card;
    }));
  } catch (error) {
    list.replaceChildren(createText("p", "Riwayat gagal dimuat."));
    console.error(error);
    showAlert(`Gagal memuat riwayat: ${errorText(error)}`, "error");
  }
}

async function loadRiwayat(docId) {
  const snapshot = await getDoc(doc(db, "stock_opname", docId));
  if (!snapshot.exists()) return showAlert("Riwayat tidak ditemukan.", "error");
  const data = snapshot.data();
  if (data.uid !== auth.currentUser?.uid) return showAlert("Anda tidak memiliki akses ke riwayat ini.", "error");

  currentRiwayatId = docId;
  daftarKurang = (data.kurang || []).map(normalizeHistoryItem);
  daftarLebih = (data.lebih || []).map(normalizeHistoryItem);
  $("judulDokumen").value = data.judul || "";
  $("judul-dokumen-terpilih").textContent = `Mengedit: ${data.judul || "Tanpa Judul"}`;
  $("btnSimpanOpname").textContent = "Update Riwayat Stock Opname";
  renderLembarOpname();
  await showStockOpname();
}

async function hapusRiwayat(docId) {
  const yes = await showConfirm("Hapus riwayat stock opname ini secara permanen?");
  if (!yes) return;
  try {
    const snapshot = await getDoc(doc(db, "stock_opname", docId));
    if (!snapshot.exists() || snapshot.data().uid !== auth.currentUser?.uid) throw new Error("Riwayat tidak ditemukan atau bukan milik Anda.");
    await deleteDoc(doc(db, "stock_opname", docId));
    showAlert("Riwayat berhasil dihapus.");
    await showRiwayat();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal menghapus riwayat: ${errorText(error)}`, "error");
  }
}

async function hapusSemuaRiwayat() {
  const yes = await showConfirm("Hapus SEMUA riwayat stock opname milik akun ini? Tindakan ini tidak dapat dibatalkan.");
  if (!yes) return;
  try {
    const items = await getRiwayatUser();
    await Promise.all(items.map((item) => deleteDoc(doc(db, "stock_opname", item.id))));
    showAlert("Semua riwayat berhasil dihapus.");
    await showRiwayat();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal menghapus semua riwayat: ${errorText(error)}`, "error");
  }
}

function setupStockSheet(sheet, items, title) {
  sheet.columns = [
    { header: "Qty", key: "qty", width: 20 },
    { header: "Nama Barang", key: "nama", width: 32 },
    { header: "Total", key: "total", width: 22 }
  ];
  sheet.getRow(1).font = { bold: true };
  let grandTotal = 0;
  items.map(normalizeHistoryItem).forEach((item) => {
    grandTotal += item.total;
    sheet.addRow({ qty: item.displayQty, nama: item.nama, total: item.total });
  });
  const totalRow = sheet.addRow({ qty: "", nama: `Jumlah Total ${title}`, total: grandTotal });
  totalRow.font = { bold: true };
  sheet.getColumn("total").numFmt = '"Rp" #,##0';
}

async function exportRiwayatToExcel(docId) {
  if (!window.ExcelJS || !window.saveAs) return showAlert("Library Excel belum termuat. Periksa koneksi internet.", "error");
  try {
    const snapshot = await getDoc(doc(db, "stock_opname", docId));
    if (!snapshot.exists()) throw new Error("Riwayat tidak ditemukan.");
    const data = snapshot.data();
    if (data.uid !== auth.currentUser?.uid) throw new Error("Riwayat bukan milik akun ini.");

    const workbook = new ExcelJS.Workbook();
    setupStockSheet(workbook.addWorksheet("Lembar Lebih"), data.lebih || [], "Lebih");
    setupStockSheet(workbook.addWorksheet("Lembar Kurang"), data.kurang || [], "Kurang");
    const buffer = await workbook.xlsx.writeBuffer();
    const safeTitle = String(data.judul || "Tanpa_Judul").replace(/[\\/:*?"<>|]+/g, "_");
    saveAs(new Blob([buffer]), `Stock_Opname_${safeTitle}.xlsx`);
    showAlert("File stock opname berhasil diekspor.");
  } catch (error) {
    console.error(error);
    showAlert(`Gagal export Excel: ${errorText(error)}`, "error");
  }
}

function cellPrimitive(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (typeof value === "object") {
    if ("result" in value) return value.result;
    if ("text" in value) return value.text;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  }
  return value;
}

function normalizeHeader(value) {
  return String(value || "").toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, "");
}

function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  let text = String(value ?? "").trim().replace(/\s+/g, "").replace(/^rp/i, "");
  if (!text) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, "");
  } else {
    text = text.replace(",", ".").replace(/[^0-9.-]/g, "");
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

// Sama dengan validBarang() di firestore.rules; baris yang tidak lolos akan menggagalkan satu batch penuh.
function barisImportValid(item) {
  return item.nama.length > 0 && item.nama.length <= 200
    && Number.isFinite(item.harga) && item.harga >= 0 && item.harga < 1000000000
    && item.satuan.length > 0 && item.satuan.length <= 50
    && item.isiPerSatuan >= 1 && item.isiPerSatuan <= 100000
    && (item.hargaJual === undefined || (item.hargaJual >= 0 && item.hargaJual < 1000000000));
}

async function uploadExcelToFirestore() {
  if (!window.ExcelJS) return showAlert("Library ExcelJS belum termuat. Periksa koneksi internet.", "error");
  const file = $("excelUpload").files[0];
  if (!file) return showAlert("Pilih file Excel terlebih dahulu.", "warning");
  if (!auth.currentUser) return showAlert("Anda harus login.", "error");

  stopUpload = false;
  $("uploadExcelBtn").disabled = true;
  $("stopUploadBtn").style.display = "inline-flex";
  $("loading-upload").style.display = "block";
  $("upload-log").style.display = "block";
  $("upload-log").textContent = "Membaca file Excel...";

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("Worksheet tidak ditemukan.");

    let headerRowNumber = null;
    let headerMap = {};
    const maxHeaderScan = Math.min(10, sheet.rowCount);

    for (let rowNumber = 1; rowNumber <= maxHeaderScan; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const map = {};
      row.eachCell((cell, colNumber) => {
        map[normalizeHeader(cellPrimitive(cell))] = colNumber;
      });
      if ((map.namabarang || map.nama) && (map.hargatotal || map.harga)) {
        headerRowNumber = rowNumber;
        headerMap = map;
        break;
      }
    }

    if (!headerRowNumber) throw new Error("Header 'Nama Barang/Nama' dan 'Harga Total/Harga' tidak ditemukan pada 10 baris pertama.");

    const namaCol = headerMap.namabarang || headerMap.nama;
    const hargaCol = headerMap.hargatotal || headerMap.harga;
    const satuanCol = headerMap.satuan;
    const isiCol = headerMap.isipersatuan || headerMap.isi;
    const hargaJualCol = headerMap.hargajual; // opsional (mis. dari file backup)
    const rows = [];

    for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const nama = String(cellPrimitive(row.getCell(namaCol)) || "").trim();
      const hargaRaw = cellPrimitive(row.getCell(hargaCol));
      const harga = parseMoney(hargaRaw);
      if (!nama || !Number.isFinite(harga)) continue;
      const satuanRaw = satuanCol ? String(cellPrimitive(row.getCell(satuanCol)) || "pcs").trim() : "pcs";
      const satuan = !satuanRaw || satuanRaw === "undefined" ? "pcs" : satuanRaw;
      const isiPerSatuan = Math.max(1, isiCol ? parseInt(cellPrimitive(row.getCell(isiCol)), 10) || 1 : 1);
      const baris = { nama, harga, satuan, isiPerSatuan };
      if (hargaJualCol) {
        const hargaJualRaw = cellPrimitive(row.getCell(hargaJualCol));
        const hargaJual = hargaJualRaw === "" ? 0 : parseMoney(hargaJualRaw);
        if (Number.isFinite(hargaJual)) baris.hargaJual = hargaJual;
      }
      rows.push(baris);
    }

    if (!rows.length) throw new Error("Tidak ada baris data valid untuk diunggah.");

    // Ambil data terbaru sekali agar barang yang sudah ada diperbarui, bukan diduplikasi.
    await fetchBarang();

    // 1) Susun rencana tulis dulu (tanpa menulis ke Firestore).
    const editedBy = auth.currentUser.email || "anonymous";
    const uid = auth.currentUser.uid;
    const keadaan = new Map(barangCache.map((item) => [barangKey(item.nama, item.satuan), item]));
    const rencana = [];
    let sama = 0;
    let tidakValid = 0;

    for (const item of rows) {
      if (!barisImportValid(item)) {
        tidakValid++;
        continue;
      }
      const key = barangKey(item.nama, item.satuan);
      const existing = keadaan.get(key);
      const data = { ...item, hargaSatuan: item.harga / item.isiPerSatuan, editedAt: new Date(), editedBy };

      if (!existing) {
        const ref = doc(collection(db, "barang"));
        rencana.push({ jenis: "tambah", ref, data });
        keadaan.set(key, { id: ref.id, ...data });
        continue;
      }
      if (existing.nama === item.nama && existing.harga === item.harga && existing.isiPerSatuan === item.isiPerSatuan
        && (item.hargaJual === undefined || existing.hargaJual === item.hargaJual)) {
        sama++;
        continue;
      }
      const changes = { ...data, hargaLama: existing.harga };
      if (item.hargaJual !== undefined && item.hargaJual !== existing.hargaJual) {
        changes.hargaJualSebelumnya = existing.hargaJual;
        changes.hargaJualDiubah = new Date();
      }
      const history = existing.harga === item.harga ? null : {
        barangId: existing.id,
        namaLama: existing.nama,
        nama: item.nama,
        hargaLama: existing.harga,
        hargaBaru: item.harga,
        timestamp: new Date(),
        uid,
        editedBy
      };
      rencana.push({
        jenis: "ubah",
        ref: doc(db, "barang", existing.id),
        data: changes,
        history
      });
      keadaan.set(key, { ...existing, ...changes });
    }

    // 2) Tulis per kelompok (batch). Satu batch Firestore maksimal 500 operasi.
    const MAX_OPERASI = 450;
    const kelompok = [];
    let sekarang = [];
    let jumlahOperasi = 0;
    rencana.forEach((langkah) => {
      const operasi = langkah.history ? 2 : 1;
      if (jumlahOperasi + operasi > MAX_OPERASI) {
        kelompok.push(sekarang);
        sekarang = [];
        jumlahOperasi = 0;
      }
      sekarang.push(langkah);
      jumlahOperasi += operasi;
    });
    if (sekarang.length) kelompok.push(sekarang);

    let ditambah = 0;
    let diperbarui = 0;
    let gagal = 0;
    for (const [index, isi] of kelompok.entries()) {
      if (stopUpload) break;
      $("upload-log").textContent = `Menyimpan kelompok ${index + 1}/${kelompok.length} (${isi.length} barang)...`;
      const batch = writeBatch(db);
      isi.forEach((langkah) => {
        if (langkah.jenis === "tambah") batch.set(langkah.ref, stempel(langkah.data));
        else batch.update(langkah.ref, stempel(langkah.data));
        if (langkah.history) batch.set(doc(collection(db, "price_history")), langkah.history);
      });
      try {
        await batch.commit();
        isi.forEach((langkah) => {
          upsertBarangCache(langkah.ref.id, langkah.data);
          if (langkah.history) tambahRiwayatHargaLokal(langkah.history);
          if (langkah.jenis === "tambah") ditambah++;
          else diperbarui++;
        });
      } catch (error) {
        console.error("Gagal menyimpan kelompok import:", error);
        gagal += isi.length;
      }
    }

    refreshBarangViews();
    if (ditambah || diperbarui) jadwalkanSinkronKatalog();
    const ringkasan = `${ditambah} baru, ${diperbarui} diperbarui, ${sama} tidak berubah, ${gagal} gagal`
      + (tidakValid ? `, ${tidakValid} baris dilewati karena tidak valid` : "") + ".";
    $("upload-log").textContent = stopUpload ? `Upload dihentikan. ${ringkasan}` : `Upload selesai. ${ringkasan}`;
    showAlert(stopUpload ? `Upload dihentikan. ${ringkasan}` : `Upload selesai: ${ringkasan}`, stopUpload || gagal || tidakValid ? "warning" : "success", 6000);
  } catch (error) {
    console.error(error);
    showAlert(`Gagal membaca/upload Excel: ${errorText(error)}`, "error");
    $("upload-log").textContent = `Gagal: ${errorText(error)}`;
  } finally {
    $("loading-upload").style.display = "none";
    $("stopUploadBtn").style.display = "none";
    $("uploadExcelBtn").disabled = false;
    $("excelUpload").value = "";
    setTimeout(() => { $("upload-log").style.display = "none"; }, 6000);
  }
}

async function ambilDataBackup(user) {
  const [barangSnap, historySnap, opnameSnap] = await Promise.all([
    getDocs(collection(db, "barang")),
    getDocs(collection(db, "price_history")),
    getDocs(query(collection(db, "stock_opname"), where("uid", "==", user.uid)))
  ]);
  return {
    barang: barangSnap.docs.map((snap) => normalizeBarang(snap.id, snap.data())),
    history: historySnap.docs.map((snap) => ({ id: snap.id, ...snap.data() })),
    opname: opnameSnap.docs.map((snap) => ({ id: snap.id, ...snap.data() }))
  };
}

// ExcelJS menulis tanggal sebagai UTC; geser ke jam lokal agar jam di Excel sesuai (mis. WIB).
function tanggalExcel(value) {
  const date = toDate(value);
  return date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000) : null;
}

function siapkanSheet(sheet, columns) {
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111111" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// Satu file Excel berisi seluruh data. Sheet "Barang" memakai format yang sama
// dengan Import Excel, sehingga daftar barang bisa dipulihkan lewat tombol Upload Excel.
async function backupSemuaData() {
  if (!window.ExcelJS || !window.saveAs) return showAlert("Library Excel belum termuat. Periksa koneksi internet.", "error");
  const user = auth.currentUser;
  if (!user) return showAlert("Anda harus login terlebih dahulu.", "error");

  const button = $("backup-btn");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "⏳ Menyiapkan backup...";

  try {
    const { barang, history, opname } = await ambilDataBackup(user);
    const waktu = new Date();
    const formatTanggal = "dd/mm/yyyy hh:mm";
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Toko H Endun";
    workbook.created = waktu;

    const sheetBarang = workbook.addWorksheet("Barang");
    siapkanSheet(sheetBarang, [
      { header: "Nama Barang", key: "nama", width: 34 },
      { header: "Harga Total", key: "harga", width: 15, style: { numFmt: "#,##0" } },
      { header: "Satuan", key: "satuan", width: 12 },
      { header: "Isi per Satuan", key: "isi", width: 15 },
      { header: "Harga Satuan", key: "hargaSatuan", width: 15, style: { numFmt: "#,##0.##" } },
      { header: "Harga Jual", key: "hargaJual", width: 14, style: { numFmt: "#,##0" } },
      { header: "Untung per Pcs", key: "untung", width: 15, style: { numFmt: "#,##0.##;-#,##0.##;0" } },
      { header: "Terakhir Diedit", key: "editedAt", width: 18, style: { numFmt: formatTanggal } },
      { header: "Diedit Oleh", key: "editedBy", width: 26 },
      { header: "ID Barang", key: "id", width: 24 }
    ]);
    barang
      .sort((a, b) => a.nama.localeCompare(b.nama, "id", { sensitivity: "base" }))
      .forEach((item) => sheetBarang.addRow({
        nama: item.nama,
        harga: item.harga,
        satuan: item.satuan,
        isi: item.isiPerSatuan,
        hargaSatuan: item.hargaSatuan,
        hargaJual: item.hargaJual,
        untung: item.hargaJual > 0 ? item.hargaJual - item.hargaSatuan : null,
        editedAt: tanggalExcel(item.editedAt),
        editedBy: item.editedBy || "",
        id: item.id
      }));

    const sheetHarga = workbook.addWorksheet("Riwayat Harga");
    siapkanSheet(sheetHarga, [
      { header: "Tanggal", key: "tanggal", width: 18, style: { numFmt: formatTanggal } },
      { header: "Nama Barang", key: "nama", width: 32 },
      { header: "Nama Lama", key: "namaLama", width: 32 },
      { header: "Harga Lama", key: "hargaLama", width: 14, style: { numFmt: "#,##0" } },
      { header: "Harga Baru", key: "hargaBaru", width: 14, style: { numFmt: "#,##0" } },
      { header: "Selisih", key: "selisih", width: 14, style: { numFmt: "+#,##0;-#,##0;0" } },
      { header: "Diedit Oleh", key: "editedBy", width: 26 },
      { header: "ID Barang", key: "barangId", width: 24 }
    ]);
    history
      .sort((a, b) => (toDate(a.timestamp)?.getTime() || 0) - (toDate(b.timestamp)?.getTime() || 0))
      .forEach((item) => {
        const hargaLama = Number(item.hargaLama) || 0;
        const hargaBaru = Number(item.hargaBaru) || 0;
        sheetHarga.addRow({
          tanggal: tanggalExcel(item.timestamp),
          nama: item.nama || "",
          namaLama: item.namaLama || "",
          hargaLama,
          hargaBaru,
          selisih: hargaBaru - hargaLama,
          editedBy: item.editedBy || "",
          barangId: item.barangId || ""
        });
      });

    const sheetOpname = workbook.addWorksheet("Stock Opname");
    siapkanSheet(sheetOpname, [
      { header: "Dokumen", key: "judul", width: 28 },
      { header: "Tanggal", key: "tanggal", width: 18, style: { numFmt: formatTanggal } },
      { header: "Lembar", key: "lembar", width: 10 },
      { header: "Nama Barang", key: "nama", width: 32 },
      { header: "Qty", key: "qty", width: 18 },
      { header: "Qty (pcs)", key: "qtyPcs", width: 11 },
      { header: "Satuan", key: "satuan", width: 12 },
      { header: "Harga Kemasan", key: "hargaKemasan", width: 15, style: { numFmt: "#,##0" } },
      { header: "Total", key: "total", width: 15, style: { numFmt: "#,##0" } }
    ]);
    let jumlahEntriOpname = 0;
    opname
      .sort((a, b) => (toDate(a.timestamp)?.getTime() || 0) - (toDate(b.timestamp)?.getTime() || 0))
      .forEach((dokumen) => {
        [["Kurang", dokumen.kurang], ["Lebih", dokumen.lebih]].forEach(([lembar, list]) => {
          (list || []).map(normalizeHistoryItem).forEach((item) => {
            jumlahEntriOpname++;
            sheetOpname.addRow({
              judul: dokumen.judul || "Tanpa Judul",
              tanggal: tanggalExcel(dokumen.timestamp),
              lembar,
              nama: item.nama,
              qty: item.displayQty,
              qtyPcs: item.qtyPcs,
              satuan: item.satuan,
              hargaKemasan: item.hargaKemasan,
              total: item.total
            });
          });
        });
      });

    const sheetInfo = workbook.addWorksheet("Info Backup");
    sheetInfo.columns = [{ width: 28 }, { width: 70 }];
    [
      ["Toko H Endun — Backup Data", ""],
      ["Dibuat pada", formatDate(waktu, true)],
      ["Dibuat oleh", user.email || ""],
      ["Jumlah barang", barang.length],
      ["Jumlah riwayat harga", history.length],
      ["Jumlah dokumen stock opname", `${opname.length} (milik akun ini saja)`],
      ["", ""],
      ["Cara memulihkan barang", "Dashboard → Upload Excel → pilih file ini. Sheet \"Barang\" akan dibaca; barang yang sudah ada diperbarui, yang hilang ditambahkan kembali."],
      ["Riwayat harga & stock opname", "Disimpan sebagai arsip untuk dibaca; tidak dipulihkan otomatis lewat Upload Excel."]
    ].forEach((row) => sheetInfo.addRow(row));
    sheetInfo.getRow(1).font = { bold: true, size: 14 };
    sheetInfo.getColumn(1).font = { bold: true };
    sheetInfo.getColumn(2).alignment = { wrapText: true, vertical: "top" };

    // Sheet "Barang" harus jadi sheet pertama agar terbaca oleh Upload Excel.
    const buffer = await workbook.xlsx.writeBuffer();
    const tanggalFile = waktu.toLocaleDateString("sv-SE");
    saveAs(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Backup_Toko_H_Endun_${tanggalFile}.xlsx`
    );
    showAlert(`Backup berhasil diunduh: ${barang.length} barang, ${history.length} riwayat harga, ${opname.length} dokumen stock opname (${jumlahEntriOpname} baris).`, "success", 6000);
  } catch (error) {
    console.error(error);
    showAlert(`Gagal membuat backup: ${errorText(error)}`, "error", 6000);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function exportBarangToExcel() {
  if (!window.ExcelJS || !window.saveAs) return showAlert("Library Excel belum termuat. Periksa koneksi internet.", "error");
  if (!barangCache.length) return showAlert("Tidak ada data barang untuk diekspor.", "warning");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Daftar Barang");
  sheet.mergeCells("A1:I2");
  const title = sheet.getCell("A1");
  title.value = "DAFTAR BARANG TOKO H ENDUN";
  title.font = { size: 18, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };

  sheet.getRow(3).values = ["No", "Nama Barang", "Satuan", "Isi per Satuan", "Harga Total", "Harga Satuan", "Harga Jual", "Untung per Pcs", "Terakhir Diedit"];
  sheet.getRow(3).font = { bold: true };
  sheet.columns = [
    { width: 6 }, { width: 32 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 20 }, { width: 18 }, { width: 18 }, { width: 22 }
  ];

  barangCache.forEach((item, index) => {
    const untung = item.hargaJual > 0 ? item.hargaJual - item.hargaSatuan : null;
    sheet.addRow([index + 1, item.nama, item.satuan, item.isiPerSatuan, item.harga, item.hargaSatuan, item.hargaJual, untung, formatDate(item.editedAt, true)]);
  });
  sheet.getColumn(5).numFmt = '"Rp" #,##0';
  sheet.getColumn(6).numFmt = '"Rp" #,##0.00';
  sheet.getColumn(7).numFmt = '"Rp" #,##0';
  sheet.getColumn(8).numFmt = '"Rp" #,##0.00;-"Rp" #,##0.00';

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), "Daftar_Barang.xlsx");
  showAlert("Daftar barang berhasil diekspor.");
}

function rapikanRiwayatHarga(id, data) {
  return {
    id,
    barangId: data.barangId || null,
    nama: String(data.nama || data.namaLama || "Tanpa Nama"),
    namaLama: String(data.namaLama || ""),
    hargaLama: Number(data.hargaLama) || 0,
    hargaBaru: Number(data.hargaBaru) || 0,
    timestamp: data.timestamp,
    editedBy: data.editedBy || "-",
    hanyaTerakhir: false
  };
}

// Perubahan harga dari perangkat ini langsung ditambahkan ke memori (tanpa membaca ulang server).
function tambahRiwayatHargaLokal(data) {
  if (riwayatHargaMentah) riwayatHargaMentah.push(rapikanRiwayatHarga(`lokal-${makeId()}`, data));
}

async function loadPriceHistory() {
  let historyError = null;
  // Seluruh riwayat harga dibaca sekali per sesi, bukan setiap kali statistik dibuka.
  if (!riwayatHargaMentah) {
    try {
      const snapshot = await getDocs(collection(db, "price_history"));
      riwayatHargaMentah = snapshot.docs.map((snap) => rapikanRiwayatHarga(snap.id, snap.data()));
    } catch (error) {
      historyError = error;
      console.warn("price_history belum dapat dibaca, memakai perubahan terakhir dari data barang.", error);
    }
  }
  const changes = (riwayatHargaMentah || []).map((item) => ({ ...item }));

  const namaKey = (nama) => String(nama || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
  const idByNama = new Map(barangCache.map((item) => [namaKey(item.nama), item.id]));

  changes.forEach((item) => {
    // Data lama tanpa barangId dicocokkan ke barang lewat nama (baru atau lama) supaya tetap satu grafik.
    item.barangId = item.barangId || idByNama.get(namaKey(item.nama)) || idByNama.get(namaKey(item.namaLama)) || null;
  });

  // Lengkapi dengan perubahan terakhir di dokumen barang yang belum tercatat di price_history.
  barangCache.forEach((item) => {
    if (item.hargaLama == null || item.hargaLama === "") return;
    const hargaLama = Number(item.hargaLama);
    if (!Number.isFinite(hargaLama) || hargaLama === item.harga) return;
    const sudahTercatat = changes.some((change) => change.barangId === item.id
      && change.hargaLama === hargaLama && change.hargaBaru === item.harga);
    if (sudahTercatat) return;
    changes.push({
      id: `barang-${item.id}`,
      barangId: item.id,
      nama: item.nama,
      hargaLama,
      hargaBaru: item.harga,
      timestamp: item.editedAt,
      editedBy: item.editedBy || "-",
      hanyaTerakhir: true
    });
  });

  changes.forEach((item) => {
    item.key = item.barangId || `nama:${namaKey(item.nama)}`;
  });
  changes.sort((a, b) => (toDate(b.timestamp)?.getTime() || 0) - (toDate(a.timestamp)?.getTime() || 0));
  return { changes, historyError };
}

function renderStatistikNotice(historyError) {
  const notice = $("statistik-notice");
  notice.textContent = historyError
    ? `⚠️ Riwayat lengkap (price_history) tidak bisa dibaca: ${historyError.code || historyError.message}. `
      + "Yang tampil hanya perubahan terakhir tiap barang. Publish isi file firestore.rules di Firebase Console → Firestore → Rules."
    : "";
  notice.style.display = historyError ? "block" : "none";
}

const WARNA_NAIK = "#dc3545";
const WARNA_TURUN = "#28a745";
const WARNA_TETAP = "#6c757d";

function describeChange(hargaLama, hargaBaru) {
  const diff = hargaBaru - hargaLama;
  const arah = diff > 0 ? "naik" : diff < 0 ? "turun" : "tetap";
  if (arah === "tetap") return { diff, arah, text: "Tidak berubah" };
  const persen = hargaLama > 0
    ? ` (${diff > 0 ? "+" : "−"}${Math.abs(diff / hargaLama * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%)`
    : "";
  return { diff, arah, text: `${arah === "naik" ? "▲ +" : "▼ −"}${formatRupiah(Math.abs(diff))}${persen}` };
}

function formatShortDate(value) {
  const date = toDate(value);
  return date ? date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "2-digit" }) : "-";
}

function createText(tag, text, className = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

function renderStatistikSummary() {
  const count = (arah) => priceHistoryCache.filter((item) => describeChange(item.hargaLama, item.hargaBaru).arah === arah).length;
  const tiles = [
    ["Perubahan", priceHistoryCache.length, ""],
    ["Harga naik", count("naik"), "naik"],
    ["Harga turun", count("turun"), "turun"],
    ["Barang", new Set(priceHistoryCache.map((item) => item.key)).size, ""]
  ];
  $("statistik-summary").replaceChildren(...tiles.map(([label, value, arah]) => {
    const tile = document.createElement("div");
    tile.className = `statistik-tile ${arah}`;
    tile.append(createText("strong", value.toLocaleString("id-ID")), createText("span", label));
    return tile;
  }));
}

function renderStatistikOptions() {
  const latest = new Map();
  priceHistoryCache.forEach((item) => {
    if (!latest.has(item.key)) latest.set(item.key, { nama: item.nama, jumlah: 0 });
    latest.get(item.key).jumlah++;
  });
  const options = [...latest.entries()]
    .sort((a, b) => a[1].nama.localeCompare(b[1].nama, "id", { sensitivity: "base" }))
    .map(([key, info]) => {
      const option = createText("option", `${info.nama} (${info.jumlah}x perubahan)`);
      option.value = key;
      return option;
    });
  $("statistik-barang").replaceChildren(...options);
  $("statistik-barang").value = priceHistoryCache[0]?.key || "";
}

function renderStatistikList() {
  const content = $("statistik-content");
  const keyword = $("statistik-search").value.trim().toLocaleLowerCase("id-ID");
  const arahFilter = $("statistik-arah").value;
  const items = priceHistoryCache.filter((item) =>
    item.nama.toLocaleLowerCase("id-ID").includes(keyword)
    && (arahFilter === "semua" || describeChange(item.hargaLama, item.hargaBaru).arah === arahFilter));

  if (!items.length) {
    content.replaceChildren(createText("p", "Tidak ada perubahan harga yang cocok.", "statistik-kosong"));
    return;
  }

  content.replaceChildren(...items.map((item) => {
    const change = describeChange(item.hargaLama, item.hargaBaru);
    const entry = document.createElement("div");
    entry.className = `statistik-entry ${change.arah}`;
    entry.tabIndex = 0;
    entry.setAttribute("role", "button");
    entry.title = "Klik untuk melihat grafik barang ini";

    const head = document.createElement("div");
    head.className = "statistik-entry-head";
    head.append(createText("strong", item.nama), createText("span", change.text, `statistik-badge ${change.arah}`));

    const harga = document.createElement("div");
    harga.className = "statistik-harga";
    harga.append(createText("span", formatRupiah(item.hargaLama), "harga-lama"), " → ", createText("b", formatRupiah(item.hargaBaru)));

    const meta = createText("small", `${formatDate(item.timestamp, true)} • oleh ${getUserNameFromEmail(item.editedBy)}`);
    entry.append(head, harga, meta);

    const open = () => toggleStatistikChart(item.key);
    entry.addEventListener("click", open);
    entry.addEventListener("keydown", (event) => { if (event.key === "Enter") open(); });
    return entry;
  }));
}

async function showStatistikHarga() {
  const content = $("statistik-content");
  content.replaceChildren(createText("p", "⏳ Memuat riwayat harga...", "statistik-kosong"));
  $("statistik-summary").replaceChildren();
  $("statistik-notice").style.display = "none";
  $("statistik-search").value = "";
  $("statistik-arah").value = "semua";
  $("statistik-chart").style.display = "none";
  $("btnStatistikWaktu").textContent = "📈 Lihat Grafik Riwayat";
  $("statistik-popup").style.display = "flex";

  try {
    const { changes, historyError } = await loadPriceHistory();
    priceHistoryCache = changes;
    renderStatistikNotice(historyError);
    const ada = priceHistoryCache.length > 0;
    $("statistik-filter").style.display = ada ? "flex" : "none";
    $("btnStatistikWaktu").style.display = ada ? "" : "none";
    if (!ada) {
      content.replaceChildren(createText("p", "Belum ada perubahan harga yang tercatat.", "statistik-kosong"));
      return;
    }
    renderStatistikSummary();
    renderStatistikOptions();
    renderStatistikList();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal memuat statistik: ${errorText(error)}`, "error");
  }
}

function toggleStatistikChart(key = null) {
  const wrapper = $("statistik-chart");
  const show = key ? true : wrapper.style.display === "none";
  wrapper.style.display = show ? "block" : "none";
  $("btnStatistikWaktu").textContent = show ? "Sembunyikan Grafik" : "📈 Lihat Grafik Riwayat";
  if (!show) return;
  if (key) $("statistik-barang").value = key;
  renderStatistikChart($("statistik-barang").value);
  wrapper.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderStatistikChart(key) {
  if (!window.Chart) return showAlert("Chart.js belum termuat. Periksa koneksi internet.", "error");
  const history = priceHistoryCache
    .filter((item) => item.key === key)
    .sort((a, b) => (toDate(a.timestamp)?.getTime() || 0) - (toDate(b.timestamp)?.getTime() || 0));
  if (!history.length) return;

  // Titik pertama = harga sebelum perubahan pertama, lalu satu titik per perubahan.
  const points = [
    { label: "Awal", title: `Harga sebelum ${formatDate(history[0].timestamp, true)}`, harga: history[0].hargaLama, change: null },
    ...history.map((item) => ({
      label: formatShortDate(item.timestamp),
      title: `${formatDate(item.timestamp, true)} • oleh ${getUserNameFromEmail(item.editedBy)}`,
      harga: item.hargaBaru,
      change: describeChange(item.hargaLama, item.hargaBaru)
    }))
  ];
  const awal = points[0].harga;
  const akhir = points[points.length - 1].harga;
  const total = describeChange(awal, akhir);
  const info = $("statistik-chart-info");
  info.replaceChildren(
    createText("strong", history[history.length - 1].nama),
    createText("span", `${formatRupiah(awal)} → ${formatRupiah(akhir)} dalam ${history.length}x perubahan`),
    createText("span", total.text, `statistik-badge ${total.arah}`)
  );

  const warna = (arah) => (arah === "naik" ? WARNA_NAIK : arah === "turun" ? WARNA_TURUN : WARNA_TETAP);
  const pointColors = points.map((point) => warna(point.change?.arah));
  const rupiahSingkat = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });

  priceChart?.destroy();
  priceChart = new Chart($("statistik-canvas"), {
    type: "line",
    data: {
      labels: points.map((point) => point.label),
      datasets: [{
        label: "Harga",
        data: points.map((point) => point.harga),
        borderWidth: 2,
        tension: 0,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors,
        segment: {
          borderColor: (ctx) => warna(describeChange(ctx.p0.parsed.y, ctx.p1.parsed.y).arah)
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => points[items[0].dataIndex].title,
            label: (ctx) => `Harga: ${formatRupiah(ctx.parsed.y)}`,
            afterLabel: (ctx) => points[ctx.dataIndex].change?.text || ""
          }
        }
      },
      scales: {
        y: {
          grace: "10%",
          ticks: { callback: (value) => `Rp ${rupiahSingkat.format(value)}` }
        },
        x: { ticks: { maxRotation: 45, autoSkip: true, autoSkipPadding: 8 } }
      }
    }
  });
}

function closeStatistik() {
  $("statistik-popup").style.display = "none";
}

async function loginEmail() {
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) return showAlert("Email dan password harus diisi.", "warning");
  try {
    await signInWithEmailAndPassword(auth, email, password);
    showAlert("Login berhasil.");
  } catch (error) {
    console.error(error);
    showAlert(`Login gagal: ${errorText(error)}`, "error");
  }
}

async function signupEmail() {
  const email = $("signup-email").value.trim();
  const password = $("signup-password").value;
  if (!email || password.length < 6) return showAlert("Isi email dan password minimal 6 karakter.", "warning");
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    showAlert("Pendaftaran berhasil.");
  } catch (error) {
    console.error(error);
    showAlert(`Pendaftaran gagal: ${errorText(error)}`, "error");
  }
}

async function loginGoogle() {
  try {
    await signInWithPopup(auth, provider);
    showAlert("Login Google berhasil.");
  } catch (error) {
    console.error(error);
    showAlert(`Login Google gagal: ${errorText(error)}`, "error");
  }
}

function setupEvents() {
  $("maintenance-cek").addEventListener("click", cekUlangPerbaikan);
  $("login-btn").addEventListener("click", loginEmail);
  $("google-login-btn").addEventListener("click", loginGoogle);
  $("signup-btn").addEventListener("click", signupEmail);
  $("logout-btn").addEventListener("click", () => signOut(auth));

  $("show-signup").addEventListener("click", (event) => { event.preventDefault(); setView("signup"); });
  $("show-login").addEventListener("click", (event) => { event.preventDefault(); setView("login"); });

  // Panel pembeli
  const kembaliKeToko = (event) => {
    event.preventDefault();
    lanjutCheckout = false;
    $("login-info").textContent = "";
    tampilkanToko();
  };
  $("login-ke-toko").addEventListener("click", kembaliKeToko);
  $("signup-ke-toko").addEventListener("click", kembaliKeToko);
  $("toko-masuk-btn").addEventListener("click", () => { $("login-info").textContent = ""; setView("login"); });
  $("toko-keluar-btn").addEventListener("click", () => signOut(auth));
  $("toko-admin-btn").addEventListener("click", () => setView("dashboard"));
  $("toko-pesanan-btn").addEventListener("click", bukaPesananSaya);
  $("toko-keranjang-btn").addEventListener("click", bukaKeranjang);
  $("toko-cari").addEventListener("input", renderToko);
  $("close-keranjang").addEventListener("click", () => { $("keranjang-popup").style.display = "none"; });
  $("keranjang-checkout").addEventListener("click", mulaiCheckout);
  $("close-checkout").addEventListener("click", () => { $("checkout-popup").style.display = "none"; });
  $("checkout-kirim").addEventListener("click", kirimPesanan);
  $("checkout-catatan").addEventListener("keydown", (event) => { if (event.key === "Enter") kirimPesanan(); });
  $("close-pesanan-saya").addEventListener("click", () => { $("pesanan-saya-popup").style.display = "none"; });

  // Pesanan masuk (admin)
  $("btn-pesanan").addEventListener("click", showPesananAdmin);
  $("notif-btn").addEventListener("click", aturNotifikasi);
  // Notifikasi diklik saat panel sudah terbuka → service worker meminta membuka halaman Pesanan.
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.jenis === "buka-pesanan" && peran === "admin") showPesananAdmin();
  });
  $("btnKembaliPesanan").addEventListener("click", () => setView("dashboard"));
  $("pesanan-filter").addEventListener("change", gantiFilterPesanan);
  $("pesanan-muat-ulang").addEventListener("click", muatPesananAdmin);
  $("lihat-toko-btn").addEventListener("click", () => { katalogCache = null; tampilkanToko(); });
  perbaruiJumlahKeranjang();

  $("btnTambah").addEventListener("click", tambahBarang);
  ["namaBarang", "hargaBarang", "namaCustom", "isiCustom"].forEach((id) => {
    $(id).addEventListener("keydown", (event) => { if (event.key === "Enter") tambahBarang(); });
  });
  ["edit-namaBarang", "edit-hargaBarang", "edit-namaSatuan", "edit-isiSatuan"].forEach((id) => {
    $(id).addEventListener("keydown", (event) => { if (event.key === "Enter") simpanEditBarang(); });
  });
  $("searchBarang").addEventListener("input", renderBarang);
  $("searchSidebarBarang").addEventListener("input", renderSidebarBarang);
  $("satuanBarang").addEventListener("change", () => {
    $("customWrapper").style.display = $("satuanBarang").value === "custom" ? "block" : "none";
  });

  $("close-edit-popup").addEventListener("click", closeEdit);

  $("btn-harga-jual").addEventListener("click", showHargaJual);

  // Struk belanja grosir
  $("struk-btn").addEventListener("click", showStruk);
  $("btnKembaliStruk").addEventListener("click", () => setView("dashboard"));
  $("struk-foto").addEventListener("click", () => $("struk-kamera").click());
  $("struk-pilih").addEventListener("click", () => $("struk-galeri").click());
  $("struk-ulang-foto").addEventListener("click", () => $("struk-kamera").click());
  ["struk-kamera", "struk-galeri"].forEach((id) => {
    $(id).addEventListener("change", (event) => {
      pilihFotoStruk(event.target.files?.[0]);
      event.target.value = "";
    });
  });
  $("struk-tetap-baca").addEventListener("click", () => strukSesi?.lanjut?.());
  $("struk-terapkan").addEventListener("click", terapkanStruk);
  $("struk-batal").addEventListener("click", resetStruk);
  $("struk-centang-semua").addEventListener("change", (event) => {
    strukSesi?.baris?.forEach((b) => {
      if (b.perubahan && b.perubahan.arah !== "tetap") b.dipilih = event.target.checked;
    });
    renderHasilStruk();
  });

  // Aset produk (upload ke GitHub)
  $("close-aset").addEventListener("click", tutupAsetProduk);
  $("aset-file").addEventListener("change", pilihFileAset);
  $("aset-unggah").addEventListener("click", unggahAsetProduk);
  $("aset-hapus").addEventListener("click", hapusAsetProduk);
  $("aset-cari").addEventListener("click", () => {
    const item = barangCache.find((barang) => barang.id === asetProdukId);
    if (item) window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${item.nama} png`)}`, "_blank", "noopener");
  });
  $("gh-simpan").addEventListener("click", simpanPengaturanGitHub);
  $("gh-tes").addEventListener("click", tesKoneksiGitHub);
  $("gh-hapus-token").addEventListener("click", hapusTokenGitHub);
  $("btnKembaliHargaJual").addEventListener("click", () => setView("dashboard"));
  $("searchHargaJual").addEventListener("input", renderHargaJual);
  $("close-harga-jual-popup").addEventListener("click", tutupHargaJual);
  $("hj-simpan").addEventListener("click", simpanHargaJual);
  $("hj-input").addEventListener("input", perbaruiPratinjauUntung);
  $("hj-input").addEventListener("keydown", (event) => { if (event.key === "Enter") simpanHargaJual(); });
  $("save-edit-btn").addEventListener("click", simpanEditBarang);

  $("confirm-yes").addEventListener("click", () => closeConfirm(true));
  $("confirm-no").addEventListener("click", () => closeConfirm(false));

  $("btn-stock-opname").addEventListener("click", () => showStockOpname({ reset: true }));
  $("btnBackToDashboard").addEventListener("click", kembaliKeDashboard);
  $("btn-riwayat-stock-opname").addEventListener("click", showRiwayat);
  $("kembali-dari-riwayat").addEventListener("click", () => showStockOpname());
  $("btnSimpanOpname").addEventListener("click", simpanHasilStockOpname);
  $("judulDokumen").addEventListener("input", simpanDraf);
  $("hapus-semua-riwayat").addEventListener("click", hapusSemuaRiwayat);

  $("qty-ok").addEventListener("click", () => resolveQuantity(true));
  $("qty-cancel").addEventListener("click", () => resolveQuantity(false));
  $("qty-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") resolveQuantity(true);
    if (event.key === "Escape") resolveQuantity(false);
  });

  $("uploadExcelBtn").addEventListener("click", uploadExcelToFirestore);
  $("stopUploadBtn").addEventListener("click", () => { stopUpload = true; });
  $("convert-btn").addEventListener("click", exportBarangToExcel);
  $("backup-btn").addEventListener("click", backupSemuaData);

  $("btnStatistikHarga").addEventListener("click", showStatistikHarga);
  $("btnStatistikWaktu").addEventListener("click", () => toggleStatistikChart());
  $("statistik-barang").addEventListener("change", () => renderStatistikChart($("statistik-barang").value));
  $("statistik-search").addEventListener("input", renderStatistikList);
  $("statistik-arah").addEventListener("change", renderStatistikList);
  $("close-statistik-popup").addEventListener("click", closeStatistik);
  $("close-price-diff").addEventListener("click", () => { $("price-diff-container").style.display = "none"; });

  $("email").addEventListener("keydown", (event) => { if (event.key === "Enter") loginEmail(); });
  $("password").addEventListener("keydown", (event) => { if (event.key === "Enter") loginEmail(); });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if ($("edit-popup").style.display === "flex") closeEdit();
    if ($("statistik-popup").style.display === "flex") closeStatistik();
    if ($("confirm-popup").style.display === "flex") closeConfirm(false);
    if ($("harga-jual-popup").style.display === "flex") tutupHargaJual();
    if ($("aset-popup").style.display === "flex") tutupAsetProduk();
    ["keranjang-popup", "checkout-popup", "pesanan-saya-popup"].forEach((id) => {
      if ($(id).style.display === "flex") $(id).style.display = "none";
    });
  });
}

// Jam & tanggal WIB (Asia/Jakarta) di pojok layar, plus status koneksi internet.
function mulaiJamWIB() {
  const jam = $("jam-wib");
  const tanggal = $("tanggal-wib");
  const status = $("status-koneksi");
  if (!jam || !tanggal) return;

  const formatJam = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const formatTanggal = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const jamPerbaikan = $("perbaikan-jam");
  const perbarui = () => {
    const sekarang = new Date();
    jam.textContent = formatJam.format(sekarang).replace(/\./g, ":");
    tanggal.textContent = formatTanggal.format(sekarang);
    if (jamPerbaikan) jamPerbaikan.textContent = `${jam.textContent} WIB · ${tanggal.textContent}`;
  };
  perbarui();
  // Selaraskan dengan pergantian detik agar jam tidak tertinggal.
  setTimeout(() => {
    perbarui();
    setInterval(perbarui, 1000);
  }, 1000 - (Date.now() % 1000));

  if (status) {
    const perbaruiStatus = () => {
      status.textContent = navigator.onLine ? "Online" : "Offline";
      status.classList.toggle("offline", !navigator.onLine);
    };
    perbaruiStatus();
    window.addEventListener("online", perbaruiStatus);
    window.addEventListener("offline", perbaruiStatus);
  }
}

setupEvents();
mulaiJamWIB();
checkMaintenance();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    peran = "tamu";
    barangCache = [];
    resetStockForm();
    hapusCacheBarang(); // data harga modal tidak ditinggalkan di perangkat setelah keluar
    berhentiPantauPesanan();
    setBadgePesanan(0);
    riwayatHargaMentah = null;
    resetStruk();
    aliasStruk = null;
    riwayatStruk = null;
    $("user-photo").src = DEFAULT_PHOTO;
    perbaruiHeaderToko();
    tampilkanToko();
    return;
  }

  // Tentukan peran lewat izin Firestore: hanya admin (daftar di firestore.rules) yang boleh membaca "barang".
  let admin = false;
  try {
    await getDocs(query(collection(db, "barang"), limit(1)));
    admin = true;
  } catch (error) {
    if (error.code !== "permission-denied") {
      console.error(error);
      showAlert(`Gagal memeriksa akun: ${errorText(error)}`, "error");
    }
  }

  if (!admin) {
    peran = "pembeli";
    masukSebagaiPembeli(user);
    return;
  }

  peran = "admin";
  lanjutCheckout = false;
  perbaruiHeaderToko();
  $("user-email").textContent = getUserNameFromEmail(user.email);
  $("user-photo").src = user.photoURL || DEFAULT_PHOTO;
  $("user-photo").style.display = "block";
  setView("dashboard");
  showBarangLoading();
  try {
    await fetchBarang();
    sinkronKatalog();
    mulaiSinkronBerkala();
    mulaiPantauPesanan();
    perbaruiTombolNotifikasi();
    if (notifikasiAktif()) daftarkanServiceWorker();
    // Dibuka dari klik notifikasi (alamat berakhiran #pesanan) → langsung ke halaman Pesanan.
    if (location.hash === "#pesanan") {
      history.replaceState(null, "", location.pathname + location.search);
      showPesananAdmin();
    }
  } catch (error) {
    console.error(error);
    showBarangError();
    showAlert(`Gagal memuat data barang: ${errorText(error)}`, "error");
  }
});

// API global kecil untuk kompatibilitas bookmark/devtools lama.
window.loadBarang = fetchBarang;
window.loadSidebarBarang = renderSidebarBarang;
window.uploadExcelToFirestore = uploadExcelToFirestore;
window.loadRiwayat = loadRiwayat;
window.hapusRiwayat = hapusRiwayat;
window.hapusSemuaRiwayat = hapusSemuaRiwayat;
window.exportRiwayatToExcel = exportRiwayatToExcel;
window.simpanHasilStockOpname = simpanHasilStockOpname;
window.kembaliKeDashboard = kembaliKeDashboard;
