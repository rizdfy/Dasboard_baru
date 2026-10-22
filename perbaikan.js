#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const stateArg = (args.find((arg) => arg === "on" || arg === "off") || "").toLowerCase();
const pushToGithub = args.includes("--github");

if (!stateArg) {
  console.log("Penggunaan:");
  console.log("  node perbaikan.js on");
  console.log("  node perbaikan.js off");
  console.log("  node perbaikan.js on --github   # membutuhkan env GITHUB_TOKEN");
  process.exit(1);
}

const maintenance = stateArg === "on";
const configPath = path.join(__dirname, "maintenance-config.json");
const content = `${JSON.stringify({ maintenance })}\n`;
fs.writeFileSync(configPath, content, "utf8");
console.log(`✅ maintenance-config.json diubah ke ${stateArg.toUpperCase()}`);

if (!pushToGithub) process.exit(0);

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("❌ GITHUB_TOKEN belum tersedia. Token sengaja tidak diminta lewat terminal agar tidak tampil sebagai teks biasa.");
  process.exit(1);
}

const GITHUB_REPO = process.env.GITHUB_REPO || "rizdfy/Dashboard_toko";
const FILE_PATH = "maintenance-config.json";
const BRANCH = process.env.GITHUB_BRANCH || "main";

async function updateGithub() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Dashboard-Toko-Maintenance-Script"
  };

  const currentResponse = await fetch(`${apiUrl}?ref=${encodeURIComponent(BRANCH)}`, { headers });
  if (!currentResponse.ok) throw new Error(`Gagal membaca file GitHub (${currentResponse.status})`);
  const current = await currentResponse.json();

  const updateResponse = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `maintenance ${stateArg}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha: current.sha,
      branch: BRANCH
    })
  });

  if (!updateResponse.ok) {
    const body = await updateResponse.text();
    throw new Error(`Gagal mengubah GitHub (${updateResponse.status}): ${body}`);
  }

  console.log(`✅ GitHub ${GITHUB_REPO}/${FILE_PATH} berhasil diubah ke ${stateArg.toUpperCase()}`);
}

updateGithub().catch((error) => {
  console.error("❌", error.message);
  process.exitCode = 1;
});
