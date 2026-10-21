// Adegan 3D halaman pemeliharaan (dimuat hanya saat maintenance-config.json = true):
// tiga roda gigi yang saling mengait (hitam, oranye, garis), cincin progres oranye, balok-balok kecil
// yang mengorbit, dan bidang titik bergelombang. Mengikuti kursor / kemiringan; klik atau sentuh =
// roda berputar kencang dan balok terlempar lalu kembali.
// Hemat: berhenti saat tab tersembunyi, statis bila pengguna memilih "kurangi gerakan".

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
const TINTA = 0x111111;
const ABU = 0x6b655a;
const ORANYE = 0xff5a1f;
const MODUL = 0.2; // ukuran gigi; jari-jari jarak bagi = MODUL × jumlah gigi / 2

// Bentuk 2D roda gigi: gigi trapesium, lubang poros & lubang jari-jari dekoratif.
function bentukRodaGigi(THREE, gigi, { lubangJari = 5 } = {}) {
  const r = (MODUL * gigi) / 2;
  const luar = r + MODUL * 0.95;
  const dalam = r - MODUL * 1.15;
  const poros = Math.max(0.12, r * 0.22);
  const langkah = (Math.PI * 2) / gigi;
  const bentuk = new THREE.Shape();
  for (let i = 0; i < gigi; i++) {
    const a = i * langkah;
    [[dalam, 0], [luar, 0.13], [luar, 0.37], [dalam, 0.5], [dalam, 0.66], [dalam, 0.83]].forEach(([jari, t], j) => {
      const sudut = a + t * langkah;
      const x = Math.cos(sudut) * jari;
      const y = Math.sin(sudut) * jari;
      if (i === 0 && j === 0) bentuk.moveTo(x, y);
      else bentuk.lineTo(x, y);
    });
  }
  bentuk.closePath();
  const lubang = new THREE.Path();
  lubang.absarc(0, 0, poros, 0, Math.PI * 2, true);
  bentuk.holes.push(lubang);
  // Lubang jari-jari hanya bila badan roda cukup lebar.
  const ruang = dalam - poros;
  if (lubangJari && ruang > 0.35) {
    const tengah = poros + ruang / 2;
    const jari = ruang * 0.3;
    for (let i = 0; i < lubangJari; i++) {
      const sudut = (i / lubangJari) * Math.PI * 2;
      const p = new THREE.Path();
      p.absarc(Math.cos(sudut) * tengah, Math.sin(sudut) * tengah, jari, 0, Math.PI * 2, true);
      bentuk.holes.push(p);
    }
  }
  return { bentuk, r, langkah };
}

function geometriRoda(THREE, gigi, tebal, opsi) {
  const { bentuk, r, langkah } = bentukRodaGigi(THREE, gigi, opsi);
  const geo = new THREE.ExtrudeGeometry(bentuk, {
    depth: tebal,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 1,
    curveSegments: 18
  });
  geo.translate(0, 0, -tebal / 2);
  return { geo, r, langkah };
}

export async function mulaiPerbaikan3D(kanvas) {
  const THREE = await import(THREE_URL);
  const geraknyaDikurangi = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: kanvas, antialias: true, alpha: true });
  } catch (error) {
    console.warn("WebGL tidak tersedia; halaman pemeliharaan tanpa 3D.", error);
    return { hentikan() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const lampu = new THREE.DirectionalLight(0xfff4e6, 2.2);
  lampu.position.set(-4, 6, 8);
  scene.add(lampu);
  const lampuBelakang = new THREE.DirectionalLight(0xffd2bd, 0.8);
  lampuBelakang.position.set(5, -3, -4);
  scene.add(lampuBelakang);

  // ---------- Roda gigi ----------
  const rakit = new THREE.Group(); // ikut kursor
  scene.add(rakit);
  const mesin = new THREE.Group(); // roda + cincin, digeser sesuai ukuran layar
  rakit.add(mesin);

  const bahanHitam = new THREE.MeshStandardMaterial({ color: TINTA, roughness: 0.55, metalness: 0.25, flatShading: true });
  const bahanOranye = new THREE.MeshStandardMaterial({ color: ORANYE, roughness: 0.45, metalness: 0.1, flatShading: true });

  const A = geometriRoda(THREE, 14, 0.38);
  const B = geometriRoda(THREE, 9, 0.42);
  const C = geometriRoda(THREE, 7, 0.3, { lubangJari: 0 });

  const rodaA = new THREE.Mesh(A.geo, bahanHitam);
  const rodaB = new THREE.Mesh(B.geo, bahanOranye);
  // Roda ketiga hanya garis tepi (gaya wireframe).
  const rodaC = new THREE.LineSegments(new THREE.EdgesGeometry(C.geo, 25), new THREE.LineBasicMaterial({ color: TINTA }));
  // Garis tepi krem tipis di roda hitam agar bentuknya tegas.
  rodaA.add(new THREE.LineSegments(new THREE.EdgesGeometry(A.geo, 30), new THREE.LineBasicMaterial({ color: 0x3a3631 })));

  // Posisi & fase agar gigi benar-benar saling mengait:
  // gigi roda penggerak menghadap celah roda yang digerakkan pada garis pusat keduanya.
  const arahAB = THREE.MathUtils.degToRad(-38);
  rodaB.position.set(Math.cos(arahAB) * (A.r + B.r), Math.sin(arahAB) * (A.r + B.r), 0.05);
  const faseA = arahAB - 0.25 * A.langkah;
  const faseB = arahAB + Math.PI - 0.75 * B.langkah;
  // Roda C mengait roda B pada salah satu gigi B yang mengarah ke kanan atas.
  const k = Math.round((THREE.MathUtils.degToRad(40) - faseB) / B.langkah - 0.25);
  const arahBC = faseB + (k + 0.25) * B.langkah;
  rodaC.position.set(
    rodaB.position.x + Math.cos(arahBC) * (B.r + C.r),
    rodaB.position.y + Math.sin(arahBC) * (B.r + C.r),
    -0.1
  );
  const faseC = arahBC + Math.PI - 0.75 * C.langkah;
  mesin.add(rodaA, rodaB, rodaC);

  // Cincin progres (busur 270°) mengelilingi roda besar.
  const cincin = new THREE.Mesh(
    new THREE.TorusGeometry(A.r + 0.75, 0.018, 8, 160, Math.PI * 1.5),
    new THREE.MeshBasicMaterial({ color: ORANYE })
  );
  cincin.rotation.x = 0.25;
  mesin.add(cincin);
  const cincinTipis = new THREE.Mesh(
    new THREE.TorusGeometry(A.r + 1.05, 0.006, 6, 160),
    new THREE.MeshBasicMaterial({ color: ABU, transparent: true, opacity: 0.45 })
  );
  cincinTipis.rotation.x = -0.35;
  mesin.add(cincinTipis);

  // Titik tengah sistem roda (untuk orbit balok).
  const pusat = new THREE.Vector3().addVectors(rodaA.position, rodaB.position).multiplyScalar(0.5);
  mesin.children.forEach((anak) => anak.position.sub(pusat));

  // ---------- Balok mengorbit ----------
  const balok = [];
  const geoBalok = new THREE.BoxGeometry(1, 1, 1);
  const bahanBalok = [
    bahanOranye,
    bahanHitam,
    new THREE.MeshBasicMaterial({ color: TINTA, wireframe: true })
  ];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(geoBalok, bahanBalok[i % 3]);
    const ukuran = 0.1 + Math.random() * 0.16;
    m.scale.setScalar(ukuran);
    const data = {
      jari: 2.7 + Math.random() * 1.3,
      sudut: Math.random() * Math.PI * 2,
      laju: (0.15 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1),
      miring: (Math.random() - 0.5) * 1.2,
      putar: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(1.5),
      lempar: 0
    };
    m.userData = data;
    mesin.add(m);
    balok.push(m);
  }

  // ---------- Bidang titik bergelombang ----------
  const KOLOM = 70;
  const BARIS = 34;
  const posisi = new Float32Array(KOLOM * BARIS * 3);
  for (let y = 0; y < BARIS; y++) {
    for (let x = 0; x < KOLOM; x++) {
      const i = (y * KOLOM + x) * 3;
      posisi[i] = (x / (KOLOM - 1) - 0.5) * 26;
      posisi[i + 1] = (y / (BARIS - 1) - 0.5) * 13;
      posisi[i + 2] = 0;
    }
  }
  const geoTitik = new THREE.BufferGeometry();
  geoTitik.setAttribute("position", new THREE.BufferAttribute(posisi, 3));
  const titik = new THREE.Points(geoTitik, new THREE.PointsMaterial({ color: ABU, size: 0.035, transparent: true, opacity: 0.55 }));
  titik.position.z = -5;
  titik.rotation.x = -0.5;
  scene.add(titik);

  // ---------- Interaksi ----------
  const kursor = { x: 0, y: 0, tx: 0, ty: 0 };
  let dorongan = 0; // putaran ekstra setelah klik
  const gerak = (event) => {
    kursor.tx = (event.clientX / window.innerWidth) * 2 - 1;
    kursor.ty = -((event.clientY / window.innerHeight) * 2 - 1);
  };
  const klik = (event) => {
    if (event.target.closest("button, a")) return;
    dorongan = Math.min(dorongan + 9, 14);
    balok.forEach((m) => { m.userData.lempar = 1.6 + Math.random() * 1.4; });
    if (geraknyaDikurangi) gambar(0);
  };
  window.addEventListener("pointermove", gerak, { passive: true });
  window.addEventListener("pointerdown", klik);

  // ---------- Ukuran & tata letak ----------
  // Layar lebar: roda di kanan, teks di kiri. Layar tegak (HP): roda di atas, teks di bawah.
  function ubahUkuran() {
    const w = kanvas.clientWidth || window.innerWidth;
    const h = kanvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tinggiTerlihat = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const lebarTerlihat = tinggiTerlihat * camera.aspect;
    if (camera.aspect >= 1.05) {
      const skala = Math.min(0.95, lebarTerlihat / 12.5);
      mesin.scale.setScalar(skala);
      mesin.position.set(lebarTerlihat * 0.25, 0.1, 0);
    } else {
      // Roda di separuh atas layar; teks di separuh bawah.
      const skala = Math.min(0.75, lebarTerlihat / 6.2, tinggiTerlihat / 11);
      mesin.scale.setScalar(skala);
      mesin.position.set(0, tinggiTerlihat * 0.24, 0);
    }
    if (geraknyaDikurangi) gambar(0);
  }
  const pengamatUkuran = new ResizeObserver(ubahUkuran);
  pengamatUkuran.observe(kanvas);

  // ---------- Animasi ----------
  const jam = new THREE.Clock();
  let waktu = 0;
  let sudutA = 0;

  function gambar(delta) {
    waktu += delta;
    kursor.x += (kursor.tx - kursor.x) * Math.min(1, delta * 3);
    kursor.y += (kursor.ty - kursor.y) * Math.min(1, delta * 3);
    dorongan *= Math.pow(0.18, delta); // meluruh
    const laju = 0.35 + dorongan;
    sudutA += laju * delta;

    rodaA.rotation.z = faseA + sudutA;
    rodaB.rotation.z = faseB - sudutA * (14 / 9);
    rodaC.rotation.z = faseC + sudutA * (14 / 7);
    cincin.rotation.z = -waktu * 0.6 - sudutA * 0.3;
    cincinTipis.rotation.z = waktu * 0.15;

    rakit.rotation.y = kursor.x * 0.45 + Math.sin(waktu * 0.4) * 0.06;
    rakit.rotation.x = -kursor.y * 0.3 + Math.cos(waktu * 0.3) * 0.04;
    camera.position.x = kursor.x * 0.4;
    camera.position.y = kursor.y * 0.25;
    camera.lookAt(0, 0, 0);

    balok.forEach((m) => {
      const d = m.userData;
      d.lempar *= Math.pow(0.25, delta);
      d.sudut += d.laju * delta * (1 + dorongan * 0.15);
      const jari = d.jari + d.lempar;
      m.position.set(Math.cos(d.sudut) * jari, Math.sin(d.sudut) * jari * 0.62, Math.sin(d.sudut) * d.miring + d.lempar * 0.4);
      m.rotation.x += d.putar.x * delta * (1 + dorongan * 0.3);
      m.rotation.y += d.putar.y * delta * (1 + dorongan * 0.3);
    });

    const p = geoTitik.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 2] = Math.sin(p[i] * 0.55 + waktu * 0.9) * 0.22 + Math.cos(p[i + 1] * 0.7 + waktu * 0.6) * 0.18;
    }
    geoTitik.attributes.position.needsUpdate = true;
    titik.rotation.z = kursor.x * 0.05;

    renderer.render(scene, camera);
  }

  let berjalan = false;
  let idFrame = 0;
  function loop() {
    if (!berjalan) return;
    gambar(Math.min(jam.getDelta(), 0.05));
    idFrame = requestAnimationFrame(loop);
  }
  function jalankan() {
    if (berjalan || geraknyaDikurangi || document.hidden) return;
    berjalan = true;
    jam.getDelta();
    idFrame = requestAnimationFrame(loop);
  }
  function jeda() {
    berjalan = false;
    cancelAnimationFrame(idFrame);
  }
  const saatVisibilitas = () => (document.hidden ? jeda() : jalankan());
  document.addEventListener("visibilitychange", saatVisibilitas);

  ubahUkuran();
  gambar(0.016);
  kanvas.classList.add("siap");
  jalankan();

  return {
    hentikan() {
      jeda();
      pengamatUkuran.disconnect();
      window.removeEventListener("pointermove", gerak);
      window.removeEventListener("pointerdown", klik);
      document.removeEventListener("visibilitychange", saatVisibilitas);
      scene.traverse((obj) => {
        obj.geometry?.dispose();
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((b) => b?.dispose());
      });
      renderer.dispose();
      kanvas.classList.remove("siap");
    }
  };
}
