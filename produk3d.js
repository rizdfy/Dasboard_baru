// Gambar produk 3D untuk etalase pembeli (Three.js).
// - gambarProduk(): gambar untuk kartu produk. Urutan prioritas:
//     1. aset sendiri di folder aset-produk/ (model .glb/.gltf/.obj atau foto .jpg/.png/.webp),
//        terdaftar di aset-produk/daftar.json, dicocokkan lewat nama barang;
//     2. model 3D otomatis per jenis kemasan (botol, kaleng, karung, bungkus, kotak).
//   Satu renderer dipakai bergantian untuk semua kartu, hasilnya di-cache.
// - pasangPratinjau(): saat kartu disorot mouse, model 3D hidup berputar mengikuti kursor
//   (foto tampil sebagai kartu 3D yang miring mengikuti kursor).

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
// Loader model memakai "three" lewat import map di index.html.
const ADDONS_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/";
const FOLDER_ASET = "aset-produk/";
const EKSTENSI_FOTO = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
const EKSTENSI_MODEL = ["glb", "gltf", "obj"];
const UKURAN_GAMBAR = 360;

// Warna kemasan dipilih tetap per nama produk agar konsisten setiap kali dibuka.
const PALET = [0xff5a1f, 0x111111, 0x2f8f4e, 0x1f6fd1, 0xd62f2f, 0xe6b325, 0x7a4fd1, 0x17a2b8];

let THREE = null;
let siap = null;
let rendererGambar = null;
const cacheGambar = new Map();

export function warnaUntuk(nama) {
  let hash = 0;
  for (const huruf of String(nama)) hash = (hash * 31 + huruf.charCodeAt(0)) >>> 0;
  return PALET[hash % PALET.length];
}

function muatThree() {
  if (!siap) {
    siap = import(THREE_URL).then((modul) => {
      THREE = modul;
      return modul;
    });
  }
  return siap;
}

function buatAdegan() {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const cahaya = new THREE.DirectionalLight(0xffffff, 1.6);
  cahaya.position.set(3, 4, 5);
  scene.add(cahaya);
  const cahayaBelakang = new THREE.DirectionalLight(0xffffff, 0.5);
  cahayaBelakang.position.set(-4, 2, -3);
  scene.add(cahayaBelakang);
  const cahayaOranye = new THREE.PointLight(0xff5a1f, 6, 12);
  cahayaOranye.position.set(-3, -2, 3);
  scene.add(cahayaOranye);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.7, 8.2);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}

function bahan(warna, opsi = {}) {
  return new THREE.MeshStandardMaterial({ color: warna, roughness: 0.45, metalness: 0.08, ...opsi });
}

function garisTepi(geo, opacity = 0.18) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 30),
    new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity })
  );
}

// ---------- Label dari foto produk ----------
// Foto ditempel sebagai label pada model kemasan (opsi "foto jadi label 3D").
function rasioTekstur(tekstur) {
  return (tekstur.image?.width || 1) / (tekstur.image?.height || 1);
}

function bahanLabel(tekstur) {
  return new THREE.MeshStandardMaterial({ map: tekstur, roughness: 0.4, metalness: 0.05, transparent: true });
}

// Label datar (karung, bungkus, dus): sebesar mungkin di dalam kotak maks, rasio foto dijaga.
function labelDatar(tekstur, maksLebar, maksTinggi) {
  const rasio = rasioTekstur(tekstur);
  const [lebar, tinggi] = rasio > maksLebar / maksTinggi ? [maksLebar, maksLebar / rasio] : [maksTinggi * rasio, maksTinggi];
  return new THREE.Mesh(new THREE.PlaneGeometry(lebar, tinggi), bahanLabel(tekstur));
}

// Label melengkung mengikuti badan silinder (botol, kaleng), menghadap ke depan.
function labelLengkung(tekstur, jariJari, maksTinggi, maksSudut = 2.4) {
  const rasio = rasioTekstur(tekstur);
  let tinggi = maksTinggi;
  let sudut = (tinggi * rasio) / jariJari;
  if (sudut > maksSudut) {
    sudut = maksSudut;
    tinggi = (sudut * jariJari) / rasio;
  }
  return new THREE.Mesh(
    new THREE.CylinderGeometry(jariJari, jariJari, tinggi, 40, 1, true, -sudut / 2, sudut),
    bahanLabel(tekstur)
  );
}

// ---------- Model per jenis kemasan ----------
function modelBotol(warna, tekstur = null) {
  const grup = new THREE.Group();
  const profil = [
    [0.0, -1.45], [0.58, -1.45], [0.62, -1.35], [0.62, 0.35], [0.55, 0.65],
    [0.32, 0.95], [0.26, 1.05], [0.26, 1.3], [0.0, 1.3]
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const badan = new THREE.Mesh(
    new THREE.LatheGeometry(profil, 40),
    bahan(0xdfeef2, { transparent: true, opacity: 0.82, roughness: 0.15 })
  );
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.635, 0.635, 0.95, 40, 1, true), bahan(warna, { side: THREE.DoubleSide }));
  label.position.y = -0.45;
  const tutup = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.34, 28), bahan(warna === 0x111111 ? 0xff5a1f : 0x111111));
  tutup.position.y = 1.45;
  grup.add(badan, label, tutup);
  if (tekstur) {
    const foto = labelLengkung(tekstur, 0.645, 1.45);
    foto.position.y = -0.5;
    grup.add(foto);
  }
  return grup;
}

function modelKaleng(warna, tekstur = null) {
  const grup = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.78, 0.78, 2.2, 40);
  const badan = new THREE.Mesh(geo, bahan(warna, { metalness: 0.55, roughness: 0.3 }));
  const perak = bahan(0xcfd3d6, { metalness: 0.8, roughness: 0.25 });
  const atas = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.06, 10, 40), perak);
  atas.rotation.x = Math.PI / 2;
  atas.position.y = 1.1;
  const bawah = atas.clone();
  bawah.position.y = -1.1;
  const pita = new THREE.Mesh(new THREE.CylinderGeometry(0.785, 0.785, 0.45, 40, 1, true), bahan(0xf3eee2, { side: THREE.DoubleSide }));
  pita.position.y = 0.1;
  grup.add(badan, atas, bawah, pita);
  if (tekstur) grup.add(labelLengkung(tekstur, 0.795, 1.8));
  return grup;
}

function modelKarung(warna, tekstur = null) {
  const grup = new THREE.Group();
  const badanGeo = new THREE.SphereGeometry(1, 36, 24);
  const badan = new THREE.Mesh(badanGeo, bahan(0xeee6d2, { roughness: 0.9 }));
  badan.scale.set(1.0, 1.3, 0.62);
  const ikat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.42, 16), bahan(0xd8cdb2, { roughness: 0.9 }));
  ikat.position.y = 1.38;
  const tali = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 20), bahan(warna));
  tali.rotation.x = Math.PI / 2;
  tali.position.y = 1.3;
  if (tekstur) {
    const foto = labelDatar(tekstur, 1.25, 1.45);
    foto.position.set(0, -0.05, 0.64);
    grup.add(badan, ikat, tali, foto);
    return grup;
  }
  const labelGeo = new THREE.BoxGeometry(1.15, 0.85, 0.05);
  const label = new THREE.Mesh(labelGeo, bahan(warna));
  label.position.set(0, -0.05, 0.6);
  grup.add(badan, ikat, tali, label);
  return grup;
}

function modelBungkus(warna, tekstur = null) {
  const grup = new THREE.Group();
  const bentuk = new THREE.Shape();
  const w = 0.95;
  const h = 1.25;
  const r = 0.18;
  bentuk.moveTo(-w + r, -h);
  bentuk.lineTo(w - r, -h);
  bentuk.quadraticCurveTo(w, -h, w, -h + r);
  bentuk.lineTo(w, h - r);
  bentuk.quadraticCurveTo(w, h, w - r, h);
  bentuk.lineTo(-w + r, h);
  bentuk.quadraticCurveTo(-w, h, -w, h - r);
  bentuk.lineTo(-w, -h + r);
  bentuk.quadraticCurveTo(-w, -h, -w + r, -h);
  const geo = new THREE.ExtrudeGeometry(bentuk, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.1, bevelSegments: 6, curveSegments: 8 });
  geo.center();
  const badan = new THREE.Mesh(geo, bahan(warna, { roughness: 0.3, metalness: 0.15 }));
  const jahit = bahan(warna === 0x111111 ? 0x333333 : 0xf3eee2, { roughness: 0.6 });
  const atas = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 0.12), jahit);
  atas.position.y = 1.32;
  const bawah = atas.clone();
  bawah.position.y = -1.32;
  if (tekstur) {
    const foto = labelDatar(tekstur, 1.75, 2.3);
    foto.position.set(0, 0, 0.27);
    grup.add(badan, atas, bawah, foto);
    return grup;
  }
  const jendela = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), bahan(0xf3eee2, { roughness: 0.4 }));
  jendela.position.set(0, 0.05, 0.27);
  grup.add(badan, atas, bawah, jendela);
  return grup;
}

function modelKotak(warna, tekstur = null) {
  const grup = new THREE.Group();
  const geo = new THREE.BoxGeometry(2.1, 1.55, 1.45);
  const badan = new THREE.Mesh(geo, bahan(0xc9a27a, { roughness: 0.85 }));
  const selotip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 1.47), bahan(0xb08a62, { roughness: 0.5 }));
  selotip.position.y = 0.78;
  const label = tekstur ? labelDatar(tekstur, 1.85, 1.35) : new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.02), bahan(warna));
  label.position.set(0, -0.05, tekstur ? 0.731 : 0.735);
  grup.add(badan, garisTepi(geo, 0.3), selotip, label);
  return grup;
}

// tekstur (opsional) = foto produk yang ditempel sebagai label.
export function buatModel(jenis, warna, tekstur = null) {
  switch (jenis) {
    case "botol": return modelBotol(warna, tekstur);
    case "kaleng": return modelKaleng(warna, tekstur);
    case "karung": return modelKarung(warna, tekstur);
    case "bungkus": return modelBungkus(warna, tekstur);
    default: return modelKotak(warna, tekstur);
  }
}

function buangModel(model) {
  if (model.userData.bersama) return; // model dari aset dipakai ulang (cache), jangan dibuang
  model.traverse((obj) => {
    obj.geometry?.dispose();
    if (obj.material) [].concat(obj.material).forEach((m) => m.dispose());
  });
}

// ---------- Aset produk sendiri (aset-produk/daftar.json) ----------
// daftar.json boleh berupa:
//   ["aqua-300ml.glb", "indomie-goreng.png", "gula-pasir-1kg.obj", "gula-pasir-1kg.mtl"]
//     → dicocokkan dengan nama barang yang diubah jadi "slug" (huruf kecil, spasi jadi tanda -)
//   {"Aqua 300ml": "aqua.glb", "Indomie Goreng": "https://alamat-lain/indomie.png"}
//     → nama barang ditulis bebas, nilai boleh nama file di folder atau alamat lengkap (https://)
let daftarAset = null;

export function slugNama(nama) {
  return String(nama)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function alamatAset(file) {
  if (/^https?:\/\//i.test(file)) return file;
  return FOLDER_ASET + file.split("/").map(encodeURIComponent).join("/");
}

async function muatDaftarAset() {
  if (daftarAset) return daftarAset;
  daftarAset = (async () => {
    const peta = new Map();
    try {
      const res = await fetch(`${FOLDER_ASET}daftar.json`, { cache: "no-cache" });
      if (!res.ok) return peta;
      const data = await res.json();
      // Bentuk objek boleh berisi beberapa file per barang: {"Gula": ["gula.obj", "gula.mtl"]}
      const pasangan = Array.isArray(data)
        ? data.map((file) => [String(file).replace(/\.[^.\/]+$/, ""), String(file)])
        : Object.entries(data).flatMap(([nama, file]) => [].concat(file).map((f) => [nama, String(f)]));

      const mtl = new Map();
      pasangan.forEach(([nama, file]) => {
        const ext = file.split("?")[0].split(".").pop().toLowerCase();
        if (ext === "mtl") mtl.set(slugNama(nama), alamatAset(file));
      });
      pasangan.forEach(([nama, file]) => {
        const ext = file.split("?")[0].split(".").pop().toLowerCase();
        const jenis = EKSTENSI_MODEL.includes(ext) ? "model" : EKSTENSI_FOTO.includes(ext) ? "foto" : null;
        if (!jenis) return;
        const slug = slugNama(nama);
        const lama = peta.get(slug);
        if (lama && !(lama.jenis === "foto" && jenis === "model")) return; // model 3D diutamakan
        peta.set(slug, { file, url: alamatAset(file), jenis, ext, mtl: ext === "obj" ? mtl.get(slug) || null : null });
      });
    } catch (error) {
      console.info("Tidak ada aset produk khusus (aset-produk/daftar.json); memakai model otomatis.");
    }
    return peta;
  })();
  return daftarAset;
}

export async function asetUntuk(nama) {
  return (await muatDaftarAset()).get(slugNama(nama)) || null;
}

// Model dari file diperkecil/diperbesar & dipusatkan agar ukurannya seragam dengan model otomatis.
function normalkanModel(objek) {
  const kotak = new THREE.Box3().setFromObject(objek);
  const ukuran = kotak.getSize(new THREE.Vector3());
  const pusat = kotak.getCenter(new THREE.Vector3());
  const terbesar = Math.max(ukuran.x, ukuran.y, ukuran.z) || 1;
  objek.position.sub(pusat);
  const grup = new THREE.Group();
  grup.add(objek);
  grup.scale.setScalar(3 / terbesar);
  grup.userData.bersama = true;
  return grup;
}

const cacheModelAset = new Map();
function muatModelAset(aset) {
  if (!cacheModelAset.has(aset.url)) {
    cacheModelAset.set(aset.url, (async () => {
      await muatThree();
      let objek;
      if (aset.ext === "obj") {
        const { OBJLoader } = await import(`${ADDONS_URL}loaders/OBJLoader.js`);
        const loader = new OBJLoader();
        if (aset.mtl) {
          const { MTLLoader } = await import(`${ADDONS_URL}loaders/MTLLoader.js`);
          const bahanMtl = await new MTLLoader().loadAsync(aset.mtl);
          bahanMtl.preload();
          loader.setMaterials(bahanMtl);
        }
        objek = await loader.loadAsync(aset.url);
        // OBJ tanpa .mtl: beri bahan netral agar tidak tampil polos putih.
        if (!aset.mtl) objek.traverse((o) => { if (o.isMesh) o.material = bahan(0xd9d2c3, { roughness: 0.6 }); });
      } else {
        const { GLTFLoader } = await import(`${ADDONS_URL}loaders/GLTFLoader.js`);
        objek = (await new GLTFLoader().loadAsync(aset.url)).scene;
      }
      return normalkanModel(objek);
    })());
  }
  return cacheModelAset.get(aset.url);
}

// Foto produk dimuat sebagai tekstur (dipakai ulang), lalu ditempel jadi label kemasan 3D.
const cacheTekstur = new Map();
export function muatTeksturFoto(url) {
  if (!cacheTekstur.has(url)) {
    cacheTekstur.set(url, (async () => {
      await muatThree();
      const tekstur = await new THREE.TextureLoader().loadAsync(url);
      tekstur.colorSpace = THREE.SRGBColorSpace;
      tekstur.anisotropy = 4;
      return tekstur;
    })().catch((error) => {
      cacheTekstur.delete(url);
      throw error;
    }));
  }
  return cacheTekstur.get(url);
}

// Model untuk satu produk: aset model sendiri, kemasan otomatis berlabel foto, atau kemasan otomatis.
// Dipakai etalase & pratinjau di panel admin.
export async function modelProduk({ jenis, nama, aset }) {
  await muatThree();
  if (aset?.jenis === "model") return (await muatModelAset(aset)).clone(true);
  if (aset?.jenis === "foto") return buatModel(jenis, warnaUntuk(nama), await muatTeksturFoto(aset.url));
  return buatModel(jenis, warnaUntuk(nama));
}

// ---------- Gambar diam (untuk semua kartu) ----------
let adeganGambar = null;

async function siapkanRendererGambar() {
  await muatThree();
  if (!rendererGambar) {
    rendererGambar = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    rendererGambar.setPixelRatio(1);
    rendererGambar.setSize(UKURAN_GAMBAR, UKURAN_GAMBAR, false);
    rendererGambar.setClearColor(0x000000, 0);
    adeganGambar = buatAdegan();
  }
}

function renderKeGambar(model) {
  model.rotation.set(0.12, -0.55, 0);
  adeganGambar.scene.add(model);
  rendererGambar.render(adeganGambar.scene, adeganGambar.camera);
  const url = rendererGambar.domElement.toDataURL("image/png");
  adeganGambar.scene.remove(model);
  buangModel(model);
  return url;
}

// Hasil: { url, jenis: "foto" | "model" | "otomatis" }
export async function gambarProduk(jenis, nama) {
  const aset = await asetUntuk(nama);
  if (aset?.jenis === "model" || aset?.jenis === "foto") {
    const kunci = `aset|${aset.url}|${jenis}`;
    if (!cacheGambar.has(kunci)) {
      try {
        const model = await modelProduk({ jenis, nama, aset });
        await siapkanRendererGambar();
        cacheGambar.set(kunci, renderKeGambar(model));
      } catch (error) {
        console.warn(`Aset "${aset.file}" gagal dimuat; memakai model otomatis.`, error);
        cacheModelAset.delete(aset.url);
        aset.jenis = "gagal";
      }
    }
    if (cacheGambar.has(kunci)) return { url: cacheGambar.get(kunci), jenis: aset.jenis };
  }

  const warna = warnaUntuk(nama);
  const kunci = `${jenis}|${warna}`;
  if (!cacheGambar.has(kunci)) {
    await siapkanRendererGambar();
    cacheGambar.set(kunci, renderKeGambar(buatModel(jenis, warna)));
  }
  return { url: cacheGambar.get(kunci), jenis: "otomatis" };
}

// ---------- Untuk panel admin: pratinjau file sebelum diunggah ----------
// Membuat objek "aset" dari file yang dipilih di perangkat (belum diunggah).
export function asetDariFile(files) {
  const daftar = [...files];
  const ekstensi = (f) => f.name.split(".").pop().toLowerCase();
  const utama = daftar.find((f) => EKSTENSI_MODEL.includes(ekstensi(f))) || daftar.find((f) => EKSTENSI_FOTO.includes(ekstensi(f)));
  if (!utama) return null;
  const ext = ekstensi(utama);
  const mtl = ext === "obj" ? daftar.find((f) => ekstensi(f) === "mtl") : null;
  return {
    file: utama.name,
    url: URL.createObjectURL(utama),
    jenis: EKSTENSI_MODEL.includes(ext) ? "model" : "foto",
    ext,
    mtl: mtl ? URL.createObjectURL(mtl) : null
  };
}

// Daftar aset dibaca ulang (mis. setelah admin mengunggah aset baru).
export function aturUlangDaftarAset() {
  daftarAset = null;
}

// Penampil kecil: model berputar pelan di dalam kanvas.
export async function buatPenampil(canvas) {
  await muatThree();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const { scene, camera } = buatAdegan();
  let model = null;
  let berjalan = false;
  let waktu = 0;
  let terakhir = 0;

  function ukur() {
    const lebar = canvas.clientWidth || 260;
    const tinggi = canvas.clientHeight || 260;
    renderer.setSize(lebar, tinggi, false);
    camera.aspect = lebar / tinggi;
    camera.updateProjectionMatrix();
  }

  function loop(sekarang) {
    if (!berjalan) return;
    const delta = Math.min((sekarang - terakhir) / 1000 || 0, 0.05);
    terakhir = sekarang;
    waktu += delta;
    if (model) {
      model.rotation.set(0.12, -0.55 + waktu * 0.7, 0);
      model.position.y = Math.sin(waktu * 2) * 0.05;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  return {
    tampilkan(baru) {
      if (model) {
        scene.remove(model);
        buangModel(model);
      }
      model = baru;
      if (model) scene.add(model);
      ukur();
      if (!berjalan) {
        berjalan = true;
        terakhir = performance.now();
        requestAnimationFrame(loop);
      }
    },
    hentikan() {
      berjalan = false;
      if (model) {
        scene.remove(model);
        buangModel(model);
        model = null;
      }
    }
  };
}

// ---------- Pratinjau hidup saat kartu disorot ----------
export async function pasangPratinjau(grid) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  await muatThree();

  const canvas = document.createElement("canvas");
  canvas.className = "produk-3d-hidup";
  canvas.setAttribute("aria-hidden", "true");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (error) {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const { scene, camera } = buatAdegan();

  let kartuAktif = null;
  let model = null;
  let berjalan = false;
  const target = { x: 0, y: 0 };
  let waktu = 0;
  let terakhir = 0;

  function lepas() {
    if (model) {
      scene.remove(model);
      buangModel(model);
      model = null;
    }
    kartuAktif?.classList.remove("hidup");
    canvas.remove();
    kartuAktif = null;
    berjalan = false;
  }

  function loop(sekarang) {
    if (!berjalan || !model) return;
    const delta = Math.min((sekarang - terakhir) / 1000 || 0, 0.05);
    terakhir = sekarang;
    waktu += delta;
    // Foto hanya dimiringkan mengikuti kursor (tidak diputar sampai terlihat belakangnya).
    const putar = model.userData.foto ? target.x * 0.45 : -0.55 + target.x * 0.9 + waktu * 0.6;
    model.rotation.y += (putar - model.rotation.y) * 0.08;
    model.rotation.x += ((model.userData.foto ? target.y * 0.3 : 0.12 + target.y * 0.35) - model.rotation.x) * 0.08;
    model.position.y = Math.sin(waktu * 2) * 0.06;
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  // Model untuk kartu: aset sendiri (salinan dari cache), kemasan berlabel foto, atau model otomatis.
  async function modelUntukKartu(kartu) {
    const aset = await asetUntuk(kartu.dataset.nama);
    try {
      return await modelProduk({ jenis: kartu.dataset.jenis, nama: kartu.dataset.nama, aset });
    } catch (error) {
      console.warn(`Aset "${aset?.file}" gagal dimuat untuk pratinjau.`, error);
      return buatModel(kartu.dataset.jenis, warnaUntuk(kartu.dataset.nama));
    }
  }

  grid.addEventListener("pointerover", async (event) => {
    const kartu = event.target.closest?.(".produk-kartu");
    if (!kartu || kartu === kartuAktif) return;
    lepas();
    const wadah = kartu.querySelector(".produk-gambar");
    if (!wadah) return;
    kartuAktif = kartu;
    const baru = await modelUntukKartu(kartu);
    if (kartuAktif !== kartu) {
      buangModel(baru); // kursor sudah pindah ke kartu lain selama memuat
      return;
    }
    const kotak = wadah.getBoundingClientRect();
    renderer.setSize(Math.round(kotak.width), Math.round(kotak.height), false);
    camera.aspect = kotak.width / kotak.height;
    camera.updateProjectionMatrix();
    model = baru;
    model.rotation.set(model.userData.foto ? 0 : 0.12, model.userData.foto ? 0 : -0.55, 0);
    scene.add(model);
    wadah.appendChild(canvas);
    kartu.classList.add("hidup");
    waktu = 0;
    berjalan = true;
    terakhir = performance.now();
    requestAnimationFrame(loop);
  });

  grid.addEventListener("pointermove", (event) => {
    if (!kartuAktif) return;
    const kotak = kartuAktif.getBoundingClientRect();
    target.x = ((event.clientX - kotak.left) / kotak.width) * 2 - 1;
    target.y = ((event.clientY - kotak.top) / kotak.height) * 2 - 1;
  });

  grid.addEventListener("pointerout", (event) => {
    if (!kartuAktif) return;
    if (event.relatedTarget && kartuAktif.contains(event.relatedTarget)) return;
    lepas();
  });
}
