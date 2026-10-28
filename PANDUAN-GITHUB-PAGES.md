# 🚀 Panduan Memasang E-Catalog Properti di GitHub Pages / Vercel (v6.1)

Setelah selesai, aplikasi bisa dibuka di **`https://USERNAME.github.io/e-catalog-properti/`**. Tampilan, menu, dan fitur sama persis dengan versi Apps Script. Database tetap di Google Sheets & Drive yang sama.

```
 GitHub Pages (tampilan)                    Google Apps Script (server + database)
 index.html · css/ · js/      ── fetch ──►  Kode.gs → doPost()  →  Google Sheets / Drive
 USERNAME.github.io/...       ◄── JSON ───  (Web App /exec yang sama seperti sekarang)
```

Alamat `/exec` lama **tetap berfungsi**. Anda bisa memakai keduanya bersamaan, lalu beralih penuh ke GitHub Pages kapan saja.

---

## Tahap 1 — Perbarui server Apps Script (± 3 menit)

1. Buka proyek Apps Script E-Catalog → berkas **Kode** → hapus semua isinya → tempel isi **`E-Catalog_1-Kode.gs.txt`** → **Ctrl + S**.
   Untuk v6.1 salin juga **JavaScript** dan **Stylesheet** (versi `/exec` tetap dipakai sebagai cadangan).
2. **Deploy → Manage deployments** → klik ikon **pensil ✏️** pada deployment yang sudah ada.
3. Pastikan:

   | Kolom | Nilai |
   |---|---|
   | Version | **New version** |
   | Execute as | **Me** (akun Anda) |
   | Who has access | **Anyone** (wajib — bukan "Anyone with Google account") |

4. **Deploy** → salin **Web app URL** (berakhiran `/exec`). Inilah `GAS_URL`.

> ⚠️ Jangan pilih **New deployment**, karena itu membuat URL baru. Gunakan pensil ✏️ pada deployment lama.

**Cek cepat:** buka `GAS_URL?ping=1` di browser (tambahkan `?ping=1` di belakang URL). Harus tampil tulisan seperti `{"ok":true,"ping":true,...}`. Bila yang tampil halaman login Google, ulangi langkah 3 dan pilih **Anyone**.

---

## Tahap 2 — Siapkan folder frontend

1. Ekstrak **`E-Catalog-Properti-GitHub-Pages-v6.0.zip`**. Hasilnya folder **`e-catalog-properti`**, misalnya di `Documents\e-catalog-properti`.
2. Buka **`e-catalog-properti\js\config.js`** dengan Notepad, lalu ganti baris `GAS_URL` dengan URL dari Tahap 1:
   ```js
   window.ECP_CONFIG = {
     GAS_URL: 'https://script.google.com/macros/s/AKfycbx...milik-anda.../exec'
   };
   ```
   Simpan (Ctrl + S). Pastikan tanda kutip `'...'` tetap ada.

---

## Tahap 3 — Buat repository di GitHub

github.com → tombol **+** → **New repository**:
- **Repository name:** `e-catalog-properti`. Nama ini menjadi bagian alamat situs.
- **Public** (wajib untuk GitHub Pages gratis; aman, karena folder ini tidak berisi kata sandi atau token apa pun)
- **Jangan** centang *Add a README*, *.gitignore*, atau *license*
- **Create repository**

---

## Tahap 4 — Push dari folder yang BENAR

Folder kerja Anda adalah **`e-catalog-properti`** (folder yang berisi `index.html`). Jangan pakai folder di atasnya.

Buka folder `e-catalog-properti` di File Explorer → klik address bar → ketik `powershell` → Enter.

**4a — Pastikan posisi folder benar:**
```powershell
dir
```
Yang harus terlihat: `css`, `js`, `.nojekyll`, `index.html`, `README.md`. Bila yang terlihat justru folder `e-catalog-properti`, ketik `cd e-catalog-properti` lalu `dir` lagi.

**4b — Kirim ke GitHub** (ganti `USERNAME` dengan username GitHub Anda):
```powershell
git init
git add .
git commit -m "E-Catalog Properti v6.0"
git branch -M main
git remote add origin https://github.com/USERNAME/e-catalog-properti.git
git push -u origin main
```
Tanda berhasil: muncul `Writing objects: 100%` dan `* [new branch] main -> main`.
Bila diminta password, tempel **Personal Access Token** (bukan password akun). Saat ditempel, layar memang tetap kosong. Itu normal.

---

## Tahap 5 — Aktifkan GitHub Pages

Repository di github.com → **Settings** → **Pages**:

| Kolom | Nilai |
|---|---|
| Source | **Deploy from a branch** |
| Branch | **main** · **/ (root)** → **Save** |
| Enforce HTTPS | ✅ centang |

Tunggu 1–2 menit, refresh. Akan muncul: *Your site is live at `https://USERNAME.github.io/e-catalog-properti/`*

---

## Tahap 6 — Uji

1. Buka alamat situs. Etalase dan daftar proyek harus tampil.
2. Klik **Masuk** → login Owner → buka Dashboard, Data Konsumen, dan WhatsApp & Notifikasi.
3. Coba **Input Manual** satu konsumen uji → cek di Google Sheets (`Transaksi_Penjualan`) → hapus lagi dari aplikasi.
4. Buka juga di HP.
5. (Opsional) tekan **F12 → Console** → ketik `Perf.table()` untuk melihat kecepatan tiap panggilan.

Login, sesi, "Ingat perangkat ini", dan semua data sama seperti di versi `/exec`. Saat pertama kali membuka alamat GitHub Pages, setiap pengguna perlu **login sekali**, karena alamat situsnya baru.

---

## Memperbarui di kemudian hari

Setiap versi baru akan datang dalam dua bagian:

| Bagian | Cara memperbarui |
|---|---|
| **Kode.gs** (server) | Salin-tempel di Apps Script → Deploy → Manage deployments → ✏️ → New version |
| **ZIP frontend** | Ekstrak, timpa isi folder `e-catalog-properti` **kecuali `js/config.js`** (biarkan URL Anda), lalu jalankan perintah di bawah |

```powershell
git add .
git commit -m "Update ke versi baru"
git push
```
Tunggu 1–2 menit → **Ctrl + Shift + R**.

---

## Memakai Vercel (bukan GitHub Pages)

Isi folder `e-catalog-properti` sama persis untuk Vercel: berkas statis biasa, tanpa proses build.

- **Lewat GitHub (disarankan):** push folder seperti Tahap 4, lalu di vercel.com pilih **Add New → Project → Import** repository `e-catalog-properti`.
  - **Framework Preset:** *Other*
  - **Build Command:** kosong
  - **Output Directory:** kosong / `.`
  - Klik **Deploy**.
  - Setiap `git push` berikutnya otomatis ter-deploy ulang.
- **Tanpa GitHub:** di vercel.com, tarik (drag & drop) folder `e-catalog-properti` ke halaman **Deploy**.
- `js/config.js` tetap wajib berisi `GAS_URL` milik Anda.
- **Integrasi aplikasi Kontraktor, SiKeu, dan notifikasi WhatsApp tetap berjalan.** Semuanya terjadi di server Apps Script, bukan di Vercel. Yang perlu dipastikan hanya **Kode.gs versi terbaru** sudah di-deploy (New version).

---

## Mengatasi masalah

| Gejala | Penyebab & solusi |
|---|---|
| Kotak merah *"Alamat server belum diatur"* | `js/config.js` belum diisi / masih `TEMPEL-ID-...`. Isi `GAS_URL`, lalu `git add .` → `git commit -m "isi config"` → `git push` |
| *"Server membalas halaman, bukan data"* | Deploy Apps Script belum **Anyone**, atau URL salah (harus berakhiran `/exec`, bukan `/dev`). Ulangi Tahap 1 |
| *"Fungsi server … tidak ditemukan"* | Kode.gs v6.0 belum disalin atau belum **Deploy → New version** |
| Situs 404 *File not found* | `index.html` tidak berada di root repository. Push ulang dari folder `e-catalog-properti` (lihat Tahap 4a) |
| Tampilan polos tanpa warna | Folder `css/` atau `js/` tidak ikut terkirim. Selalu push lewat terminal (`git add .`), jangan lewat *Upload files* di web |
| Situs masih versi lama | Cache browser: **Ctrl + Shift + R** atau buka jendela Incognito |
| Pertama kali buka terasa lambat (2–4 detik) | Server Google sedang "bangun" (cold start). Aplikasi otomatis membangunkannya saat dibuka; pembukaan berikutnya lebih cepat |
| Sinyal HP putus-sambung | Aplikasi otomatis mencoba ulang. Penyimpanan membawa kode unik, jadi tidak pernah tersimpan ganda |
