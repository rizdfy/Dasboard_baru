// Efek interaktif (terinspirasi gaya situs studio kreatif):
// - Latar 3D Three.js: gelombang titik yang bereaksi ke kursor & klik (riak),
//   bentuk geometris yang "menoleh" ke kursor, grid, dan kamera yang ikut scroll.
// - Logo "H" 3D di halaman login yang mengikuti kursor.
// - Kursor kustom (hanya perangkat dengan mouse).
// Semua murni dekorasi: tidak menerima klik dan tidak mengubah layout.
// Jika Three.js / WebGL tidak tersedia, halaman tetap memakai tampilan biasa.

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// Palet tema minimalis (krem · hitam · oranye)
const TINTA = 0x111111;
const ABU = 0x6b655a;
const ORANYE = 0xff5a1f;
const geraknyaDikurangi = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Posisi kursor/sentuhan dalam koordinat -1..1 (dipakai semua efek).
const pointer = { x: 0, y: 0, aktif: false, terakhirGerak: 0 };
window.addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -((event.clientY / window.innerHeight) * 2 - 1);
  pointer.aktif = true;
  pointer.terakhirGerak = performance.now();
}, { passive: true });
document.addEventListener("pointerleave", () => { pointer.aktif = false; });

// ===================================================================
// Kursor kustom
// ===================================================================
function pasangKursor() {
  if (geraknyaDikurangi || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const titik = document.createElement("div");
  titik.className = "kursor-titik";
  const cincin = document.createElement("div");
  cincin.className = "kursor-cincin";
  [titik, cincin].forEach((el) => {
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  });

  const posisi = { x: -100, y: -100 };
  const cincinPos = { x: -100, y: -100 };
  const SELEKTOR_INTERAKTIF = "button, a, select, label, [role='button'], .statistik-entry, input[type='file']";

  window.addEventListener("mousemove", (event) => {
    posisi.x = event.clientX;
    posisi.y = event.clientY;
    titik.style.transform = `translate3d(${posisi.x}px, ${posisi.y}px, 0)`;
    document.body.classList.add("kursor-tampil");
  }, { passive: true });
  document.addEventListener("mouseleave", () => document.body.classList.remove("kursor-tampil"));
  document.addEventListener("mouseover", (event) => {
    const interaktif = event.target.closest?.(SELEKTOR_INTERAKTIF);
    const ketik = event.target.closest?.("input:not([type='file']), textarea");
    cincin.classList.toggle("aktif", Boolean(interaktif));
    cincin.classList.toggle("ketik", Boolean(ketik) && !interaktif);
  });
  window.addEventListener("mousedown", () => cincin.classList.add("tekan"));
  window.addEventListener("mouseup", () => cincin.classList.remove("tekan"));

  function loop() {
    cincinPos.x += (posisi.x - cincinPos.x) * 0.18;
    cincinPos.y += (posisi.y - cincinPos.y) * 0.18;
    cincin.style.transform = `translate3d(${cincinPos.x}px, ${cincinPos.y}px, 0)`;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// ===================================================================
// Latar 3D
// ===================================================================
function buatLatar(THREE) {
  const canvas = document.createElement("canvas");
  canvas.id = "bg-3d";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: window.innerWidth > 768, powerPreference: "low-power" });
  } catch (error) {
    console.warn("WebGL tidak didukung; latar animasi dinonaktifkan.", error);
    canvas.remove();
    return null;
  }

  const hp = window.innerWidth < 600;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, hp ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 120);
  const kameraDasar = new THREE.Vector3(0, 5.5, 14);
  camera.position.copy(kameraDasar);
  const LANTAI_Y = -3.2;

  // ---------- Gelombang titik interaktif ----------
  const kolom = hp ? 44 : 80;
  const baris = hp ? 26 : 40;
  const jarak = hp ? 0.95 : 0.6;
  const posisi = new Float32Array(kolom * baris * 3);
  const skala = new Float32Array(kolom * baris);
  let i = 0;
  for (let x = 0; x < kolom; x++) {
    for (let z = 0; z < baris; z++) {
      posisi[i * 3] = (x - kolom / 2) * jarak;
      posisi[i * 3 + 1] = 0;
      posisi[i * 3 + 2] = (z - baris / 2) * jarak;
      skala[i] = 0.6 + Math.random() * 0.8;
      i++;
    }
  }
  const geometriTitik = new THREE.BufferGeometry();
  geometriTitik.setAttribute("position", new THREE.BufferAttribute(posisi, 3));
  geometriTitik.setAttribute("aScale", new THREE.BufferAttribute(skala, 1));

  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: (hp ? 7 : 8) * pixelRatio },
    uColorA: { value: new THREE.Color(TINTA) },
    uColorB: { value: new THREE.Color(ABU) },
    uGlow: { value: new THREE.Color(ORANYE) },
    uMouse: { value: new THREE.Vector2(999, 999) },
    uMouseStrength: { value: 0 },
    uRipple: { value: new THREE.Vector2(0, 0) },
    uRippleAge: { value: 100 }
  };

  const materialTitik = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSize;
      uniform vec2 uMouse;
      uniform float uMouseStrength;
      uniform vec2 uRipple;
      uniform float uRippleAge;
      attribute float aScale;
      varying float vElevation;
      varying float vFade;
      varying float vGlow;
      void main() {
        vec3 p = position;
        float e = sin(p.x * 0.32 + uTime * 0.7) * 0.55
                + cos(p.z * 0.42 + uTime * 0.55) * 0.45
                + sin((p.x + p.z) * 0.18 + uTime * 0.4) * 0.35;

        // Titik di bawah kursor terangkat.
        float dm = distance(p.xz, uMouse);
        float bump = exp(-dm * dm * 0.07) * 1.9 * uMouseStrength;

        // Riak yang menyebar dari titik klik.
        float dr = distance(p.xz, uRipple);
        float ring = exp(-pow(dr - uRippleAge * 9.0, 2.0) * 0.22) * exp(-uRippleAge * 0.85) * 1.5;

        p.y += e + bump + ring;
        vElevation = e;
        vGlow = clamp(bump * 0.55 + ring * 0.7, 0.0, 1.0);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFade = clamp(1.0 - (-mv.z - 6.0) / 22.0, 0.15, 1.0);
        gl_PointSize = uSize * aScale * (1.0 + vGlow * 1.3) * (10.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uGlow;
      varying float vElevation;
      varying float vFade;
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, d) * mix(0.6, 1.0, vGlow) * max(vFade, vGlow);
        vec3 color = mix(uColorA, uColorB, clamp(vElevation * 0.7 + 0.5, 0.0, 1.0));
        color = mix(color, uGlow, vGlow * 0.9);
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
  const gelombang = new THREE.Points(geometriTitik, materialTitik);
  gelombang.position.y = LANTAI_Y;
  scene.add(gelombang);

  // ---------- Grid tipis ----------
  const grid = new THREE.GridHelper(90, 60, TINTA, TINTA);
  grid.material.transparent = true;
  grid.material.opacity = 0.07;
  grid.material.depthWrite = false;
  grid.position.y = LANTAI_Y - 1.6;
  scene.add(grid);

  // ---------- Bentuk geometris yang "menoleh" ke kursor ----------
  // pos = layar lebar; posHp = layar HP (di area atas, di atas kartu).
  const daftarBentuk = [
    { geo: new THREE.IcosahedronGeometry(1.3, 0), pos: [-9, 4.5, -4], posHp: [-2.6, 6.3, 0], warna: TINTA },
    { geo: new THREE.OctahedronGeometry(1.0, 0), pos: [9.5, 5.5, -6], posHp: [2.8, 6.0, -1], warna: ORANYE },
    { geo: new THREE.TorusGeometry(0.9, 0.28, 8, 24), pos: [7, 1.5, -2], posHp: [0.3, 6.9, -4], warna: TINTA },
    { geo: new THREE.IcosahedronGeometry(0.8, 0), pos: [-6, 0.8, 1], warna: TINTA },
    { geo: new THREE.TetrahedronGeometry(0.9, 0), pos: [2.5, 7.5, -8], warna: ORANYE }
  ];
  const bentuk = [];
  daftarBentuk.slice(0, hp ? 3 : daftarBentuk.length).forEach((item, index) => {
    const pemutar = new THREE.Group(); // menoleh ke kursor
    const mesh = new THREE.Mesh(
      item.geo,
      new THREE.MeshBasicMaterial({ color: item.warna, wireframe: true, transparent: true, opacity: item.warna === ORANYE ? 0.7 : 0.45 })
    );
    pemutar.add(mesh);
    pemutar.position.set(...item.pos);
    pemutar.userData = {
      pos: item.pos,
      posHp: item.posHp || item.pos,
      dasar: new THREE.Vector3(...item.pos),
      dorong: new THREE.Vector3(),
      fase: index * 1.7,
      putar: 0.25 + index * 0.05
    };
    scene.add(pemutar);
    bentuk.push({ pemutar, mesh });
  });

  // ---------- Ukuran layar ----------
  function sesuaikanUkuran() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    kameraDasar.z = w < 600 ? 17 : 14;
    camera.updateProjectionMatrix();
    const rapat = Math.min(1, camera.aspect / 1.4);
    bentuk.forEach(({ pemutar }) => {
      const [x, y, z] = w < 600 ? pemutar.userData.posHp : pemutar.userData.pos;
      pemutar.userData.dasar.set(w < 600 ? x : x * rapat, y, z);
    });
  }
  sesuaikanUkuran();
  window.addEventListener("resize", sesuaikanUkuran);

  // ---------- Kursor → dunia 3D ----------
  const raycaster = new THREE.Raycaster();
  const lantai = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LANTAI_Y);
  const titikLantai = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  const targetPandang = new THREE.Vector3();
  const bantu = new THREE.Object3D();
  const proyeksi = new THREE.Vector3();

  function kursorKeLantai(x, y) {
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(lantai, titikLantai);
  }

  // Klik / sentuh di mana saja → riak gelombang dari titik itu.
  window.addEventListener("pointerdown", (event) => {
    const x = (event.clientX / window.innerWidth) * 2 - 1;
    const y = -((event.clientY / window.innerHeight) * 2 - 1);
    const kena = kursorKeLantai(x, y);
    if (kena) uniforms.uRipple.value.set(kena.x, kena.z);
    else uniforms.uRipple.value.set(x * 12, -2);
    uniforms.uRippleAge.value = 0;
  }, { passive: true });

  let gulir = 0;
  window.addEventListener("scroll", () => {
    gulir = Math.min(window.scrollY / 1200, 1);
  }, { passive: true });

  let waktu = 0;
  let kekuatanTarget = 0;

  function gambar(delta) {
    waktu += delta;
    uniforms.uTime.value = waktu + gulir * 2;
    uniforms.uRippleAge.value += delta;

    // Kursor diproyeksikan ke lantai gelombang.
    const masihBergerak = pointer.aktif && performance.now() - pointer.terakhirGerak < 2500;
    const kena = masihBergerak ? kursorKeLantai(pointer.x, pointer.y) : null;
    if (kena) uniforms.uMouse.value.lerp(new THREE.Vector2(kena.x, kena.z), 0.18);
    kekuatanTarget = kena ? 1 : 0;
    uniforms.uMouseStrength.value += (kekuatanTarget - uniforms.uMouseStrength.value) * 0.06;

    // Titik yang "dilihat" bentuk: sinar dari kamera lewat kursor, sejauh 12 unit.
    ndc.set(pointer.x, pointer.y);
    raycaster.setFromCamera(ndc, camera);
    raycaster.ray.at(12, targetPandang);

    bentuk.forEach(({ pemutar, mesh }) => {
      const data = pemutar.userData;

      // Menyingkir saat kursor mendekat (dihitung di layar).
      proyeksi.copy(data.dasar).project(camera);
      const dx = proyeksi.x - pointer.x;
      const dy = proyeksi.y - pointer.y;
      const jarakLayar = Math.hypot(dx, dy);
      const radius = 0.32;
      if (pointer.aktif && jarakLayar < radius && jarakLayar > 0.0001) {
        const kuat = ((radius - jarakLayar) / radius) * 1.8;
        data.dorong.set((dx / jarakLayar) * kuat, (dy / jarakLayar) * kuat, 0);
      } else {
        data.dorong.multiplyScalar(0.94);
      }

      const target = data.dasar.clone().add(data.dorong);
      target.y += Math.sin(waktu * 0.6 + data.fase) * 0.45;
      pemutar.position.lerp(target, 0.08);

      // Menoleh ke kursor dengan halus.
      bantu.position.copy(pemutar.position);
      bantu.lookAt(targetPandang);
      pemutar.quaternion.slerp(bantu.quaternion, 0.06);

      // Tetap berputar pelan pada porosnya sendiri, lebih cepat saat di-scroll.
      mesh.rotation.z += delta * data.putar * (1 + gulir * 3);
      mesh.rotation.x += delta * data.putar * 0.4;
    });

    // Kamera: parallax kursor + turun mengikuti scroll.
    const tx = kameraDasar.x + (pointer.aktif ? pointer.x : 0) * 1.6;
    const ty = kameraDasar.y - (pointer.aktif ? -pointer.y : 0) * 0.9 - gulir * 2.5;
    camera.position.x += (tx - camera.position.x) * 0.04;
    camera.position.y += (ty - camera.position.y) * 0.04;
    camera.position.z += (kameraDasar.z - camera.position.z) * 0.04;
    camera.lookAt(0, -gulir * 1.5, 0);

    renderer.render(scene, camera);
  }

  return { canvas, gambar };
}

// ===================================================================
// Logo "H" 3D di halaman login
// ===================================================================
function buatLogo3D(THREE) {
  const judul = document.querySelector("#login-form > h2");
  if (!judul) return null;

  const UKURAN = 76;
  const canvas = document.createElement("canvas");
  canvas.className = "logo-3d";
  canvas.setAttribute("aria-hidden", "true");

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (error) {
    return null;
  }
  judul.prepend(canvas);
  judul.classList.add("pakai-logo-3d");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(UKURAN, UKURAN, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 7.2);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const cahaya = new THREE.DirectionalLight(0xffffff, 1.6);
  cahaya.position.set(3, 4, 5);
  scene.add(cahaya);
  const cahayaOranye = new THREE.PointLight(ORANYE, 22, 12);
  cahayaOranye.position.set(-3, -2, 3);
  scene.add(cahayaOranye);

  const logo = new THREE.Group();
  const bahan = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.45, roughness: 0.3 });
  const garis = new THREE.LineBasicMaterial({ color: ORANYE, transparent: true, opacity: 0.9 });
  [
    { size: [0.46, 2.1, 0.55], pos: [-0.66, 0, 0] },
    { size: [0.46, 2.1, 0.55], pos: [0.66, 0, 0] },
    { size: [0.86, 0.4, 0.55], pos: [0, 0, 0] }
  ].forEach(({ size, pos }) => {
    const geo = new THREE.BoxGeometry(...size);
    const balok = new THREE.Mesh(geo, bahan);
    balok.position.set(...pos);
    const tepi = new THREE.LineSegments(new THREE.EdgesGeometry(geo), garis);
    tepi.position.set(...pos);
    logo.add(balok, tepi);
  });
  scene.add(logo);

  let waktu = 0;
  function gambar(delta) {
    if (canvas.offsetParent === null) return; // halaman login sedang tidak tampil
    waktu += delta;
    const targetY = (pointer.aktif ? pointer.x : Math.sin(waktu * 0.8) * 0.4) * 0.7;
    const targetX = (pointer.aktif ? -pointer.y : 0) * 0.45;
    logo.rotation.y += (targetY - logo.rotation.y) * 0.08;
    logo.rotation.x += (targetX - logo.rotation.x) * 0.08;
    logo.position.y = Math.sin(waktu * 1.6) * 0.08;
    renderer.render(scene, camera);
  }
  return { gambar };
}

// ===================================================================
// Tombol 3D: miring mengikuti kursor, sedikit "tertarik" ke kursor, dan berkilau
// (hanya perangkat bermouse; tidak mengubah ukuran/posisi tombol di layout)
// ===================================================================
function pasangTombol3D() {
  if (geraknyaDikurangi || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  let aktif = null;

  function lepas(tombol) {
    if (!tombol) return;
    tombol.style.transform = "";
    tombol.classList.remove("disorot");
  }

  document.addEventListener("pointermove", (event) => {
    const tombol = event.target.closest?.("button");
    if (tombol !== aktif) {
      lepas(aktif);
      aktif = tombol && !tombol.disabled ? tombol : null;
    }
    if (!aktif) return;

    const kotak = aktif.getBoundingClientRect();
    const rx = Math.max(-1, Math.min(1, (event.clientX - kotak.left) / kotak.width * 2 - 1));
    const ry = Math.max(-1, Math.min(1, (event.clientY - kotak.top) / kotak.height * 2 - 1));
    const kecil = kotak.height < 34; // tombol di tabel: efek lebih halus
    const kuat = kecil ? 0.5 : 1;

    aktif.classList.add("tombol-3d", "disorot");
    aktif.style.setProperty("--gx", `${((rx + 1) / 2) * 100}%`);
    aktif.style.setProperty("--gy", `${((ry + 1) / 2) * 100}%`);
    aktif.style.transform =
      `perspective(420px) translate(${rx * 4 * kuat}px, ${ry * 3 * kuat}px) ` +
      `rotateX(${-ry * 14 * kuat}deg) rotateY(${rx * 16 * kuat}deg) scale(${kecil ? 1.04 : 1.05})`;
  }, { passive: true });

  document.addEventListener("pointerleave", () => { lepas(aktif); aktif = null; });
}

// ===================================================================
// Ledakan kepingan 3D saat tombol diklik (satu kanvas transparan di atas halaman)
// ===================================================================
function buatLedakan(THREE) {
  const canvas = document.createElement("canvas");
  canvas.id = "fx-3d";
  canvas.setAttribute("aria-hidden", "true");

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch (error) {
    return null;
  }
  document.body.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // Kamera ortografis dalam satuan piksel layar: x ke kanan, y ke bawah (dibalik jadi negatif).
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1000, 1000);
  camera.position.z = 500;

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const cahaya = new THREE.DirectionalLight(0xffffff, 1.8);
  cahaya.position.set(0.4, 0.8, 1);
  scene.add(cahaya);

  const MAKS = 160;
  const kepingan = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ metalness: 0.35, roughness: 0.3 }),
    MAKS
  );
  kepingan.frustumCulled = false;
  scene.add(kepingan);

  const bantu = new THREE.Object3D();
  const warna = new THREE.Color();
  const partikel = Array.from({ length: MAKS }, () => ({ hidup: 0 }));
  let berikut = 0;
  let adaYangHidup = false;
  let perluBersih = false;

  // Sembunyikan semua kepingan di awal & siapkan warna per kepingan.
  bantu.scale.setScalar(0);
  bantu.updateMatrix();
  warna.setHex(0xffffff);
  for (let n = 0; n < MAKS; n++) {
    kepingan.setMatrixAt(n, bantu.matrix);
    kepingan.setColorAt(n, warna);
  }
  kepingan.instanceMatrix.needsUpdate = true;

  function sesuaikanUkuran() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.left = 0;
    camera.right = w;
    camera.top = 0;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
  }
  sesuaikanUkuran();
  window.addEventListener("resize", sesuaikanUkuran);

  // Kompilasi shader lebih awal saat browser senggang, agar klik pertama tidak tersendat.
  const siapkan = () => {
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
  };
  if ("requestIdleCallback" in window) requestIdleCallback(siapkan, { timeout: 3000 });
  else setTimeout(siapkan, 1500);

  const PALET_UTAMA = [TINTA, TINTA, ORANYE, ORANYE, 0xffffff, 0xc9c2b2];
  const PALET_MERAH = [0xd62f2f, 0xff6b6b, TINTA, 0xffffff];

  function ledak(x, y, palet) {
    const jumlah = window.innerWidth < 600 ? 18 : 30;
    for (let n = 0; n < jumlah; n++) {
      const p = partikel[berikut];
      const sudut = Math.random() * Math.PI * 2;
      const laju = 180 + Math.random() * 380;
      p.x = x;
      p.y = -y;
      p.z = 0;
      p.vx = Math.cos(sudut) * laju;
      p.vy = Math.sin(sudut) * laju + 220; // condong ke atas
      p.rx = Math.random() * Math.PI;
      p.ry = Math.random() * Math.PI;
      p.vr = (Math.random() - 0.5) * 14;
      p.ukuran = 4 + Math.random() * 6;
      p.umur = 0;
      p.hidup = 0.8 + Math.random() * 0.6;
      warna.setHex(palet[Math.floor(Math.random() * palet.length)]);
      kepingan.setColorAt(berikut, warna);
      berikut = (berikut + 1) % MAKS;
    }
    kepingan.instanceColor.needsUpdate = true;
    adaYangHidup = true;
  }

  // Klik tombol mana pun → ledakan dari titik klik (atau tengah tombol bila lewat keyboard).
  document.addEventListener("click", (event) => {
    if (geraknyaDikurangi) return;
    const tombol = event.target.closest?.("button");
    if (!tombol || tombol.disabled) return;
    const kotak = tombol.getBoundingClientRect();
    const x = event.clientX || kotak.left + kotak.width / 2;
    const y = event.clientY || kotak.top + kotak.height / 2;
    const merah = tombol.matches(".hapus-btn, .btnreset, #confirm-yes, #logout-btn");
    ledak(x, y, merah ? PALET_MERAH : PALET_UTAMA);
  }, true);

  function gambar(delta) {
    if (!adaYangHidup) {
      if (perluBersih) {
        renderer.render(scene, camera); // satu kali untuk mengosongkan kanvas
        perluBersih = false;
      }
      return;
    }

    let masihAda = false;
    partikel.forEach((p, n) => {
      if (p.hidup <= 0) return;
      p.umur += delta;
      if (p.umur >= p.hidup) {
        p.hidup = 0;
        bantu.scale.setScalar(0);
        bantu.updateMatrix();
        kepingan.setMatrixAt(n, bantu.matrix);
        return;
      }
      masihAda = true;
      p.vy -= 900 * delta; // gravitasi
      p.vx *= 0.985;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.rx += p.vr * delta;
      p.ry += p.vr * 0.7 * delta;
      const sisa = 1 - p.umur / p.hidup;
      bantu.position.set(p.x, p.y, p.z);
      bantu.rotation.set(p.rx, p.ry, 0);
      bantu.scale.setScalar(p.ukuran * Math.min(1, sisa * 2.2));
      bantu.updateMatrix();
      kepingan.setMatrixAt(n, bantu.matrix);
    });
    kepingan.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);

    if (!masihAda) {
      adaYangHidup = false;
      perluBersih = true;
    }
  }

  return { gambar };
}

// ===================================================================
// Mulai
// ===================================================================
async function mulai() {
  pasangKursor();
  pasangTombol3D();

  let THREE;
  try {
    THREE = await import(THREE_URL);
  } catch (error) {
    console.warn("Three.js tidak termuat; efek 3D dinonaktifkan.", error);
    return;
  }

  const latar = buatLatar(THREE);
  const logo = buatLogo3D(THREE);
  const ledakan = geraknyaDikurangi ? null : buatLedakan(THREE);
  const efek = [latar, logo, ledakan].filter(Boolean);
  if (!efek.length) return;

  const jam = new THREE.Clock();
  let berjalan = false;

  function frame() {
    const delta = Math.min(jam.getDelta(), 0.05);
    efek.forEach((item) => item.gambar(delta));
  }

  function loop() {
    if (!berjalan) return;
    frame();
    requestAnimationFrame(loop);
  }

  // Saat mode pemeliharaan, latar ini tertutup overlay (yang punya adegan 3D sendiri) → dijeda.
  const sedangPerbaikan = () => document.body.classList.contains("mode-perbaikan");

  function jalankan() {
    if (berjalan || geraknyaDikurangi || sedangPerbaikan()) return;
    berjalan = true;
    jam.getDelta();
    requestAnimationFrame(loop);
  }

  // Hemat baterai: berhenti saat tab tidak terlihat.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) berjalan = false;
    else jalankan();
  });
  window.addEventListener("mode-perbaikan", (event) => {
    if (event.detail) berjalan = false;
    else jalankan();
  });

  frame();
  latar?.canvas.classList.add("siap");
  jalankan();
}

mulai();
