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
  where
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
let stopUpload = false;
let confirmResolver = null;
let qtyResolver = null;
let qtyCurrentItem = null;
let alertTimer = null;
let priceDiffTimer = null;
let priceChart = null;

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
    : date.toLocaleDateString("id-ID");
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
    hargaSatuan: Number(raw.hargaSatuan) || harga / isiPerSatuan
  };
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
    riwayat: $("riwayat-container")
  };
  Object.entries(views).forEach(([key, el]) => {
    if (el) el.style.display = key === name ? "block" : "none";
  });
}

async function checkMaintenance() {
  const overlay = $("maintenance-overlay");
  try {
    const response = await fetch(`maintenance-config.json?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    overlay.hidden = !Boolean(config.maintenance);
  } catch (error) {
    console.warn("Maintenance config tidak dapat dibaca. Aplikasi tetap dibuka.", error);
    overlay.hidden = true;
  }
}

function showAlert(message, type = "success") {
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
  }, 2800);
}

function showConfirm(message) {
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

async function fetchBarang() {
  const snapshot = await getDocs(collection(db, "barang"));
  barangCache = snapshot.docs.map((snap) => normalizeBarang(snap.id, snap.data()));
  barangCache.sort((a, b) => a.nama.localeCompare(b.nama, "id", { sensitivity: "base" }));
  renderBarang();
  renderSidebarBarang();
  return barangCache;
}

function createCell(text) {
  const td = document.createElement("td");
  td.textContent = String(text);
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

function renderBarang() {
  const tbody = $("barangList");
  const keyword = $("searchBarang").value.trim().toLocaleLowerCase("id-ID");
  tbody.replaceChildren();

  const items = barangCache.filter((item) => item.nama.toLocaleLowerCase("id-ID").includes(keyword));
  if (!items.length) {
    const tr = document.createElement("tr");
    const td = createCell("Barang tidak ditemukan");
    td.colSpan = 7;
    td.className = "empty-row";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  items.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.append(
      createCell(index + 1),
      createCell(item.nama),
      createCell(`${item.satuan} (${item.isiPerSatuan} pcs)`),
      createCell(formatRupiah(item.harga)),
      createCell(formatRupiah(item.hargaSatuan)),
      createCell(formatDate(item.editedAt))
    );

    const actionTd = document.createElement("td");
    const group = document.createElement("div");
    group.className = "action-group";
    group.append(
      createButton("Edit", "btn-edit", () => openEditPopup(item.id)),
      createButton("Hapus", "hapus-btn", () => hapusBarang(item.id))
    );
    actionTd.appendChild(group);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });
}

function renderSidebarBarang() {
  const tbody = $("sidebarBarangBody");
  const keyword = $("searchSidebarBarang").value.trim().toLocaleLowerCase("id-ID");
  tbody.replaceChildren();

  const items = barangCache.filter((item) => item.nama.toLocaleLowerCase("id-ID").includes(keyword));
  if (!items.length) {
    const tr = document.createElement("tr");
    const td = createCell("Barang tidak ditemukan");
    td.colSpan = 4;
    td.className = "empty-row";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  items.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.append(createCell(index + 1), createCell(item.nama), createCell(formatRupiah(item.harga)));
    const actionTd = document.createElement("td");
    const group = document.createElement("div");
    group.className = "action-group";
    group.append(
      createButton("Kurang", "", () => tambahKeLembarOpname("kurang", item)),
      createButton("Lebih", "", () => tambahKeLembarOpname("lebih", item))
    );
    actionTd.appendChild(group);
    tr.appendChild(actionTd);
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

async function tambahBarang() {
  const nama = $("namaBarang").value.trim();
  const harga = Number($("hargaBarang").value);
  const unit = getSelectedUnit();

  if (!nama) return showAlert("Nama barang wajib diisi.", "warning");
  if (!Number.isFinite(harga) || harga < 0) return showAlert("Harga harus berupa angka yang valid.", "warning");
  if (!unit) return showAlert("Satuan custom dan isi per satuan harus diisi.", "warning");

  $("btnTambah").disabled = true;
  try {
    await addDoc(collection(db, "barang"), {
      nama,
      harga,
      satuan: unit.satuan,
      isiPerSatuan: unit.isiPerSatuan,
      hargaSatuan: harga / unit.isiPerSatuan,
      editedAt: new Date(),
      editedBy: auth.currentUser?.email || "anonymous"
    });
    $("namaBarang").value = "";
    $("hargaBarang").value = "";
    showAlert("Barang berhasil ditambahkan.");
    await fetchBarang();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal menambah barang: ${error.message}`, "error");
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
  if (!currentEditId) return;
  const oldData = barangCache.find((item) => item.id === currentEditId);
  if (!oldData) return showAlert("Data lama tidak ditemukan.", "error");

  const nama = $("edit-namaBarang").value.trim();
  const harga = Number($("edit-hargaBarang").value);
  const satuan = $("edit-namaSatuan").value.trim() || "pcs";
  const isiPerSatuan = Math.max(1, parseInt($("edit-isiSatuan").value, 10) || 0);

  if (!nama) return showAlert("Nama barang wajib diisi.", "warning");
  if (!Number.isFinite(harga) || harga < 0) return showAlert("Harga tidak valid.", "warning");
  if (!Number($("edit-isiSatuan").value)) return showAlert("Isi per satuan minimal 1.", "warning");

  const newData = { nama, harga, satuan, isiPerSatuan, hargaSatuan: harga / isiPerSatuan };
  $("save-edit-btn").disabled = true;

  try {
    await updateDoc(doc(db, "barang", currentEditId), {
      ...newData,
      hargaLama: oldData.harga,
      editedAt: new Date(),
      editedBy: auth.currentUser?.email || "anonymous"
    });

    if (oldData.harga !== harga) {
      updatePriceDiff(nama, oldData.harga, harga);
      try {
        await addDoc(collection(db, "price_history"), {
          barangId: currentEditId,
          namaLama: oldData.nama,
          nama,
          hargaLama: oldData.harga,
          hargaBaru: harga,
          timestamp: new Date(),
          uid: auth.currentUser?.uid || null,
          editedBy: auth.currentUser?.email || "anonymous"
        });
      } catch (historyError) {
        console.warn("Histori harga belum dapat disimpan. Edit barang utama tetap berhasil.", historyError);
      }
    }

    await syncRiwayatForBarang(currentEditId, oldData, newData);
    closeEdit();
    showAlert("Data barang berhasil diperbarui.");
    await fetchBarang();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal memperbarui barang: ${error.message}`, "error");
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
    showAlert("Barang berhasil dihapus.");
    await fetchBarang();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal menghapus barang: ${error.message}`, "error");
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
  items.forEach((item) => {
    const normalized = normalizeHistoryItem(item);
    const tr = document.createElement("tr");
    tr.append(createCell(normalized.displayQty), createCell(normalized.nama), createCell(formatRupiah(normalized.total)));
    const actionTd = document.createElement("td");
    actionTd.appendChild(createButton("Hapus", "hapus-btn", () => {
      if (tipe === "kurang") daftarKurang = daftarKurang.filter((entry) => entry.entryId !== normalized.entryId);
      else daftarLebih = daftarLebih.filter((entry) => entry.entryId !== normalized.entryId);
      renderLembarOpname();
    }));
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });
}

function renderLembarOpname() {
  daftarKurang = daftarKurang.map(normalizeHistoryItem);
  daftarLebih = daftarLebih.map(normalizeHistoryItem);
  renderLembarTable("kurang", daftarKurang);
  renderLembarTable("lebih", daftarLebih);
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

async function showStockOpname({ reset = false } = {}) {
  if (reset) resetStockForm();
  if (!barangCache.length) await fetchBarang();
  renderSidebarBarang();
  setView("stock");
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
    showAlert(`Gagal menyimpan stock opname: ${error.message}`, "error");
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
  list.replaceChildren();

  try {
    const items = await getRiwayatUser();
    if (!items.length) {
      const p = document.createElement("p");
      p.textContent = "Belum ada riwayat stock opname.";
      list.appendChild(p);
      return;
    }

    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "riwayat-item";
      const date = document.createElement("small");
      date.textContent = formatDate(item.timestamp, true);
      const title = document.createElement("strong");
      title.textContent = item.judul || "Tanpa Judul";
      title.style.display = "block";
      const actions = document.createElement("div");
      actions.className = "riwayat-actions";
      actions.append(
        createButton("Lihat / Edit", "", () => loadRiwayat(item.id)),
        createButton("Export Excel", "", () => exportRiwayatToExcel(item.id)),
        createButton("Hapus", "hapus-btn", () => hapusRiwayat(item.id))
      );
      card.append(date, title, actions);
      list.appendChild(card);
    });
  } catch (error) {
    console.error(error);
    showAlert(`Gagal memuat riwayat: ${error.message}`, "error");
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
    showAlert(`Gagal menghapus riwayat: ${error.message}`, "error");
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
    showAlert(`Gagal menghapus semua riwayat: ${error.message}`, "error");
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
    showAlert(`Gagal export Excel: ${error.message}`, "error");
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
      rows.push({ nama, harga, satuan, isiPerSatuan });
    }

    if (!rows.length) throw new Error("Tidak ada baris data valid untuk diunggah.");

    let berhasil = 0;
    let gagal = 0;
    for (const item of rows) {
      if (stopUpload) break;
      $("upload-log").textContent = `Mengunggah ${berhasil + gagal + 1}/${rows.length}: ${item.nama}`;
      try {
        await addDoc(collection(db, "barang"), {
          ...item,
          hargaSatuan: item.harga / item.isiPerSatuan,
          editedAt: new Date(),
          editedBy: auth.currentUser.email || "anonymous"
        });
        berhasil++;
      } catch (error) {
        console.error("Gagal upload baris:", item, error);
        gagal++;
      }
    }

    $("upload-log").textContent = stopUpload
      ? `Upload dihentikan. ${berhasil} berhasil, ${gagal} gagal.`
      : `Upload selesai. ${berhasil} berhasil, ${gagal} gagal.`;
    showAlert(stopUpload ? `Upload dihentikan. ${berhasil} data masuk.` : `${berhasil} data berhasil diunggah.`, stopUpload ? "warning" : "success");
    await fetchBarang();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal membaca/upload Excel: ${error.message}`, "error");
    $("upload-log").textContent = `Gagal: ${error.message}`;
  } finally {
    $("loading-upload").style.display = "none";
    $("stopUploadBtn").style.display = "none";
    $("uploadExcelBtn").disabled = false;
    $("excelUpload").value = "";
    setTimeout(() => { $("upload-log").style.display = "none"; }, 1800);
  }
}

async function exportBarangToExcel() {
  if (!window.ExcelJS || !window.saveAs) return showAlert("Library Excel belum termuat. Periksa koneksi internet.", "error");
  if (!barangCache.length) return showAlert("Tidak ada data barang untuk diekspor.", "warning");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Daftar Barang");
  sheet.mergeCells("A1:G2");
  const title = sheet.getCell("A1");
  title.value = "DAFTAR BARANG TOKO H ENDUN";
  title.font = { size: 18, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };

  sheet.getRow(3).values = ["No", "Nama Barang", "Satuan", "Isi per Satuan", "Harga Total", "Harga Satuan", "Terakhir Diedit"];
  sheet.getRow(3).font = { bold: true };
  sheet.columns = [
    { width: 6 }, { width: 32 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 20 }, { width: 22 }
  ];

  barangCache.forEach((item, index) => {
    sheet.addRow([index + 1, item.nama, item.satuan, item.isiPerSatuan, item.harga, item.hargaSatuan, formatDate(item.editedAt, true)]);
  });
  sheet.getColumn(5).numFmt = '"Rp" #,##0';
  sheet.getColumn(6).numFmt = '"Rp" #,##0.00';

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), "Daftar_Barang.xlsx");
  showAlert("Daftar barang berhasil diekspor.");
}

async function loadPriceHistory() {
  const changes = [];
  try {
    const snapshot = await getDocs(collection(db, "price_history"));
    snapshot.forEach((snap) => {
      const data = snap.data();
      changes.push({
        id: snap.id,
        nama: String(data.nama || data.namaLama || "Tanpa Nama"),
        hargaLama: Number(data.hargaLama) || 0,
        hargaBaru: Number(data.hargaBaru) || 0,
        timestamp: data.timestamp,
        editedBy: data.editedBy || "-"
      });
    });
  } catch (error) {
    console.warn("price_history belum dapat dibaca, memakai fallback data barang.", error);
  }

  if (!changes.length) {
    barangCache.forEach((item) => {
      if (Number.isFinite(Number(item.hargaLama)) && Number(item.hargaLama) !== item.harga) {
        changes.push({
          id: item.id,
          nama: item.nama,
          hargaLama: Number(item.hargaLama),
          hargaBaru: item.harga,
          timestamp: item.editedAt,
          editedBy: item.editedBy || "-"
        });
      }
    });
  }

  changes.sort((a, b) => (toDate(b.timestamp)?.getTime() || 0) - (toDate(a.timestamp)?.getTime() || 0));
  return changes;
}

async function showStatistikHarga() {
  const content = $("statistik-content");
  content.replaceChildren();
  $("statistik-chart").style.display = "none";
  $("statistik-popup").style.display = "flex";

  try {
    const changes = await loadPriceHistory();
    if (!changes.length) {
      const p = document.createElement("p");
      p.textContent = "Belum ada perubahan harga yang tercatat.";
      content.appendChild(p);
      return;
    }

    changes.forEach((item) => {
      const diff = item.hargaBaru - item.hargaLama;
      const div = document.createElement("div");
      div.className = "statistik-entry";
      const strong = document.createElement("strong");
      strong.textContent = `${item.nama} ${diff > 0 ? "⬆" : diff < 0 ? "⬇" : ""}`;
      const lines = document.createElement("div");
      lines.textContent = `${formatRupiah(item.hargaLama)} → ${formatRupiah(item.hargaBaru)} (${diff >= 0 ? "+" : ""}${formatRupiah(diff).replace("Rp ", "Rp ")})`;
      const meta = document.createElement("small");
      meta.textContent = `${formatDate(item.timestamp, true)} • ${item.editedBy}`;
      div.append(strong, lines, meta);
      content.appendChild(div);
    });
  } catch (error) {
    console.error(error);
    showAlert(`Gagal memuat statistik: ${error.message}`, "error");
  }
}

async function loadStatistikChart() {
  if (!window.Chart) return showAlert("Chart.js belum termuat. Periksa koneksi internet.", "error");
  const changes = (await loadPriceHistory()).slice().reverse();
  const container = $("statistik-chart");
  container.style.display = "block";
  container.replaceChildren();

  if (!changes.length) {
    const p = document.createElement("p");
    p.textContent = "Belum ada riwayat harga untuk digrafikkan.";
    container.appendChild(p);
    return;
  }

  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  priceChart?.destroy();
  priceChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: changes.map((item) => `${item.nama} • ${formatDate(item.timestamp)}`),
      datasets: [{
        label: "Harga Baru",
        data: changes.map((item) => item.hargaBaru),
        tension: 0.2,
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
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
    showAlert(`Login gagal: ${error.message}`, "error");
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
    showAlert(`Pendaftaran gagal: ${error.message}`, "error");
  }
}

async function loginGoogle() {
  try {
    await signInWithPopup(auth, provider);
    showAlert("Login Google berhasil.");
  } catch (error) {
    console.error(error);
    showAlert(`Login Google gagal: ${error.message}`, "error");
  }
}

function setupEvents() {
  $("login-btn").addEventListener("click", loginEmail);
  $("google-login-btn").addEventListener("click", loginGoogle);
  $("signup-btn").addEventListener("click", signupEmail);
  $("logout-btn").addEventListener("click", () => signOut(auth));

  $("show-signup").addEventListener("click", (event) => { event.preventDefault(); setView("signup"); });
  $("show-login").addEventListener("click", (event) => { event.preventDefault(); setView("login"); });

  $("btnTambah").addEventListener("click", tambahBarang);
  $("searchBarang").addEventListener("input", renderBarang);
  $("searchSidebarBarang").addEventListener("input", renderSidebarBarang);
  $("satuanBarang").addEventListener("change", () => {
    $("customWrapper").style.display = $("satuanBarang").value === "custom" ? "block" : "none";
  });

  $("close-edit-popup").addEventListener("click", closeEdit);
  $("save-edit-btn").addEventListener("click", simpanEditBarang);

  $("confirm-yes").addEventListener("click", () => closeConfirm(true));
  $("confirm-no").addEventListener("click", () => closeConfirm(false));

  $("btn-stock-opname").addEventListener("click", () => showStockOpname({ reset: true }));
  $("btnBackToDashboard").addEventListener("click", () => { resetStockForm(); setView("dashboard"); });
  $("btnSimpanOpname").addEventListener("click", simpanHasilStockOpname);
  $("btn-riwayat-stock-opname").addEventListener("click", showRiwayat);
  $("kembali-dari-riwayat").addEventListener("click", () => showStockOpname());
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

  $("btnStatistikHarga").addEventListener("click", showStatistikHarga);
  $("btnStatistikWaktu").addEventListener("click", loadStatistikChart);
  $("close-statistik-popup").addEventListener("click", closeStatistik);
  $("close-price-diff").addEventListener("click", () => { $("price-diff-container").style.display = "none"; });

  $("email").addEventListener("keydown", (event) => { if (event.key === "Enter") loginEmail(); });
  $("password").addEventListener("keydown", (event) => { if (event.key === "Enter") loginEmail(); });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if ($("edit-popup").style.display === "flex") closeEdit();
    if ($("statistik-popup").style.display === "flex") closeStatistik();
    if ($("confirm-popup").style.display === "flex") closeConfirm(false);
  });
}

setupEvents();
checkMaintenance();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    barangCache = [];
    resetStockForm();
    setView("login");
    $("user-photo").src = DEFAULT_PHOTO;
    return;
  }

  $("user-email").textContent = getUserNameFromEmail(user.email);
  $("user-photo").src = user.photoURL || DEFAULT_PHOTO;
  $("user-photo").style.display = "block";
  setView("dashboard");
  try {
    await fetchBarang();
  } catch (error) {
    console.error(error);
    showAlert(`Gagal memuat data barang: ${error.message}`, "error");
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
window.kembaliKeDashboard = () => setView("dashboard");
