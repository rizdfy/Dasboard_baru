// Membaca struk belanja grosir dari foto (Tesseract.js, gratis, berjalan di browser).
// Alur: periksaKualitas → siapkanGambarOcr → bacaTeks → uraiStruk → cocokkanBarang → gambarBertag.
// Fungsi urai & cocok tidak memakai DOM sehingga bisa diuji di Node.

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js";

// ---------------------------------------------------------------------------
// 1. Kualitas foto
// ---------------------------------------------------------------------------
// Batas ini sengaja longgar; bila foto tetap sulit dibaca, hasil OCR (keyakinan rendah /
// tidak ada baris harga) juga akan memicu permintaan foto ulang.
export const BATAS_KUALITAS = { sisiMin: 500, terangMin: 70, kontrasMin: 25, tajamMin: 35 };

export function periksaKualitas(sumber) {
  const lebarAsli = sumber.naturalWidth || sumber.width;
  const tinggiAsli = sumber.naturalHeight || sumber.height;
  const skala = Math.min(1, 500 / lebarAsli);
  const lebar = Math.max(1, Math.round(lebarAsli * skala));
  const tinggi = Math.max(1, Math.round(tinggiAsli * skala));
  const kanvas = document.createElement("canvas");
  kanvas.width = lebar;
  kanvas.height = tinggi;
  const ctx = kanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sumber, 0, 0, lebar, tinggi);
  const { data } = ctx.getImageData(0, 0, lebar, tinggi);

  const abu = new Float32Array(lebar * tinggi);
  let jumlah = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    abu[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    jumlah += abu[p];
  }
  const terang = jumlah / abu.length;
  let ragam = 0;
  for (const v of abu) ragam += (v - terang) ** 2;
  const kontras = Math.sqrt(ragam / abu.length);

  // Ketajaman: ragam operator Laplace (makin kecil makin buram).
  let jumlahL = 0;
  let jumlahL2 = 0;
  let n = 0;
  for (let y = 1; y < tinggi - 1; y++) {
    for (let x = 1; x < lebar - 1; x++) {
      const p = y * lebar + x;
      const l = abu[p - lebar] + abu[p + lebar] + abu[p - 1] + abu[p + 1] - 4 * abu[p];
      jumlahL += l;
      jumlahL2 += l * l;
      n++;
    }
  }
  const tajam = n ? jumlahL2 / n - (jumlahL / n) ** 2 : 0;

  const alasan = [];
  if (Math.min(lebarAsli, tinggiAsli) < BATAS_KUALITAS.sisiMin) alasan.push("resolusi foto terlalu kecil");
  if (terang < BATAS_KUALITAS.terangMin) alasan.push("foto terlalu gelap");
  if (kontras < BATAS_KUALITAS.kontrasMin) alasan.push("tulisan kurang kontras (pudar / silau)");
  if (tajam < BATAS_KUALITAS.tajamMin) alasan.push("foto buram / goyang");
  return { ok: alasan.length === 0, alasan, terang: Math.round(terang), kontras: Math.round(kontras), tajam: Math.round(tajam) };
}

// ---------------------------------------------------------------------------
// 2. Persiapan gambar untuk OCR
//    a) potong ke area kertas struk (latar meja/kain dibuang),
//    b) perbesar hingga lebar ±1600 px,
//    c) ambang adaptif (Bradley) → hitam-putih; bayangan & tinta thermal pudar tetap terbaca.
// ---------------------------------------------------------------------------
function keAbu(data) {
  const abu = new Float32Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) abu[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return abu;
}

// "Keputihan" tiap piksel = min(R,G,B) / max(R,G,B): kertas (putih/abu netral, juga saat kena bayangan)
// bernilai tinggi; latar berwarna (marmer oranye, meja kayu) bernilai rendah walau sama terangnya.
function keKertas(data) {
  const hasil = new Float32Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const maks = Math.max(data[i], data[i + 1], data[i + 2]);
    hasil[p] = maks < 40 ? 0 : (Math.min(data[i], data[i + 1], data[i + 2]) / maks) * 255;
  }
  return hasil;
}

function ambangOtsu(abu) {
  const histogram = new Float64Array(256);
  abu.forEach((v) => { histogram[Math.min(255, Math.round(v))]++; });
  let jumlahSemua = 0;
  for (let v = 0; v < 256; v++) jumlahSemua += v * histogram[v];
  let bobotB = 0;
  let jumlahB = 0;
  let terbaik = 0;
  let ambang = 128;
  for (let v = 0; v < 256; v++) {
    bobotB += histogram[v];
    if (!bobotB) continue;
    const bobotF = abu.length - bobotB;
    if (!bobotF) break;
    jumlahB += v * histogram[v];
    const beda = bobotB * bobotF * (jumlahB / bobotB - (jumlahSemua - jumlahB) / bobotF) ** 2;
    if (beda > terbaik) { terbaik = beda; ambang = v; }
  }
  return ambang;
}

// Rentang indeks terpanjang yang memenuhi syarat (celah kecil diabaikan).
function rentangTerpanjang(nilai, syarat, celahMaks) {
  let terbaik = null;
  let mulai = -1;
  let celah = 0;
  for (let i = 0; i <= nilai.length; i++) {
    const ok = i < nilai.length && syarat(nilai[i]);
    if (ok) {
      if (mulai < 0) mulai = i;
      celah = 0;
    } else if (mulai >= 0 && (++celah > celahMaks || i === nilai.length)) {
      const akhir = i - celah;
      if (!terbaik || akhir - mulai > terbaik[1] - terbaik[0]) terbaik = [mulai, akhir];
      mulai = -1;
      celah = 0;
    }
  }
  return terbaik;
}

// Kotak kertas struk (warna terang) di dalam foto, dalam koordinat foto asli.
export function cariKertas(sumber) {
  const lebarAsli = sumber.naturalWidth || sumber.width;
  const tinggiAsli = sumber.naturalHeight || sumber.height;
  const penuh = { x: 0, y: 0, w: lebarAsli, h: tinggiAsli };
  const s = Math.min(1, 320 / Math.max(lebarAsli, tinggiAsli));
  const w = Math.max(1, Math.round(lebarAsli * s));
  const h = Math.max(1, Math.round(tinggiAsli * s));
  const kanvas = document.createElement("canvas");
  kanvas.width = w;
  kanvas.height = h;
  const ctx = kanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sumber, 0, 0, w, h);
  const abu = keKertas(ctx.getImageData(0, 0, w, h).data);
  const ambang = ambangOtsu(abu);

  const kolom = new Float32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (abu[y * w + x] > ambang) kolom[x]++;
  const rk = rentangTerpanjang(Array.from(kolom, (n) => n / h), (f) => f > 0.4, 2);
  if (!rk) return penuh;
  const baris = new Float32Array(h);
  for (let y = 0; y < h; y++) for (let x = rk[0]; x <= rk[1]; x++) if (abu[y * w + x] > ambang) baris[y]++;
  const lebarKolom = rk[1] - rk[0] + 1;
  const rb = rentangTerpanjang(Array.from(baris, (n) => n / lebarKolom), (f) => f > 0.45, 3);
  if (!rb) return penuh;

  const luas = (lebarKolom * (rb[1] - rb[0] + 1)) / (w * h);
  if (luas < 0.08 || luas > 0.92) return penuh; // tidak jelas / struk memenuhi foto
  const tepiX = Math.round(w * 0.02);
  const tepiY = Math.round(h * 0.01);
  const x0 = Math.max(0, rk[0] - tepiX);
  const y0 = Math.max(0, rb[0] - tepiY);
  const x1 = Math.min(w, rk[1] + 1 + tepiX);
  const y1 = Math.min(h, rb[1] + 1 + tepiY);
  return { x: Math.round(x0 / s), y: Math.round(y0 / s), w: Math.round((x1 - x0) / s), h: Math.round((y1 - y0) / s) };
}

// Ambang adaptif Bradley memakai citra integral: piksel (setelah dihaluskan sedikit agar titik-titik
// huruf dot-matrix menyatu) yang lebih gelap T% dari rata-rata sekitarnya → hitam.
// Daerah yang rata-ratanya gelap (meja/latar di luar kertas) dibuat putih.
function buatIntegral(nilai, w, h) {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let jumlahBaris = 0;
    for (let x = 0; x < w; x++) {
      jumlahBaris += nilai[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + jumlahBaris;
    }
  }
  return (x, y, r) => {
    const xa = Math.max(0, x - r);
    const xb = Math.min(w, x + r + 1);
    const ya = Math.max(0, y - r);
    const yb = Math.min(h, y + r + 1);
    return (integral[yb * (w + 1) + xb] - integral[ya * (w + 1) + xb] - integral[yb * (w + 1) + xa] + integral[ya * (w + 1) + xa])
      / ((xb - xa) * (yb - ya));
  };
}

function ambangAdaptif(abu, kertas, w, h, jendela, T, halus, batasKertas) {
  const rataAbu = buatIntegral(abu, w, h);
  const rataKertas = buatIntegral(kertas, w, h);
  const r = Math.floor(jendela / 2);
  const hasil = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rata = rataAbu(x, y, r);
      const nilai = halus ? rataAbu(x, y, halus) : abu[y * w + x];
      hasil[y * w + x] = rataKertas(x, y, r) >= batasKertas && nilai < rata * (1 - T) ? 0 : 255;
    }
  }
  return hasil;
}

// Hasil: kanvas hitam-putih + transformasi foto asli → kanvas OCR (x' = (x - potong.x) * skala).
export function siapkanGambarOcr(sumber, { potong = cariKertas(sumber), T = 0.1, halus = 2, lebar = 1600 } = {}) {
  const skala = Math.min(3, lebar / potong.w);
  const kanvas = document.createElement("canvas");
  kanvas.width = Math.round(potong.w * skala);
  kanvas.height = Math.round(potong.h * skala);
  const ctx = kanvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sumber, potong.x, potong.y, potong.w, potong.h, 0, 0, kanvas.width, kanvas.height);
  const gambar = ctx.getImageData(0, 0, kanvas.width, kanvas.height);
  const d = gambar.data;
  const abu = keAbu(d);
  const kertas = keKertas(d);
  const batasKertas = ambangOtsu(kertas) * 0.9;
  const hitamPutih = ambangAdaptif(abu, kertas, kanvas.width, kanvas.height, Math.round(kanvas.width / 12) | 1, T, halus, batasKertas);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) d[i] = d[i + 1] = d[i + 2] = hitamPutih[p];
  ctx.putImageData(gambar, 0, 0);
  return { kanvas, skala, potong };
}

// ---------------------------------------------------------------------------
// 3. OCR (Tesseract.js dimuat hanya saat fitur ini dipakai)
// ---------------------------------------------------------------------------
const pekerja = [null, null];

function muatTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const skrip = document.createElement("script");
    skrip.src = TESSERACT_URL;
    skrip.onload = () => resolve(window.Tesseract);
    skrip.onerror = () => reject(new Error("Tesseract.js gagal dimuat. Periksa koneksi internet."));
    document.head.appendChild(skrip);
  });
}

// Dua pekerja (web worker) agar dua pembacaan struk berjalan bersamaan di dua inti prosesor.
const laporProgres = [() => {}, () => {}];

function siapkanPekerja(Tesseract, indeks) {
  pekerja[indeks] ||= (async () => {
    const w = await Tesseract.createWorker(["ind", "eng"], 1, {
      logger: (m) => {
        if (m.status === "recognizing text") laporProgres[indeks]("Membaca struk...", m.progress);
        else if (m.progress != null) laporProgres[indeks](`Menyiapkan pembaca teks: ${m.status}...`, m.progress);
      }
    });
    // PSM 6 (satu blok teks seragam) paling lengkap membaca kolom harga di kanan struk.
    await w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    return w;
  })().catch((error) => { pekerja[indeks] = null; throw error; });
  return pekerja[indeks];
}

export async function bacaTeks(kanvas, onProgres = () => {}, indeks = 0) {
  laporProgres[indeks] = onProgres;
  const Tesseract = await muatTesseract();
  if (!pekerja[indeks]) onProgres("Menyiapkan pembaca teks (unduhan pertama ±5 MB)...", 0);
  const { data } = await (await siapkanPekerja(Tesseract, indeks)).recognize(kanvas);
  const baris = (data.lines || [])
    .map((b) => ({ teks: b.text.replace(/\s+/g, " ").trim(), yakin: Math.round(b.confidence), kotak: b.bbox }))
    .filter((b) => b.teks);
  return { teks: data.text || "", yakin: Math.round(data.confidence || 0), baris };
}

// ---------------------------------------------------------------------------
// 4. Mengurai baris struk menjadi { nama, qty, harga, total }
// ---------------------------------------------------------------------------
const KATA_LEWATI = /\b(SUB ?TOTAL|TOTAL|GRAND|TUNAI|CASH|KEMBALI(AN)?|BAYAR|DISKON|DISC|POTONGAN|HEMAT|PPN|PAJAK|DPP|KASIR|TGL|TANGGAL|JAM|TELP|TELEPON|NPWP|STRUK|NOTA|INVOICE|FAKTUR|TERIMA ?KASIH|DEBIT|KREDIT|KARTU|QRIS|VOUCHER|POIN|MEMBER|JUMLAH ITEM|TOTAL ITEM|ITEM\(S\)|SALDO|ALAMAT|JL\.?|JALAN|NO\.? ?TRANS|NO\.? ?NOTA|BARANG ?TIDAK|DAPAT DITUKAR|HARGA SUDAH|TERMASUK|BON|SPG|OPR|BUKU|LANJUTAN|SILAHKAN|DATANG KEMBALI)\b/i;
// Harga satuan barang grosir di atas ini hampir pasti baris saldo/bon/subtotal yang salah baca.
const HARGA_MAKS_WAJAR = 1000000;
const KATA_SATUAN = /^(X|PCS|PC|BKS|BOX|DUS|DS|KRT|CTN|PAK|PACK|PK|LSN|SAK|RTG|RCG|RENTENG|BTL|KLG|SCH|@|RP\.?|IDR)$/i;

// Perbaiki salah baca umum pada angka (O→0, l/I→1, S→5) hanya untuk token yang hampir semua digit.
function rapikanAngka(token) {
  const digit = (token.match(/\d/g) || []).length;
  if (digit < Math.max(1, token.replace(/[.,]/g, "").length - 1)) return token;
  return token.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5");
}

// "52.000" / "52,000" / "52000" / "52.000,00" → 52000; selain itu null.
export function angkaUang(token) {
  let t = rapikanAngka(String(token).replace(/^RP\.?/i, "").trim());
  t = t.replace(/[.,]00$/, "");
  if (/^0\d/.test(t)) return null; // harga tidak diawali 0 → digit pertama salah baca
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  if (/^\d{4,9}$/.test(t)) return Number(t);
  return null;
}

const SATUAN_QTY = ["PCS", "PC", "DUS", "DS", "BKS", "KRT", "CTN", "PAK", "PACK", "PK", "SAK", "BOX", "SLOP", "SLP", "BAL", "BALL", "LSN", "LUSIN", "RTG", "RCG", "RENCENG", "BTL", "KLG", "IKAT", "ROLL", "KG", "UNIT", "STRI", "STRIP", "STR", "SET", "LBR", "TUB"];

// Satuan qty, termasuk yang salah baca 1 huruf (PAK → FAK / PAR / SAK...).
function miripSatuan(kata) {
  const k = kata.toUpperCase().replace(/[^A-Z]/g, "");
  if (!k) return false;
  return SATUAN_QTY.some((s) => s === k || (k.length >= 3 && k.length === s.length && [...s].filter((h, i) => h !== k[i]).length <= 1));
}

// Simbol yang sering menempel pada angka karena coretan/centang di struk.
const bersihToken = (t) => t.replace(/^[^\w]+|[^\w.,]+$/g, "");

function bersihkanNama(tokens) {
  const hasil = tokens
    .map((t) => t.replace(/^[^\w]+|[^\w]+$/g, ""))
    .filter((t) => t && !KATA_SATUAN.test(t));
  // Sisa coretan di ujung (mis. "mr", "ea") & satuan salah baca ("Dak"/"nak" = pak) dibuang;
  // angka tetap (ukuran / isi).
  const buangUjung = (t) => !/\d/.test(t) && (t.length <= 2 || miripSatuan(t));
  while (hasil.length > 1 && buangUjung(hasil[hasil.length - 1])) hasil.pop();
  return hasil.join(" ").trim();
}

const adaKata = (teks) => /[A-Za-z]{3,}/.test(teks);

// Dari satu atau dua angka uang di baris + qty, tentukan harga satuan.
// ragu = angka tidak saling cocok (salah satu salah baca) → alternatif ditampilkan & tidak dicentang otomatis.
// Harga grosir hampir selalu kelipatan 100/500/1000; angka "100.009" pasti salah baca.
const kebulatan = (v) => (v % 1000 === 0 ? 3 : v % 500 === 0 ? 2 : v % 50 === 0 ? 1 : 0);

function tentukanHarga(uang, qty, { kolomTotal = false } = {}) {
  if (uang.length >= 2) {
    const a = uang[uang.length - 2].nilai;
    const z = uang[uang.length - 1].nilai;
    // Selisih sangat kecil (≤ 0,05%) = satu digit terakhir salah baca; dipilih angka yang lebih "bulat".
    const cocok = (x, y) => Math.abs(x - y) <= Math.max(2, y * 0.0005);
    const pilihBulat = (q) => {
      const dariTotal = Math.round(z / q);
      return kebulatan(dariTotal) > kebulatan(a) ? dariTotal : a;
    };
    if (cocok(a * qty, z)) return { qty, harga: pilihBulat(qty), total: z };
    const kali = Math.round(z / a);
    if (kali >= 1 && kali <= 999 && cocok(a * kali, z)) return { qty: kali, harga: pilihBulat(kali), total: z }; // qty salah baca
    // Kolom harga & total tidak cocok → salah satunya salah baca. Angka yang meleset sedikit dari
    // kelipatan 50 ("25.901") kemungkinan digit terakhirnya salah baca → ikut ditawarkan versi bulatnya.
    let alternatif = [a, qty > 1 ? Math.round(z / qty) : z].flatMap((v) => {
      const bulat = Math.round(v / 50) * 50;
      return kebulatan(v) === 0 && Math.abs(bulat - v) <= 10 ? [v, bulat] : [v];
    });
    alternatif = [...new Set(alternatif)];
    if (alternatif.some((v) => kebulatan(v) > 0)) alternatif = alternatif.filter((v) => kebulatan(v) > 0);
    return { qty, harga: alternatif[0], total: z, ragu: true, alternatif };
  }
  // Hanya satu angka terbaca → tidak bisa dicek silang dengan kolom lain, jadi selalu ditandai ragu.
  const v = uang[0].nilai;
  if (kolomTotal) {
    const h = Math.round(v / qty);
    return { qty, harga: h, total: v, ragu: true, alternatif: [h] };
  }
  return { qty, harga: v, total: v * qty, ragu: true, alternatif: [v] };
}

export function uraiStruk(baris) {
  const hasil = [];
  let namaTertunda = null;

  baris.forEach((b) => {
    const teks = b.teks
      .replace(/[|]/g, " ")
      .replace(/(\d)([.,])\s(\d{3})(?!\d)/g, "$1$2$3") // "525, 000" → "525,000"
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^([^A-Za-z0-9]*\d{1,3})([A-Za-z]{2,6})(?=\s)/, (s, q, u) => (miripSatuan(u) ? `${q} ${u}` : s)); // "2PAK" → "2 PAK"
    if (!teks) return;
    if (KATA_LEWATI.test(teks)) {
      namaTertunda = null;
      return;
    }
    if (/(^|\s)-\d|\(\s?\d[\d.,]*\s?\)/.test(teks)) return; // baris potongan / minus

    const token = teks.split(" ");
    const uang = [];
    token.forEach((t, i) => {
      const bersih = bersihToken(t);
      const nilai = angkaUang(bersih);
      if (nilai !== null && nilai >= 100) uang.push({ i, nilai, pemisah: /[.,]\d{3}/.test(bersih) });
    });

    // a) Baris qty grosir: "2 PAK 259.000 518.000" — nama ada di baris sebelumnya.
    // Qty bisa salah baca: I/l/i = 1, S = 5, O = 0 (hanya dipercaya bila diikuti satuan yang dikenal).
    const qtySatuan = teks.match(/^[^A-Za-z0-9]*([0-9IilSO]{1,3})\s+([A-Za-z]{2,6})\.?\s/);
    const qtyBerhuruf = qtySatuan && /[A-Za-z]/.test(qtySatuan[1]);
    if (qtySatuan && uang.length && (miripSatuan(qtySatuan[2]) || (!qtyBerhuruf && namaTertunda && qtySatuan[2].length <= 4))) {
      if (!namaTertunda) return;
      const qty = Math.max(1, Number(qtySatuan[1].replace(/[Iil]/g, "1").replace(/S/g, "5").replace(/O/g, "0")) || 1);
      // Angka "berantakan" (mis. "je4.000") sebelum satu-satunya angka uang → yang terbaca adalah kolom total.
      const awalSisa = token.findIndex((t, i) => i > 1 && /\d/.test(t));
      const kolomTotal = uang.length === 1 && awalSisa >= 0 && awalSisa < uang[0].i;
      hasil.push(buatItem(tentukanHarga(uang, qty, { kolomTotal }), namaTertunda, b));
      namaTertunda = null;
      return;
    }

    // b) Baris tanpa angka uang → calon nama barang untuk baris qty berikutnya. Baris yang sulit
    //    dibaca tetap menggantikan nama sebelumnya, supaya nama tidak terpasang ke harga barang lain.
    if (!uang.length) {
      if (adaKata(teks)) namaTertunda = { teks: bersihkanNama(token), baris: b };
      return;
    }

    // c) Nama & harga dalam satu baris: "AQUA 600ML 24S 2 x 26.000 52.000".
    const batasNama = uang[0].i;
    const tokenNama = [];
    for (let i = 0; i < batasNama; i++) {
      if (/^\d+[xX@*]?$/.test(token[i]) && i > 0) break; // qty setelah nama
      tokenNama.push(token[i]);
    }
    const namaBaris = bersihkanNama(tokenNama);
    const punyaNama = adaKata(namaBaris);
    const pola = teks.match(/(?:^|\s)(\d{1,3})\s?(?:[xX*@]|PCS|PC|DUS|BKS|KRT|CTN|PAK|SAK|BOX)\b/) || teks.match(/[xX@*]\s?(\d{1,3})(?:\s|$)/);
    // Angka tanpa pemisah ribuan & tanpa pola qty (tahun, jam, nomor nota) bukan harga. Bila baris
    // itu punya nama ("RINSO 1000 karung", "ULTRA 250ML"), anggap baris nama untuk baris qty berikutnya.
    if (!pola && !uang.some((u) => u.pemisah)) {
      if (punyaNama) namaTertunda = { teks: bersihkanNama(token), baris: b };
      return;
    }
    if (!punyaNama && !namaTertunda) return;

    let qty = pola ? Number(pola[1]) : 1;
    if (!pola) {
      const kecil = token.slice(0, uang[0].i).filter((t) => /^\d{1,3}$/.test(t)).pop();
      if (kecil && Number(kecil) > 0) qty = Number(kecil);
    }
    qty = Math.max(1, Math.min(999, qty || 1));
    const adaKali = /[xX@*]/.test(teks);
    const harga = uang.length >= 2 || adaKali || !pola ? tentukanHarga(uang, qty) : tentukanHarga(uang, qty, { kolomTotal: true });
    // Satu angka dengan nama di baris yang sama ("AQUA 600ML 52.000") wajar; dipercaya bila nama jelas.
    if (punyaNama && uang.length === 1 && !pola && (b.yakin ?? 100) >= 70) { delete harga.ragu; delete harga.alternatif; }
    hasil.push(buatItem(harga, punyaNama ? { teks: namaBaris, baris: null } : namaTertunda, b));
    namaTertunda = null;
  });
  return hasil;
}

// ---------------------------------------------------------------------------
// 4b. Baca dua kali (ambang hitam-putih berbeda) lalu gabungkan.
//     Angka yang dibaca sama oleh kedua pembacaan / lolos cek silang harga × qty = total dianggap pasti;
//     yang tetap berbeda ditandai ragu dan harus dicek admin.
// ---------------------------------------------------------------------------
export async function bacaStrukGanda(sumber, onProgres = () => {}, { lebar } = {}) {
  const potong = cariKertas(sumber);
  const progres = [0, 0];
  const hasil = await Promise.all([0.08, 0.1].map(async (T, i) => {
    const { kanvas, skala } = siapkanGambarOcr(sumber, { potong, T, lebar });
    const ocr = await bacaTeks(kanvas, (teks, p) => {
      progres[i] = p || 0;
      onProgres(teks, (progres[0] + progres[1]) / 2);
    }, i);
    return { ocr, skala, items: uraiStruk(ocr.baris) };
  }));
  let items = gabungHasil(hasil[0].items, hasil[1].items);

  // Baris yang masih ragu / baru dibaca sekali dibaca ulang dari dua varian gambar lain.
  const perluCek = items.filter((i) => i.kotakHarga && (i.ragu || i.bacaan.length < 2)).slice(0, 40);
  if (perluCek.length) {
    onProgres("Memeriksa ulang angka yang kurang jelas...", 0);
    const hasilVarian = await Promise.all([{ T: 0.06, halus: 1 }, { T: 0.12, halus: 3 }].map((v, w) => {
      const { kanvas } = siapkanGambarOcr(sumber, { potong, lebar, ...v });
      return bacaUlangBaris(kanvas, perluCek.map((i) => i.kotakHarga), w);
    }));
    const indeksCek = new Map(perluCek.map((item, i) => [item, i]));
    items = items.map((item) => {
      if (!indeksCek.has(item)) return item;
      const ekstra = hasilVarian.map((h) => h[indeksCek.get(item)]).filter(Boolean);
      return ekstra.length ? putuskan(item, [...item.bacaan, ...ekstra]) : item;
    });
  }
  return { ocr: hasil[0].ocr, skala: hasil[0].skala, potong, items };
}

const nilaiItem = (i) => (i.ragu ? i.alternatif : [i.harga]);

// Dua hasil dianggap barang yang sama bila letak barisnya di foto saling menumpuk.
function tumpangTindih(a, b) {
  if (!a.kotak || !b.kotak) return false;
  const tumpang = Math.min(a.kotak.y1, b.kotak.y1) - Math.max(a.kotak.y0, b.kotak.y0);
  return tumpang > 0.5 * Math.min(a.kotak.y1 - a.kotak.y0, b.kotak.y1 - b.kotak.y0);
}

// Huruf dot-matrix membuat salah baca yang konsisten (6→4, 5→3), kadang di kolom harga & total
// sekaligus sehingga cek harga × qty = total tetap lolos. Karena itu hasil beberapa pembacaan
// dikumpulkan dan diputuskan lewat suara (lihat putuskan).
function satukan(u, k) {
  const qtyDari = !k.ragu && u.ragu ? k : u;
  const hasil = putuskan({ ...u, qty: qtyDari.qty, yakin: Math.max(u.yakin, k.yakin) }, [...(u.bacaan || [bacaanDari(u)]), ...(k.bacaan || [bacaanDari(k)])]);
  return hasil;
}

export function gabungHasil(utama, kedua) {
  const sisa = [...kedua];
  const gabung = utama.map((u) => {
    const idx = sisa.findIndex((k) => tumpangTindih(u, k));
    return idx < 0 ? { ...u, bacaan: [bacaanDari(u)] } : satukan(u, sisa.splice(idx, 1)[0]);
  });
  const urut = [...gabung, ...sisa.map((k) => ({ ...k, bacaan: [bacaanDari(k)] }))].sort((a, b) => (a.kotak?.y0 ?? 0) - (b.kotak?.y0 ?? 0));
  // Barang yang tetap muncul dua kali (berdampingan & menumpuk) disatukan.
  return urut.reduce((hasil, item) => {
    const akhir = hasil[hasil.length - 1];
    if (akhir && tumpangTindih(akhir, item)) hasil[hasil.length - 1] = satukan(akhir, item);
    else hasil.push(item);
    return hasil;
  }, []);
}

function buatItem(harga, nama, b) {
  const barisNama = nama.baris;
  if (harga.harga >= HARGA_MAKS_WAJAR) Object.assign(harga, { ragu: true, alternatif: harga.alternatif || [harga.harga] });
  return {
    teks: barisNama ? `${barisNama.teks} / ${b.teks}` : b.teks,
    nama: nama.teks,
    ...harga,
    yakin: Math.min(b.yakin ?? 100, barisNama?.yakin ?? 100),
    kotak: gabungKotak(b.kotak, barisNama?.kotak),
    kotakHarga: b.kotak || null
  };
}

// Ringkasan satu kali baca untuk pemungutan suara.
const bacaanDari = (i) => ({ ragu: Boolean(i.ragu), nilai: nilaiItem(i) });

// Suara: pembacaan yang lolos cek silang dua kolom = 1 suara "pasti" untuk angkanya.
// Pasti bila angka teratas didukung ≥ 2 pembacaan pasti dan tidak ada pembacaan pasti lain yang menyangkal.
function putuskan(item, bacaan) {
  const pastiPer = new Map();
  const semua = new Map();
  bacaan.forEach((b) => {
    if (!b.ragu) pastiPer.set(b.nilai[0], (pastiPer.get(b.nilai[0]) || 0) + 1);
    b.nilai.forEach((v) => semua.set(v, (semua.get(v) || 0) + (b.ragu ? 0.5 : 2)));
  });
  const urut = [...semua.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  const { ragu, alternatif, ...lain } = item;
  if (pastiPer.size === 1) {
    const [[nilai, suara]] = [...pastiPer.entries()];
    if (suara >= 2) return { ...lain, harga: nilai, total: nilai * item.qty, bacaan };
  }
  const wajar = urut.filter((v) => v < HARGA_MAKS_WAJAR);
  const kandidat = wajar.length ? wajar : urut;
  const bulat = kandidat.filter((v) => kebulatan(v) > 0);
  const pilihan = bulat.length ? bulat : kandidat;
  return { ...lain, harga: pilihan[0], ragu: true, alternatif: pilihan.slice(0, 4), bacaan };
}

// Baca ulang baris-baris harga dari gambar varian lain. Semua baris ditumpuk jadi satu gambar
// (diberi jarak) sehingga cukup satu kali baca per varian.
async function bacaUlangBaris(kanvas, kotakList, indeks) {
  const tepi = 8;
  const jarak = 40;
  const slot = [];
  let tinggi = jarak;
  kotakList.forEach((kotak) => {
    const y0 = Math.max(0, kotak.y0 - tepi);
    const y1 = Math.min(kanvas.height, kotak.y1 + tepi);
    slot.push({ sumberY: y0, tinggi: y1 - y0, y: tinggi });
    tinggi += y1 - y0 + jarak;
  });
  const tumpukan = document.createElement("canvas");
  tumpukan.width = kanvas.width;
  tumpukan.height = tinggi;
  const ctx = tumpukan.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, tumpukan.width, tumpukan.height);
  slot.forEach((s) => ctx.drawImage(kanvas, 0, s.sumberY, kanvas.width, s.tinggi, 0, s.y, kanvas.width, s.tinggi));

  const ocr = await bacaTeks(tumpukan, () => {}, indeks);
  const teksSlot = slot.map(() => []);
  ocr.baris.forEach((b) => {
    const tengah = (b.kotak.y0 + b.kotak.y1) / 2;
    const i = slot.findIndex((s) => tengah >= s.y - jarak / 2 && tengah <= s.y + s.tinggi + jarak / 2);
    if (i >= 0) teksSlot[i].push(b);
  });
  return teksSlot.map((baris) => {
    const teks = baris.map((b) => b.teks).join(" ");
    if (!teks) return null;
    // Baris qty ("2 PAK 87.000 174.000") butuh nama di atasnya → diberi nama tiruan.
    const [hasil] = uraiStruk([{ teks: "BARANG UJI", yakin: 99 }, { teks, yakin: Math.min(...baris.map((b) => b.yakin)) }]);
    return hasil ? bacaanDari(hasil) : null;
  });
}

function gabungKotak(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

// ---------------------------------------------------------------------------
// 5. Mencocokkan nama di struk dengan barang di website
// ---------------------------------------------------------------------------
const SINGKATAN = {
  GRG: "GORENG", GRNG: "GORENG", BTL: "BOTOL", KLG: "KALENG", BKS: "BUNGKUS", RTG: "RENTENG",
  MNYK: "MINYAK", MYK: "MINYAK", MNY: "MINYAK", TPG: "TEPUNG", TRG: "TERIGU", SBN: "SABUN",
  KCP: "KECAP", SMP: "SAMPO", SHP: "SAMPO", SHAMPOO: "SAMPO", DTRJN: "DETERJEN", DET: "DETERJEN",
  PSR: "PASIR", PTH: "PUTIH", CKL: "COKLAT", COKELAT: "COKLAT", ORG: "ORIGINAL", ORI: "ORIGINAL",
  SPC: "SPECIAL", SPCL: "SPECIAL", SPESIAL: "SPECIAL", MIX: "MIX", LTR: "L", LT: "L", LITER: "L",
  GRAM: "GR", G: "GR", MLT: "ML", GG: "GUDANG GARAM"
};

export function normalNama(teks) {
  let t = String(teks).toUpperCase()
    .replace(/(\d)[.,](\d)/g, "$1$2")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/(\d+)\s+(ML|L|LTR|LT|LITER|KG|GR|GRAM|G)\b/g, "$1$2");
  t = t.split(/\s+/).filter(Boolean).map((k) => {
    const m = k.match(/^(\d+)(ML|L|LTR|LT|LITER|KG|GR|GRAM|G)$/);
    if (m) return `${m[1]}${SINGKATAN[m[2]] || m[2]}`;
    if (/^\d+S$/.test(k) || /^X\d+$/.test(k)) return ""; // isi kemasan (24S, X24)
    return SINGKATAN[k] ?? k;
  }).filter(Boolean).join(" ");
  return t.trim();
}

function bigram(teks) {
  const t = ` ${teks.replace(/\s+/g, " ")} `;
  const hasil = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    hasil.set(g, (hasil.get(g) || 0) + 1);
  }
  return hasil;
}

function dice(a, b) {
  const ba = bigram(a);
  const bb = bigram(b);
  let sama = 0;
  let total = 0;
  ba.forEach((n, g) => { sama += Math.min(n, bb.get(g) || 0); total += n; });
  bb.forEach((n) => { total += n; });
  return total ? (2 * sama) / total : 0;
}

export function skorNama(namaStruk, namaBarang) {
  const a = normalNama(namaStruk);
  const b = normalNama(namaBarang);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(" ");
  const tb = b.split(" ");
  // Token struk dianggap cocok bila sama atau merupakan awalan (≥2 huruf) token barang.
  const cocok = ta.filter((x) => tb.some((y) => y === x || (x.length >= 2 && !/^\d/.test(x) && y.startsWith(x)))).length;
  const tumpang = cocok / ta.length;
  let skor = 0.55 * dice(a, b) + 0.45 * tumpang;
  // Spasi sering hilang/bertambah saat dibaca ("MAGNUMBINTANG" = "Magnum Bintang").
  skor = Math.max(skor, 0.9 * dice(a.replace(/ /g, ""), b.replace(/ /g, "")));
  // Ukuran berbeda (600ML vs 1500ML) → hampir pasti barang lain.
  const ukuran = (t) => t.filter((x) => /^\d+(ML|L|KG|GR)$/.test(x));
  const ua = ukuran(ta);
  const ub = ukuran(tb);
  if (ua.length && ub.length && !ua.some((x) => ub.includes(x))) skor *= 0.35;
  return Math.round(skor * 100) / 100;
}

export function kunciAlias(namaStruk) {
  return normalNama(namaStruk).replace(/\s+/g, " ").slice(0, 80);
}

// barang: [{ id, nama, harga, isiPerSatuan, satuan, hargaJual, hargaSatuan }]
// alias: { [kunciAlias]: barangId }
export function cocokkanBarang(item, barang, alias = {}) {
  const kunci = kunciAlias(item.nama);
  // Hasil baca bisa sedikit berbeda tiap foto ("JAZY MAX FIL" / "1AZV MAY FIL"), jadi ingatan
  // dicocokkan juga secara mirip, bukan hanya persis.
  let idAlias = alias[kunci];
  if (!idAlias && kunci.length >= 5) {
    let terbaik = 0.8;
    Object.entries(alias).forEach(([k, id]) => {
      const skor = dice(k, kunci);
      if (skor >= terbaik) { terbaik = skor; idAlias = id; }
    });
  }
  const dariAlias = idAlias && barang.find((b) => b.id === idAlias);
  const kandidat = barang
    .map((b) => ({ barang: b, skor: skorNama(item.nama, b.nama) }))
    .filter((k) => k.skor >= 0.3)
    .sort((x, y) => y.skor - x.skor)
    .slice(0, 5);
  if (dariAlias) return { terpilih: dariAlias, sumber: "alias", skor: 1, kandidat };
  const terbaik = kandidat[0];
  if (terbaik && terbaik.skor >= 0.55) return { terpilih: terbaik.barang, sumber: "mirip", skor: terbaik.skor, kandidat };
  return { terpilih: null, sumber: null, skor: terbaik?.skor || 0, kandidat };
}

// Harga di struk dibandingkan dengan harga modal barang (per satuan kemasan).
// - Angka ragu (dua kemungkinan) → dipilih yang paling dekat dengan harga lama.
// - Struk per pcs sedangkan barang per dus → dikalikan isi per dus.
// - Struk per pak/slop sedangkan barang per pcs → ditebak dibagi 10/12/20/24/40/48 (tebakan, perlu dicek).
export function hitungPerubahan(item, barang) {
  const lama = Number(barang.harga) || 0;
  const isi = Math.max(1, Number(barang.isiPerSatuan) || 1);
  let hargaStruk = item.harga;
  if (lama > 0 && item.alternatif?.length) {
    hargaStruk = item.alternatif.reduce((a, b) => (Math.abs(b - lama) < Math.abs(a - lama) ? b : a));
  }
  let baru = hargaStruk;
  let konversi = null;
  let tebakan = false;
  if (lama > 0) {
    const selisihLangsung = Math.abs(hargaStruk - lama) / lama;
    const selisihPerPcs = Math.abs(hargaStruk * isi - lama) / lama;
    if (isi > 1 && selisihPerPcs < selisihLangsung && selisihPerPcs < 0.35) {
      baru = Math.round(hargaStruk * isi);
      konversi = `harga struk per pcs × ${isi} = per ${barang.satuan}`;
    } else if (isi === 1 && selisihLangsung > 0.4) {
      const pilihan = [10, 12, 20, 24, 40, 48]
        .map((n) => ({ n, selisih: Math.abs(hargaStruk / n - lama) / lama }))
        .sort((a, b) => a.selisih - b.selisih)[0];
      if (pilihan.selisih < 0.15) {
        baru = Math.round(hargaStruk / pilihan.n);
        konversi = `tebakan: harga struk ÷ ${pilihan.n} = per ${barang.satuan}`;
        tebakan = true;
      }
    }
  }
  const selisih = baru - lama;
  const persen = lama > 0 ? (selisih / lama) * 100 : 0;
  return {
    lama,
    baru,
    selisih,
    persen,
    arah: selisih > 0 ? "naik" : selisih < 0 ? "turun" : "tetap",
    konversi,
    tebakan,
    mencurigakan: lama > 0 && Math.abs(persen) > 40
  };
}

// ---------------------------------------------------------------------------
// 6. Foto struk bertanda (tag ▲ naik / ▼ turun pada baris yang berubah)
// ---------------------------------------------------------------------------
// tanda: [{ kotak (koordinat gambar OCR), arah, label }], skalaOcr: skala gambar OCR terhadap foto asli
export function gambarBertag(sumber, tanda, { skalaOcr = 1, potong = { x: 0, y: 0 }, judul = "" } = {}) {
  const lebarAsli = sumber.naturalWidth || sumber.width;
  const tinggiAsli = sumber.naturalHeight || sumber.height;
  const skala = Math.min(1, 1600 / lebarAsli);
  const kepala = 64;
  const kanvas = document.createElement("canvas");
  kanvas.width = Math.round(lebarAsli * skala);
  kanvas.height = Math.round(tinggiAsli * skala) + kepala;
  const ctx = kanvas.getContext("2d");
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, kanvas.width, kepala);
  ctx.drawImage(sumber, 0, kepala, kanvas.width, kanvas.height - kepala);

  const naik = tanda.filter((t) => t.arah === "naik").length;
  const turun = tanda.filter((t) => t.arah === "turun").length;
  ctx.font = "600 22px 'IBM Plex Mono', monospace";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f3eee2";
  ctx.fillText(judul || "Struk belanja", 18, kepala / 2);
  const ringkas = `▲ ${naik} naik   ▼ ${turun} turun`;
  ctx.fillStyle = "#ff5a1f";
  ctx.fillText(ringkas, kanvas.width - ctx.measureText(ringkas).width - 18, kepala / 2);

  const k = skala / skalaOcr; // koordinat OCR → koordinat kanvas
  const geserX = potong.x * skala;
  const geserY = potong.y * skala;
  tanda.forEach((t) => {
    if (!t.kotak) return;
    const warna = t.arah === "naik" ? "#d62f2f" : t.arah === "turun" ? "#2f8f4e" : "#857e70";
    const x = t.kotak.x0 * k + geserX - 6;
    const y = t.kotak.y0 * k + geserY + kepala - 6;
    const w = (t.kotak.x1 - t.kotak.x0) * k + 12;
    const h = (t.kotak.y1 - t.kotak.y0) * k + 12;
    ctx.lineWidth = 4;
    ctx.strokeStyle = warna;
    ctx.strokeRect(x, y, w, h);
    ctx.font = "600 20px 'IBM Plex Mono', monospace";
    const teks = t.label;
    const lebarTeks = ctx.measureText(teks).width + 16;
    const tx = Math.min(Math.max(0, x + w - lebarTeks), kanvas.width - lebarTeks);
    const ty = Math.max(kepala, y - 30);
    ctx.fillStyle = warna;
    ctx.fillRect(tx, ty, lebarTeks, 28);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(teks, tx + 8, ty + 14);
  });
  return kanvas;
}
