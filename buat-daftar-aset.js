#!/usr/bin/env node
// Membuat ulang aset-produk/daftar.json dari isi folder aset-produk/.
// Jalankan: node buat-daftar-aset.js
const fs = require("fs");
const path = require("path");

const folder = path.join(__dirname, "aset-produk");
const didukung = new Set(["glb", "gltf", "obj", "mtl", "jpg", "jpeg", "png", "webp", "gif", "avif"]);

if (!fs.existsSync(folder)) {
  console.error("❌ Folder aset-produk/ tidak ditemukan.");
  process.exit(1);
}

const daftar = fs.readdirSync(folder)
  .filter((nama) => didukung.has(nama.split(".").pop().toLowerCase()))
  .sort((a, b) => a.localeCompare(b));

fs.writeFileSync(path.join(folder, "daftar.json"), `${JSON.stringify(daftar, null, 2)}\n`, "utf8");
console.log(`✅ aset-produk/daftar.json diperbarui (${daftar.length} file):`);
daftar.forEach((nama) => console.log(`   - ${nama}`));
