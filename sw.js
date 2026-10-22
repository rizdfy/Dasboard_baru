// Service worker kecil untuk notifikasi pesanan (wajib agar notifikasi bisa tampil di HP Android).
// Tidak menyimpan cache halaman apa pun, sehingga website tetap selalu memuat versi terbaru.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Notifikasi diklik → buka/fokuskan panel admin di halaman Pesanan.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const tujuan = new URL("./#pesanan", self.registration.scope).href;
  event.waitUntil((async () => {
    const jendela = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const klien of jendela) {
      if (klien.url.startsWith(self.registration.scope)) {
        await klien.focus();
        klien.postMessage({ jenis: "buka-pesanan" });
        return;
      }
    }
    await self.clients.openWindow(tujuan);
  })());
});
