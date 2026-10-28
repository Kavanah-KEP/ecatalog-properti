# E-Catalog Properti — Frontend GitHub Pages (v6.1)

Folder ini adalah **frontend** E-Catalog Properti. Folder inilah yang di-`git init` dan di-push ke GitHub Pages.

```
e-catalog-properti/      ← folder ini = root repository (jalankan git init DI SINI)
├── index.html           ← halaman aplikasi (etalase + login + dashboard)
├── README.md
├── .nojekyll            ← berkas kosong, biarkan saja
├── css/
│   └── style.css        ← seluruh tampilan
└── js/
    ├── config.js        ← ⚠️ ISI GAS_URL DI SINI sebelum push
    ├── api.js           ← penghubung ke server Apps Script (REST)
    └── app.js           ← seluruh logika aplikasi
```

- **Backend & database** tetap di Google Apps Script + Google Sheets/Drive. Kode backend (`Kode.gs`) **tidak** ada di folder ini.
- Satu-satunya berkas yang perlu diubah: **`js/config.js`**. Isi `GAS_URL` dengan URL `/exec` dari *Apps Script → Deploy → Manage deployments*.
- Alamat lama `/exec` tetap bisa dipakai. Keduanya memakai server & data yang sama.

## Memperbarui
```bash
git add .
git commit -m "Update E-Catalog"
git push
```
Tunggu 1–2 menit, lalu tekan **Ctrl+Shift+R** di browser.

## Cek kecepatan
Buka aplikasi, tekan **F12 → Console**, ketik `Perf.table()`. Tabel menampilkan waktu total, waktu server, dan waktu jaringan tiap panggilan.
