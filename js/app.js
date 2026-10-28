/**
 * ============================================================
 * E-CATALOG PROPERTI — JavaScript.html (Frontend SPA)
 * Prinsip: 1) SPA client-side  2) Optimistic UI + LocalStorage
 *          3) Cache server     4) Batch processing
 * Semua navigasi 0ms — tidak ada reload & tidak ada ?page=
 * ============================================================
 */

// ════════ BAGIAN 1 — STATE GLOBAL & UTILITAS ════════

const App = {
  etalase: {},
  hero: {},
  proyek: [],
  kavling: [],
  transaksi: [],
  dokumen: [],
  indent: [],
  users: [],
  config: {},
  sesi: null,
  token: null,
  pubPage: 'beranda',
  appPage: 'dashboard',
  proyekAktif: null,     // proyek yang dipilih di Data Konsumen
  masterProyekId: null,  // proyek yang daftar kavlingnya sedang dibuka di Master Proyek
  proyekDetail: null,    // proyek yang dibuka di etalase
  kavlingPilih: null,    // kavling yang sedang dipesan
  step: 1,
  charts: {},
  siap: false
};

const LS = {
  get(k, d) { try { const v = localStorage.getItem('ecp_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ecp_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('ecp_' + k); } catch (e) {} }
};

// v4.9.3 — penyimpanan per tab (bertahan saat halaman di-refresh, hilang saat tab ditutup)
const SS = {
  get(k, d) { try { const v = sessionStorage.getItem('ecp_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { sessionStorage.setItem('ecp_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { sessionStorage.removeItem('ecp_' + k); } catch (e) {} }
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * v4.3: escape untuk teks di DALAM string JavaScript pada atribut onclick="fn('…')".
 * esc() saja tidak cukup di posisi ini: browser mengubah &#39; kembali menjadi '
 * sebelum menjalankan onclick, sehingga teks berisi tanda kutip bisa "keluar"
 * dari string dan menjalankan kode (XSS).
 */
function escJs(s) {
  return esc(String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/</g, '\\x3c'));
}

function rp(n) {
  const v = Math.round(Number(n) || 0);
  return 'Rp ' + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function rpSingkat(n) {
  const v = Number(n) || 0;
  if (v >= 1e12) return 'Rp ' + (v / 1e12).toFixed(2).replace('.', ',') + ' T';
  if (v >= 1e9) return 'Rp ' + (v / 1e9).toFixed(2).replace('.', ',') + ' M';
  if (v >= 1e6) return 'Rp ' + (v / 1e6).toFixed(0) + ' Jt';
  return rp(v);
}

function angka(n) { return (Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function tglIndo(s) {
  if (!s) return '-';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(s);
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return d.getDate() + ' ' + bulan[d.getMonth()] + ' ' + d.getFullYear();
}

function bulanKey(s) {
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function debounce(fn, ms) {
  let t;
  return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms || 300); };
}

/** Warna badge status kavling / berkas. */
function chipStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'tersedia') return 'chip-ok';
  if (s.indexOf('proses') >= 0 || s === 'diajukan' || s === 'pending review') return 'chip-gold';
  if (s === 'terjual' || s === 'lengkap 100%' || s === 'verified' || s === 'akad selesai') return 'chip-brand';
  if (s === 'ditolak') return 'chip-danger';
  if (s === 'sp3k' || s === 'jadwal akad') return 'chip-soft';
  return 'chip';
}

// ── Notifikasi Toast ──
// ── Pustaka (Bootstrap/Chart.js) dimuat tanpa memblokir — tunggu bila belum siap ──
function bootstrapSiap() { return !!(window.bootstrap && window.bootstrap.Modal); }

function denganBootstrap(fn) {
  if (bootstrapSiap()) { fn(); return; }
  const tunggu = (window.PustakaSiap && window.PustakaSiap.bootstrap) || Promise.resolve(false);
  tunggu.then(function () { if (bootstrapSiap()) fn(); });
}

function showToast(judul, pesan, tipe) {
  const el = document.getElementById('appToast');
  document.getElementById('toastTitle').textContent = judul;
  document.getElementById('toastBody').textContent = pesan;
  el.className = 'toast toast-lux ' + (tipe === 'success' ? 'ok' : tipe === 'danger' ? 'err' : tipe === 'warning' ? 'warn' : '');
  if (bootstrapSiap()) { bootstrap.Toast.getOrCreateInstance(el, { delay: 4200 }).show(); return; }
  // Cadangan bila Bootstrap belum termuat: tampilkan manual
  el.classList.add('show');
  clearTimeout(el._pewaktu);
  el._pewaktu = setTimeout(function () { el.classList.remove('show'); }, 4200);
}

// ── Pengelola modal: mencegah modal "macet" & lapisan gelap yang tertinggal ──
/**
 * Tampilkan modal dengan aman. Bila modal yang sama sedang dalam animasi
 * menutup, tunggu sampai selesai lalu buka — dahulu kondisi ini membuat
 * modal tidak muncul sama sekali dan lapisan gelap tertinggal di layar.
 */
function tampilkanModal(id) {
  denganBootstrap(function () {
    const el = document.getElementById(id);
    if (!el) return;
    let sudah = false;
    const buka = function () {
      if (sudah) return;
      sudah = true;
      delete el.dataset.sedangTutup;
      delete el.dataset.sedangTutupSejak;
      bootstrap.Modal.getOrCreateInstance(el).show();
    };
    if (el.dataset.sedangTutup === '1') {
      el.addEventListener('hidden.bs.modal', buka, { once: true });
      setTimeout(buka, 700);   // pengaman bila peristiwa "hidden" tidak pernah datang
    } else buka();
  });
}

function sembunyikanModal(id) {
  if (!bootstrapSiap()) return;
  const el = document.getElementById(id);
  const m = bootstrap.Modal.getInstance(el);
  if (!m) return;
  // v4.7: bila jendela masih dalam animasi membuka, Bootstrap mengabaikan perintah tutup —
  // tunggu animasinya selesai lalu tutup, agar jendela tidak tertinggal terbuka.
  if (m._isTransitioning && !el.dataset.sedangTutup) {
    let selesai = false;
    const tutup = function () { if (selesai) return; selesai = true; m.hide(); };
    el.addEventListener('shown.bs.modal', tutup, { once: true });
    setTimeout(tutup, 700);
    return;
  }
  m.hide();
}

/** Bersihkan sisa lapisan gelap & kunci gulir bila tidak ada modal yang terbuka. */
function rapikanModal() {
  const terbuka = document.querySelectorAll('.modal.show').length;
  // Jangan sentuh apa pun selama ada modal yang sedang beranimasi buka/tutup
  // (penanda berisi waktu mulai; dianggap basi setelah 2 detik)
  const kini = Date.now();
  const sedangAnimasi = Array.prototype.some.call(document.querySelectorAll('.modal'), function (m) {
    const t = Number(m.dataset.sedangBuka || m.dataset.sedangTutupSejak || 0);
    return t && kini - t < 2000;
  });
  if (sedangAnimasi) return;
  const lapisan = document.querySelectorAll('.modal-backdrop');
  if (!terbuka) {
    lapisan.forEach(function (b) { b.parentNode && b.parentNode.removeChild(b); });
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  } else {
    document.body.classList.add('modal-open');
    for (let i = 0; i < lapisan.length - terbuka; i++) {
      if (lapisan[i].parentNode) lapisan[i].parentNode.removeChild(lapisan[i]);
    }
  }
}

(function pasangPengelolaModal() {
  document.addEventListener('hide.bs.modal', function (e) {
    e.target.dataset.sedangTutup = '1';
    e.target.dataset.sedangTutupSejak = Date.now();
  });
  document.addEventListener('hidden.bs.modal', function (e) {
    delete e.target.dataset.sedangTutup;
    delete e.target.dataset.sedangTutupSejak;
    e.target.style.removeProperty('z-index');
    if (e.target.id === 'modalPreview') bersihkanPratinjau();
    setTimeout(rapikanModal, 30);
  });
  // Modal bertumpuk (mis. konfirmasi hapus di atas jendela Kelola Berkas):
  // modal yang baru selalu di atas, lapisan gelapnya tepat di bawahnya.
  document.addEventListener('shown.bs.modal', function (e) { delete e.target.dataset.sedangBuka; });
  document.addEventListener('show.bs.modal', function (e) {
    e.target.dataset.sedangBuka = Date.now();
    const lain = Array.prototype.filter.call(document.querySelectorAll('.modal.show'), function (m) { return m !== e.target; }).length;
    if (!lain) return;
    const z = 1055 + lain * 20;
    e.target.style.zIndex = z;
    setTimeout(function () {
      const bd = document.querySelectorAll('.modal-backdrop');
      if (bd.length) bd[bd.length - 1].style.zIndex = z - 5;
    }, 0);
  });
})();

// ── Modal serbaguna ──
function openModal(judul, isiHtml, footerHtml, ukuran) {
  document.getElementById('modalUmumTitle').textContent = judul;
  document.getElementById('modalUmumBody').innerHTML = isiHtml;
  document.getElementById('modalUmumFooter').innerHTML = footerHtml ||
    '<button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>';
  const dlg = document.querySelector('#modalUmum .modal-dialog');
  dlg.className = 'modal-dialog modal-dialog-centered modal-dialog-scrollable ' + (ukuran || 'modal-lg');
  tampilkanModal('modalUmum');
}

function closeModal() {
  sembunyikanModal('modalUmum');
}

function konfirmasi(judul, pesan, onOk) {
  document.getElementById('konfirmasiTitle').textContent = judul;
  document.getElementById('konfirmasiPesan').textContent = pesan;
  const btn = document.getElementById('konfirmasiOk');
  const clone = btn.cloneNode(true);
  btn.parentNode.replaceChild(clone, btn);
  clone.onclick = function () { sembunyikanModal('modalKonfirmasi'); onOk(); };
  tampilkanModal('modalKonfirmasi');
}

/**
 * Pratinjau dokumen di dalam aplikasi.
 * Isi berkas diambil dari server sebagai data URL, jadi gambar & PDF
 * tampil langsung tanpa bergantung pada penampil Google Drive.
 */
function previewFile(url, judul) {
  if (!url) { showToast('Info', 'Dokumen belum diunggah.', 'warning'); return; }

  document.getElementById('previewTitle').textContent = judul || 'Pratinjau Dokumen';
  const tombolUnduh = document.getElementById('previewDownload');
  tombolUnduh.href = /^https:\/\//i.test(String(url)) ? url : '#';   // v4.3: tolak javascript: dll.
  const body = document.getElementById('previewBody');

  body.innerHTML = '<div class="py-5 text-center">' +
    '<div class="loader-ring mx-auto"></div>' +
    '<p class="text-muted-2 mt-3 mb-0" style="font-size:.86rem">Memuat pratinjau…</p></div>';

  tampilkanModal('modalPreview');

  call('getFilePratinjau', App.token, url).then(function (res) {
    if (!res.success) {
      body.innerHTML = pratinjauGagal(url, res.message);
      return;
    }
    const d = res.data;
    const kb = (d.ukuran / 1024).toFixed(0);

    if (String(d.mime).indexOf('image/') === 0) {
      // Gambar memakai Blob URL (bukan teks base64 raksasa di halaman) → hemat memori,
      // dan dilepas otomatis saat jendela pratinjau ditutup.
      const src = buatBlobUrl(d.data, d.mime);
      body.innerHTML =
        '<img src="' + src + '" alt="' + esc(d.nama) + '" ' +
          'style="max-width:100%;max-height:72vh;border-radius:12px;box-shadow:var(--shadow-card);cursor:zoom-in" ' +
          'onclick="this.style.maxHeight = this.style.maxHeight === \'none\' ? \'72vh\' : \'none\'">' +
        '<div class="text-muted-2 mt-2" style="font-size:.78rem">' + esc(d.nama) + ' • ' + kb + ' KB' +
          ' — klik gambar untuk memperbesar</div>';
    } else if (String(d.mime).indexOf('pdf') >= 0) {
      // v4.9.1 — PDF digambar sebagai halaman (pdf.js). Penampil PDF bawaan browser
      // diblokir di dalam bingkai Apps Script sehingga dulu layar tampak putih.
      body.innerHTML = '<div class="pdf-wadah"></div>' +
        '<div class="text-muted-2 mt-2" style="font-size:.78rem">' + esc(d.nama) + ' • ' + kb + ' KB</div>';
      tampilPdf(body.querySelector('.pdf-wadah'), d.data, d.mime);
    } else {
      body.innerHTML = pratinjauGagal(url, 'Jenis berkas ini tidak dapat dipratinjau (' + esc(d.mime) + ').');
    }
    tombolUnduh.href = d.url || url;
  }).catch(function (err) {
    body.innerHTML = pratinjauGagal(url, err.message);
  });
}

const _blobPratinjau = [];
function buatBlobUrl(base64, mime) {
  try {
    const biner = atob(base64);
    const arr = new Uint8Array(biner.length);
    for (let i = 0; i < biner.length; i++) arr[i] = biner.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: mime }));
    _blobPratinjau.push(url);
    return url;
  } catch (e) {
    return 'data:' + mime + ';base64,' + base64;
  }
}

/** Kosongkan isi pratinjau saat ditutup agar memori HP/laptop tidak menumpuk. */
function bersihkanPratinjau() {
  const body = document.getElementById('previewBody');
  if (body) body.innerHTML = '';
  while (_blobPratinjau.length) { try { URL.revokeObjectURL(_blobPratinjau.pop()); } catch (e) {} }
}

function pratinjauGagal(url, pesan) {
  return '<div class="py-5 text-center">' +
    '<i class="bi bi-file-earmark-x" style="font-size:2.6rem;color:var(--border)"></i>' +
    '<p class="text-muted-2 mt-3 mb-3" style="font-size:.88rem">' + esc(pesan || 'Pratinjau tidak tersedia.') + '</p>' +
    '<a class="btn btn-outline-brand btn-sm" href="' + esc(url) + '" target="_blank">' +
      '<i class="bi bi-box-arrow-up-right"></i> Buka di Google Drive</a></div>';
}

/**
 * Batas waktu panggilan BACA data. Kadang google.script.run tidak pernah
 * membalas (koneksi putus, HP tertidur) — dahulu layar menunggu selamanya
 * dan tampak putih. Kini ada batas waktu, lalu muncul pilihan "Coba Lagi".
 * Panggilan SIMPAN sengaja tidak diberi batas agar tidak terjadi data ganda.
 */
const BATAS_WAKTU_BACA = {
  getBootstrapData: 30000, getWorkspaceData: 40000, pingSession: 20000,
  getFilePratinjau: 60000, cekStatusKPR: 30000,
  loginUser: 25000                                // v5.0.1 — login di HP tidak pernah macet menunggu
};

/** Bungkus google.script.run menjadi Promise agar mudah dirangkai. */
function call(fnName) {
  const args = Array.prototype.slice.call(arguments, 1);
  return new Promise(function (resolve, reject) {
    let beres = false;
    const batas = BATAS_WAKTU_BACA[fnName];
    const pewaktu = batas ? setTimeout(function () {
      if (beres) return;
      beres = true;
      const err = new Error('Koneksi ke server sedang lambat. Silakan coba lagi.');
      err.kode = 'TIMEOUT';
      reject(err);
    }, batas) : null;

    if (!window.google || !google.script || !google.script.run) {
      reject(new Error('Koneksi Google belum siap. Silakan muat ulang halaman.'));
      return;
    }
    const runner = google.script.run
      .withSuccessHandler(function (res) {
        if (beres) return;
        beres = true; clearTimeout(pewaktu);
        if (res && res.success === false && res.message === 'SESSION_EXPIRED') {
          // v5.0.1 — jawaban untuk token LAMA (permintaan yang masih berjalan saat sesi berganti /
          // sudah keluar) tidak boleh melempar ke layar login lagi & mengganggu orang yang sedang mengetik
          if (App.token && (!args.length || args[0] === App.token)) sesiHabis();
          else if (args[0] && (args[0] === LS.get('token', null) || args[0] === SS.get('token', null))) {
            LS.del('token'); lupakanSesiTab();               // token tersimpan sudah kedaluwarsa: bersihkan diam-diam
          }
          reject(new Error('Sesi berakhir'));
          return;
        }
        if (res && res.notifAntri && fnName !== 'dorongAntrianNotif') { try { dorongNotifLatar(); } catch (e0) { /* v5.3 — opsional */ } }
        resolve(res);
      })
      .withFailureHandler(function (err) {
        if (beres) return;
        beres = true; clearTimeout(pewaktu);
        reject(err || new Error('Terjadi kesalahan koneksi.'));
      });
    if (typeof runner[fnName] !== 'function') {
      beres = true; clearTimeout(pewaktu);
      reject(new Error('Fungsi server "' + fnName + '" tidak ditemukan. Pastikan Kode.gs terbaru sudah di-deploy.'));
      return;
    }
    runner[fnName].apply(runner, args);
  });
}

function sesiHabis() {
  const sudahDiLogin = !App.token && !document.getElementById('viewLogin').classList.contains('hidden');
  App.token = null; App.sesi = null;
  LS.del('token');
  lupakanSesiTab();                          // v4.9.3
  hentikanPekerjaanLatar();                  // v5.0.1
  if (sudahDiLogin) return;                  // v5.0.1 — sudah di layar masuk: jangan ulang (fokus & pesan tidak direset)
  showToast('Sesi Berakhir', 'Silakan masuk kembali.', 'warning');
  showLogin();
}

function tombolLoading(btn, aktif, teksAsli) {
  if (!btn) return;
  if (aktif) {
    btn.dataset.asli = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-inline"></span> Memproses…';
    btn.disabled = true;
  } else {
    btn.innerHTML = teksAsli || btn.dataset.asli || btn.innerHTML;
    btn.disabled = false;
  }
}

function skeleton(tinggi, jumlah) {
  let h = '';
  for (let i = 0; i < (jumlah || 3); i++) h += '<div class="skeleton mb-2" style="height:' + (tinggi || 60) + 'px"></div>';
  return h;
}

function emptyState(ikon, judul, pesan) {
  return '<div class="empty-state"><i class="bi bi-' + ikon + '"></i><h6 class="font-head">' + esc(judul) + '</h6>' +
    '<p class="mb-0" style="font-size:.86rem">' + esc(pesan || '') + '</p></div>';
}

// ════════ BAGIAN 1b — PENGAMAN ANTI-LAYAR-PUTIH ════════

/**
 * Jalankan fungsi penggambar halaman dengan aman. Bila terjadi kesalahan
 * (data tak terduga, pustaka belum termuat, dll.), halaman TIDAK dibiarkan
 * kosong putih — diganti kartu pemulihan dengan tombol "Coba Lagi".
 */
function jalankanAman(fn, wadah, nama) {
  try {
    fn();
    return true;
  } catch (err) {
    console.error('Gagal menggambar "' + nama + '":', err);
    const halamanApp = nama && App.sesi && typeof JUDUL_HALAMAN !== 'undefined' && JUDUL_HALAMAN[nama];
    if (wadah) tampilkanKartuPulih(wadah, err && err.message, halamanApp ? 'goApp(\'' + nama + '\', true)' : null);
    return false;
  }
}

function tampilkanKartuPulih(wadah, pesan, aksiUlang) {
  if (!wadah) return;
  wadah.innerHTML = '<div class="kartu-pulih">' +
    '<i class="bi bi-arrow-clockwise"></i>' +
    '<h5 class="mt-2 mb-1">Tampilan belum berhasil dimuat</h5>' +
    '<p class="text-muted-2 mb-3" style="font-size:.86rem">Biasanya karena koneksi sedang lambat. Data Anda aman.' +
      (pesan ? '<br><small>(' + esc(pesan) + ')</small>' : '') + '</p>' +
    '<div class="d-flex gap-2 justify-content-center flex-wrap">' +
      (aksiUlang ? '<button class="btn btn-brand" onclick="' + aksiUlang + '"><i class="bi bi-arrow-repeat"></i> Coba Lagi</button>' : '') +
      (App.sesi ? '<button class="btn btn-ghost" onclick="refreshWorkspace()"><i class="bi bi-cloud-download"></i> Ambil Data Terbaru</button>' : '') +
    '</div></div>';
}

/**
 * Pemeriksa kesehatan tampilan — dijalankan saat ada error, saat tab
 * kembali dibuka, dan berkala tiap 5 detik. Memperbaiki sendiri keadaan
 * yang dulu membuat layar putih/macet sehingga harus di-refresh:
 *   • layar memuat tidak tertutup   • tidak ada tampilan yang aktif
 *   • halaman aktif kosong           • lapisan gelap modal tertinggal
 */
function pastikanTampilanSehat() {
  try {
    if (!App.siap) return;

    const ov = document.getElementById('loadingOverlay');
    const gagal = !document.getElementById('loaderAksi').classList.contains('hidden');
    if (ov && ov.style.display !== 'none' && !gagal && App._overlayLamaSejak && Date.now() - App._overlayLamaSejak > 15000) {
      sembunyikanLoading();
    }
    if (ov && ov.style.display !== 'none' && !gagal) App._overlayLamaSejak = App._overlayLamaSejak || Date.now();
    else App._overlayLamaSejak = 0;

    const views = ['viewPublic', 'viewLogin', 'viewApp'];
    const adaView = views.some(function (v) { return !document.getElementById(v).classList.contains('hidden'); });
    if (!adaView) { if (App.sesi) tampilkanView('viewApp'); else showPublic(); }

    if (!document.getElementById('viewApp').classList.contains('hidden') && App.sesi && !App._memuatAwal) {
      const aktif = document.querySelector('#viewApp .page.active');
      if (!aktif) goApp(App.appPage || 'dashboard', true);
      else if (!aktif.firstElementChild && !aktif.textContent.trim()) {     // v5.0 — tanpa membaca seluruh HTML
        App._ulangKosong = (App._ulangKosong || 0) + 1;
        if (App._ulangKosong <= 2) goApp(App.appPage || 'dashboard', true);
      } else App._ulangKosong = 0;
    }
    if (!document.getElementById('viewPublic').classList.contains('hidden') &&
        !document.querySelector('#viewPublic .page.active')) {
      goPublic(App.pubPage || 'beranda');
    }
    if (bootstrapSiap()) rapikanModal();
  } catch (e) { /* pemeriksa tidak boleh menimbulkan error baru */ }
}

window.addEventListener('error', function () { setTimeout(pastikanTampilanSehat, 50); });
window.addEventListener('unhandledrejection', function (e) {
  console.warn('Promise tidak tertangani:', e.reason);
  setTimeout(pastikanTampilanSehat, 50);
});
window.addEventListener('pageshow', function () { setTimeout(pastikanTampilanSehat, 100); });
setInterval(pastikanTampilanSehat, 5000);

/**
 * Saat tab/aplikasi dibuka kembali setelah lama ditinggal (HP terkunci,
 * pindah aplikasi), tampilan diperiksa dan data disegarkan diam-diam di
 * latar belakang — tanpa layar memuat, tanpa melompat ke atas.
 */
document.addEventListener('visibilitychange', function () {
  if (document.hidden) { App._tersembunyiSejak = Date.now(); return; }
  setTimeout(pastikanTampilanSehat, 100);
  const lama = App._tersembunyiSejak ? Date.now() - App._tersembunyiSejak : 0;
  App._tersembunyiSejak = 0;
  if (lama < 10 * 60 * 1000) return;                     // < 10 menit: tidak perlu
  if (document.querySelector('.modal.show')) return;     // jangan ganggu formulir yang sedang diisi
  if (App.sesi && App.token && !document.getElementById('viewApp').classList.contains('hidden')) {
    muatWorkspace(false, true);                          // v5.0 — latar belakang
  } else if (App.siap && !App.sesi) {
    segarkanEtalaseDiam();
  }
});

/** Segarkan status kavling etalase publik di latar belakang. */
function segarkanEtalaseDiam() {
  call('getBootstrapData').then(function (res) {
    if (!res || !res.success) return;
    if (document.querySelector('.modal.show')) return;
    App.proyek = res.data.proyek;
    App.kavling = res.data.kavling;
    App.hero = res.data.hero || App.hero;
    App.testimoniPublik = res.data.testimoni || App.testimoniPublik;
    App.testimoniSetelan = res.data.testimoniSetelan || App.testimoniSetelan;
    App._terakhirSegar = Date.now();
    aturNavTestimoni();
    if (App.pubPage === 'testimoni') jalankanAman(renderHalamanTestimoni, null, 'testimoni');
    if (App.pubPage === 'beranda') jalankanAman(renderEtalaseAwal, null, 'beranda');
    else if (App.pubPage === 'daftarProyek') jalankanAman(function () { renderGridProyek('gridProyekSemua', App.proyek); }, null, 'daftarProyek');
  }).catch(function () { /* diam: tetap memakai data yang ada */ });
}

// ════════ BAGIAN 2 — INISIALISASI & TEMA ════════

document.addEventListener('DOMContentLoaded', function () {
  // Terapkan tema tersimpan lebih dulu agar tidak berkedip
  const tema = LS.get('theme', 'light');
  document.documentElement.setAttribute('data-theme', tema);
  syncThemeUI(tema);

  document.getElementById('footTahun').textContent = new Date().getFullYear();
  mulaiAplikasi(0);
});

/**
 * Muat data awal. Bila server lambat/gagal, dicoba ulang otomatis satu kali;
 * bila masih gagal, layar memuat berubah menjadi pesan + tombol "Coba Lagi"
 * (tidak pernah tertinggal layar putih kosong).
 */
function mulaiAplikasi(percobaan) {
  if (!percobaan && bootInstan()) return;          // v5.0 — refresh: tampil instan dari data terakhir
  statusMemuat('memuat');
  const pesanLambat = setTimeout(function () { statusMemuat('lambat'); }, 8000);

  call('getBootstrapData')
    .then(function (res) {
      if (!res || !res.success) throw new Error((res && res.message) || 'Data awal tidak dapat dimuat.');
      App.etalase = res.data.etalase;
      App.hero = res.data.hero || {};
      App.proyek = res.data.proyek;
      App.kavling = res.data.kavling;
      App.config = { kpr: res.data.kpr };
      App.testimoniPublik = res.data.testimoni || [];            // v4.4
      App.testimoniSetelan = res.data.testimoniSetelan || null;  // v4.4
      App.siap = true;
      App._terakhirSegar = Date.now();

      terapkanIdentitas();
      terapkanGayaTulisan();
      aturNavTestimoni();
      jalankanAman(renderEtalaseAwal, document.getElementById('pub-beranda'), 'renderEtalaseAwal');

      // Pulihkan sesi bila token masih tersimpan
      const token = LS.get('token', null) || SS.get('token', null);     // v4.9.3: + sesi tab
      if (token) {
        return call('pingSession', token).then(function (r) {
          if (r.success) {
            App.token = token; App.sesi = r.data;
            SS.set('token', token);
            pulihkanPosisiHalaman();                                       // v4.9.3
            masukDashboard();
            tandaiHalamanPulih();
          }
          else { LS.del('token'); lupakanSesiTab(); showPublic(); }
        }).catch(function () { showPublic(); });
      }
      showPublic();
    })
    .then(function () {
      clearTimeout(pesanLambat);
      sembunyikanLoading();
    })
    .catch(function (err) {
      clearTimeout(pesanLambat);
      if (percobaan < 1) {           // coba ulang otomatis satu kali
        statusMemuat('ulang');
        setTimeout(function () { mulaiAplikasi(percobaan + 1); }, 1500);
        return;
      }
      statusMemuat('gagal', (err && err.message) ||
        'Terjadi kesalahan. Pastikan setupAppEnvironment() sudah dijalankan.');
    });
}

function cobaMuatLagi() { mulaiAplikasi(0); }

/** Teks & tombol pada layar memuat sesuai keadaan. */
function statusMemuat(keadaan, pesan) {
  const ov = document.getElementById('loadingOverlay');
  const teks = document.getElementById('loaderTeks');
  const ring = document.getElementById('loaderRing');
  const aksi = document.getElementById('loaderAksi');
  if (!ov || !teks) return;
  ov.style.display = 'flex'; ov.style.opacity = '1';
  ring.classList.toggle('hidden', keadaan === 'gagal');
  aksi.classList.toggle('hidden', keadaan !== 'gagal');
  teks.textContent = {
    memuat: 'Memuat E-Catalog Properti…',
    lambat: 'Koneksi agak lambat, mohon tunggu sebentar…',
    ulang: 'Menghubungkan ulang ke server…',
    gagal: 'Gagal memuat: ' + (pesan || 'koneksi terputus') + ' Periksa internet Anda lalu tekan Coba Lagi.'
  }[keadaan] || '';
}

/** Tutup layar memuat setelah gaya tampilan (Bootstrap) siap — maksimal 9 detik menunggu. */
function sembunyikanLoading() {
  const ov = document.getElementById('loadingOverlay');
  const tutup = function () {
    ov.style.opacity = '0';
    setTimeout(function () { ov.style.display = 'none'; }, 280);
  };
  const css = (window.PustakaSiap && window.PustakaSiap.css) || Promise.resolve(true);
  let selesai = false;
  const sekali = function () { if (!selesai) { selesai = true; tutup(); } };
  css.then(sekali);
  setTimeout(sekali, 9000);
}

/** Terapkan identitas dinamis (logo, nama, warna) ke SELURUH halaman. */
function terapkanIdentitas() {
  const e = App.etalase || {};
  const nama = e.namaPerusahaan || 'E-Catalog Properti';
  const inisial = nama.trim().charAt(0).toUpperCase() || 'E';

  document.title = nama;
  const logoImg = e.logoUrl
    ? '<img src="' + esc(e.logoUrl) + '" alt="Logo" onerror="this.parentNode.innerHTML=\'<span class=&quot;brand-fallback&quot;>' + inisial + '</span>\'">'
    : '<span class="brand-fallback">' + inisial + '</span>';

  document.getElementById('pubLogoWrap').innerHTML = logoImg;
  document.getElementById('pubBrandName').textContent = nama;
  document.getElementById('appLogoWrap').innerHTML = e.logoUrl
    ? '<img src="' + esc(e.logoUrl) + '" alt="Logo">'
    : '<span class="s-logo-fallback">' + inisial + '</span>';
  document.getElementById('appBrandName').textContent = nama;
  document.getElementById('loginBrand').textContent = nama.toUpperCase();
  document.getElementById('loginLogoWrap').innerHTML = e.logoUrl
    ? '<img src="' + esc(e.logoUrl) + '" alt="Logo">'
    : '<i class="bi bi-house-heart"></i>';

  document.getElementById('footBrand').textContent = nama;
  document.getElementById('footNama').textContent = nama;
  document.getElementById('footDeskripsi').textContent = e.footer || '';
  document.getElementById('footAlamat').innerHTML = '<i class="bi bi-geo-alt"></i> ' + esc(e.alamat || '-');
  document.getElementById('footKontak').innerHTML =
    (e.email ? '<i class="bi bi-envelope"></i> ' + esc(e.email) + '<br>' : '') +
    (e.telepon ? '<i class="bi bi-telephone"></i> ' + esc(e.telepon) : '');

  // Warna utama & aksen dinamis dari Pengaturan Etalase
  if (e.warnaUtama) document.documentElement.style.setProperty('--primary', e.warnaUtama);
  if (e.warnaAksen) document.documentElement.style.setProperty('--accent', e.warnaAksen);
}

function toggleDarkMode() {
  const kini = document.documentElement.getAttribute('data-theme');
  const baru = kini === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', baru);
  LS.set('theme', baru);
  syncThemeUI(baru);
  perbaruiTemaChart();
}

function syncThemeUI(tema) {
  const tgl = document.getElementById('darkModeToggle');
  if (tgl) tgl.checked = tema === 'dark';
  const ic = document.getElementById('pubThemeIcon');
  if (ic) ic.className = tema === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
}

// ── Peralihan antar tampilan utama ──
function tampilkanView(id) {
  ['viewPublic', 'viewLogin', 'viewApp'].forEach(function (v) {
    document.getElementById(v).classList.toggle('hidden', v !== id);
  });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function showPublic() {
  tampilkanView('viewPublic');
  // v4.5: kembali dari dashboard → data etalase (termasuk testimoni baru) disegarkan
  if (App.siap && Date.now() - (App._terakhirSegar || 0) > 15000) segarkanEtalaseDiam();
}

function showLogin() {
  document.getElementById('loginAlert').classList.add('hidden');
  tampilkanView('viewLogin');
  bersihkanPenghalangLogin();                // v5.0.1
  setTimeout(function () {
    // v5.0.1 — jangan memindahkan kursor bila pengguna sudah mulai mengetik di salah satu kolom
    const a = document.activeElement;
    if (a && a.closest && a.closest('#formLogin')) return;
    document.getElementById('loginUser').focus();
  }, 200);
}

function infoLupaSandi() {
  showToast('Lupa Kata Sandi', 'Silakan hubungi Owner/Superadmin untuk mengatur ulang kata sandi Anda.', 'info');
}

/** Toggle lihat/sembunyikan kata sandi (PRD US-A5 AC1). */
function togglePassword(inputId, btn) {
  const inp = document.getElementById(inputId);
  const ic = btn.querySelector('i');
  if (inp.type === 'password') { inp.type = 'text'; ic.className = 'bi bi-eye-slash'; }
  else { inp.type = 'password'; ic.className = 'bi bi-eye'; }
  // Kursor tetap di kolom sandi agar bisa langsung lanjut mengetik
  const posisi = inp.value.length;
  inp.focus();
  try { inp.setSelectionRange(posisi, posisi); } catch (e) {}
}

// ════════ BAGIAN 3 — ETALASE PUBLIK (NAVIGASI 0ms) ════════

function goPublic(halaman, data) {
  App.pubPage = halaman;
  document.querySelectorAll('#viewPublic .page').forEach(function (s) { s.classList.remove('active'); });
  const target = document.getElementById('pub-' + halaman);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item-pub').forEach(function (n) {
    n.classList.toggle('active', n.dataset.pub === halaman);
  });
  document.getElementById('pubMenuMobile').classList.add('hidden');
  tampilkanView('viewPublic');

  if (halaman === 'daftarProyek') jalankanAman(function () { renderGridProyek('gridProyekSemua', App.proyek); }, null, 'daftarProyek');
  if (halaman === 'simulasiKpr') jalankanAman(hitungKPR, null, 'simulasiKpr');
  if (halaman === 'testimoni') jalankanAman(muatHalamanTestimoni, null, 'testimoni');   // v4.5
  window.scrollTo(0, 0);
}

function togglePubMenu() {
  document.getElementById('pubMenuMobile').classList.toggle('hidden');
}

// ── Gaya tulisan (font) etalase publik — dapat diubah Owner & Marketing ──
const FONT_ETALASE = {
  judul: [
    { n: 'Playfair Display', k: 'Klasik Mewah', f: 'serif' },
    { n: 'Cormorant Garamond', k: 'Elegan Butik', f: 'serif' },
    { n: 'Cinzel', k: 'Monumental (huruf kapital)', f: 'serif' },
    { n: 'Bodoni Moda', k: 'Majalah Premium', f: 'serif' },
    { n: 'DM Serif Display', k: 'Tegas Modern', f: 'serif' },
    { n: 'Lora', k: 'Hangat Klasik', f: 'serif' },
    { n: 'Libre Baskerville', k: 'Editorial', f: 'serif' },
    { n: 'Marcellus', k: 'Arsitektural', f: 'serif' },
    { n: 'Prata', k: 'Anggun Ramping', f: 'serif' },
    { n: 'Montserrat', k: 'Modern Geometris', f: 'sans-serif' },
    { n: 'Poppins', k: 'Ramah Modern', f: 'sans-serif' },
    { n: 'Raleway', k: 'Ramping Elegan', f: 'sans-serif' },
    { n: 'Josefin Sans', k: 'Art Deco', f: 'sans-serif' },
    { n: 'Plus Jakarta Sans', k: 'Kontemporer', f: 'sans-serif' }
  ],
  isi: [
    { n: 'Inter', k: 'Netral & Jelas', f: 'sans-serif' },
    { n: 'Poppins', k: 'Ramah Modern', f: 'sans-serif' },
    { n: 'Montserrat', k: 'Geometris', f: 'sans-serif' },
    { n: 'Nunito Sans', k: 'Lembut', f: 'sans-serif' },
    { n: 'Lato', k: 'Hangat', f: 'sans-serif' },
    { n: 'Open Sans', k: 'Mudah Dibaca', f: 'sans-serif' },
    { n: 'DM Sans', k: 'Rapi', f: 'sans-serif' },
    { n: 'Plus Jakarta Sans', k: 'Kontemporer', f: 'sans-serif' },
    { n: 'Raleway', k: 'Ramping', f: 'sans-serif' },
    { n: 'Source Sans 3', k: 'Profesional', f: 'sans-serif' },
    { n: 'Work Sans', k: 'Lugas', f: 'sans-serif' }
  ],
  sorotan: [
    { n: '', k: 'Sama dengan font judul (miring)' },
    { n: 'Great Vibes', k: 'Tulisan Tangan Mewah', f: 'cursive', skrip: true },
    { n: 'Dancing Script', k: 'Tulisan Tangan Santai', f: 'cursive', skrip: true },
    { n: 'Allura', k: 'Kaligrafi Halus', f: 'cursive', skrip: true },
    { n: 'Parisienne', k: 'Gaya Paris', f: 'cursive', skrip: true },
    { n: 'Pinyon Script', k: 'Undangan Klasik', f: 'cursive', skrip: true },
    { n: 'Satisfy', k: 'Kuas Tegas', f: 'cursive', skrip: true }
  ]
};

/** Paduan font siap pakai — satu klik untuk pengguna yang tidak ingin memilih satu per satu. */
const PADUAN_FONT = [
  { nama: 'Klasik Mewah', judul: 'Playfair Display', isi: 'Inter', sorotan: '' },
  { nama: 'Elegan Butik', judul: 'Cormorant Garamond', isi: 'Montserrat', sorotan: 'Great Vibes' },
  { nama: 'Monumental', judul: 'Cinzel', isi: 'Lato', sorotan: '' },
  { nama: 'Majalah Premium', judul: 'Bodoni Moda', isi: 'DM Sans', sorotan: '' },
  { nama: 'Modern Tegas', judul: 'DM Serif Display', isi: 'Plus Jakarta Sans', sorotan: '' },
  { nama: 'Hangat Keluarga', judul: 'Lora', isi: 'Nunito Sans', sorotan: 'Dancing Script' },
  { nama: 'Arsitektural', judul: 'Marcellus', isi: 'Raleway', sorotan: 'Parisienne' },
  { nama: 'Modern Bersih', judul: 'Poppins', isi: 'Poppins', sorotan: '' }
];

const FONT_BAWAAN = { judul: 'Playfair Display', isi: 'Inter', sorotan: '' };
const _fontDimuat = { 'Playfair Display': true, 'Inter': true };   // sudah dimuat di Index.html

function infoFont(nama) {
  const semua = FONT_ETALASE.judul.concat(FONT_ETALASE.isi, FONT_ETALASE.sorotan);
  return semua.find(function (x) { return x.n === nama; }) || { n: nama, f: 'sans-serif' };
}

/** Muat font dari Google Fonts sekali saja (API v1 toleran bila ketebalan tidak tersedia). */
function muatFontGoogle(nama) {
  if (!nama || _fontDimuat[nama] || !/^[A-Za-z0-9 ]{2,40}$/.test(nama)) return;
  _fontDimuat[nama] = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css?family=' + nama.replace(/ /g, '+') +
    ':300,400,500,600,700,400i,500i,600i&display=swap';
  document.head.appendChild(link);
}

function tumpukanFont(nama, cadangan) {
  return "'" + nama + "', " + (cadangan || infoFont(nama).f || 'sans-serif');
}

/** Pasang variabel font pada sebuah elemen (etalase publik atau kotak pratinjau). */
function pasangVarFont(el, font) {
  if (!el) return;
  font = font || FONT_BAWAAN;
  const judul = font.judul || FONT_BAWAAN.judul;
  const isi = font.isi || FONT_BAWAAN.isi;
  const sorot = font.sorotan || '';
  [judul, isi, sorot].forEach(muatFontGoogle);

  el.style.setProperty('--font-head', tumpukanFont(judul, infoFont(judul).f === 'serif' ? 'Georgia, serif' : 'sans-serif'));
  el.style.setProperty('--font-body', tumpukanFont(isi, "-apple-system, 'Segoe UI', sans-serif"));
  if (sorot) {
    el.style.setProperty('--font-hl', tumpukanFont(sorot, 'cursive'));
    el.style.setProperty('--hl-style', 'normal');
    el.style.setProperty('--hl-weight', '400');
    el.style.setProperty('--hl-size', '1.18em');
  } else {
    ['--font-hl', '--hl-style', '--hl-weight', '--hl-size'].forEach(function (v) { el.style.removeProperty(v); });
  }
}

/** Terapkan gaya tulisan tersimpan ke seluruh etalase publik. */
function terapkanGayaTulisan() {
  pasangVarFont(document.getElementById('viewPublic'), (App.hero || {}).font);
}

/** Sorot kata tertentu pada judul dengan warna emas. */
function sorotJudul(judul, highlight) {
  const teks = esc(judul || '');
  const hl = String(highlight || '').trim();
  if (!hl) return teks;
  const hlEsc = esc(hl);
  const idx = teks.toLowerCase().indexOf(hlEsc.toLowerCase());
  if (idx < 0) return teks;
  return teks.substring(0, idx) + '<span class="hl">' + teks.substr(idx, hlEsc.length) + '</span>' +
    teks.substring(idx + hlEsc.length);
}

function htmlKotakCari(ringkas) {
  const sufiks = ringkas ? 'Pv' : '';
  return '<div class="search-bar mx-auto" style="max-width:780px">' +
    '<div class="sb-field"><label><i class="bi bi-geo-alt"></i> Lokasi</label>' +
      '<select id="cariKota' + sufiks + '"><option value="">Semua Lokasi</option></select></div>' +
    '<div class="sb-field"><label><i class="bi bi-house"></i> Tipe Properti</label>' +
      '<select id="cariTipe' + sufiks + '"><option value="">Semua Tipe</option></select></div>' +
    '<div class="sb-field"><label><i class="bi bi-cash-stack"></i> Kisaran Harga</label>' +
      '<select id="cariHarga' + sufiks + '">' +
        '<option value="">Semua Harga</option>' +
        '<option value="0-1000000000">&lt; Rp 1 Miliar</option>' +
        '<option value="1000000000-2000000000">Rp 1 – 2 Miliar</option>' +
        '<option value="2000000000-3000000000">Rp 2 – 3 Miliar</option>' +
        '<option value="3000000000-999000000000">&gt; Rp 3 Miliar</option>' +
      '</select></div>' +
    '<button class="btn btn-brand"' + (ringkas ? ' type="button"' : ' onclick="cariProyek()"') + '>' +
      '<i class="bi bi-search"></i> <span class="d-none d-sm-inline">Cari</span></button>' +
  '</div>';
}

/**
 * Membangun HTML banner beranda sesuai gaya pilihan Owner.
 * @param {object} h konfigurasi hero
 * @param {boolean} ringkas true = versi pratinjau kecil di halaman Pengaturan
 */
function buildHeroHtml(h, ringkas) {
  h = h || {};
  const gaya = h.gaya || 'klasik';
  const foto = h.foto || (App.proyek.find(function (p) { return p.foto; }) || {}).foto || '';
  const judul = sorotJudul(h.judul, h.highlight);
  const eyebrow = h.label
    ? '<div class="hero-eyebrow hero-fade-in"><i class="bi bi-gem"></i> ' + esc(h.label) + '</div>' : '';
  const sub = h.subjudul
    ? '<p class="hero-sub hero-fade-in d2">' + esc(h.subjudul) + '</p>' : '';
  const cari = (h.tampilCari === false) ? '' :
    '<div class="mt-4 hero-fade-in d3">' + htmlKotakCari(ringkas) + '</div>';

  // ── Gaya 2: Split (teks kiri, foto kanan) ──
  if (gaya === 'split') {
    return '<div class="hero hero-split">' +
      '<div class="container"><div class="hero-grid">' +
        '<div>' + eyebrow +
          '<h1 class="hero-fade-in d1">' + judul + '</h1>' +
          '<div class="gold-rule hero-fade-in d1"></div>' + sub + cari +
        '</div>' +
        '<div class="hero-figure hero-fade-in d2">' +
          (foto ? '<img src="' + esc(foto) + '" alt="Banner">' : '<div class="empty"><i class="bi bi-buildings"></i></div>') +
          '<div class="frame"></div>' +
        '</div>' +
      '</div></div></div>';
  }

  // ── Gaya 3: Minimalis terang (tanpa foto) ──
  if (gaya === 'minimalis') {
    return '<div class="hero hero-minimal hero-center">' +
      '<div class="container text-center">' + eyebrow +
        '<h1 class="hero-fade-in d1">' + judul + '</h1>' +
        '<div class="gold-rule hero-fade-in d1"></div>' + sub + cari +
      '</div></div>';
  }

  // ── Gaya 1: Klasik (foto latar + gradasi) ──
  return '<div class="hero hero-center" style="' +
      (foto ? 'background-image:url(' + esc(foto) + ');' : '') +
      '--hero-ov:' + (h.overlay === undefined ? 72 : h.overlay) + '%">' +
    '<div class="container text-center">' + eyebrow +
      '<h1 class="hero-fade-in d1">' + judul + '</h1>' +
      '<div class="gold-rule hero-fade-in d1"></div>' + sub + cari +
    '</div></div>';
}

function renderHero() {
  const area = document.getElementById('heroArea');
  if (area) {
    area.innerHTML = buildHeroHtml(App.hero, false);
    isiFilterPencarian();
  }
}

/** Isi pilihan Lokasi & Tipe pada kotak pencarian (bila kotak ditampilkan). */
function isiFilterPencarian() {
  const selKota = document.getElementById('cariKota');
  const selTipe = document.getElementById('cariTipe');
  if (!selKota || !selTipe) return;

  const kota = [...new Set(App.proyek.map(function (p) { return p.kota; }).filter(Boolean))];
  selKota.innerHTML = '<option value="">Semua Lokasi</option>' +
    kota.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('');

  const tipe = [...new Set(App.kavling.map(function (k) { return k.tipe; }).filter(Boolean))];
  selTipe.innerHTML = '<option value="">Semua Tipe</option>' +
    tipe.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
}

/** Kartu statistik di bawah banner — otomatis atau diisi manual oleh Owner. */
function renderStatHero() {
  const h = App.hero || {};
  let kartu;

  if (h.statMode === 'manual') {
    kartu = (h.stat || []).filter(function (s) { return s.nilai || s.label; })
      .map(function (s) { return { i: s.ikon || 'buildings', v: s.nilai, l: s.label }; });
  } else {
    const tersedia = App.kavling.filter(function (k) { return k.status === 'Tersedia'; }).length;
    const terjual = App.kavling.filter(function (k) { return k.status === 'Terjual'; }).length;
    const totalKav = App.kavling.length || 1;
    const serap = Math.round(((totalKav - tersedia) / totalKav) * 100);
    kartu = [
      { i: 'buildings', v: App.proyek.length + '+', l: 'Proyek Perumahan Premium' },
      { i: 'patch-check', v: serap + '%', l: 'Tingkat Serapan Kavling' },
      { i: 'house-check', v: tersedia + ' Unit', l: 'Kavling Siap Dipesan' }
    ];
    if (terjual) kartu[1].l = serap + '% terserap • ' + terjual + ' unit terjual';
  }

  const el = document.getElementById('statEtalase');
  if (!el) return;
  if (!kartu.length) { el.innerHTML = ''; return; }
  const kolom = kartu.length === 1 ? 'col-12' : kartu.length === 2 ? 'col-md-6' : 'col-md-4';
  el.innerHTML = kartu.map(function (s) {
    return '<div class="' + kolom + '"><div class="stat-hero">' +
      '<div class="ic"><i class="bi bi-' + esc(s.i) + '"></i></div>' +
      '<div><div class="val">' + esc(s.v) + '</div><div class="lbl">' + esc(s.l) + '</div></div>' +
    '</div></div>';
  }).join('');
}

function renderEtalaseAwal() {
  renderHero();          // banner digambar lebih dulu agar elemen filter tersedia
  renderStatHero();

  const kota = [...new Set(App.proyek.map(function (p) { return p.kota; }).filter(Boolean))];
  document.getElementById('filterKota').innerHTML =
    '<span class="filter-chip active" onclick="filterKota(this,\'\')">Semua</span>' +
    kota.map(function (k) { return '<span class="filter-chip" onclick="filterKota(this,\'' + escJs(k) + '\')">' + esc(k) + '</span>'; }).join('');

  renderGridProyek('gridProyekBeranda', App.proyek.slice(0, 6));
  try { renderTestimoniBeranda(); } catch (e) { /* v4.4: testimoni opsional — etalase tetap tampil */ }
  renderFaqKpr();
  hitungKPR();
}

function filterKota(el, kota) {
  document.querySelectorAll('#filterKota .filter-chip').forEach(function (c) { c.classList.remove('active'); });
  el.classList.add('active');
  renderGridProyek('gridProyekBeranda', kota ? App.proyek.filter(function (p) { return p.kota === kota; }) : App.proyek.slice(0, 6));
}

function cariProyek() {
  const elKota = document.getElementById('cariKota');
  if (!elKota) { goPublic('daftarProyek'); return; }
  const kota = elKota.value;
  const tipe = document.getElementById('cariTipe').value;
  const harga = document.getElementById('cariHarga').value;

  let hasil = App.proyek.slice();
  if (kota) hasil = hasil.filter(function (p) { return p.kota === kota; });
  if (tipe || harga) {
    const batas = harga ? harga.split('-').map(Number) : null;
    hasil = hasil.filter(function (p) {
      return App.kavling.some(function (k) {
        if (k.idProyek !== p.id) return false;
        if (tipe && k.tipe !== tipe) return false;
        if (batas && (k.harga < batas[0] || k.harga > batas[1])) return false;
        return true;
      });
    });
  }
  goPublic('daftarProyek');
  renderGridProyek('gridProyekSemua', hasil);
  showToast('Hasil Pencarian', hasil.length + ' proyek ditemukan.', hasil.length ? 'success' : 'warning');
}

function statistikProyek(idProyek) {
  const kav = App.kavling.filter(function (k) { return k.idProyek === idProyek; });
  return {
    total: kav.length,
    tersedia: kav.filter(function (k) { return k.status === 'Tersedia'; }).length,
    proses: kav.filter(function (k) { return k.status === 'Proses KPR' || k.status === 'SP3K'; }).length,
    terjual: kav.filter(function (k) { return k.status === 'Terjual'; }).length,
    minHarga: kav.length ? Math.min.apply(null, kav.map(function (k) { return k.harga || 0; })) : 0,
    promo: kav.some(function (k) { return k.promoAktif; })
  };
}

function renderGridProyek(containerId, daftar) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!daftar.length) { el.innerHTML = '<div class="col-12">' + emptyState('search', 'Belum ada proyek', 'Proyek akan tampil di sini setelah ditambahkan oleh Owner.') + '</div>'; return; }

  el.innerHTML = daftar.map(function (p) {
    const s = statistikProyek(p.id);
    const foto = p.foto
      ? '<img src="' + esc(p.foto) + '" alt="' + esc(p.nama) + '" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;thumb-empty&quot;><i class=&quot;bi bi-buildings&quot;></i></div>\'">'
      : '<div class="thumb-empty"><i class="bi bi-buildings"></i></div>';
    return '<div class="col-md-6 col-lg-4"><div class="card-lux proyek-card">' +
      '<div class="thumb">' + foto +
        '<div class="badges">' +
          (s.promo ? '<span class="chip chip-gold">Promo Aktif</span>' : '') +
          (p.badge ? '<span class="chip chip-brand">' + esc(p.badge) + '</span>' : '') +
        '</div></div>' +
      '<div class="body">' +
        '<div class="text-muted-2" style="font-size:.76rem"><i class="bi bi-geo-alt"></i> ' + esc(p.kota || p.alamat) + '</div>' +
        '<h5>' + esc(p.nama) + '</h5>' +
        '<p class="desc">' + esc(p.deskripsi) + '</p>' +
        '<div class="d-flex gap-2 my-2 flex-wrap">' +
          '<span class="chip chip-ok">' + s.tersedia + ' Tersedia</span>' +
          '<span class="chip">' + s.total + ' Total Unit</span>' +
        '</div>' +
        '<div class="d-flex align-items-end justify-content-between mt-2">' +
          '<div><div class="text-muted-2" style="font-size:.72rem">Mulai dari</div>' +
          '<div class="font-head fw-bold" style="color:var(--primary);font-size:1.1rem">' + rp(s.minHarga) + '</div></div>' +
          '<button class="btn btn-sm btn-outline-brand" onclick="bukaDetailProyek(\'' + p.id + '\')">Lihat Detail</button>' +
        '</div>' +
      '</div></div></div>';
  }).join('');
}

// ── Detail proyek + daftar kavling ──
function bukaDetailProyek(idProyek) {
  const p = App.proyek.find(function (x) { return x.id === idProyek; });
  if (!p) return;
  App.proyekDetail = p;
  goPublic('detailProyek');

  document.getElementById('detailHero').innerHTML =
    '<div class="hero" style="padding:3.2rem 0 2.4rem;' + (p.foto ? 'background-image:url(' + esc(p.foto) + ')' : '') + '">' +
    '<div class="container">' +
      (p.badge ? '<span class="chip chip-gold mb-2">' + esc(p.badge) + '</span> ' : '') +
      '<span class="text-white-50" style="font-size:.84rem"><i class="bi bi-geo-alt"></i> ' + esc(p.alamat) + '</span>' +
      '<h1 class="mt-2 mb-2">' + esc(p.nama) + '</h1>' +
      '<p class="mx-0">' + esc(p.deskripsi) + '</p>' +
      '<button class="btn btn-sm btn-light-soft mt-2" onclick="goPublic(\'daftarProyek\')"><i class="bi bi-arrow-left"></i> Semua Proyek</button>' +
    '</div></div>';

  const blok = [...new Set(App.kavling.filter(function (k) { return k.idProyek === idProyek; })
    .map(function (k) { return k.blok; }))].sort();
  document.getElementById('fltBlok').innerHTML = '<option value="">Semua Blok</option>' +
    blok.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('');
  document.getElementById('fltStatus').value = '';
  document.getElementById('fltHarga').value = '';
  document.getElementById('fltCariKavling').value = '';

  const s = statistikProyek(idProyek);
  document.getElementById('statKavling').innerHTML =
    [['Total Unit', s.total, ''], ['Tersedia', s.tersedia, 'var(--success)'],
     ['Proses KPR', s.proses, 'var(--accent)'], ['Terjual', s.terjual, 'var(--primary)']]
    .map(function (r) {
      return '<div class="d-flex justify-content-between py-1" style="font-size:.84rem;border-bottom:1px solid var(--border)">' +
        '<span class="text-muted-2">' + r[0] + '</span><b style="' + (r[2] ? 'color:' + r[2] : '') + '">' + r[1] + ' Unit</b></div>';
    }).join('') +
    '<div class="mt-3 pt-3" style="border-top:1px solid var(--border)">' +
      (s.tersedia === 0
        ? '<div class="chip chip-gold mb-2"><i class="bi bi-hourglass-split"></i> Semua unit sudah dipesan</div>' +
          '<p class="text-muted-2 mb-2" style="font-size:.8rem">Daftarkan diri Anda pada antrean indent — kami hubungi begitu ada unit yang kembali tersedia karena pembatalan.</p>'
        : '<p class="text-muted-2 mb-2" style="font-size:.8rem">Unit incaran belum tersedia? Daftarkan diri Anda pada antrean indent.</p>') +
      '<button class="btn btn-sm ' + (s.tersedia === 0 ? 'btn-brand' : 'btn-outline-brand') + ' w-100" ' +
        'onclick="formIndentPublik(\'' + idProyek + '\')">' +
        '<i class="bi bi-person-plus"></i> Daftar Antrean Indent</button>' +
    '</div>';

  renderKavlingProyek();
}

function resetFilterKavling() {
  ['fltBlok', 'fltStatus', 'fltHarga'].forEach(function (id) { document.getElementById(id).value = ''; });
  document.getElementById('fltCariKavling').value = '';
  renderKavlingProyek();
}

const debounceRenderKavling = debounce(function () { renderKavlingProyek(); }, 220);

function renderKavlingProyek() {
  if (!App.proyekDetail) return;
  const idP = App.proyekDetail.id;
  const fBlok = document.getElementById('fltBlok').value;
  const fStatus = document.getElementById('fltStatus').value;
  const fHarga = document.getElementById('fltHarga').value;
  const fCari = document.getElementById('fltCariKavling').value.trim().toLowerCase();
  const urut = document.getElementById('fltUrut').value;

  let list = App.kavling.filter(function (k) { return k.idProyek === idP; });
  if (fBlok) list = list.filter(function (k) { return k.blok === fBlok; });
  if (fStatus) list = list.filter(function (k) { return k.status === fStatus; });
  if (fHarga) {
    const b = fHarga.split('-').map(Number);
    list = list.filter(function (k) { return k.harga >= b[0] && k.harga <= b[1]; });
  }
  if (fCari) {
    list = list.filter(function (k) {
      return (k.blok + '-' + k.nomor).toLowerCase().indexOf(fCari) >= 0 ||
        String(k.tipe).toLowerCase().indexOf(fCari) >= 0;
    });
  }

  // Urutan default: Blok → Nomor Kavling
  list.sort(function (a, b) {
    if (urut === 'murah') return a.harga - b.harga;
    if (urut === 'mahal') return b.harga - a.harga;
    if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok));
    return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
  });

  const area = document.getElementById('kavlingArea');
  const semua = App.kavling.filter(function (k) { return k.idProyek === idP; });
  const adaBebas = semua.some(function (k) { return k.status === 'Tersedia'; });

  const spanduk = (!adaBebas && semua.length)
    ? '<div class="card-lux p-3 p-md-4 mb-3" style="border-color:var(--accent);background:var(--accent-tint)">' +
        '<div class="d-flex align-items-center gap-3 flex-wrap">' +
          '<i class="bi bi-hourglass-split" style="font-size:1.8rem;color:var(--warning)"></i>' +
          '<div style="flex:1;min-width:220px">' +
            '<h5 class="mb-1">Seluruh unit sudah dipesan</h5>' +
            '<div class="text-muted-2" style="font-size:.86rem">Daftar antrean indent sekarang — bila ada pembatalan atau pengajuan KPR yang tidak disetujui bank, Anda yang pertama kami hubungi.</div>' +
          '</div>' +
          '<button class="btn btn-brand" onclick="formIndentPublik(\'' + idP + '\')">' +
            '<i class="bi bi-person-plus"></i> Daftar Antrean Indent</button>' +
        '</div></div>'
    : '';

  if (!list.length) {
    area.innerHTML = spanduk + emptyState('house-slash', 'Tidak ada kavling', 'Coba ubah filter pencarian Anda.');
    return;
  }

  // Kelompokkan per blok
  const grup = {};
  list.forEach(function (k) { (grup[k.blok] = grup[k.blok] || []).push(k); });

  area.innerHTML = spanduk + Object.keys(grup).sort().map(function (b) {
    const items = grup[b];
    const tersedia = items.filter(function (k) { return k.status === 'Tersedia'; }).length;
    const namaBlok = items[0].namaBlok ? ' — ' + esc(items[0].namaBlok) : '';
    return '<div class="d-flex align-items-end justify-content-between mb-2 mt-4">' +
      '<h4 class="mb-0">Blok ' + esc(b) + namaBlok + '</h4>' +
      '<span class="text-muted-2" style="font-size:.76rem;letter-spacing:.06em;text-transform:uppercase">' + tersedia + ' unit tersedia</span></div>' +
      '<div class="row g-3">' + items.map(kartuKavling).join('') + '</div>';
  }).join('');
}

function kartuKavling(k) {
  const bisa = k.status === 'Tersedia';
  const hargaAkhir = k.promoAktif ? Math.max(k.harga - k.promoNominal, 0) : k.harga;
  return '<div class="col-sm-6 col-xl-4"><div class="card-lux kavling-card' + (bisa ? '' : ' is-locked') + '">' +
    '<div class="kv-head mb-2">' +
      '<div><div class="text-muted-2" style="font-size:.72rem">Kavling</div>' +
      '<div class="kv-no">' + esc(k.blok) + ' - ' + esc(k.nomor) + '</div></div>' +
      '<span class="chip ' + chipStatus(k.status) + '">' + esc(k.status) + '</span>' +
    '</div>' +
    '<div class="kv-spec"><span>Luas Tanah / Bangunan</span><b>' + k.lt + 'm² / ' + k.lb + 'm²</b></div>' +
    '<div class="kv-spec"><span>Kamar Tidur / Mandi</span><b>' + k.kt + ' / ' + k.km + '</b></div>' +
    '<div class="kv-spec"><span>Tipe</span><b>' + esc(k.tipe || '-') + '</b></div>' +
    '<div class="d-flex justify-content-between align-items-end mt-2 mb-2">' +
      '<span class="text-muted-2" style="font-size:.78rem">' + (bisa ? 'Harga Estimasi' : 'Harga') + '</span>' +
      '<span class="kv-price">' + rp(hargaAkhir) + '</span></div>' +
    (k.promoAktif ? '<div class="promo-note mb-2"><i class="bi bi-patch-check"></i> ' + esc(k.promoKet || 'Promo spesial tersedia') + '</div>' : '') +
    (bisa
      ? '<button class="btn btn-brand w-100 mt-auto" onclick="mulaiPesan(\'' + k.id + '\')">Beli Sekarang</button>'
      : '<button class="btn btn-ghost w-100 mt-auto" disabled>' +
        (k.status === 'Terjual' ? 'Terjual' : 'Sedang Dalam Proses') + '</button>') +
    '</div></div>';
}

/** Formulir pendaftaran antrean indent untuk konsumen (tanpa login). */
function formIndentPublik(idProyek) {
  const p = App.proyek.find(function (x) { return x.id === idProyek; }) || {};
  const blok = [...new Set(App.kavling.filter(function (k) { return k.idProyek === idProyek; })
    .map(function (k) { return k.blok; }).filter(Boolean))].sort();
  const tipe = [...new Set(App.kavling.filter(function (k) { return k.idProyek === idProyek; })
    .map(function (k) { return k.tipe; }).filter(Boolean))];

  openModal('Daftar Antrean Indent — ' + (p.nama || ''),
    '<p class="text-muted-2" style="font-size:.88rem">Isi data berikut. Tim marketing kami akan menghubungi Anda begitu ada unit yang tersedia kembali. Pendaftaran ini <b>tidak dipungut biaya</b> dan tidak mengikat.</p>' +
    '<form id="formIndPub"><div class="row g-3">' +
      '<div class="col-md-6"><label class="form-label">Nama Lengkap <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="nama" required placeholder="Sesuai KTP"></div>' +
      '<div class="col-md-6"><label class="form-label">No. HP / WhatsApp <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="hp" required placeholder="08xxxxxxxxxx"></div>' +
      '<div class="col-md-6"><label class="form-label">Email</label>' +
        '<input type="email" class="form-control" name="email" placeholder="nama@email.com"></div>' +
      '<div class="col-md-6"><label class="form-label">NIK (opsional)</label>' +
        '<input class="form-control" name="nik" maxlength="16" placeholder="16 digit"></div>' +
      '<div class="col-md-4"><label class="form-label">Blok Diminati</label>' +
        '<select class="form-select" name="minatBlok"><option value="">Bebas / belum tentu</option>' +
        blok.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('') + '</select></div>' +
      '<div class="col-md-4"><label class="form-label">Tipe Diminati</label>' +
        '<select class="form-select" name="minatTipe"><option value="">Bebas</option>' +
        tipe.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
      '<div class="col-md-4"><label class="form-label">Rencana Pembayaran</label>' +
        '<select class="form-select" name="metode">' +
        '<option value="">Belum ditentukan</option><option>KPR</option><option>Cash</option><option>Tempo</option></select></div>' +
      '<div class="col-12"><label class="form-label">Catatan Tambahan</label>' +
        '<textarea class="form-control" name="catatan" rows="2" placeholder="Contoh: mencari yang hadap selatan, siap DP 20%"></textarea></div>' +
    '</div>' +
    '<input type="hidden" name="idProyek" value="' + esc(idProyek) + '">' +
    '</form>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnIndPub" onclick="kirimIndentPublik()">' +
    '<i class="bi bi-send"></i> Daftar Antrean</button>');
}

function kirimIndentPublik() {
  const form = document.getElementById('formIndPub');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const payload = {};
  Array.prototype.forEach.call(form.elements, function (el) { if (el.name) payload[el.name] = el.value; });

  const btn = document.getElementById('btnIndPub');
  tombolLoading(btn, true);

  call('simpanIndent', payload).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-send"></i> Daftar Antrean');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    closeModal();
    openModal('Pendaftaran Indent Berhasil',
      '<div class="text-center py-3">' +
      '<i class="bi bi-hourglass-split" style="font-size:3rem;color:var(--accent)"></i>' +
      '<h5 class="font-head mt-3">Terima kasih, ' + esc(payload.nama) + '!</h5>' +
      '<p class="text-muted-2">Anda telah masuk antrean indent dengan nomor:</p>' +
      '<div class="chip chip-brand" style="font-size:1rem;padding:.5rem 1.1rem">' + esc(res.data.idIndent) + '</div>' +
      '<p class="text-muted-2 mt-3" style="font-size:.86rem">Kami akan menghubungi Anda lewat WhatsApp begitu ada unit yang tersedia kembali.</p>' +
      '</div>',
      '<button class="btn btn-brand" data-bs-dismiss="modal">Tutup</button>', 'modal-md');
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-send"></i> Daftar Antrean');
    showToast('Error', err.message, 'danger');
  });
}

// ── Simulasi KPR ──
function formatRibuan(el) {
  const angkaSaja = el.value.replace(/[^0-9]/g, '');
  el.value = angkaSaja ? angkaSaja.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';
}

function setHargaKpr(v) {
  document.getElementById('kprHarga').value = angka(v);
  hitungKPR();
}

function nilaiKprHarga() {
  return Number(document.getElementById('kprHarga').value.replace(/[^0-9]/g, '')) || 0;
}

function hitungKPR() {
  const harga = nilaiKprHarga();
  const dpPersen = Number(document.getElementById('kprDp').value) || 0;
  const tenor = Number(document.getElementById('kprTenor').value) || 20;
  const bunga = Number(document.getElementById('kprBunga').value) || 7.5;

  const dp = harga * dpPersen / 100;
  const plafon = Math.max(harga - dp, 0);
  const i = bunga / 100 / 12;
  const n = tenor * 12;
  const cicilan = i > 0 ? plafon * i / (1 - Math.pow(1 + i, -n)) : plafon / n;
  const minGaji = cicilan * 3;

  document.getElementById('kprBungaLabel').textContent = String(bunga).replace('.', ',') + '%';
  document.getElementById('kprDpNominal').textContent = rp(dp);
  document.getElementById('kprCicilan').textContent = rp(cicilan);
  document.getElementById('kprPlafon').textContent = rp(plafon);
  document.getElementById('kprDpOut').textContent = rp(dp);
  document.getElementById('kprMinGaji').textContent = rp(minGaji);

  const provisi = plafon * 0.01;
  const admin = 250000;
  const asuransi = plafon * 0.008;
  document.getElementById('kprRincian').innerHTML =
    [['Biaya Provisi (1%)', provisi], ['Biaya Administrasi', admin],
     ['Estimasi Asuransi Jiwa & Kebakaran', asuransi]]
    .map(function (r) {
      return '<div class="d-flex justify-content-between py-2" style="font-size:.84rem;border-bottom:1px solid var(--border)">' +
        '<span class="text-muted-2">' + r[0] + '</span><b class="tabular">' + rp(r[1]) + '</b></div>';
    }).join('') +
    '<div class="d-flex justify-content-between pt-2"><b>Total Estimasi Dana Awal</b>' +
    '<b class="tabular" style="color:var(--primary)">' + rp(dp + provisi + admin + asuransi) + '</b></div>';

  const cta = document.getElementById('ctaCicilan');
  if (cta) {
    cta.textContent = rp(cicilan);
    document.getElementById('ctaBunga').textContent = 'Bunga ' + String(bunga).replace('.', ',') + '% p.a., tenor ' + tenor + ' tahun.';
  }
}

function renderFaqKpr() {
  const faq = [
    ['Apa saja syarat dokumen umum untuk mengajukan KPR?',
      'Umumnya: KTP pemohon (dan pasangan), Kartu Keluarga, surat nikah/cerai bila ada, NPWP, slip gaji 3 bulan terakhir atau laporan keuangan usaha, rekening koran 3–6 bulan, serta surat keterangan kerja.'],
    ['Berapa ideal cicilan KPR dibandingkan penghasilan bulanan?',
      'Bank umumnya menetapkan batas cicilan maksimal sepertiga (33%) dari penghasilan bersih bulanan. Karena itu kalkulator ini menampilkan estimasi minimal penghasilan sebesar 3× cicilan.'],
    ['Apa tips agar pengajuan KPR cepat disetujui bank?',
      'Pastikan riwayat kredit (SLIK/BI Checking) bersih, lengkapi berkas sejak awal, jaga rasio utang terhadap penghasilan tetap rendah, dan siapkan uang muka lebih besar bila memungkinkan.'],
    ['Apa itu suku bunga floating dan fixed?',
      'Bunga fixed tetap selama periode tertentu (mis. 3 tahun pertama) sehingga cicilan stabil. Setelah periode itu berlaku bunga floating yang mengikuti suku bunga pasar, sehingga cicilan dapat naik atau turun.']
  ];
  document.getElementById('faqKpr').innerHTML = faq.map(function (f, i) {
    return '<div class="accordion-item card-flat mb-2" style="overflow:hidden">' +
      '<h2 class="accordion-header"><button class="accordion-button collapsed" style="background:var(--card);color:var(--text);font-weight:500;font-size:.92rem" ' +
      'type="button" data-bs-toggle="collapse" data-bs-target="#faq' + i + '">' + esc(f[0]) + '</button></h2>' +
      '<div id="faq' + i + '" class="accordion-collapse collapse" data-bs-parent="#faqKpr">' +
      '<div class="accordion-body text-muted-2" style="font-size:.88rem">' + esc(f[1]) + '</div></div></div>';
  }).join('');
}

// ── Cek Status KPR (publik, via NIK) ──
function cekStatus() {
  const nik = document.getElementById('inputNikCek').value.trim();
  const box = document.getElementById('hasilCekStatus');
  if (!/^\d{16}$/.test(nik)) { showToast('NIK Tidak Valid', 'NIK harus terdiri dari 16 digit angka.', 'warning'); return; }

  box.innerHTML = skeleton(90, 1);
  call('cekStatusKPR', nik).then(function (res) {
    if (!res.success) { box.innerHTML = emptyState('search', 'Data tidak ditemukan', res.message); return; }
    const tahap = ['Diajukan', 'Lengkap 100%', 'SP3K', 'Jadwal Akad', 'Akad Selesai'];
    box.innerHTML = res.data.map(function (d) {
      const idx = Math.max(tahap.indexOf(d.statusBerkas), 0);
      const timeline = tahap.map(function (t, i) {
        const aktif = i <= idx;
        return '<div class="d-flex align-items-start gap-2 mb-2">' +
          '<i class="bi bi-' + (aktif ? 'check-circle-fill' : 'circle') + '" style="color:' + (aktif ? 'var(--primary)' : 'var(--border)') + '"></i>' +
          '<div><div style="font-size:.86rem;font-weight:' + (i === idx ? '600' : '400') + '">' + t + '</div>' +
          (i === idx && d.tanggalAkad ? '<div class="text-muted-2" style="font-size:.78rem">' + tglIndo(d.tanggalAkad) + ' ' + esc(d.waktuAkad || '') + ' — ' + esc(d.lokasiAkad || '') + '</div>' : '') +
          '</div></div>';
      }).join('');
      return '<div class="card-lux p-4 mb-3">' +
        '<div class="d-flex flex-wrap justify-content-between gap-2 mb-3">' +
          '<div><div class="sect-label">' + esc(d.idTransaksi) + '</div>' +
          '<h5 class="mb-0">' + esc(d.nama) + '</h5>' +
          '<div class="text-muted-2" style="font-size:.84rem">' + esc(d.proyek) + ' • ' + esc(d.unit) + '</div></div>' +
          '<span class="chip ' + chipStatus(d.statusTransaksi) + '" style="height:fit-content">' + esc(d.statusTransaksi) + '</span>' +
        '</div>' +
        '<div class="row g-3"><div class="col-md-6">' + timeline + '</div>' +
        '<div class="col-md-6"><div class="card-flat p-3" style="background:var(--surface)">' +
          '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Metode</span><b>' + esc(d.metode) + '</b></div>' +
          '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Bank</span><b>' + esc(d.bank || '-') + '</b></div>' +
          '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Tanggal Pesan</span><b>' + tglIndo(d.tanggal) + '</b></div>' +
          '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Jadwal Akad</span><b>' + (d.tanggalAkad ? tglIndo(d.tanggalAkad) : 'Belum dijadwalkan') + '</b></div>' +
        '</div>' +
        (d.plafon > 0
          ? '<div class="card-flat p-3 mt-2" style="background:var(--info-bg);border-color:transparent">' +
              '<div class="sect-label mb-1"><i class="bi bi-bank"></i> Plafon Disetujui Bank</div>' +
              '<div class="font-head fw-bold" style="font-size:1.35rem;color:var(--primary)">' + rp(d.plafon) + '</div>' +
              (d.catatanBank ? '<div class="text-muted-2 mt-1" style="font-size:.8rem">' + esc(d.catatanBank) + '</div>' : '') +
            '</div>'
          : '') +
        '</div></div></div>';
    }).join('');
  }).catch(function (err) {
    box.innerHTML = emptyState('exclamation-triangle', 'Gagal memuat', err.message);
  });
}

// ════════ BAGIAN 4 — FORM PEMBELIAN (4 LANGKAH) ════════

const fileBuffer = {};   // { fileKtp: {data,name,mime}, ... }

function mulaiPesan(idKavling) {
  const k = App.kavling.find(function (x) { return x.id === idKavling; });
  if (!k) return;
  if (k.status !== 'Tersedia') { showToast('Tidak Tersedia', 'Kavling ini sudah tidak dapat dipesan.', 'warning'); return; }

  App.kavlingPilih = k;
  App.step = 1;
  document.getElementById('formBeli').reset();
  Object.keys(fileBuffer).forEach(function (k2) { delete fileBuffer[k2]; });
  ['boxKtp', 'boxKk', 'boxBukti'].forEach(function (id) {
    const b = document.getElementById(id);
    b.classList.remove('has-file');
  });

  // Pulihkan draft (Optimistic UI + LocalStorage)
  const draft = LS.get('draftBeli', null);
  if (draft && draft.nik) {
    Object.keys(draft).forEach(function (key) {
      const el = document.querySelector('#formBeli [name="' + key + '"]');
      if (el) el.value = draft[key];
    });
  }

  goPublic('formBeli');
  renderStep();
  renderKavlingTerpilih();
}

function renderKavlingTerpilih() {
  const k = App.kavlingPilih;
  if (!k) return;
  const p = App.proyek.find(function (x) { return x.id === k.idProyek; }) || {};
  const harga = k.promoAktif ? Math.max(k.harga - k.promoNominal, 0) : k.harga;
  document.getElementById('kavlingTerpilihBox').innerHTML =
    '<div style="width:64px;height:54px;border-radius:10px;overflow:hidden;flex:none;background:var(--surface-2)">' +
      (k.foto ? '<img src="' + esc(k.foto) + '" class="img-cover">' : '<div class="d-grid h-100" style="place-items:center"><i class="bi bi-house"></i></div>') +
    '</div>' +
    '<div class="flex-grow-1"><div class="sect-label">Kavling Dipilih</div>' +
    '<div class="fw-semibold">' + esc(p.nama || '') + ' — Blok ' + esc(k.blok) + ' No. ' + esc(k.nomor) + '</div>' +
    '<div class="text-muted-2" style="font-size:.8rem">Luas Tanah: ' + k.lt + 'm² • Bangunan: ' + k.lb + 'm² • Tipe ' + esc(k.tipe || '-') + '</div></div>' +
    '<div class="text-end"><div class="text-muted-2" style="font-size:.74rem">Total Estimasi Harga</div>' +
    '<div class="font-head fw-bold" style="color:var(--primary)">' + rp(harga) + '</div></div>';
}

function renderStep() {
  document.querySelectorAll('#stepper .step').forEach(function (s) {
    const n = Number(s.dataset.step);
    s.classList.toggle('active', n === App.step);
    s.classList.toggle('done', n < App.step);
    s.querySelector('.dot').innerHTML = n < App.step ? '<i class="bi bi-check-lg"></i>' : n;
  });
  document.querySelectorAll('.step-pane').forEach(function (p) {
    p.classList.toggle('active', Number(p.dataset.pane) === App.step);
  });
  document.getElementById('btnPrev').style.visibility = App.step === 1 ? 'hidden' : 'visible';
  const next = document.getElementById('btnNext');
  if (App.step === 4) {
    next.innerHTML = '<i class="bi bi-send-check"></i> Kirim Pemesanan';
    next.onclick = kirimPemesanan;
    renderRingkasan();
  } else {
    next.innerHTML = 'Lanjut <i class="bi bi-arrow-right"></i>';
    next.onclick = stepNext;
  }
  window.scrollTo({ top: 120, behavior: 'smooth' });
}

function stepNext() {
  if (!validasiStep(App.step)) return;
  simpanDraft();
  App.step = Math.min(App.step + 1, 4);
  renderStep();
}

function stepPrev() {
  App.step = Math.max(App.step - 1, 1);
  renderStep();
}

function validasiStep(step) {
  const form = document.getElementById('formBeli');
  if (step === 1) {
    const nama = form.nama.value.trim();
    const nik = form.nik.value.trim();
    const hp = form.hp.value.trim();
    if (!nama) { showToast('Lengkapi Data', 'Nama lengkap wajib diisi.', 'warning'); form.nama.focus(); return false; }
    if (!/^\d{16}$/.test(nik)) { showToast('NIK Tidak Valid', 'NIK harus 16 digit angka.', 'warning'); form.nik.focus(); return false; }
    if (!/^[0-9+\- ]{8,}$/.test(hp)) { showToast('No. HP Tidak Valid', 'Masukkan nomor HP yang benar.', 'warning'); form.hp.focus(); return false; }
  }
  if (step === 3) {
    if (!form.metode.value) { showToast('Lengkapi Data', 'Pilih metode pembelian.', 'warning'); return false; }
  }
  return true;
}

function simpanDraft() {
  const form = document.getElementById('formBeli');
  const draft = {};
  Array.prototype.forEach.call(form.elements, function (el) {
    if (el.name && el.type !== 'file') draft[el.name] = el.value;
  });
  LS.set('draftBeli', draft);   // Optimistic: tersimpan instan di perangkat
}

function onMetodeChange() {
  const kpr = document.getElementById('metodeBeli').value === 'KPR';
  document.getElementById('wrapBank').classList.toggle('hidden', !kpr);
}

/**
 * Perkecil ukuran gambar di sisi browser sebelum dikirim ke server.
 * Foto 4 MB dari kamera HP biasanya menyusut menjadi ±250 KB — inilah
 * yang membuat proses "Memproses" tidak lagi lama dan layar tidak membeku.
 */
function kompresGambar(file, maksPiksel, kualitas) {
  return new Promise(function (resolve, reject) {
    // Bukan gambar (mis. PDF) → kirim apa adanya
    if (!file.type || file.type.indexOf('image/') !== 0) {
      bacaSebagaiBase64(file).then(resolve).catch(reject);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      try {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        const skala = Math.min(1, (maksPiksel || 1600) / Math.max(w, h));
        w = Math.max(Math.round(w * skala), 1);
        h = Math.max(Math.round(h * skala), 1);

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        const dataUrl = canvas.toDataURL('image/jpeg', kualitas || 0.78);
        resolve({
          data: dataUrl.split(',')[1],
          name: String(file.name).replace(/\.[^.]+$/, '') + '.jpg',
          mime: 'image/jpeg',
          ukuran: Math.round(dataUrl.length * 0.75)
        });
      } catch (err) {
        URL.revokeObjectURL(url);
        bacaSebagaiBase64(file).then(resolve).catch(reject);
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      bacaSebagaiBase64(file).then(resolve).catch(reject);
    };
    img.src = url;
  });
}

function bacaSebagaiBase64(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      resolve({
        data: reader.result.split(',')[1],
        name: file.name,
        mime: file.type || 'application/octet-stream',
        ukuran: file.size
      });
    };
    reader.onerror = function () { reject(new Error('Gagal membaca file.')); };
    reader.readAsDataURL(file);
  });
}

/** Pilih file → kompres → simpan di memori. Server belum dipanggil di sini. */
function tandaiFile(inputId, boxId) {
  const input = document.getElementById(inputId);
  const box = document.getElementById(boxId);
  const file = input.files[0];
  if (!file) return;

  if (file.size > 10 * 1024 * 1024) {
    showToast('File Terlalu Besar', 'Ukuran maksimal 10 MB per dokumen.', 'warning');
    input.value = '';
    return;
  }

  const isiAsli = box.innerHTML;
  box.innerHTML = '<i class="bi bi-arrow-repeat"></i><div style="font-size:.86rem">Menyiapkan file…</div>';

  kompresGambar(file, 1600, 0.78).then(function (hasil) {
    if (hasil.ukuran > 6 * 1024 * 1024) {
      box.innerHTML = isiAsli;
      showToast('File Terlalu Besar', 'Dokumen ini masih di atas 6 MB. Silakan pakai file yang lebih kecil.', 'warning');
      input.value = '';
      return;
    }
    fileBuffer[inputId] = hasil;
    const kb = (hasil.ukuran / 1024).toFixed(0);
    const hemat = file.size > hasil.ukuran
      ? ' (dari ' + (file.size / 1024 / 1024).toFixed(1) + ' MB)'
      : '';
    box.classList.add('has-file');
    box.innerHTML = '<i class="bi bi-check-circle"></i>' +
      '<div style="font-size:.86rem">' + esc(hasil.name) + '</div>' +
      '<small>' + kb + ' KB' + hemat + ' — klik untuk mengganti</small>';
  }).catch(function () {
    box.innerHTML = isiAsli;
    showToast('Gagal', 'File tidak dapat dibaca. Coba file lain.', 'danger');
    input.value = '';
  });
}

function renderRingkasan() {
  const form = document.getElementById('formBeli');
  const k = App.kavlingPilih || {};
  const p = App.proyek.find(function (x) { return x.id === k.idProyek; }) || {};
  const baris = [
    ['Nama Konsumen', form.nama.value], ['NIK', form.nik.value],
    ['No. HP / WhatsApp', form.hp.value], ['Email', form.email.value || '-'],
    ['Pekerjaan', form.pekerjaan.value || '-'], ['Perusahaan', form.perusahaan.value || '-'],
    ['Proyek', p.nama || '-'], ['Unit Kavling', 'Blok ' + k.blok + ' No. ' + k.nomor],
    ['Metode Pembelian', form.metode.value],
    ['Bank Partner', form.bank ? (form.bank.value || '-') : '-'],
    ['Dokumen KTP', fileBuffer.fileKtp ? '✓ Terlampir' : '✗ Belum diunggah'],
    ['Dokumen KK', fileBuffer.fileKk ? '✓ Terlampir' : '✗ Belum diunggah'],
    ['Bukti Pembayaran', fileBuffer.fileBukti ? '✓ Terlampir' : '✗ Belum diunggah']
  ];
  document.getElementById('ringkasanPesanan').innerHTML =
    '<div class="card-flat p-3" style="background:var(--surface)">' +
    baris.map(function (b) {
      return '<div class="d-flex justify-content-between gap-3 py-1" style="font-size:.86rem;border-bottom:1px solid var(--border)">' +
        '<span class="text-muted-2">' + b[0] + '</span><b class="text-end">' + esc(b[1]) + '</b></div>';
    }).join('') + '</div>';
}

function kirimPemesanan() {
  const form = document.getElementById('formBeli');
  if (!document.getElementById('setuju').checked) {
    showToast('Persetujuan Diperlukan', 'Centang pernyataan persetujuan terlebih dahulu.', 'warning');
    return;
  }
  if (!App.kavlingPilih) {
    showToast('Kavling Belum Dipilih', 'Silakan pilih kavling terlebih dahulu.', 'warning');
    return;
  }

  // Payload RINGAN — tanpa file, agar tersimpan dalam hitungan detik
  const payload = {
    idKavling: App.kavlingPilih.id,
    nama: form.nama.value.trim(), nik: form.nik.value.trim(), hp: form.hp.value.trim(),
    email: form.email.value.trim(), pekerjaan: form.pekerjaan.value, perusahaan: form.perusahaan.value,
    jabatan: form.jabatan.value, penghasilan: form.penghasilan.value,
    metode: form.metode.value, bank: form.bank ? form.bank.value : '',
    marketing: form.marketing.value, catatan: form.catatan.value
  };

  const btn = document.getElementById('btnNext');
  const teksAsli = '<i class="bi bi-send-check"></i> Kirim Pemesanan';
  btn.innerHTML = '<span class="spinner-inline"></span> Menyimpan pemesanan…';
  btn.disabled = true;

  call('submitPembelian', payload).then(function (res) {
    btn.innerHTML = teksAsli;
    btn.disabled = false;
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }

    LS.del('draftBeli');
    const kv = App.kavling.find(function (x) { return x.id === payload.idKavling; });
    if (kv) kv.status = res.data.status;

    const jumlahDok = ['fileKtp', 'fileKk', 'fileBukti']
      .filter(function (k) { return fileBuffer[k]; }).length;

    openModal('Pemesanan Berhasil',
      '<div class="text-center py-3">' +
      '<i class="bi bi-patch-check-fill" style="font-size:3rem;color:var(--success)"></i>' +
      '<h5 class="font-head mt-3">Terima kasih, ' + esc(payload.nama) + '!</h5>' +
      '<p class="text-muted-2">Pemesanan Anda telah tercatat dengan nomor transaksi:</p>' +
      '<div class="chip chip-brand" style="font-size:1rem;padding:.5rem 1.1rem">' + esc(res.data.idTransaksi) + '</div>' +
      '<div id="statusUnggah" class="mt-3" style="font-size:.86rem;color:var(--muted)">' +
        (jumlahDok ? '<span class="spinner-inline" style="border-color:var(--primary-tint);border-top-color:var(--primary)"></span> Mengunggah dokumen…' : '') +
      '</div>' +
      '<p class="text-muted-2 mt-2" style="font-size:.84rem">Simpan nomor ini. Anda dapat memantau progres melalui menu <b>Cek Status KPR</b> dengan NIK Anda.</p>' +
      '</div>',
      '<button class="btn btn-ghost" data-bs-dismiss="modal" onclick="goPublic(\'daftarProyek\')">Lihat Proyek Lain</button>' +
      '<button class="btn btn-brand" data-bs-dismiss="modal" onclick="goPublic(\'cekStatus\')">Cek Status Saya</button>',
      'modal-md');

    renderKavlingProyek();

    // Dokumen & notifikasi diproses di LATAR BELAKANG — konsumen tidak menunggu
    unggahDokumenLatar(res.data.idTransaksi, res.data.tiket);
  }).catch(function (err) {
    btn.innerHTML = teksAsli;
    btn.disabled = false;
    showToast('Error', err.message, 'danger');
  });
}

function setStatusUnggah(html) {
  const el = document.getElementById('statusUnggah');
  if (el) el.innerHTML = html;
}

/** Unggah dokumen satu per satu (paket kecil) lalu kirim notifikasi. */
function unggahDokumenLatar(idTransaksi, tiket) {
  const antrean = [
    { jenis: 'ktp', file: fileBuffer.fileKtp, label: 'KTP' },
    { jenis: 'kk', file: fileBuffer.fileKk, label: 'Kartu Keluarga' },
    { jenis: 'bukti', file: fileBuffer.fileBukti, label: 'Bukti Pembayaran' }
  ].filter(function (a) { return a.file; });

  let i = 0;
  let gagal = 0;

  function lanjut() {
    if (i >= antrean.length) {
      if (antrean.length) {
        setStatusUnggah(gagal
          ? '<span style="color:var(--danger)"><i class="bi bi-exclamation-triangle"></i> ' + gagal +
            ' dokumen gagal diunggah. Tim marketing akan menghubungi Anda.</span>'
          : '<span style="color:var(--success)"><i class="bi bi-check-circle"></i> Semua dokumen berhasil diunggah.</span>');
      }
      ['fileKtp', 'fileKk', 'fileBukti'].forEach(function (k) { delete fileBuffer[k]; });
      call('kirimNotifikasiTransaksi', idTransaksi, tiket).catch(function () { /* notifikasi opsional */ });
      return;
    }

    const item = antrean[i++];
    setStatusUnggah('<span class="spinner-inline" style="border-color:var(--primary-tint);border-top-color:var(--primary)"></span> ' +
      'Mengunggah ' + item.label + ' (' + i + '/' + antrean.length + ')…');

    call('unggahDokumenTransaksi', idTransaksi, item.jenis, item.file, tiket)
      .then(function (r) { if (!r || !r.success) gagal++; lanjut(); })
      .catch(function () { gagal++; lanjut(); });
  }
  lanjut();
}

// ════════ BAGIAN 5 — LOGIN, MENU & ROUTER INTERNAL ════════

function doLogin(ev) {
  ev.preventDefault();
  const u = document.getElementById('loginUser').value;
  const p = document.getElementById('loginPass').value;
  const alertBox = document.getElementById('loginAlert');
  const btn = document.getElementById('btnLogin');
  // v5.0.1 — tombol "Go/Enter" keyboard HP ditekan berkali-kali: abaikan selama permintaan masih berjalan
  if (App._loginSejak && Date.now() - App._loginSejak < 26000) return;
  const urutLogin = App._urutLogin = (App._urutLogin || 0) + 1;
  App._loginSejak = Date.now();
  alertBox.classList.add('hidden');
  tombolLoading(btn, true);
  const TEKS_MASUK = 'Masuk <i class="bi bi-arrow-right"></i>';

  call('loginUser', u, p).then(function (res) {
    if (urutLogin !== App._urutLogin) return;              // v5.0.1 — jawaban percobaan lama
    App._loginSejak = 0;
    tombolLoading(btn, false, TEKS_MASUK);
    if (!res.success) {
      alertBox.textContent = res.message;
      alertBox.classList.remove('hidden');
      siapIsiUlangLogin();                                 // v5.0.1 — langsung bisa mengetik ulang
      return;
    }
    App.token = res.data.token;
    App.sesi = res.data;
    if (document.getElementById('ingatSaya').checked) LS.set('token', res.data.token);
    SS.set('token', res.data.token);           // v4.9.3: refresh halaman tidak keluar dari aplikasi
    document.getElementById('formLogin').reset();
    showToast('Berhasil Masuk', res.message, 'success');
    masukDashboard();
  }).catch(function (err) {
    if (urutLogin !== App._urutLogin) return;
    App._loginSejak = 0;
    tombolLoading(btn, false, TEKS_MASUK);
    alertBox.textContent = err && err.kode === 'TIMEOUT'
      ? 'Koneksi sedang lambat — silakan tekan Masuk sekali lagi.'
      : ((err && err.message) || 'Terjadi kesalahan koneksi. Silakan coba lagi.');
    alertBox.classList.remove('hidden');
    siapIsiUlangLogin();
  });
}

function doLogout() {
  konfirmasi('Keluar Aplikasi', 'Anda yakin ingin mengakhiri sesi ini?', function () {
    const t = App.token;
    App.token = null; App.sesi = null; LS.del('token');
    lupakanSesiTab();                        // v4.9.3
    hentikanPekerjaanLatar();                // v5.0.1
    call('logoutUser', t).catch(function () {});   // fire & forget
    showLogin();   // PRD US-A5 AC5: kembali ke layar login internal
  });
}

/** Definisi menu sidebar per peran (PRD bagian 7.3). */
function menuUntukRole(role) {
  if (role === 'Perbankan') {
    return [
      { g: '' },
      { id: 'dashboard', i: 'grid-1x2', t: 'Dashboard' },
      { id: 'pilihProyek', i: 'people', t: 'Data Konsumen' },
      { id: 'siteplan', i: 'map', t: 'Siteplan' },                            // v5.0
      { id: 'progresRumah', i: 'bricks', t: 'Progres Rumah' },               // v6.1
      { id: 'cekBi', i: 'shield-check', t: 'Cek ID BI' },
      { id: 'uploadBerkas', i: 'file-earmark-arrow-up', t: 'Upload Berkas' },
      { id: 'indentBank', i: 'hourglass-split', t: 'Data Indent' },          // v4.9.3
      { id: 'rekanan', i: 'person-badge', t: 'Rekap Rekanan Bank' },
      { id: 'jadwalAkad', i: 'calendar-event', t: 'Jadwal Akad' }
    ];
  }
  if (role === 'Marketing') {
    return [
      { g: '' },
      { id: 'dashboard', i: 'grid-1x2', t: 'Dashboard' },
      { id: 'pilihProyek', i: 'people', t: 'Data Konsumen' },
      { id: 'siteplan', i: 'map', t: 'Siteplan' },                            // v5.0
      { id: 'progresRumah', i: 'bricks', t: 'Progres Rumah' },               // v6.1
      { id: 'indent', i: 'hourglass-split', t: 'Data Indent' },
      { id: 'spr', i: 'file-earmark-text', t: 'SPR' },
      { id: 'ppjb', i: 'file-earmark-ruled', t: 'PPJB' },
      { id: 'formService', i: 'tools', t: 'Form Service' },
      { id: 'penagihan', i: 'cash-coin', t: 'Penagihan Biaya Akad' },
      { id: 'pembayaran', i: 'wallet2', t: 'Pembayaran Konsumen' },           // v5.1
      { g: 'Pengaturan' },
      { id: 'desainSpr', i: 'palette', t: 'Desain SPR' },
      { id: 'desainDokumen', i: 'file-earmark-richtext', t: 'Desain Service, PPJB & Tagihan' },
      { id: 'masterProyek', i: 'buildings', t: 'Master Proyek & Kavling' },
      { id: 'hargaPromo', i: 'tag', t: 'Edit Harga & Promo' },
      { id: 'desainEtalase', i: 'shop-window', t: 'Desain Tampilan Etalase' },
      { id: 'testimoni', i: 'chat-quote', t: 'Testimoni Konsumen' },
      { id: 'pengguna', i: 'person-gear', t: 'Manajemen Pengguna', lock: true }
    ];
  }
  // Owner / Superadmin
  return [
    { g: '' },
    { id: 'dashboard', i: 'grid-1x2', t: 'Dashboard' },
    { id: 'pilihProyek', i: 'people', t: 'Data Konsumen' },
    { id: 'siteplan', i: 'map', t: 'Siteplan' },                              // v5.0
    { id: 'progresRumah', i: 'bricks', t: 'Progres Rumah' },                 // v6.1
    { id: 'indent', i: 'hourglass-split', t: 'Data Indent' },
    { id: 'spr', i: 'file-earmark-text', t: 'SPR' },
    { id: 'ppjb', i: 'file-earmark-ruled', t: 'PPJB' },
    { id: 'formService', i: 'tools', t: 'Form Service' },
    { id: 'penagihan', i: 'cash-coin', t: 'Penagihan Biaya Akad' },
    { id: 'pembayaran', i: 'wallet2', t: 'Pembayaran Konsumen' },             // v5.1
    { id: 'rekanan', i: 'person-badge', t: 'Rekap Rekanan Bank' },
    { id: 'laporan', i: 'bar-chart', t: 'Laporan Gabungan' },
    { id: 'crm', i: 'person-lines-fill', t: 'CRM Kontak' },                    // v5.3
    { g: 'Pengaturan' },
    { id: 'desainSpr', i: 'palette', t: 'Desain SPR' },
    { id: 'desainDokumen', i: 'file-earmark-richtext', t: 'Desain Service, PPJB & Tagihan' },
    { id: 'masterProyek', i: 'buildings', t: 'Master Proyek & Kavling' },
    { id: 'hargaPromo', i: 'tag', t: 'Edit Harga & Promo' },
    { id: 'pengguna', i: 'person-gear', t: 'Manajemen Pengguna' },
    { id: 'desainEtalase', i: 'shop-window', t: 'Desain Tampilan Etalase' },
    { id: 'testimoni', i: 'chat-quote', t: 'Testimoni Konsumen' },
    { id: 'konfigurasi', i: 'sliders', t: 'Konfigurasi Sistem' },
    { id: 'notifWa', i: 'whatsapp', t: 'WhatsApp & Notifikasi' }              // v5.3
  ];
}

function renderSidebar() {
  const role = App.sesi.role;
  const menus = menuUntukRole(role);
  document.getElementById('sidebarNav').innerHTML = menus.map(function (m) {
    if (m.g !== undefined) return m.g ? '<li class="group-title">' + esc(m.g) + '</li>' : '';
    const terkunci = m.lock === true;
    return '<li><a data-menu="' + m.id + '" onclick="' +
      (terkunci ? 'menuTerkunci()' : 'goApp(\'' + m.id + '\')') + '">' +
      '<i class="bi bi-' + m.i + '"></i><span>' + esc(m.t) + '</span>' +
      (terkunci ? '<i class="bi bi-lock-fill lock"></i>' : '') + '</a></li>';
  }).join('');

  const nama = App.sesi.nama || App.sesi.username;
  document.getElementById('userNama').textContent = nama;
  document.getElementById('userRole').textContent = role === 'Owner' ? 'Owner / Superadmin' : role;
  document.getElementById('userAvatar').textContent = nama.charAt(0).toUpperCase();
  document.getElementById('topAvatar').textContent = nama.charAt(0).toUpperCase();
}

function menuTerkunci() {
  showToast('Akses Terbatas', 'Menu ini hanya dapat diakses oleh Owner / Superadmin.', 'warning');
}

function masukDashboard() {
  try { App.ntf.info = null; App.ntf.antrean = null; App.ntf.blast = null; App.crm.kontak = null; App.crm.pilih = {}; } catch (e) { /* v5.3 */ }
  try { App.kp = null; App.kpKonfig = null; } catch (e) { /* v6.1 */ }
  tampilkanView('viewApp');
  renderSidebar();
  muatWorkspace(true);
}

/**
 * @param {boolean} pertamaKali tampilkan kerangka memuat (saat baru masuk)
 * @param {boolean} latar v5.0 — penyegaran di latar belakang (lonceng / kembali ke tab):
 *        tampilan baru digambar ulang saat pengguna tidak sedang menyentuh / mengisi formulir.
 */
function muatWorkspace(pertamaKali, latar) {
  const target = document.getElementById('app-' + App.appPage);
  if (pertamaKali && target) target.innerHTML = skeleton(90, 4);
  if (pertamaKali) App._memuatAwal = true;
  // Nomor urut permintaan: jawaban lama yang datang terlambat diabaikan,
  // agar data terbaru tidak tertimpa data lama saat menyimpan berturut-turut.
  const urutan = App._urutMuat = (App._urutMuat || 0) + 1;
  // v5.0 — kirim penanda versi data yang sudah ada; bila sama, server menjawab "tidak berubah"
  const versiKirim = (!pertamaKali && App.versiData && App.transaksi) ? App.versiData : '';

  return call('getWorkspaceData', App.token, versiKirim).then(function (res) {
    if (urutan !== App._urutMuat) return;
    App._memuatAwal = false;
    if (!res.success) {
      if (res.message === 'SESSION_EXPIRED') { sesiHabis(); return; }
      if (pertamaKali) tampilkanKartuPulih(target, res.message, 'muatWorkspace(true)');
      showToast('Gagal Memuat', res.message, 'danger'); return;
    }
    App._terakhirSegar = Date.now();
    if (res.data && res.data.tidakBerubah) {                 // v5.0 — data sama: tidak perlu menggambar ulang
      if (res.data.sesi) App.sesi = res.data.sesi;
      // Dipanggil setelah menyimpan → halaman tetap digambar ulang seperti biasa (formulir di halaman ikut bersih)
      if (!latar || halamanAktifKosong()) {
        App._gambarDiam = true;
        try { goApp(App.appPage || 'dashboard', true); } finally { App._gambarDiam = false; }
      }
      return;
    }
    if (latar && penggunaSibuk()) {                         // v5.0 — tunda sampai pengguna selesai berinteraksi
      tundaTerapkanRuangKerja(res.data, urutan);
      return;
    }
    terapkanRuangKerja(res.data, pertamaKali);              // v5.0 — dipisah agar bisa dipakai ulang (tampil instan & tunda)
  }).catch(function (err) {
    if (urutan !== App._urutMuat) return;
    App._memuatAwal = false;
    const t = document.getElementById('app-' + App.appPage);
    // Halaman masih kosong / kerangka memuat → ganti dengan kartu "Coba Lagi"
    if (t && (pertamaKali || !t.innerHTML.trim() || t.querySelector('.skeleton'))) {
      tampilkanKartuPulih(t, err.message, 'muatWorkspace(true)');
    }
    if (latar) return;                                      // v5.0 — penyegaran latar gagal: diam, data lama tetap tampil
    showToast('Error', err.message, 'danger');
  });
}

/** v5.0 — terapkan data ruang kerja ke memori lalu gambar ulang halaman aktif. */
function terapkanRuangKerja(data, pertamaKali) {
  App.versiData = data.versiData || '';               // v5.0
  simpanCuplikanRuangKerja(data);                     // v5.0 — untuk tampil instan saat refresh
  App.proyek = data.proyek;
  App.kavling = data.kavling;
  App.transaksi = data.transaksi;
  App.dokumen = data.dokumen || [];
  App.indent = data.indent || [];
  App.users = data.users || [];
  App.testimoniAdmin = data.testimoni || [];                                   // v4.4
  App.dokumenDesain = data.dokumenDesain || App.dokumenDesain;                 // v4.6
  App.aturanMarketing = data.aturanMarketing || { hapus: 'semua', ubah: 'semua' }; // v4.6
  App.daftarBank = data.daftarBank || App.daftarBank || [];                   // v4.7
  App.penagihan = data.penagihan || [];                                         // v4.7
  App.rekanan = data.rekanan || [];                                             // v4.7
  App.kwitansiKeuangan = data.kwitansiKeuangan || {};                           // v4.9
  App.siteplan = data.siteplan || {};                                           // v5.0
  App.pembayaran = data.pembayaran || [];                                       // v5.1
  if (data.testimoniSetelan) App.testimoniSetelan = data.testimoniSetelan; // v4.4
  App.config = data.config || {};
  App.etalase = data.etalase;
  App.hero = data.hero || App.hero;
  App.sesi = data.sesi;
  terapkanIdentitas();
  terapkanGayaTulisan();
  renderSidebar();
  // Setelah menyimpan, halaman digambar ulang di posisi gulir yang sama
  // (tidak melompat ke atas) agar pengguna tetap melihat data yang baru diisi.
  App._gambarDiam = !pertamaKali;                         // v5.0 — grafik tidak dianimasikan ulang
  try { goApp(App.appPage || 'dashboard', !pertamaKali); } finally { App._gambarDiam = false; }
}

function refreshWorkspace() {
  showToast('Menyegarkan', 'Mengambil data terbaru dari server…', 'info');
  // v5.0 — cache server dikosongkan DULU, baru data diambil (agar benar-benar terbaru)
  call('segarkanCache', App.token).catch(function () {}).then(function () { muatWorkspace(false); });
}

const JUDUL_HALAMAN = {
  dashboard: 'Dashboard', pilihProyek: 'Data Konsumen', dataKonsumen: 'Data Konsumen',
  spr: 'Halaman SPR', uploadBerkas: 'Upload Berkas Konsumen', jadwalAkad: 'Manajemen Jadwal Akad',
  indent: 'Data Indent Konsumen',
  desainSpr: 'Desain SPR', masterProyek: 'Master Proyek & Kavling', hargaPromo: 'Edit Harga & Promo',
  pengguna: 'Manajemen Pengguna', desainEtalase: 'Desain Tampilan Etalase',
  konfigurasi: 'Konfigurasi Sistem', laporan: 'Laporan Gabungan',
  testimoni: 'Testimoni Konsumen', cekBi: 'Cek ID BI Konsumen',
  ppjb: 'PPJB — Perjanjian Pengikatan Jual Beli', formService: 'Form Service', desainDokumen: 'Desain Form Service, PPJB & Penagihan',
  penagihan: 'Penagihan DP & Biaya Akad', rekanan: 'Rekap Rekanan Bank',
  notifWa: 'WhatsApp & Notifikasi', crm: 'CRM Kontak',                           // v5.3
  progresRumah: 'Progres Rumah'                                                  // v6.1
};

/** Router internal — 0ms, tanpa reload & tanpa parameter URL. */
function goApp(halaman, tetapPosisi) {
  const posisiGulir = window.scrollY;
  App.appPage = halaman;
  document.querySelectorAll('#viewApp .page').forEach(function (s) { s.classList.remove('active'); });
  const el = document.getElementById('app-' + halaman);
  if (el) el.classList.add('active');

  document.querySelectorAll('#sidebarNav a').forEach(function (a) {
    const aktif = a.dataset.menu === halaman ||
      (halaman === 'dataKonsumen' && a.dataset.menu === 'pilihProyek');
    a.classList.toggle('active', aktif);
  });
  document.getElementById('appPageTitle').textContent = JUDUL_HALAMAN[halaman] || 'Dashboard';
  document.getElementById('globalSearchResult').innerHTML = '';
  closeSidebar();

  const perender = {
    dashboard: renderDashboard, pilihProyek: renderPilihProyek, dataKonsumen: renderDataKonsumen,
    spr: renderHalamanSPR, uploadBerkas: renderUploadBerkas, jadwalAkad: renderJadwalAkad,
    indent: renderIndent, indentBank: renderIndentBank,
    desainSpr: renderDesainSPR, masterProyek: renderMasterProyek, hargaPromo: renderHargaPromo,
    pengguna: renderPengguna, desainEtalase: renderDesainEtalase, konfigurasi: renderKonfigurasi,
    laporan: renderLaporan, testimoni: renderTestimoniAdmin, cekBi: renderCekBi,
    ppjb: function () { renderHalamanDokumen('ppjb'); }, formService: function () { renderHalamanDokumen('service'); },
    desainDokumen: renderDesainDokumen, penagihan: renderPenagihan, rekanan: renderRekanan,
    siteplan: renderSiteplan,                                                      // v5.0
    pembayaran: renderPembayaran,                                                  // v5.1
    notifWa: renderNotifWa, crm: renderCrm,                                        // v5.3
    progresRumah: renderProgresRumah                                               // v6.1
  };
  if (perender[halaman]) jalankanAman(perender[halaman], el, halaman);
  if (tetapPosisi) window.scrollTo(0, posisiGulir);
  else window.scrollTo({ top: 0, behavior: 'smooth' });
  simpanPosisiHalaman();                     // v4.9.3
  cekDataBasi();                             // v5.2.1
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('show');
  document.getElementById('sidebarBackdrop').classList.toggle('show');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('show');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}

// ── Pencarian global (lokal, tanpa RTT) ──
const globalSearchHandler = debounce(function () {
  const q = document.getElementById('globalSearch').value.trim().toLowerCase();
  const box = document.getElementById('globalSearchResult');
  if (q.length < 2) { box.innerHTML = ''; return; }

  const hasil = App.transaksi.filter(function (t) {
    return (t.nama + ' ' + t.nik + ' ' + t.id + ' ' + t.blok + '-' + t.nomor).toLowerCase().indexOf(q) >= 0;
  }).slice(0, 6);

  if (!hasil.length) { box.innerHTML = '<div class="card-flat p-3 text-muted-2" style="font-size:.86rem">Tidak ada hasil untuk "' + esc(q) + '".</div>'; return; }
  box.innerHTML = '<div class="card-lux p-2">' + hasil.map(function (t) {
    const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
    return '<div class="d-flex justify-content-between align-items-center p-2 cursor-pointer" onclick="bukaProyek(\'' + t.idProyek + '\')" style="border-bottom:1px solid var(--border)">' +
      '<div><b style="font-size:.9rem">' + esc(t.nama) + '</b>' +
      '<div class="text-muted-2" style="font-size:.78rem">' + esc(p.nama || '') + ' • Blok ' + esc(t.blok) + '-' + esc(t.nomor) + ' • ' + esc(t.id) + '</div></div>' +
      '<span class="chip ' + chipStatus(t.status) + '">' + esc(t.status) + '</span></div>';
  }).join('') + '</div>';
}, 250);

// ════════ BAGIAN 6 — DASHBOARD & GRAFIK ════════

/* Palet kategori tervalidasi (uji buta warna & kontras lolos untuk
   kedua mode). Urutan warna TETAP — tidak pernah diputar ulang. */
const PALET_TERANG = ['#9F3C59', '#C9A24B', '#1F8A70', '#4C6FD6', '#D1603D', '#8455C7'];
const PALET_GELAP  = ['#C4566E', '#B08636', '#2FA88A', '#6E8FDB', '#D0703F', '#9E7FD6'];

function modeGelap() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
function palet() { return modeGelap() ? PALET_GELAP : PALET_TERANG; }
function warnaSeri(i) { const p = palet(); return p[i % p.length]; }
function warnaTeksChart() { return modeGelap() ? '#C9BCBF' : '#6B5C60'; }
function warnaGrid() { return modeGelap() ? 'rgba(255,255,255,.08)' : 'rgba(36,26,30,.08)'; }

/* Warna status — dipesan khusus, tidak pernah dipakai sebagai "seri ke-4". */
function warnaStatus(kunci) {
  const gelap = modeGelap();
  const peta = {
    diajukan:  gelap ? '#B08636' : '#C9A24B',
    lengkap:   gelap ? '#2FA88A' : '#1B7F4B',
    sp3k:      gelap ? '#6E8FDB' : '#4C6FD6',
    akad:      gelap ? '#C4566E' : '#7A1F3D',
    selesai:   gelap ? '#9E7FD6' : '#5C0427',
    ditolak:   gelap ? '#F0564B' : '#BA1A1A'
  };
  return peta[kunci] || 'var(--muted)';
}

function buatChart(canvasId, konfigurasi) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (App.charts[canvasId]) { try { App.charts[canvasId].destroy(); } catch (e) {} delete App.charts[canvasId]; }

  // Chart.js belum termuat (CDN lambat) → tampilkan penanda, gambar ulang otomatis saat siap
  if (typeof window.Chart !== 'function') {
    ctx.style.display = 'none';
    if (!ctx.nextElementSibling || !ctx.nextElementSibling.classList.contains('grafik-tunggu')) {
      ctx.insertAdjacentHTML('afterend', '<div class="grafik-tunggu"><span><span class="spinner-inline"></span> Menyiapkan grafik…</span></div>');
    }
    if (!App._tungguChart && window.PustakaSiap) {
      App._tungguChart = true;
      window.PustakaSiap.chart.then(function () {
        App._tungguChart = false;
        if (typeof window.Chart === 'function' && App.sesi &&
            (App.appPage === 'dashboard' || App.appPage === 'laporan')) goApp(App.appPage, true);
      });
    }
    return;
  }
  // v5.0 — penyegaran data di latar: grafik langsung tampil tanpa animasi ulang (HP tidak tersendat)
  if (App._gambarDiam) { konfigurasi.options = konfigurasi.options || {}; konfigurasi.options.animation = false; }
  try {
    App.charts[canvasId] = new Chart(ctx, konfigurasi);
  } catch (e) {
    console.warn('Grafik gagal digambar:', canvasId, e);
  }
}

function perbaruiTemaChart() {
  // Grafik digambar ulang agar warna & teksnya mengikuti tema aktif
  if (App.appPage === 'dashboard' && App.sesi) renderDashboard();
  if (App.appPage === 'laporan' && App.sesi) renderLaporan();
}

function transaksiTerlihat() {
  const s = App.sesi;
  if (!s) return [];
  if (s.role === 'Perbankan') return App.transaksi.filter(function (t) { return t.metode === 'KPR'; });
  return App.transaksi;
}

function renderDashboard() {
  const role = App.sesi.role;
  if (role === 'Perbankan') return renderDashboardBank();
  return renderDashboardPenjualan(role === 'Owner');
}

// ── Dashboard Marketing & Owner (gaya portofolio) ──

/* Tangga warna maroon untuk besaran (terang→gelap), bukan warna acak. */
function rampMaroon(i, total) {
  const terang = ['#5C0427', '#7A1F3D', '#9F3C59', '#B8657C', '#D29CAA'];
  const gelap  = ['#F58AA3', '#E5788F', '#D2697F', '#BE5A70', '#A84C61'];
  const r = modeGelap() ? gelap : terang;
  if (total <= 1) return r[0];
  const idx = Math.round((i / (total - 1)) * (r.length - 1));
  return r[Math.min(idx, r.length - 1)];
}
function warnaEmas() { return modeGelap() ? '#EBC166' : '#C9A24B'; }

/** Daftar bulan untuk penyaring periode. */
function opsiPeriode(terpilih) {
  const out = ['<option value="">Seluruh Periode</option>'];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const label = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    out.push('<option value="' + key + '"' + (key === terpilih ? ' selected' : '') + '>' + label + '</option>');
  }
  return out.join('');
}

/** Target penjualan: diisi Owner di Konfigurasi, atau otomatis dari rata-rata 3 bulan. */
function targetNilaiBulanan() {
  const manual = toNum2((App.config || {}).targetNilaiBulanan);
  if (manual > 0) return { nilai: manual, sumber: 'target perusahaan' };
  const now = new Date();
  let total = 0, n = 0;
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    total += App.transaksi.filter(function (t) { return bulanKey(t.tanggal) === key; })
      .reduce(function (a, t) { return a + (t.harga || 0); }, 0);
    n++;
  }
  return { nilai: n ? Math.round(total / n) : 0, sumber: 'rata-rata 3 bulan' };
}

function targetUnitMarketing() {
  const manual = toNum2((App.config || {}).targetUnitMarketing);
  if (manual > 0) return manual;
  const per = {};
  App.transaksi.forEach(function (t) { const m = t.marketing || '-'; per[m] = (per[m] || 0) + 1; });
  const arr = Object.keys(per).map(function (k) { return per[k]; }).sort(function (a, b) { return a - b; });
  if (!arr.length) return 1;
  return Math.max(arr[Math.floor(arr.length / 2)], 1);
}

function toNum2(v) { const n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; }

function renderDashboardPenjualan(isOwner) {
  const el = document.getElementById('app-dashboard');
  const now = new Date();
  const bulanIni = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  App.periodeDash = App.periodeDash === undefined ? bulanIni : App.periodeDash;
  const periode = App.periodeDash;

  const dalamPeriode = function (t) { return !periode || bulanKey(t.tanggal) === periode; };
  const trxPeriode = App.transaksi.filter(dalamPeriode);

  // Bulan sebelumnya (untuk perbandingan MoM)
  const dPrev = periode
    ? new Date(Number(periode.split('-')[0]), Number(periode.split('-')[1]) - 2, 1)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const keyPrev = dPrev.getFullYear() + '-' + String(dPrev.getMonth() + 1).padStart(2, '0');
  const totalPeriode = trxPeriode.reduce(function (a, t) { return a + (t.harga || 0); }, 0);
  const totalPrev = App.transaksi.filter(function (t) { return bulanKey(t.tanggal) === keyPrev; })
    .reduce(function (a, t) { return a + (t.harga || 0); }, 0);
  const mom = totalPrev > 0 ? ((totalPeriode - totalPrev) / totalPrev) * 100 : null;

  const unitTerjual = trxPeriode.filter(function (t) { return t.status === 'Terjual'; }).length;
  const prosesKpr = App.transaksi.filter(function (t) { return t.status === 'Proses KPR' || t.status === 'SP3K'; });
  const menungguAkad = prosesKpr.filter(function (t) { return ['SP3K', 'Jadwal Akad'].indexOf(t.berkas.status) >= 0; }).length;
  const verifikasiBank = prosesKpr.filter(function (t) { return ['Diajukan', 'Lengkap 100%'].indexOf(t.berkas.status || 'Diajukan') >= 0; }).length;

  const target = targetNilaiBulanan();
  const capaiNilai = target.nilai > 0 ? Math.round((totalPeriode / target.nilai) * 100) : 0;

  // Target unit = target nilai dibagi rata-rata harga transaksi
  const rataHarga = App.transaksi.length
    ? App.transaksi.reduce(function (a, t) { return a + (t.harga || 0); }, 0) / App.transaksi.length : 0;
  const targetUnitTotal = rataHarga > 0 ? Math.max(Math.round(target.nilai / rataHarga), 1) : 0;
  const capaiUnit = targetUnitTotal > 0 ? Math.round((trxPeriode.length / targetUnitTotal) * 100) : 0;

  // Data per proyek pada periode terpilih
  let dataProyek = App.proyek.map(function (p) {
    const list = trxPeriode.filter(function (t) { return t.idProyek === p.id; });
    const kav = App.kavling.filter(function (k) { return k.idProyek === p.id; });
    return {
      id: p.id, nama: p.nama, unit: list.length,
      nilai: list.reduce(function (a, t) { return a + (t.harga || 0); }, 0),
      tersedia: kav.filter(function (k) { return k.status === 'Tersedia'; }).length,
      totalKav: kav.length
    };
  }).sort(function (a, b) { return b.nilai - a.nilai; });

  const filterProyek = App.filterProyekDash || '';
  if (filterProyek) dataProyek = dataProyek.filter(function (d) { return d.id === filterProyek; });

  const terlaris = dataProyek[0] || { nama: '—', unit: 0, totalKav: 0, tersedia: 0 };
  const persenTerlaris = terlaris.totalKav ? Math.round((terlaris.unit / terlaris.totalKav) * 100) : 0;

  // Proyek "potensi": stok tersedia terbanyak DI LUAR proyek terlaris — agar
  // sorotan emas tidak tumpang tindih dengan batang juara.
  const potensial = dataProyek.slice(1).sort(function (a, b) { return b.tersedia - a.tersedia; })[0] || null;

  // Sembunyikan proyek tanpa penjualan bila ada yang sudah terjual
  const adaPenjualan = dataProyek.some(function (d) { return d.nilai > 0; });
  const dataBar = adaPenjualan ? dataProyek.filter(function (d) { return d.nilai > 0; }) : dataProyek;

  const kpi = [
    { l: 'Total Penjualan ' + (periode ? 'Periode Ini' : 'Keseluruhan'), i: 'cash-coin',
      v: rpSingkat(totalPeriode),
      chip: mom === null
        ? '<span class="chip">' + trxPeriode.length + ' transaksi</span>'
        : '<span class="chip ' + (mom >= 0 ? 'chip-ok' : 'chip-danger') + '"><i class="bi bi-arrow-' +
          (mom >= 0 ? 'up' : 'down') + '-right"></i> ' + (mom >= 0 ? '+' : '') + mom.toFixed(1) + '% MoM</span>',
      note: 'Target: ' + rpSingkat(target.nilai) + ' · ' + capaiNilai + '%' +
        '<br><span style="opacity:.75">(' + target.sumber + ')</span>' },

    { l: 'Unit Terjual', i: 'building-check',
      v: unitTerjual + ' Unit',
      chip: targetUnitTotal > 0
        ? '<span class="chip ' + (capaiUnit >= 100 ? 'chip-ok' : 'chip-warn') + '">' +
          '<i class="bi bi-check-circle"></i> ' + capaiUnit + '% Target</span>'
        : '<span class="chip">' + trxPeriode.length + ' transaksi</span>',
      note: App.proyek.length + ' klaster aktif' +
        (targetUnitTotal > 0 ? '<br><span style="opacity:.75">(target ' + targetUnitTotal + ' unit)</span>' : '') },

    { l: 'Unit Proses KPR', i: 'bank',
      v: prosesKpr.length + ' Unit',
      chip: '<span class="chip chip-soft"><i class="bi bi-clock-history"></i> ' + menungguAkad + ' Menunggu Akad</span>',
      note: verifikasiBank + ' verifikasi bank' },

    { l: 'Proyek Terlaris', i: 'trophy', gaya: 'gold',
      v: terlaris.nama,
      chip: '<span class="chip chip-gold"><i class="bi bi-star-fill"></i> Terfavorit</span>',
      note: terlaris.unit + ' unit terjual (' + persenTerlaris + '%)' }
  ];

  el.innerHTML =
    // ── Kepala halaman ──
    '<div class="dash-head">' +
      '<div>' +
        '<h2>Dashboard Properti <span class="live-chip"><span class="dot"></span> Live Data</span></h2>' +
        '<div class="greet">Selamat datang kembali, <b>' + esc(App.sesi.nama) + '</b> • Portofolio Penjualan ' +
          esc(periode ? new Date(Number(periode.split('-')[0]), Number(periode.split('-')[1]) - 1, 1)
              .toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : 'Seluruh Periode') + '</div>' +
      '</div>' +
      '<div class="d-flex align-items-center gap-2 flex-wrap">' +
        '<span class="range-pill"><i class="bi bi-calendar3"></i>' +
          '<select id="periodeDash" onchange="gantiPeriodeDash(this.value)">' + opsiPeriode(periode) + '</select></span>' +
        '<button class="btn btn-sm btn-brand" onclick="unduhLaporanDashboard()"><i class="bi bi-download"></i> Unduh Laporan</button>' +
      '</div>' +
    '</div>' +

    // ── Kartu KPI ──
    '<div class="row g-3 mb-3">' + kpi.map(function (k) {
      return '<div class="col-sm-6 col-xl-3"><div class="kpi2 ' + (k.gaya || '') + '">' +
        '<div class="k-top"><div class="k-lbl">' + esc(k.l) + '</div>' +
          '<div class="k-ic"><i class="bi bi-' + k.i + '"></i></div></div>' +
        '<div class="k-val" title="' + esc(k.v) + '">' + esc(k.v) + '</div>' +
        '<div class="k-rule"></div>' +
        '<div class="k-foot">' + k.chip + '<div class="k-note">' + k.note + '</div></div>' +
      '</div></div>';
    }).join('') + '</div>' +

    // ── Grafik batang per proyek ──
    '<div class="card-lux p-3 p-md-4 mb-3">' +
      '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">' +
        '<div>' +
          '<h5 class="mb-1">Penjualan ' + (periode ? 'Bulanan ' : '') + 'per Proyek</h5>' +
          '<div class="text-muted-2" style="font-size:.82rem">Komparasi nilai perolehan bruto per kawasan perumahan</div>' +
        '</div>' +
        '<div class="d-flex align-items-center gap-3 flex-wrap">' +
          '<div class="legend-inline">' +
            '<span class="lg"><i style="background:' + rampMaroon(0, 5) + '"></i> Dominan</span>' +
            (potensial && potensial.tersedia > 0
              ? '<span class="lg"><i style="background:' + warnaEmas() + '"></i> Potensi Stok Terbesar</span>' : '') +
          '</div>' +
          '<span class="range-pill"><span class="text-muted-2" style="font-size:.78rem">Filter:</span>' +
            '<select id="filterProyekDash" onchange="gantiFilterProyekDash(this.value)">' +
              '<option value="">Semua Proyek</option>' +
              App.proyek.map(function (p) {
                return '<option value="' + p.id + '"' + (filterProyek === p.id ? ' selected' : '') + '>' + esc(p.nama) + '</option>';
              }).join('') +
            '</select></span>' +
        '</div>' +
      '</div>' +
      htmlVBars(dataBar, potensial) +
    '</div>' +

    // ── Tren 6 bulan ──
    '<div class="card-lux p-3 p-md-4 mb-3">' +
      '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">' +
        '<div>' +
          '<h5 class="mb-1">Tren Penjualan 6 Bulan Terakhir</h5>' +
          '<div class="text-muted-2" style="font-size:.82rem" id="trenSub">Pertumbuhan nilai transaksi properti</div>' +
        '</div>' +
        '<div class="legend-inline" id="trenLegend"></div>' +
      '</div>' +
      '<div style="height:230px"><canvas id="chartTren"></canvas></div>' +
    '</div>' +

    // ── Ranking marketing ──
    '<div class="card-lux p-3 p-md-4">' +
      '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">' +
        '<div>' +
          '<h5 class="mb-1">Ranking Marketing Terbaik</h5>' +
          '<div class="text-muted-2" style="font-size:.82rem">Evaluasi performa penjualan tenaga pemasar internal</div>' +
        '</div>' +
        '<span class="chip chip-soft">Periode: ' +
          esc(periode ? new Date(Number(periode.split('-')[0]), Number(periode.split('-')[1]) - 1, 1)
              .toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : 'Seluruh Periode') + '</span>' +
      '</div>' +
      '<div class="table-responsive" id="tabelRanking"></div>' +
    '</div>';

  renderChartTren();
  renderTabelRanking(trxPeriode);
}

function gantiPeriodeDash(v) { App.periodeDash = v; renderDashboard(); }
function gantiFilterProyekDash(v) { App.filterProyekDash = v; renderDashboard(); }

/** Grafik batang tegak dengan label nilai di atas tiap batang. */
function htmlVBars(data, potensial) {
  if (!data.length || data.every(function (d) { return d.nilai === 0; })) {
    return emptyState('bar-chart-line', 'Belum ada penjualan pada periode ini',
      'Pilih periode lain atau tunggu transaksi berikutnya tercatat.');
  }
  const maks = Math.max.apply(null, data.map(function (d) { return d.nilai; }));
  const garis = [0, 1, 2, 3].map(function (i) {
    return '<div class="grid-line" style="top:' + (26 + i * ((238 - 26) / 4)) + 'px"></div>';
  }).join('');

  return '<div class="vbars">' + garis + data.slice(0, 7).map(function (d, i) {
    const emas = potensial && d.id === potensial.id && d.tersedia > 0 && data.length > 1;
    const w = emas ? warnaEmas() : rampMaroon(i, Math.min(data.length, 7));
    const tinggi = maks > 0 ? Math.max((d.nilai / maks) * 176, d.nilai > 0 ? 6 : 3) : 3;
    const pillBg = emas ? 'var(--accent-tint)' : 'var(--info-bg)';
    const pillFg = emas ? 'var(--warning)' : 'var(--primary)';
    return '<div class="vbar" title="' + esc(d.nama) + ' — ' + rp(d.nilai) + ' • ' + d.unit + ' unit">' +
      '<div class="v-pill" style="background:' + pillBg + ';color:' + pillFg + '">' + rpSingkat(d.nilai) + '</div>' +
      '<div class="v-col" style="height:' + tinggi.toFixed(0) + 'px;background:' + w + '"></div>' +
      '<div class="v-name">' + esc(d.nama) + '</div>' +
      '<div class="v-sub">' + d.unit + ' Unit' + (d.tersedia ? ' • ' + d.tersedia + ' tersedia' : '') + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function renderChartTren() {
  const labels = [], kunci = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    kunci.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    labels.push(d.toLocaleDateString('id-ID', { month: 'short' }));
  }
  const nilai = kunci.map(function (k) {
    return +(App.transaksi.filter(function (t) { return bulanKey(t.tanggal) === k; })
      .reduce(function (a, t) { return a + (t.harga || 0); }, 0) / 1e6).toFixed(0);
  });

  const puncak = nilai.indexOf(Math.max.apply(null, nilai));
  const garis = modeGelap() ? '#D2697F' : '#7A1F3D';
  const emas = warnaEmas();
  const awal = nilai.find(function (v) { return v > 0; }) || 0;
  const akhir = nilai[nilai.length - 1];
  const tumbuh = awal > 0 ? Math.round(((akhir - awal) / awal) * 100) : 0;

  const lg = document.getElementById('trenLegend');
  if (lg) lg.innerHTML =
    '<span class="lg"><i style="background:' + garis + '"></i> Realisasi Penjualan</span>' +
    '<span class="lg"><i style="background:' + emas + '"></i> Bulan Puncak</span>' +
    (awal > 0 ? '<span class="chip ' + (tumbuh >= 0 ? 'chip-ok' : 'chip-danger') + '">' +
      (tumbuh >= 0 ? '+' : '') + tumbuh + '%</span>' : '');
  const sub = document.getElementById('trenSub');
  if (sub) sub.textContent = 'Pertumbuhan nilai transaksi periode ' + labels[0] + ' – ' + labels[labels.length - 1];

  // Label gelembung pada titik tertinggi
  const pluginPuncak = {
    id: 'pillPuncak',
    afterDatasetsDraw: function (chart) {
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data[puncak]) return;
      const titik = meta.data[puncak];
      const teks = rpSingkat(nilai[puncak] * 1e6);
      const c = chart.ctx;
      c.save();
      c.font = '600 11px Inter, sans-serif';
      const w = c.measureText(teks).width + 16;
      let x = titik.x - w / 2;
      x = Math.max(chart.chartArea.left, Math.min(x, chart.chartArea.right - w));
      const y = Math.max(titik.y - 30, chart.chartArea.top + 2);
      c.fillStyle = garis;
      if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, 21, 7); c.fill(); }
      else c.fillRect(x, y, w, 21);
      c.fillStyle = '#fff';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(teks, x + w / 2, y + 11);
      c.restore();
    }
  };

  buatChart('chartTren', {
    type: 'line',
    plugins: [pluginPuncak],
    data: {
      labels: labels,
      datasets: [{
        label: 'Realisasi Penjualan',
        data: nilai,
        borderColor: garis,
        borderWidth: 2.4,
        tension: .42,
        fill: true,
        backgroundColor: function (ctx) {
          const area = ctx.chart.chartArea;
          if (!area) return 'transparent';
          const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
          g.addColorStop(0, modeGelap() ? 'rgba(210,105,127,.28)' : 'rgba(122,31,61,.16)');
          g.addColorStop(1, modeGelap() ? 'rgba(210,105,127,0)' : 'rgba(122,31,61,0)');
          return g;
        },
        pointRadius: function (c) { return c.dataIndex === puncak ? 7 : 5; },
        pointHoverRadius: 9,
        pointBackgroundColor: function (c) { return c.dataIndex === puncak ? emas : (modeGelap() ? '#201A1C' : '#FFFFFF'); },
        pointBorderColor: garis,
        pointBorderWidth: 2.4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 26 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function (it) { return it[0].label; },
            label: function (c) { return 'Realisasi: ' + rpSingkat(c.parsed.y * 1e6); }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 11 },
            color: function (c) { return c.index === puncak ? garis : warnaTeksChart(); },
            callback: function (v, i) { return i === puncak ? labels[i] + ' (Puncak)' : labels[i]; }
          }
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: warnaGrid(), drawTicks: false },
          ticks: { font: { size: 11 }, color: warnaTeksChart(), padding: 8,
            callback: function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + ' M' : v + ' Jt'; } }
        }
      }
    }
  });
}

function renderTabelRanking(trxPeriode) {
  const box = document.getElementById('tabelRanking');
  if (!box) return;

  const per = {};
  trxPeriode.forEach(function (t) {
    const m = t.marketing || 'Tanpa Marketing';
    per[m] = per[m] || { unit: 0, nilai: 0, proyek: {} };
    per[m].unit++; per[m].nilai += t.harga || 0;
    per[m].proyek[t.idProyek] = true;
  });
  const urut = Object.keys(per).sort(function (a, b) { return per[b].nilai - per[a].nilai; });

  if (!urut.length) {
    box.innerHTML = emptyState('people', 'Belum ada transaksi pada periode ini',
      'Peringkat akan tampil setelah ada penjualan tercatat.');
    return;
  }

  const targetUnit = targetUnitMarketing();
  const inisial = function (n) {
    return n.split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  };

  box.innerHTML = '<table class="rank-table"><thead><tr>' +
    '<th>Peringkat</th><th>Marketing</th><th class="text-center">Unit Terjual</th>' +
    '<th style="min-width:150px">Pencapaian Target</th><th>Status</th>' +
    '<th class="text-end">Total Nilai Penjualan</th>' +
  '</tr></thead><tbody>' +
  urut.map(function (nama, i) {
    const d = per[nama];
    const pct = Math.round((d.unit / targetUnit) * 100);
    const status = pct >= 120 ? { t: 'Top Performer', c: 'chip-gold' }
      : pct >= 100 ? { t: 'Target Tercapai', c: 'chip-soft' }
      : pct >= 70 ? { t: 'Hampir Target', c: 'chip' }
      : { t: 'Aktif', c: 'chip' };
    const warnaMeter = pct >= 120 ? warnaEmas() : pct >= 100 ? (modeGelap() ? '#D2697F' : '#7A1F3D') : (modeGelap() ? '#C56379' : '#9F3C59');
    const jumlahProyek = Object.keys(d.proyek).length;

    return '<tr>' +
      '<td><div class="d-flex align-items-center gap-2">' +
        '<div class="medal ' + (i < 3 ? 'm' + (i + 1) : '') + '">' +
          (i < 3 ? '<i class="bi bi-award-fill"></i>' : (i + 1)) + '</div>' +
        (i < 3 ? '<b style="font-size:.85rem">#' + (i + 1) + '</b>' : '') +
      '</div></td>' +
      '<td><div class="d-flex align-items-center gap-2">' +
        '<div class="avatar-mkt ' + (i === 1 ? 'g2' : i === 2 ? 'g3' : i > 2 ? 'g4' : '') + '">' + esc(inisial(nama)) + '</div>' +
        '<div><div style="font-weight:600;font-size:.88rem">' + esc(nama) + '</div>' +
        '<div class="text-muted-2" style="font-size:.74rem">' + jumlahProyek + ' proyek • ' + d.unit + ' transaksi</div></div>' +
      '</div></td>' +
      '<td class="text-center"><b>' + d.unit + ' Unit</b></td>' +
      '<td>' +
        '<div class="d-flex justify-content-between" style="font-size:.74rem">' +
          '<b style="color:' + warnaMeter + '">' + pct + '%</b>' +
          '<span class="text-muted-2">Target: ' + targetUnit + '</span></div>' +
        '<div class="target-meter"><span style="width:' + Math.min(pct, 100) + '%;background:' + warnaMeter + '"></span></div>' +
      '</td>' +
      '<td><span class="chip ' + status.c + '">' + status.t + '</span></td>' +
      '<td class="text-end"><b style="color:var(--primary)">' + rp(d.nilai) + '</b></td>' +
    '</tr>';
  }).join('') + '</tbody></table>';
}

/** Unduh ringkasan dashboard sebagai PDF (lewat dialog cetak). */
function unduhLaporanDashboard() {
  const e = App.etalase || {};
  const periode = App.periodeDash;
  const labelPeriode = periode
    ? new Date(Number(periode.split('-')[0]), Number(periode.split('-')[1]) - 1, 1)
        .toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    : 'Seluruh Periode';
  const trx = App.transaksi.filter(function (t) { return !periode || bulanKey(t.tanggal) === periode; });
  const total = trx.reduce(function (a, t) { return a + (t.harga || 0); }, 0);

  const barisProyek = App.proyek.map(function (p) {
    const l = trx.filter(function (t) { return t.idProyek === p.id; });
    return '<tr><td>' + esc(p.nama) + '</td><td style="text-align:center">' + l.length + '</td>' +
      '<td style="text-align:right">' + rp(l.reduce(function (a, t) { return a + (t.harga || 0); }, 0)) + '</td></tr>';
  }).join('');

  const per = {};
  trx.forEach(function (t) {
    const m = t.marketing || 'Tanpa Marketing';
    per[m] = per[m] || { unit: 0, nilai: 0 };
    per[m].unit++; per[m].nilai += t.harga || 0;
  });
  const barisMkt = Object.keys(per).sort(function (a, b) { return per[b].nilai - per[a].nilai; })
    .map(function (m, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(m) + '</td>' +
        '<td style="text-align:center">' + per[m].unit + '</td>' +
        '<td style="text-align:right">' + rp(per[m].nilai) + '</td></tr>';
    }).join('');

  cetakHtml('<html><head><meta charset="utf-8"><title>Laporan Penjualan — ' + esc(labelPeriode) + '</title>' +
    '<style>body{font-family:Inter,Arial,sans-serif;padding:26px;color:#241A1E}' +
    'h2{font-family:Georgia,serif;color:#7A1F3D;margin:0}h3{font-family:Georgia,serif;margin:22px 0 6px}' +
    'table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}' +
    'th{background:#7A1F3D;color:#fff;text-align:left;padding:7px}td{padding:6px 7px;border-bottom:1px solid #E8DEDD}' +
    '.sum{background:#FBF1F4;font-weight:700}</style></head><body>' +
    '<h2>' + esc(e.namaPerusahaan || '') + '</h2>' +
    '<div style="font-size:11px;color:#6B5C60">' + esc(e.alamat || '') + '</div><hr>' +
    '<h3>Laporan Penjualan — ' + esc(labelPeriode) + '</h3>' +
    '<div style="font-size:11px;color:#6B5C60">Dicetak: ' + new Date().toLocaleString('id-ID') +
      ' • Oleh: ' + esc(App.sesi.nama) + '</div>' +
    '<h3>Rekap per Proyek</h3>' +
    '<table><thead><tr><th>Proyek</th><th style="text-align:center">Unit</th>' +
      '<th style="text-align:right">Nilai Penjualan</th></tr></thead><tbody>' + barisProyek +
      '<tr class="sum"><td>TOTAL</td><td style="text-align:center">' + trx.length + '</td>' +
      '<td style="text-align:right">' + rp(total) + '</td></tr></tbody></table>' +
    '<h3>Peringkat Marketing</h3>' +
    '<table><thead><tr><th>#</th><th>Marketing</th><th style="text-align:center">Unit</th>' +
      '<th style="text-align:right">Total Nilai</th></tr></thead><tbody>' + barisMkt + '</tbody></table>' +
    '</body></html>');
}

// ── Dashboard Tim Perbankan ──
function renderDashboardBank() {
  const el = document.getElementById('app-dashboard');
  const kpr = App.transaksi.filter(function (t) { return t.metode === 'KPR'; });
  const st = function (nama) { return kpr.filter(function (t) { return (t.berkas.status || 'Diajukan') === nama; }); };

  const diajukan = st('Diajukan').length;
  const lengkap = st('Lengkap 100%').length;
  const sp3k = st('SP3K').length;
  const jadwal = st('Jadwal Akad').length;
  const selesai = st('Akad Selesai').length;
  const ditolak = st('Ditolak').length;

  // Plafon nyata dari bank bila sudah ditetapkan; selain itu perkiraan 80% harga unit
  const aktif = kpr.filter(function (t) { return t.berkas.status !== 'Ditolak'; });
  const plafon = aktif.reduce(function (a, t) {
    return a + (t.berkas.plafon > 0 ? t.berkas.plafon : (t.harga || 0) * 0.8);
  }, 0);
  const sudahDitetapkan = aktif.filter(function (t) { return t.berkas.plafon > 0; }).length;
  const tuntas = selesai + jadwal;
  const persenTuntas = kpr.length ? Math.round((tuntas / kpr.length) * 100) : 0;

  const kpi = [
    { l: 'Total Pengajuan', v: kpr.length, s: 'seluruh proyek', i: 'inboxes', gaya: 'is-brand' },
    { l: 'Berkas Diajukan', v: diajukan, s: 'menunggu verifikasi', i: 'hourglass', gaya: 'is-warn' },
    { l: 'Berkas Lengkap 100%', v: lengkap, s: 'siap diproses bank', i: 'check2-square', gaya: 'is-ok' },
    { l: 'SP3K Terbit', v: sp3k, s: 'disetujui bank', i: 'file-earmark-check', gaya: 'is-gold' },
    { l: 'Jadwal Akad', v: jadwal, s: 'sudah terjadwal', i: 'calendar-check', gaya: 'is-brand' },
    { l: 'Akad Selesai', v: selesai, s: 'transaksi tuntas', i: 'patch-check', gaya: 'is-ok' }
  ];

  const tahap = [
    { n: 'Diajukan', v: diajukan, w: warnaStatus('diajukan'), ic: 'hourglass' },
    { n: 'Lengkap 100%', v: lengkap, w: warnaStatus('lengkap'), ic: 'check2-square' },
    { n: 'SP3K Terbit', v: sp3k, w: warnaStatus('sp3k'), ic: 'file-earmark-check' },
    { n: 'Jadwal Akad', v: jadwal, w: warnaStatus('akad'), ic: 'calendar-check' },
    { n: 'Akad Selesai', v: selesai, w: warnaStatus('selesai'), ic: 'patch-check' },
    { n: 'Ditolak', v: ditolak, w: warnaStatus('ditolak'), ic: 'x-octagon' }
  ];
  const maksTahap = Math.max.apply(null, tahap.map(function (t) { return t.v; }).concat([1]));

  const akad = kpr.filter(function (t) { return t.berkas.tanggalAkad; })
    .sort(function (a, b) { return String(a.berkas.tanggalAkad).localeCompare(String(b.berkas.tanggalAkad)); });

  const perluTindakan = kpr.filter(function (t) {
    return ['Diajukan', 'Lengkap 100%'].indexOf(t.berkas.status || 'Diajukan') >= 0;
  }).sort(function (a, b) { return String(a.tanggal).localeCompare(String(b.tanggal)); });

  el.innerHTML =
    '<div class="row g-2 g-md-3 mb-3">' + kpi.map(function (k) {
      return '<div class="col-6 col-lg-4 col-xl-2"><div class="kpi-tile ' + k.gaya + '">' +
        '<div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
        '<div style="min-width:0"><div class="kpi-lbl">' + esc(k.l) + '</div>' +
        '<div class="kpi-val">' + k.v + '</div>' +
        '<div class="kpi-sub">' + esc(k.s) + '</div></div></div></div>';
    }).join('') + '</div>' +

    '<div class="row g-3 mb-3">' +
      '<div class="col-xl-7"><div class="panel">' +
        '<div class="panel-head">' +
          '<h6>Pipeline Berkas KPR</h6>' +
          '<span class="chip chip-soft">' + persenTuntas + '% menuju akad</span>' +
        '</div>' +
        '<div class="panel-body tight">' +
          (kpr.length
            ? tahap.map(function (t) {
                const pct = kpr.length ? Math.round((t.v / kpr.length) * 100) : 0;
                return '<div class="pipe-row">' +
                  '<div class="pipe-ic" style="color:' + t.w + '"><i class="bi bi-' + t.ic + '"></i></div>' +
                  '<div class="pipe-name">' + t.n + '</div>' +
                  '<div class="pipe-track"><div class="pipe-fill" style="width:' +
                    Math.max((t.v / maksTahap) * 100, t.v > 0 ? 4 : 0).toFixed(1) + '%;background:' + t.w + '"></div></div>' +
                  '<div class="pipe-val" style="color:' + t.w + '">' + t.v +
                    ' <span class="pipe-pct">(' + pct + '%)</span></div>' +
                '</div>';
              }).join('') +
              '<div class="card-flat p-2 mt-2 d-flex justify-content-between align-items-center" style="background:var(--surface)">' +
                '<span class="text-muted-2" style="font-size:.78rem"><i class="bi bi-bank"></i> Total plafon aktif' +
                  (sudahDitetapkan ? ' <span class="chip chip-ok" style="font-size:.66rem">' + sudahDitetapkan +
                    ' dari ' + aktif.length + ' sudah final</span>' : ' (estimasi 80%)') + '</span>' +
                '<b style="color:var(--primary)">' + rp(plafon) + '</b></div>'
            : emptyState('inbox', 'Belum ada pengajuan KPR', 'Data muncul setelah ada pemesanan dengan metode KPR.')) +
        '</div>' +
      '</div></div>' +

      '<div class="col-xl-5"><div class="panel">' +
        '<div class="panel-head">' +
          '<h6><i class="bi bi-calendar-event" style="color:var(--accent)"></i> Akad Terdekat</h6>' +
          '<span class="text-muted-2" style="font-size:.74rem">' + akad.length + ' terjadwal</span>' +
        '</div>' +
        '<div class="panel-body"><div class="panel-scroll" style="--panel-h:214px">' +
          (akad.length ? akad.slice(0, 8).map(function (t) {
            const d = new Date(String(t.berkas.tanggalAkad).replace(' ', 'T'));
            const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
            const tgl = isNaN(d.getTime()) ? { d: '—', m: '' } : { d: d.getDate(), m: bulan[d.getMonth()] };
            const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
            return '<div class="mini-row cursor-pointer" onclick="formJadwalAkad(\'' + t.id + '\')">' +
              '<div class="mini-date"><div class="d">' + tgl.d + '</div><div class="m">' + tgl.m + '</div></div>' +
              '<div style="flex:1;min-width:0">' +
                '<div class="mini-name text-truncate">' + esc(t.nama) + '</div>' +
                '<div class="mini-sub text-truncate">' + esc(p.nama || '') + ' • Blok ' + esc(t.blok) + '-' + esc(t.nomor) + '</div>' +
              '</div>' +
              '<div class="text-end"><span class="chip ' + chipStatus(t.berkas.status) + '">' + esc(t.berkas.status || '-') + '</span>' +
              '<div class="mini-sub">' + esc(t.berkas.waktuAkad || '') + '</div></div>' +
            '</div>';
          }).join('') : emptyState('calendar-x', 'Belum ada jadwal akad', 'Jadwalkan dari menu Data Konsumen.')) +
        '</div></div>' +
      '</div></div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-head">' +
        '<h6><i class="bi bi-exclamation-circle" style="color:var(--accent)"></i> Perlu Tindakan Segera</h6>' +
        '<span class="text-muted-2" style="font-size:.74rem">' + perluTindakan.length + ' berkas menunggu</span>' +
      '</div>' +
      '<div class="panel-body"><div class="panel-scroll" style="--panel-h:148px">' +
        (perluTindakan.length ? perluTindakan.slice(0, 8).map(function (t) {
          const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
          const hari = Math.max(Math.floor((Date.now() - new Date(String(t.tanggal).replace(' ', 'T')).getTime()) / 86400000), 0);
          return '<div class="mini-row">' +
            '<div style="flex:1;min-width:0">' +
              '<div class="mini-name text-truncate">' + esc(t.nama) + '</div>' +
              '<div class="mini-sub text-truncate">' + esc(p.nama || '') + ' • Blok ' + esc(t.blok) + '-' + esc(t.nomor) +
              ' • ' + (isNaN(hari) ? '-' : hari + ' hari sejak pengajuan') + '</div>' +
            '</div>' +
            '<span class="chip ' + chipStatus(t.berkas.status || 'Diajukan') + '">' + esc(t.berkas.status || 'Diajukan') + '</span>' +
            '<button class="btn btn-sm btn-outline-brand" onclick="bankSetBerkas(\'' + t.id + '\')">Verifikasi</button>' +
          '</div>';
        }).join('') : emptyState('check2-circle', 'Semua berkas tertangani', 'Tidak ada berkas yang menunggu verifikasi.')) +
      '</div></div>' +
    '</div>';
}

// ════════ BAGIAN 7 — PILIH PROYEK & DATA KONSUMEN ════════

function renderPilihProyek() {
  const el = document.getElementById('app-pilihProyek');
  const role = App.sesi.role;

  el.innerHTML =
    '<div class="breadcrumb-lux">Data Konsumen / <b>Pilih Proyek</b></div>' +
    '<div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-4">' +
      '<h2 class="mb-0">Pilih Proyek Perumahan</h2>' +
      '<span class="text-muted-2" style="font-size:.84rem">Data konsumen dipisahkan tegas per proyek — tidak pernah tercampur.</span>' +
    '</div>' +
    '<div class="row g-4">' + App.proyek.map(function (p) {
      const trx = App.transaksi.filter(function (t) {
        return t.idProyek === p.id && (role !== 'Perbankan' || t.metode === 'KPR');
      });
      const s = statistikProyek(p.id);
      const persen = s.total ? Math.round((s.terjual / s.total) * 100) : 0;
      const foto = p.foto
        ? '<img src="' + esc(p.foto) + '" class="img-cover" loading="lazy">'
        : '<div class="thumb-empty"><i class="bi bi-buildings"></i></div>';
      return '<div class="col-md-6 col-xl-4"><div class="card-lux proyek-card">' +
        '<div class="thumb">' + foto +
          '<div class="badges">' + (p.badge ? '<span class="chip chip-brand">' + esc(p.badge) + '</span>' : '') + '</div>' +
          '<div style="position:absolute;top:.7rem;right:.7rem" class="chip chip-gold">' + trx.length + ' DATA</div>' +
        '</div>' +
        '<div class="body">' +
          '<div class="text-muted-2" style="font-size:.76rem"><i class="bi bi-geo-alt"></i> ' + esc(p.kota || '-') + '</div>' +
          '<h5>' + esc(p.nama) + '</h5>' +
          '<p class="desc">' + esc(p.deskripsi) + '</p>' +
          '<div class="card-flat p-2 my-2 d-flex justify-content-between" style="background:var(--surface)">' +
            '<div><div class="text-muted-2" style="font-size:.72rem">Total Kavling</div><b>' + s.total + ' Unit</b></div>' +
            '<div class="text-end"><div class="text-muted-2" style="font-size:.72rem">Terjual</div>' +
            '<b style="color:var(--primary)">' + s.terjual + ' Unit (' + persen + '%)</b></div>' +
          '</div>' +
          '<button class="btn btn-outline-brand w-100 mt-2" onclick="bukaProyek(\'' + p.id + '\')">Buka <i class="bi bi-arrow-right"></i></button>' +
        '</div></div></div>';
    }).join('') + '</div>' +
    (App.proyek.length ? '' : emptyState('buildings', 'Belum ada proyek', 'Owner dapat menambah proyek melalui menu Master Proyek & Kavling.'));
}

function bukaProyek(idProyek) {
  App.proyekAktif = App.proyek.find(function (p) { return p.id === idProyek; });
  goApp('dataKonsumen');
}

function renderDataKonsumen() {
  const el = document.getElementById('app-dataKonsumen');
  const p = App.proyekAktif;
  if (!p) { goApp('pilihProyek'); return; }
  const role = App.sesi.role;

  el.innerHTML =
    '<button class="btn btn-sm btn-ghost mb-2" onclick="goApp(\'pilihProyek\')"><i class="bi bi-arrow-left"></i> Kembali ke Daftar Proyek</button>' +
    '<h2 class="mb-1">Data Konsumen — ' + esc(p.nama) + '</h2>' +
    '<p class="text-muted-2">Kelola data pembeli, status verifikasi berkas, dan penjadwalan akad untuk proyek ini.</p>' +
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:280px">' +
        '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input type="text" class="form-control" id="dkCari" placeholder="Cari konsumen / NIK…" oninput="tundaCari(renderTabelKonsumen)">' +
      '</div>' +
      '<select class="form-select" style="max-width:190px" id="dkStatus" onchange="renderTabelKonsumen()">' +
        '<option value="">Semua Status</option><option>Proses KPR</option><option>SP3K</option><option>Terjual</option><option>Ditolak</option>' +
      '</select>' +
      '<select class="form-select" style="max-width:150px" id="dkBlok" onchange="renderTabelKonsumen()">' +
        '<option value="">Semua Blok</option>' +
        [...new Set(App.kavling.filter(function (k) { return k.idProyek === p.id; }).map(function (k) { return k.blok; }))].sort()
          .map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('') +
      '</select>' +
      '<div class="ms-auto d-flex gap-2">' +
        (role !== 'Perbankan' ? '<button class="btn btn-sm btn-outline-brand" onclick="formTransaksi()"><i class="bi bi-plus-lg"></i> Input Manual</button>' : '') +
        '<button class="btn btn-sm btn-brand" onclick="unduhPdfKonsumen()"><i class="bi bi-file-earmark-pdf"></i> Download PDF</button>' +
      '</div>' +
    '</div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>Blok</th><th>No. Kavling</th><th>Nama Konsumen</th><th>Metode</th>' +
      (role === 'Perbankan' ? '<th>Status Berkas</th>' : '<th>Marketing</th><th class="text-end">Nilai</th><th>Status</th>') +
      '<th class="text-end">Aksi</th>' +
    '</tr></thead><tbody id="tbodyKonsumen"></tbody></table></div>';

  renderTabelKonsumen();
}

function dataKonsumenTersaring() {
  const p = App.proyekAktif;
  const role = App.sesi.role;
  const q = (document.getElementById('dkCari') || {}).value || '';
  const st = (document.getElementById('dkStatus') || {}).value || '';
  const bl = (document.getElementById('dkBlok') || {}).value || '';

  return App.transaksi.filter(function (t) {
    if (t.idProyek !== p.id) return false;                       // pemisahan tegas per proyek
    if (role === 'Perbankan' && t.metode !== 'KPR') return false;
    if (st && t.status !== st) return false;
    if (bl && t.blok !== bl) return false;
    if (q) {
      const s = (t.nama + ' ' + t.nik + ' ' + t.hp + ' ' + t.id).toLowerCase();
      if (s.indexOf(q.toLowerCase()) < 0) return false;
    }
    return true;
  }).sort(function (a, b) {
    if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok));
    return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
  });
}

function renderTabelKonsumen() {
  const role = App.sesi.role;
  const list = dataKonsumenTersaring();
  const tbody = document.getElementById('tbodyKonsumen');
  const kolom = role === 'Perbankan' ? 6 : 8;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="' + kolom + '">' +
      emptyState('inbox', 'Belum ada data konsumen', 'Data akan muncul setelah ada pemesanan pada proyek ini.') + '</td></tr>';
    return;
  }

  let blokTerakhir = '';
  isiBertahap(tbody, list.map(function (t) {   // v5.0 — bertahap
    let head = '';
    if (t.blok !== blokTerakhir) {
      blokTerakhir = t.blok;
      const kav = App.kavling.find(function (k) { return k.idProyek === t.idProyek && k.blok === t.blok; }) || {};
      head = '<tr class="group-row"><td colspan="' + kolom + '">Blok ' + esc(t.blok) +
        (kav.namaBlok ? ' — ' + esc(kav.namaBlok) : '') + '</td></tr>';
    }
    const aksi = role === 'Perbankan'
      ? '<div class="d-flex flex-column gap-1 align-items-end">' +
        '<div class="d-flex gap-1">' +
          '<button class="btn btn-sm btn-ghost" onclick="detailTransaksi(\'' + t.id + '\')" title="Lihat data & dokumen konsumen"><i class="bi bi-eye"></i></button>' +
          '<button class="btn btn-sm btn-ghost" onclick="kelolaBerkasKpr(\'' + t.id + '\')" title="Kelola berkas KPR"><i class="bi bi-folder2-open"></i></button>' +
        '</div>' +
        '<button class="btn btn-sm btn-outline-brand" onclick="bankSetBerkas(\'' + t.id + '\')">Update Berkas</button>' +
        '<button class="btn btn-sm btn-outline-brand" onclick="formCekBi(\'' + t.id + '\')"><i class="bi bi-shield-check"></i> Cek ID BI</button>' +
        '<button class="btn btn-sm btn-outline-gold" onclick="formJadwalAkad(\'' + t.id + '\')">Jadwalkan Akad</button></div>'
      : '<div class="d-flex gap-1 justify-content-end">' +
        '<button class="btn btn-sm btn-ghost" onclick="detailTransaksi(\'' + t.id + '\')" title="Detail"><i class="bi bi-eye"></i></button>' +
        '<button class="btn btn-sm btn-ghost" onclick="kelolaPembayaran(\'' + t.id + '\')" title="Pembayaran, bukti & sisa"><i class="bi bi-wallet2"></i></button>' +   // v5.1
        '<button class="btn btn-sm btn-ghost" onclick="formTransaksi(\'' + t.id + '\')" title="Edit"><i class="bi bi-pencil"></i></button>' +
        '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="hapusTransaksi(\'' + t.id + '\')" title="Hapus / batalkan data konsumen"><i class="bi bi-trash"></i></button></div>';

    const tengah = role === 'Perbankan'
      ? '<td><span class="chip ' + chipStatus(t.berkas.status || 'Diajukan') + '">' + esc(t.berkas.status || 'Diajukan') + '</span>' +
        (t.berkas.plafon > 0
          ? '<div class="text-muted-2" style="font-size:.74rem;margin-top:.15rem">Plafon: <b>' + rpSingkat(t.berkas.plafon) + '</b></div>'
          : '') +
        '<div class="mt-1">' + chipBi(t) + '</div>' + chipBankProses(t) + '</td>'
      : '<td>' + esc(t.marketing || '-') + '</td>' +
        '<td class="text-end tabular">' + rpSingkat(t.harga) + '</td>' +
        '<td><span class="chip ' + chipStatus(t.status) + '">' + esc(t.status) + '</span>' +
        (t.metode === 'KPR' ? '<div class="mt-1">' + chipBi(t) + '</div>' + chipBankProses(t) : '') + chipKeuangan(t.id) + chipBayar(t) + '</td>';   // v5.1 chipBayar

    return head + '<tr>' +
      '<td><b>' + esc(t.blok) + '</b></td><td class="tabular">' + esc(t.nomor) + '</td>' +
      '<td><b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.76rem">NIK: ' + esc(String(t.nik).substring(0, 6)) + '…</div></td>' +
      '<td><span class="chip">' + esc(t.metode) + '</span></td>' +
      tengah + '<td class="text-end">' + aksi + '</td></tr>';
  }));
}

function detailTransaksi(id) {
  const t = App.transaksi.find(function (x) { return x.id === id; });
  if (!t) return;
  const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
  const baris = [
    ['Nomor Transaksi', t.id], ['Tanggal', tglIndo(t.tanggal)], ['Proyek', p.nama],
    ['Unit', 'Blok ' + t.blok + ' No. ' + t.nomor], ['Nama Konsumen', t.nama], ['NIK', t.nik],
    ['No. HP', t.hp], ['Email', t.email || '-'], ['Pekerjaan', t.pekerjaan || '-'],
    ['Perusahaan', t.perusahaan || '-'], ['Penghasilan', t.penghasilan || '-'],
    ['Metode Pembelian', t.metode], ['Marketing', t.marketing || '-'],
    ['Nilai Transaksi', rp(t.harga)], ['Status', t.status],
    ['Status Berkas KPR', t.berkas.status || '-'], ['Bank', t.berkas.bank || '-'],
    ['Plafon Disetujui', t.berkas.plafon > 0 ? rp(t.berkas.plafon) : 'Belum ditetapkan'],
    ['Jadwal Akad', t.berkas.tanggalAkad ? tglIndo(t.berkas.tanggalAkad) + ' ' + (t.berkas.waktuAkad || '') : 'Belum dijadwalkan']
  ];
  // v4.4 — hasil Cek ID BI (khusus KPR)
  const bi = (t.berkas && t.berkas.bi) || {};
  if (t.metode === 'KPR') {
    baris.push(['Hasil Cek ID BI', statusBi(t) + (bi.kol ? ' · ' + (KOL_BI[bi.kol] || 'Kol ' + bi.kol) : '')]);
    if (bi.tanggal) baris.push(['Tanggal Cek ID BI', tglIndo(bi.tanggal) + (bi.oleh ? ' · ' + bi.oleh : '')]);
    if (bi.catatan) baris.push(['Catatan ID BI', bi.catatan]);
  }
  const dok = [['Foto KTP', t.linkKtp], ['Kartu Keluarga', t.linkKk], ['Bukti Pembayaran', t.linkBukti]];
  if (bi.link) dok.push(['Hasil Cek ID BI', bi.link]);
  // v4.7 — internal: bank tujuan proses & SP3K
  if (t.metode === 'KPR') {
    baris.push(['Diproses ke Bank', t.berkas.bankProses ? t.berkas.bankProses + (t.berkas.bankProsesTgl ? ' · ' + tglIndo(t.berkas.bankProsesTgl) : '') : 'Belum ditentukan']);
    if (t.berkas.sp3kLink) dok.push(['Dokumen SP3K', t.berkas.sp3kLink]);
  }
  const berkasKpr = (App.dokumen || []).filter(function (d) { return d.idTransaksi === t.id; });

  openModal('Detail Transaksi — ' + t.nama,
    '<div class="row g-3"><div class="col-md-7">' +
      baris.map(function (b) {
        return '<div class="d-flex justify-content-between gap-3 py-1" style="font-size:.86rem;border-bottom:1px solid var(--border)">' +
          '<span class="text-muted-2">' + b[0] + '</span><b class="text-end">' + esc(b[1]) + '</b></div>';
      }).join('') +
    '</div><div class="col-md-5"><div class="sect-label mb-2">Dokumen Konsumen</div>' +
      dok.map(function (d) {
        return '<button class="btn btn-sm w-100 mb-2 ' + (d[1] ? 'btn-outline-brand' : 'btn-ghost') + '"' +
          (d[1] ? ' onclick="previewFile(\'' + escJs(d[1]) + '\',\'' + escJs(d[0]) + '\')"' : ' disabled') + '>' +
          '<i class="bi bi-' + (d[1] ? 'eye' : 'x-circle') + '"></i> ' + d[0] + (d[1] ? '' : ' (belum ada)') + '</button>';
      }).join('') +
      '<div class="sect-label mb-2 mt-3">Berkas KPR (' + berkasKpr.length + ')</div>' +
      (berkasKpr.length
        ? berkasKpr.map(function (b) {
            return '<button class="btn btn-sm btn-outline-gold w-100 mb-2 text-start" ' +
              'onclick="previewFile(\'' + escJs(b.link) + '\',\'' + escJs(b.jenis) + '\')">' +
              '<i class="bi bi-file-earmark-text"></i> ' + esc(b.jenis) + '</button>';
          }).join('')
        : '<div class="text-muted-2" style="font-size:.8rem">Belum ada berkas KPR diunggah.</div>') +
      (App.sesi.role !== 'Marketing'
        ? '<button class="btn btn-sm btn-brand w-100 mt-2" onclick="closeModal();setTimeout(function(){kelolaBerkasKpr(\'' + t.id + '\')},350)">' +
          '<i class="bi bi-folder2-open"></i> Kelola Berkas KPR</button>' : '') +
      (App.sesi.role === 'Perbankan' && t.metode === 'KPR'
        ? '<button class="btn btn-sm btn-outline-brand w-100 mt-2" onclick="closeModal();setTimeout(function(){formCekBi(\'' + t.id + '\')},350)">' +
          '<i class="bi bi-shield-check"></i> Input Hasil Cek ID BI</button>' : '') +
      (App.sesi.role !== 'Perbankan' ? htmlKeuangan(t.id) : '') +      // v4.9 — kwitansi dari SiKeu
      htmlRingkasBayar(t) +                                             // v5.1 — DP, akad, booking & sisa
    '</div></div>');
}

function hapusTransaksi(id) {
  const t = App.transaksi.find(function (x) { return x.id === id; });
  if (!t) return;
  if (!bolehMarketing(t, 'hapus')) {
    showToast('Akses Terbatas', 'Sesuai aturan perusahaan, Anda hanya dapat menghapus data konsumen milik Anda sendiri.', 'warning');
    return;
  }
  // v4.6 — hapus dengan alasan (salah input / konsumen batal), tercatat di pemberitahuan & log
  openModal('Hapus Data Konsumen',
    '<div class="card-flat p-3 mb-3" style="background:var(--surface)">' +
      '<b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.82rem">Blok ' + esc(t.blok) + ' No. ' + esc(t.nomor) +
      ' • ' + esc(t.metode) + ' • Marketing ' + esc(t.marketing || '-') + '</div></div>' +
    '<label class="form-label">Alasan Penghapusan</label>' +
    '<select class="form-select mb-2" id="hpsAlasan">' +
      '<option value="">— Pilih alasan —</option><option>Salah input data</option><option>Konsumen batal membeli</option>' +
      '<option>Data ganda / dobel</option><option>Lainnya</option></select>' +
    '<input class="form-control" id="hpsKet" maxlength="200" placeholder="Keterangan tambahan (wajib bila Lainnya)">' +
    '<div class="alert mt-3 mb-0" style="background:var(--danger-bg);border:none;color:var(--danger);font-size:.82rem">' +
      '<i class="bi bi-exclamation-triangle"></i> Data konsumen & berkas KPR-nya dihapus, kavling kembali <b>Tersedia</b> dan bisa diisi konsumen baru. ' +
      'Jejak penghapusan tetap tercatat di Log Aktivitas. Bila pembayaran sudah dikonfirmasi di SiKeu, data di SiKeu ditandai <b>Dibatalkan di E-Catalog</b>.</div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" style="background:var(--danger);border-color:var(--danger)" id="btnHps" onclick="prosesHapusTransaksi(\'' + escJs(id) + '\')">' +
      '<i class="bi bi-trash"></i> Hapus Data</button>',
    'modal-md');
}

function formTransaksi(id) {
  const t = id ? App.transaksi.find(function (x) { return x.id === id; }) : null;
  const p = App.proyekAktif;
  const kavTersedia = App.kavling.filter(function (k) {
    return k.idProyek === p.id && (k.status === 'Tersedia' || (t && k.id === t.idKavling));
  }).sort(function (a, b) {
    if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok));
    return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
  });

  const isi =
    '<form id="formTrx"><div class="row g-3">' +
      (t ? '' :
      '<div class="col-md-6"><label class="form-label">Kavling <span class="text-danger">*</span></label>' +
      '<select class="form-select" name="idKavling" required>' +
        kavTersedia.map(function (k) {
          return '<option value="' + k.id + '">Blok ' + esc(k.blok) + ' - ' + esc(k.nomor) + ' • ' + rpSingkat(k.harga) + '</option>';
        }).join('') + '</select></div>') +
      '<div class="col-md-6"><label class="form-label">Nama Konsumen <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="nama" required value="' + esc(t ? t.nama : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">NIK (16 digit) <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="nik" maxlength="16" required value="' + esc(t ? t.nik : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">No. HP <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="hp" required value="' + esc(t ? t.hp : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Email</label>' +
        '<input class="form-control" name="email" value="' + esc(t ? t.email : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Pekerjaan</label>' +
        '<input class="form-control" name="pekerjaan" value="' + esc(t ? t.pekerjaan : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Perusahaan</label>' +
        '<input class="form-control" name="perusahaan" value="' + esc(t ? t.perusahaan : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Metode Pembelian</label>' +
        '<select class="form-select" name="metode">' +
        ['KPR', 'Cash', 'Tempo'].map(function (m) {
          return '<option' + (t && t.metode === m ? ' selected' : '') + '>' + m + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Nama Marketing</label>' +
        '<input class="form-control" name="marketing" value="' + esc(t ? t.marketing : App.sesi.nama) + '"></div>' +
      (t ? '<div class="col-md-6"><label class="form-label">Nilai Transaksi (Rp)</label>' +
        '<input class="form-control" name="harga" value="' + (t.harga || 0) + '"></div>' : '') +
      '<div class="col-12"><label class="form-label">Catatan</label>' +
        '<textarea class="form-control" name="catatan" rows="2">' + esc(t ? t.catatan : '') + '</textarea></div>' +
      htmlUnggahDokumenManual(t) +                                          // v4.6
      (t ? '<div class="col-12"><div class="card-flat p-3 d-flex flex-wrap gap-2 align-items-center justify-content-between" style="background:var(--surface)">' +
        '<div><b style="font-size:.88rem"><i class="bi bi-arrow-left-right"></i> Pindah Unit</b>' +
        '<div class="text-muted-2" style="font-size:.78rem">Unit saat ini: Blok ' + esc(t.blok) + ' No. ' + esc(t.nomor) + '. Konsumen ingin pindah ke unit lain' +
          ' — atau dipindahkan ke daftar indent karena lama melengkapi berkas?</div></div>' +              // v5.2
        '<div class="d-flex gap-2 flex-wrap">' +
        '<button type="button" class="btn btn-sm btn-outline-brand" onclick="closeModal();setTimeout(function(){formPindahUnit(\'' + escJs(t.id) + '\')},350)">' +
        '<i class="bi bi-arrow-left-right"></i> Pindah Unit Konsumen</button>' +
        '<button type="button" class="btn btn-sm btn-outline-gold" onclick="closeModal();setTimeout(function(){formPindahUnit(\'' + escJs(t.id) + '\',\'indent\')},350)">' +   // v5.2
        '<i class="bi bi-hourglass-split"></i> Pindahkan ke Indent</button></div></div></div>' : '') +
    '</div></form>';

  openModal(t ? 'Edit Data Konsumen' : 'Input Transaksi Manual', isi,
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnSimpanTrx" onclick="simpanTransaksi(' + (t ? '\'' + t.id + '\'' : 'null') + ')">' +
    '<i class="bi bi-save"></i> Simpan</button>');
}

function simpanTransaksi(id) {
  const form = document.getElementById('formTrx');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const data = {};
  Array.prototype.forEach.call(form.elements, function (el) { if (el.name) data[el.name] = el.value; });
  data.id = id || '';

  if (data.nik && !/^\d{16}$/.test(String(data.nik).trim())) {
    showToast('NIK Tidak Valid', 'NIK harus 16 digit angka.', 'warning'); return;
  }

  const btn = document.getElementById('btnSimpanTrx');
  tombolLoading(btn, true);
  call('simpanTransaksiInternal', App.token, data).then(function (res) {
    if (!res.success) {
      tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
      showToast('Gagal', res.message, 'danger'); return;
    }
    // v4.6 — unggah KTP / KK / Bukti Bayar yang dipilih (baru maupun edit)
    const idTrx = id || (res.data && res.data.idTransaksi);
    const tiket = res.data && res.data.tiket;
    unggahDokumenManual(idTrx, tiket, btn, function (gagal, jumlah) {
      tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
      closeModal();
      showToast(gagal ? 'Sebagian Berhasil' : 'Berhasil',
        res.message + (jumlah ? (gagal ? ' ' + gagal + ' dari ' + jumlah + ' dokumen gagal diunggah — coba lagi lewat Edit.' : ' ' + jumlah + ' dokumen terunggah.') : ''),
        gagal ? 'warning' : 'success');
      muatWorkspace(false);
    });
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    showToast('Error', err.message, 'danger');
  });
}

/** Ekspor tabel aktif menjadi PDF melalui dialog cetak browser. */
function unduhPdfKonsumen() {
  const list = dataKonsumenTersaring();
  if (!list.length) { showToast('Kosong', 'Tidak ada data untuk diekspor.', 'warning'); return; }
  const p = App.proyekAktif;
  const e = App.etalase;

  const baris = list.map(function (t) {
    return '<tr><td>' + esc(t.blok) + '</td><td>' + esc(t.nomor) + '</td><td>' + esc(t.nama) + '</td>' +
      '<td>' + esc(t.nik) + '</td><td>' + esc(t.hp) + '</td><td>' + esc(t.metode) + '</td>' +
      '<td>' + esc(t.marketing || '-') + '</td><td style="text-align:right">' + rp(t.harga) + '</td>' +
      '<td>' + esc(t.status) + '</td></tr>';
  }).join('');
  const total = list.reduce(function (a, t) { return a + (t.harga || 0); }, 0);

  const html = '<html><head><meta charset="utf-8"><title>Data Konsumen — ' + esc(p.nama) + '</title>' +
    '<style>body{font-family:Inter,Arial,sans-serif;padding:26px;color:#241A1E}' +
    'h2{font-family:Georgia,serif;color:#7A1F3D;margin:0 0 2px}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:14px}' +
    'th{background:#7A1F3D;color:#fff;text-align:left;padding:7px}td{padding:6px 7px;border-bottom:1px solid #E8DEDD}' +
    'tfoot td{font-weight:700;background:#FBF1F4}</style></head><body>' +
    '<h2>' + esc(e.namaPerusahaan) + '</h2><div style="font-size:11px;color:#6B5C60">' + esc(e.alamat) + '</div><hr>' +
    '<h3 style="font-family:Georgia,serif">Laporan Data Konsumen — ' + esc(p.nama) + '</h3>' +
    '<div style="font-size:11px;color:#6B5C60">Dicetak: ' + new Date().toLocaleString('id-ID') + ' • Oleh: ' + esc(App.sesi.nama) + '</div>' +
    '<table><thead><tr><th>Blok</th><th>No.</th><th>Nama Konsumen</th><th>NIK</th><th>No. HP</th>' +
    '<th>Metode</th><th>Marketing</th><th style="text-align:right">Nilai</th><th>Status</th></tr></thead>' +
    '<tbody>' + baris + '</tbody>' +
    '<tfoot><tr><td colspan="7">TOTAL (' + list.length + ' transaksi)</td>' +
    '<td style="text-align:right">' + rp(total) + '</td><td></td></tr></tfoot></table></body></html>';

  cetakHtml(html);
}

/** Buka jendela cetak dari string HTML (dipakai untuk PDF & SPR). */
function cetakHtml(html) {
  html = rapikanCetak(html);                 // v5.1 — tanpa tulisan "about:blank", tanggal & nomor halaman dari browser
  const w = window.open('', '_blank', 'width=1024,height=720');
  if (!w) { showToast('Popup Diblokir', 'Izinkan popup pada browser untuk mencetak dokumen.', 'warning'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(function () { w.focus(); w.print(); }, 600);
}

// ════════ BAGIAN 8 — HALAMAN SPR ════════

function renderHalamanSPR() {
  const el = document.getElementById('app-spr');
  el.innerHTML =
    '<div class="row g-3">' +
      '<div class="col-lg-8">' +
        '<div class="card-lux p-3 mb-3">' +
          '<label class="form-label">Cari Konsumen berdasarkan NIK</label>' +
          '<div class="input-group">' +
            '<span class="input-group-text"><i class="bi bi-person-badge"></i></span>' +
            '<input class="form-control" id="sprNik" maxlength="16" placeholder="Masukkan 16 digit NIK konsumen">' +
            '<button class="btn btn-brand" id="btnCariSpr" onclick="cariSPR()"><i class="bi bi-search"></i> Cari &amp; Isi Otomatis</button>' +
          '</div>' +
          '<div class="mt-2 text-muted-2" style="font-size:.8rem">SPR akan terisi otomatis dari data transaksi konsumen.</div>' +
        '</div>' +
        '<div id="sprPrintArea">' + emptyState('file-earmark-text', 'Belum ada SPR ditampilkan', 'Masukkan NIK konsumen untuk membuat Surat Pemesanan Rumah.') + '</div>' +
      '</div>' +
      '<div class="col-lg-4">' +
        '<div class="card-lux p-3 mb-3">' +
          '<h6 class="font-head mb-2">Aksi Dokumen SPR</h6>' +
          '<p class="text-muted-2" style="font-size:.82rem">Unduh dokumen resmi berformat PDF atau cetak langsung ke printer fisik.</p>' +
          '<button class="btn btn-brand w-100 mb-2" onclick="cetakSPR()"><i class="bi bi-download"></i> Unduh / Simpan PDF</button>' +
          '<button class="btn btn-outline-gold w-100" onclick="cetakSPR()"><i class="bi bi-printer"></i> Cetak Dokumen</button>' +
        '</div>' +
        '<div class="card-lux p-3" id="sprStatusBox">' +
          '<h6 class="font-head mb-2">Status Pemesanan</h6>' +
          '<div class="text-muted-2" style="font-size:.84rem">Belum ada data.</div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

let sprTerakhir = null;

function cariSPR() {
  const nik = document.getElementById('sprNik').value.trim();
  if (!nik) { showToast('NIK Kosong', 'Masukkan NIK konsumen terlebih dahulu.', 'warning'); return; }
  const btn = document.getElementById('btnCariSpr');
  tombolLoading(btn, true);

  call('getSPR', App.token, nik).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-search"></i> Cari & Isi Otomatis');
    if (!res.success && res.data && res.data.blokirBi) { tampilkanSprTertahanBi(res.data); return; }   // v4.4
    if (!res.success) { showToast('Tidak Ditemukan', res.message, 'warning'); return; }
    sprTerakhir = res.data;
    document.getElementById('sprPrintArea').innerHTML = htmlSPR(res.data);
    document.getElementById('sprStatusBox').innerHTML =
      '<h6 class="font-head mb-2">Status Pemesanan</h6>' +
      '<div class="card-flat p-2 mb-2" style="background:var(--surface)">' +
        '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Transaksi</span><b>' + esc(res.data.transaksi.id) + '</b></div>' +
        '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Metode</span><b>' + esc(res.data.transaksi.metode) + '</b></div>' +
        '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Status</span>' +
        '<span class="chip ' + chipStatus(res.data.transaksi.status) + '">' + esc(res.data.transaksi.status) + '</span></div>' +
        '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Marketing</span><b>' + esc(res.data.transaksi.marketing || '-') + '</b></div>' +
        (res.data.transaksi.metode === 'KPR'
          ? '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Cek ID BI</span>' +
            '<span class="chip chip-xs chip-ok"><i class="bi bi-shield-check"></i> Lolos</span></div>' : '') +
      '</div>';
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-search"></i> Cari & Isi Otomatis');
    showToast('Error', err.message, 'danger');
  });
}

/** v4.4 — SPR konsumen KPR ditahan sampai hasil Cek ID BI "Lolos". */
function tampilkanSprTertahanBi(d) {
  sprTerakhir = null;
  const tolak = d.statusBi === 'Tidak Lolos';
  document.getElementById('sprPrintArea').innerHTML =
    '<div class="card-lux p-4 text-center">' +
      '<i class="bi bi-shield-' + (tolak ? 'x' : 'exclamation') + '" style="font-size:2.6rem;color:' + (tolak ? 'var(--danger)' : 'var(--accent)') + '"></i>' +
      '<h5 class="font-head mt-2">SPR Belum Dapat Dibuat</h5>' +
      '<p class="text-muted-2 mb-2" style="font-size:.88rem">Aturan kantor: konsumen <b>KPR</b> wajib <b>lolos Cek ID BI</b> ' +
      'sebelum Surat Pemesanan Rumah dibuat.</p>' +
      '<div class="d-inline-flex flex-column align-items-center gap-1">' +
        '<b>' + esc(d.nama) + '</b><span class="text-muted-2" style="font-size:.8rem">' + esc(d.unit) + ' • ' + esc(d.idTransaksi) + '</span>' +
        '<span class="chip ' + (tolak ? 'chip-danger' : 'chip-warn') + ' mt-1">ID BI: ' + esc(d.statusBi) + '</span>' +
      '</div>' +
      (d.catatanBi ? '<div class="card-flat p-2 mt-3 text-start" style="background:var(--surface);font-size:.82rem"><b>Catatan bank:</b> ' + esc(d.catatanBi) + '</div>' : '') +
      '<p class="text-muted-2 mt-3 mb-0" style="font-size:.8rem">' +
        (tolak ? 'Diskusikan opsi lain dengan konsumen (mis. ganti metode ke Cash/Tempo), lalu ubah data transaksinya.'
               : 'Minta Tim Perbankan menginput hasil Cek ID BI di menu <b>Cek ID BI</b>.') + '</p>' +
    '</div>';
  document.getElementById('sprStatusBox').innerHTML =
    '<h6 class="font-head mb-2">Status Pemesanan</h6>' +
    '<div class="text-muted-2" style="font-size:.84rem">SPR ditahan — menunggu hasil Cek ID BI <b>Lolos</b>.</div>';
}

function htmlSPR(d) {
  const font = d.desain.font === 'inter' ? "'Inter',sans-serif" : "'Playfair Display',Georgia,serif";
  const warna = d.desain.warna || '#7A1F3D';
  const logo = d.desain.logoUrl
    ? '<img src="' + esc(d.desain.logoUrl) + '" style="width:54px;height:54px;object-fit:contain">'
    : '<div style="width:54px;height:54px;border-radius:10px;background:' + warna + ';color:#fff;display:grid;place-items:center;font-weight:700">' +
      esc((d.desain.namaPerusahaan || 'E').charAt(0)) + '</div>';

  return '<div class="spr-doc" style="--primary:' + warna + '">' +
    '<div class="spr-kop" style="border-color:' + warna + '">' +
      '<div style="display:flex;gap:.8rem;align-items:center">' + logo +
        '<div><div style="font-family:' + font + ';font-size:1.05rem;font-weight:700;color:' + warna + '">' + esc(d.desain.namaPerusahaan) + '</div>' +
        '<div style="font-size:.74rem;color:#6B5C60">' + esc(d.desain.alamat) + '</div>' +
        '<div style="font-size:.74rem;color:#6B5C60">Telp: ' + esc(d.desain.telepon) + ' • ' + esc(d.desain.email) + '</div></div>' +
      '</div>' +
      '<div style="text-align:right;font-size:.76rem">' +
        '<div style="font-weight:700;color:' + warna + '">No. SPR</div><div>' + esc(d.nomorSPR) + '</div>' +
        '<div style="margin-top:.3rem;color:#6B5C60">Tanggal: ' + esc(d.tanggal) + '</div></div>' +
    '</div>' +

    '<div style="text-align:center;margin:1.4rem 0 .3rem">' +
      '<div style="font-family:' + font + ';font-size:1.12rem;font-weight:700;letter-spacing:.04em">SURAT PEMESANAN RUMAH (SPR)</div>' +
      '<div style="font-size:.78rem;color:#6B5C60">Booking Form &amp; Konfirmasi Pemesanan Unit Properti</div></div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;background:#FBF6F7;padding:1rem;border-radius:12px;margin-top:1rem">' +
      '<div><div style="font-weight:700;color:' + warna + ';font-size:.78rem;letter-spacing:.06em;margin-bottom:.4rem">I. DATA PEMESAN</div>' +
        barisSPR('Nama Lengkap', d.konsumen.nama) + barisSPR('No. KTP / NIK', d.konsumen.nik) +
        barisSPR('No. Telepon', d.konsumen.hp) + barisSPR('Pekerjaan', d.konsumen.pekerjaan || '-') + '</div>' +
      '<div><div style="font-weight:700;color:' + warna + ';font-size:.78rem;letter-spacing:.06em;margin-bottom:.4rem">II. INFORMASI UNIT KAVLING</div>' +
        barisSPR('Nama Proyek', d.unit.proyek) + barisSPR('Tipe Unit', d.unit.tipe) +
        barisSPR('Nomor Kavling', 'Blok ' + d.unit.blok + '-' + d.unit.nomor) +
        barisSPR('Luas Tanah/Bangunan', d.unit.lt + ' m² / ' + d.unit.lb + ' m²') + '</div>' +
    '</div>' +

    '<div style="font-weight:700;color:' + warna + ';font-size:.8rem;letter-spacing:.06em;margin:1.3rem 0 .5rem">III. RINCIAN HARGA &amp; CARA PEMBAYARAN</div>' +
    '<table class="tbl-harga"><thead><tr style="background:' + warna + '">' +
      '<th style="background:' + warna + '">Komponen Harga</th><th style="background:' + warna + ';text-align:right">Jumlah (IDR)</th></tr></thead><tbody>' +
      '<tr><td>Harga Jual Dasar (Netto)</td><td style="text-align:right">' + rp(d.harga.dasar) + '</td></tr>' +
      '<tr><td>PPN 11%</td><td style="text-align:right">' + rp(d.harga.ppn) + '</td></tr>' +
      '<tr><td>Estimasi Biaya AJB &amp; BBN</td><td style="text-align:right">' + rp(d.harga.ajb) + '</td></tr>' +
      '<tr class="total"><td>Total Harga Pengikatan</td><td style="text-align:right">' + rp(d.harga.total) + '</td></tr>' +
      '<tr><td>Cara Pembayaran</td><td style="text-align:right"><b>' + esc(d.transaksi.metode) + '</b></td></tr>' +
    '</tbody></table>' +

    '<div style="background:#F7F2F1;border-radius:12px;padding:.9rem;margin-top:1.2rem;font-size:.78rem;white-space:pre-line">' +
      '<b>Ketentuan Umum:</b>\n' + esc(d.desain.syarat || '') + '</div>' +

    '<div class="ttd-area">' +
      '<div style="flex:1"><div>Dibuat Oleh,<br><b>Marketing Eksekutif</b></div><div class="ttd-line">( ' + esc(d.transaksi.marketing || '..................') + ' )</div></div>' +
      '<div style="flex:1"><div>Mengetahui,<br><b>' + esc(d.desain.penandatangan || 'Direktur Pemasaran') + '</b></div><div class="ttd-line">( .................................. )</div></div>' +
      '<div style="flex:1"><div>Disetujui Oleh,<br><b>Pemesan / Konsumen</b></div><div class="ttd-line">( ' + esc(d.konsumen.nama) + ' )</div></div>' +
    '</div></div>';
}

function barisSPR(label, nilai) {
  return '<div style="display:flex;justify-content:space-between;gap:.6rem;font-size:.8rem;padding:.18rem 0">' +
    '<span style="color:#6B5C60">' + esc(label) + '</span><b style="text-align:right">' + esc(nilai) + '</b></div>';
}

function cetakSPR() {
  if (!sprTerakhir) { showToast('Belum Ada SPR', 'Cari NIK konsumen terlebih dahulu.', 'warning'); return; }
  const isi = document.getElementById('sprPrintArea').innerHTML;
  cetakHtml('<html><head><meta charset="utf-8"><title>SPR — ' + esc(sprTerakhir.konsumen.nama) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    '<style>body{font-family:Inter,sans-serif;margin:0;padding:24px;color:#241A1E;font-size:13px}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.spr-doc{padding:0}.spr-kop{display:flex;justify-content:space-between;gap:1rem;border-bottom:2px solid #7A1F3D;padding-bottom:.9rem}' +
    'table{width:100%;border-collapse:collapse}.tbl-harga th{color:#fff;text-align:left;padding:.55rem .8rem;font-size:.8rem}' +
    '.tbl-harga td{padding:.5rem .8rem;border-bottom:1px solid #EDE5E6}.tbl-harga tr.total td{background:#FBF1F4;font-weight:700}' +
    '.ttd-area{display:flex;justify-content:space-between;gap:1rem;margin-top:2.4rem;text-align:center;font-size:.8rem}' +
    '.ttd-line{border-top:1px solid #241A1E;margin-top:3rem;padding-top:.3rem}</style></head><body>' + isi + '</body></html>');
}

// ════════ BAGIAN 9 — MENU TIM PERBANKAN ════════

function bankSetBerkas(idTransaksi) {
  const t = App.transaksi.find(function (x) { return x.id === idTransaksi; });
  if (!t) return;
  const opsi = ['Diajukan', 'Lengkap 100%', 'SP3K', 'Jadwal Akad', 'Akad Selesai', 'Ditolak'];
  const statusKini = t.berkas.status || 'Diajukan';
  const plafonKini = t.berkas.plafon || '';

  openModal('Update Status Berkas — ' + t.nama,
    '<div class="card-flat p-3 mb-3" style="background:var(--surface)">' +
      '<b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.82rem">Blok ' + esc(t.blok) + '-' + esc(t.nomor) +
      ' • NIK ' + esc(t.nik) + ' • Harga unit ' + rp(t.harga) + '</div></div>' +

    '<label class="form-label">Status Berkas KPR</label>' +
    '<select class="form-select mb-3" id="brkStatus" onchange="toggleKolomPlafon()">' +
      opsi.map(function (o) {
        return '<option' + (statusKini === o ? ' selected' : '') + '>' + o + '</option>';
      }).join('') + '</select>' +

    '<div id="wrapPlafon">' +
      '<label class="form-label">Plafon Disetujui Bank (Rp)</label>' +
      '<div class="input-group mb-1">' +
        '<span class="input-group-text">Rp</span>' +
        '<input type="text" class="form-control tabular" id="brkPlafon" inputmode="numeric" ' +
          'value="' + (plafonKini ? angka(plafonKini) : '') + '" placeholder="Contoh: 385.000.000" ' +
          'oninput="formatRibuan(this); hitungRasioPlafon(' + (t.harga || 0) + ')">' +
      '</div>' +
      '<div class="d-flex gap-2 mb-2 flex-wrap" id="brkPlafonCepat">' +
        [70, 80, 90].map(function (p) {
          return '<span class="filter-chip" onclick="isiPlafonCepat(' + Math.round((t.harga || 0) * p / 100) + ',' + (t.harga || 0) + ')">' +
            p + '% (' + rpSingkat(Math.round((t.harga || 0) * p / 100)) + ')</span>';
        }).join('') +
      '</div>' +
      '<div class="text-muted-2 mb-3" id="brkRasio" style="font-size:.8rem"></div>' +
    '</div>' +

    // v4.7 — bank tujuan proses (internal) + unggah SP3K
    '<div id="wrapBankProses" class="mb-3">' +
      '<label class="form-label">Berkas Diproses ke Bank <span class="chip chip-soft chip-xs">Internal</span></label>' +
      '<select class="form-select" id="brkBankProses" onchange="toggleBankLain()">' +
        '<option value="">— Belum ditentukan —</option>' +
        (App.daftarBank || []).map(function (b) {
          return '<option' + (t.berkas.bankProses === b ? ' selected' : '') + '>' + esc(b) + '</option>';
        }).join('') +
        '<option value="__lain"' + (t.berkas.bankProses && (App.daftarBank || []).indexOf(t.berkas.bankProses) < 0 ? ' selected' : '') + '>Lainnya…</option>' +
      '</select>' +
      '<input class="form-control mt-2 hidden" id="brkBankLain" maxlength="60" placeholder="Nama bank lainnya" value="' +
        esc(t.berkas.bankProses && (App.daftarBank || []).indexOf(t.berkas.bankProses) < 0 ? t.berkas.bankProses : '') + '">' +
      '<small class="text-muted-2">Diisi saat berkas sudah <b>Lengkap 100%</b>. Hanya terlihat oleh Marketing, Perbankan &amp; Owner — tidak tampil di Cek Status konsumen.</small>' +
    '</div>' +
    '<div id="wrapSp3k" class="mb-3">' +
      '<label class="form-label">Dokumen SP3K dari Bank <span class="chip chip-soft chip-xs">Internal</span></label>' +
      (t.berkas.sp3kLink ? '<button type="button" class="btn btn-sm btn-ghost w-100 mb-2" onclick="previewFile(\'' + escJs(t.berkas.sp3kLink) + '\',\'SP3K\')">' +
        '<i class="bi bi-eye"></i> Lihat SP3K saat ini</button>' : '') +
      '<div class="upload-box py-3" id="boxSp3kBank" onclick="document.getElementById(\'fileSp3kBank\').click()">' +
        '<i class="bi bi-file-earmark-arrow-up"></i><div style="font-size:.84rem">' + (t.berkas.sp3kLink ? 'Ganti dokumen SP3K' : 'Unggah SP3K (PDF / foto)') + '</div></div>' +
      '<input type="file" id="fileSp3kBank" class="hidden" accept="image/*,.pdf" onchange="tandaiFile(\'fileSp3kBank\',\'boxSp3kBank\')">' +
    '</div>' +

    '<label class="form-label">Catatan Verifikasi</label>' +
    '<textarea class="form-control" id="brkCatatan" rows="3" ' +
      'placeholder="Contoh: SP3K terbit, plafon disetujui sesuai penilaian agunan">' + esc(t.berkas.catatan || '') + '</textarea>' +

    '<div class="alert mt-3 mb-0" style="background:var(--info-bg);border:none;color:var(--primary);font-size:.82rem">' +
      '<i class="bi bi-info-circle"></i> Plafon yang diisi di sini <b>langsung terlihat oleh konsumen</b> ' +
      'pada menu Cek Status KPR. Status <b>Ditolak</b> akan melepas kavling kembali menjadi <b>Tersedia</b>.</div>',

    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnBrk" onclick="simpanBerkas(\'' + idTransaksi + '\')"><i class="bi bi-save"></i> Simpan Status</button>',
    'modal-md');

  delete fileBuffer.fileSp3kBank;
  toggleKolomPlafon();
  toggleBankLain();
  hitungRasioPlafon(t.harga || 0);
}

/** v4.7 — kolom bank proses & SP3K hanya relevan mulai berkas Lengkap 100%. */
function toggleBankLain() {
  const sel = document.getElementById('brkBankProses');
  const lain = document.getElementById('brkBankLain');
  if (sel && lain) lain.classList.toggle('hidden', sel.value !== '__lain');
}

/** Kolom plafon disorot saat status sudah SP3K ke atas. */
function toggleKolomPlafon() {
  const status = (document.getElementById('brkStatus') || {}).value || '';
  const wrap = document.getElementById('wrapPlafon');
  if (!wrap) return;
  const relevan = ['SP3K', 'Jadwal Akad', 'Akad Selesai'].indexOf(status) >= 0;
  wrap.style.opacity = relevan ? '1' : '.6';
  const wb = document.getElementById('wrapBankProses');
  if (wb) wb.style.display = ['Lengkap 100%', 'SP3K', 'Jadwal Akad', 'Akad Selesai'].indexOf(status) >= 0 ? '' : 'none';
  const ws = document.getElementById('wrapSp3k');
  if (ws) ws.style.display = relevan ? '' : 'none';
  const label = wrap.querySelector('.form-label');
  if (label) {
    label.innerHTML = relevan
      ? 'Plafon Disetujui Bank (Rp) <span class="chip chip-gold" style="font-size:.66rem">Wajib diisi</span>'
      : 'Plafon Disetujui Bank (Rp) <span class="text-muted-2" style="font-weight:400">— diisi setelah SP3K terbit</span>';
  }
}

function isiPlafonCepat(nilai, harga) {
  const el = document.getElementById('brkPlafon');
  if (!el) return;
  el.value = angka(nilai);
  hitungRasioPlafon(harga);
}

/** Tampilkan rasio plafon terhadap harga unit + sisa yang harus disiapkan konsumen. */
function hitungRasioPlafon(harga) {
  const box = document.getElementById('brkRasio');
  if (!box) return;
  const nilai = Number((document.getElementById('brkPlafon').value || '').replace(/[^0-9]/g, '')) || 0;
  if (!nilai || !harga) { box.innerHTML = ''; return; }
  const rasio = Math.round((nilai / harga) * 100);
  const sisa = Math.max(harga - nilai, 0);
  box.innerHTML = '<i class="bi bi-calculator"></i> Setara <b>' + rasio + '%</b> dari harga unit • ' +
    'Sisa yang disiapkan konsumen: <b>' + rp(sisa) + '</b>' +
    (rasio > 100 ? ' <span style="color:var(--danger)">— plafon melebihi harga unit</span>' : '');
}

function simpanBerkas(idTransaksi) {
  const status = document.getElementById('brkStatus').value;
  const catatan = document.getElementById('brkCatatan').value;
  const plafon = (document.getElementById('brkPlafon').value || '').replace(/[^0-9]/g, '');

  // Ingatkan bila SP3K sudah terbit tetapi plafon belum diisi
  if (['SP3K', 'Jadwal Akad', 'Akad Selesai'].indexOf(status) >= 0 && !plafon) {
    showToast('Plafon Belum Diisi', 'Isi plafon yang disetujui bank agar konsumen dapat melihatnya.', 'warning');
    document.getElementById('brkPlafon').focus();
    return;
  }

  const btn = document.getElementById('btnBrk');
  tombolLoading(btn, true);

  // v4.7 — bank tujuan proses (hanya dikirim bila kolomnya tampil)
  const selBank = document.getElementById('brkBankProses');
  const tampilBank = document.getElementById('wrapBankProses') && document.getElementById('wrapBankProses').style.display !== 'none';
  const bankProses = !tampilBank || !selBank ? undefined
    : selBank.value === '__lain' ? document.getElementById('brkBankLain').value.trim() : selBank.value;
  if (tampilBank && selBank && selBank.value === '__lain' && !bankProses) {
    showToast('Nama Bank Kosong', 'Ketik nama bank lainnya.', 'warning'); tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Status'); return;
  }
  const fileSp3k = fileBuffer.fileSp3kBank;

  call('bankUpdateBerkas', App.token, idTransaksi, status, catatan, plafon, bankProses === undefined ? null : { bankProses: bankProses }).then(function (res) {
    if (!res.success) { tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Status'); showToast('Gagal', res.message, 'danger'); return; }
    const akhiri = function (pesanTambahan) {
      tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Status');
      closeModal();
      showToast('Berhasil', res.message + (pesanTambahan || ''), 'success');
      muatWorkspace(false);
    };
    if (!fileSp3k) { akhiri(''); return; }
    btn.innerHTML = '<span class="spinner-inline"></span> Mengunggah SP3K…';
    call('unggahSP3K', App.token, idTransaksi, fileSp3k).then(function (r2) {
      delete fileBuffer.fileSp3kBank;
      if (!r2.success) showToast('SP3K Gagal Diunggah', r2.message, 'warning');
      akhiri(r2.success ? ' Dokumen SP3K tersimpan.' : '');
    }).catch(function () { akhiri(''); });
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Status');
    showToast('Error', err.message, 'danger');
  });
}

function formJadwalAkad(idTransaksi) {
  const t = App.transaksi.find(function (x) { return x.id === idTransaksi; });
  if (!t) return;
  openModal('Jadwalkan Akad Kredit',
    '<p class="text-muted-2" style="font-size:.86rem">Pilih waktu temu untuk penandatanganan notariil.</p>' +
    '<div class="row g-3">' +
      '<div class="col-md-6"><label class="form-label"><i class="bi bi-calendar"></i> Tanggal Akad <span class="text-danger">*</span></label>' +
        '<input type="date" class="form-control" id="akTanggal" value="' + esc(t.berkas.tanggalAkad || '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label"><i class="bi bi-clock"></i> Waktu Akad</label>' +
        '<input type="time" class="form-control" id="akWaktu" value="' + esc(t.berkas.waktuAkad || '10:00') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Lokasi Akad</label>' +
        '<select class="form-select" id="akLokasi">' +
          ['Kantor Cabang Utama', 'Kantor Notaris Rekanan', 'Kantor Pemasaran Proyek', 'Kantor Cabang Pembantu']
            .map(function (l) { return '<option' + (t.berkas.lokasiAkad === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') +
        '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Bank Pemberi KPR</label>' +
        '<input class="form-control" id="akBank" value="' + esc(t.berkas.bank || '') + '" placeholder="Contoh: Bank Mandiri"></div>' +
      '<div class="col-md-6"><label class="form-label">Plafon Disetujui Bank (Rp)</label>' +
        '<div class="input-group"><span class="input-group-text">Rp</span>' +
        '<input type="text" class="form-control tabular" id="akPlafon" inputmode="numeric" ' +
          'value="' + (t.berkas.plafon > 0 ? angka(t.berkas.plafon) : '') + '" ' +
          'placeholder="Contoh: 385.000.000" oninput="formatRibuan(this)"></div></div>' +
      '<div class="col-12"><label class="form-label">Catatan Tambahan</label>' +
        '<textarea class="form-control" id="akCatatan" rows="2" placeholder="Contoh: membawa KTP asli, NPWP, dan materai 10.000 (2 lembar)">' + esc(t.berkas.catatan || '') + '</textarea></div>' +
    '</div>' +
    '<div class="card-flat p-3 mt-3 d-flex align-items-center gap-3" style="background:var(--info-bg)">' +
      '<div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:#fff;display:grid;place-items:center;font-weight:700">' +
      esc(t.nama.charAt(0)) + '</div>' +
      '<div><b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.8rem">Blok ' + esc(t.blok) + '-' + esc(t.nomor) +
      ' • Harga unit: ' + rp(t.harga) +
      (t.berkas.plafon > 0 ? ' • Plafon disetujui: <b style="color:var(--primary)">' + rp(t.berkas.plafon) + '</b>' : '') +
      '</div></div></div>' +
    '<div id="akProgres"></div>' +                                                                                  // v6.1
    '<div class="alert mt-3 mb-0" style="background:var(--warning-bg);border:none;color:var(--warning);font-size:.82rem">' +
      '<i class="bi bi-exclamation-triangle"></i> Menyimpan jadwal akan mengubah status kavling menjadi <b>Terjual</b>.</div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnAkad" onclick="simpanJadwalAkad(\'' + idTransaksi + '\')"><i class="bi bi-check2"></i> Simpan Jadwal</button>',
    'modal-md');
  panelProgresAkad(t);                                                                                             // v6.1
}

function simpanJadwalAkad(idTransaksi) {
  const tanggal = document.getElementById('akTanggal').value;
  if (!tanggal) { showToast('Tanggal Kosong', 'Pilih tanggal akad terlebih dahulu.', 'warning'); return; }
  const payload = {
    idTransaksi: idTransaksi, tanggal: tanggal,
    waktu: document.getElementById('akWaktu').value,
    lokasi: document.getElementById('akLokasi').value,
    bank: document.getElementById('akBank').value,
    plafon: (document.getElementById('akPlafon').value || '').replace(/[^0-9]/g, ''),
    catatan: document.getElementById('akCatatan').value
  };
  const abaikan = document.getElementById('akAbaikan');                                                        // v6.1
  if (abaikan && abaikan.checked) { payload.abaikanProgres = true; payload.alasanAbaikan = (document.getElementById('akAlasan') || {}).value || ''; }
  const btn = document.getElementById('btnAkad');
  tombolLoading(btn, true);

  call('bankJadwalAkad', App.token, payload).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-check2"></i> Simpan Jadwal');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    closeModal();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-check2"></i> Simpan Jadwal');
    showToast('Error', err.message, 'danger');
  });
}

/** Daftar jenis berkas bawaan (dapat ditambah bebas saat mengunggah). */
const JENIS_BERKAS = ['KTP Pemohon', 'KTP Pasangan', 'Kartu Keluarga', 'Surat Nikah / Cerai', 'NPWP',
  'Slip Gaji', 'Rekening Koran', 'Surat Keterangan Kerja', 'SPT Tahunan', 'Pas Foto',
  'Akta Kelahiran', 'Laporan Keuangan Usaha', 'SIUP / NIB', 'Formulir Aplikasi Bank', 'Lainnya'];

/** Berkas yang umumnya diminta bank — dipakai sebagai daftar periksa. */
const BERKAS_WAJIB = ['KTP Pemohon', 'Kartu Keluarga', 'NPWP', 'Slip Gaji', 'Rekening Koran'];

function dokumenTransaksi(idTransaksi) {
  return (App.dokumen || []).filter(function (d) { return d.idTransaksi === idTransaksi; })
    .sort(function (a, b) { return String(a.tanggal).localeCompare(String(b.tanggal)); });
}

function renderUploadBerkas() {
  const el = document.getElementById('app-uploadBerkas');
  const kpr = App.transaksi.filter(function (t) { return t.metode === 'KPR'; })
    .sort(function (a, b) {
      if (a.idProyek !== b.idProyek) return String(a.idProyek).localeCompare(String(b.idProyek));
      if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok));
      return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
    });

  const totalBerkas = (App.dokumen || []).length;
  const belumLengkap = kpr.filter(function (t) {
    const jenis = dokumenTransaksi(t.id).map(function (d) { return d.jenis; });
    return BERKAS_WAJIB.some(function (w) { return jenis.indexOf(w) < 0; });
  }).length;

  el.innerHTML =
    '<div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-1">' +
      '<div><h2 class="mb-0">Upload Berkas Konsumen</h2>' +
      '<span class="text-muted-2" style="font-size:.86rem">Setiap bank meminta berkas berbeda — unggah sesuai kebutuhan, hapus bila ada yang keliru.</span></div>' +
    '</div>' +

    '<div class="row g-2 g-md-3 my-2">' +
      [{ l: 'Nasabah KPR', v: kpr.length, i: 'people', g: 'is-brand' },
       { l: 'Total Berkas Terunggah', v: totalBerkas, i: 'files', g: 'is-ok' },
       { l: 'Berkas Belum Lengkap', v: belumLengkap, i: 'exclamation-circle', g: 'is-warn' }]
      .map(function (k) {
        return '<div class="col-12 col-md-4"><div class="kpi-tile ' + k.g + '">' +
          '<div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
          '<div style="min-width:0"><div class="kpi-lbl">' + k.l + '</div>' +
          '<div class="kpi-val">' + k.v + '</div></div></div></div>';
      }).join('') + '</div>' +

    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:300px">' +
        '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="ubCari" placeholder="Cari nama / NIK konsumen…" oninput="tundaCari(filterUploadBerkas)">' +
      '</div>' +
      '<select class="form-select" style="max-width:220px" id="ubKelengkapan" onchange="filterUploadBerkas()">' +
        '<option value="">Semua kelengkapan</option>' +
        '<option value="kurang">Belum lengkap</option>' +
        '<option value="lengkap">Sudah lengkap</option>' +
        '<option value="kosong">Belum ada berkas</option>' +
      '</select></div>' +

    '<div class="row g-3" id="gridUploadBerkas">' + kpr.map(kartuUploadBerkas).join('') + '</div>' +
    htmlBerkasIndentUpload() +                                                   // v4.9.3
    (kpr.length ? '' : emptyState('inbox', 'Belum ada pengajuan KPR', 'Data muncul setelah ada pemesanan dengan metode KPR.'));
}

function kartuUploadBerkas(t) {
  const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
  const dok = dokumenTransaksi(t.id);
  const jenisAda = dok.map(function (d) { return d.jenis; });
  const kurang = BERKAS_WAJIB.filter(function (w) { return jenisAda.indexOf(w) < 0; });
  const persen = Math.round(((BERKAS_WAJIB.length - kurang.length) / BERKAS_WAJIB.length) * 100);
  const kelengkapan = dok.length === 0 ? 'kosong' : (kurang.length ? 'kurang' : 'lengkap');

  return '<div class="col-md-6 col-xl-4 item-berkas" data-cari="' + esc((t.nama + ' ' + t.nik).toLowerCase()) +
    '" data-lengkap="' + kelengkapan + '">' +
    '<div class="card-lux p-3 h-100 d-flex flex-column">' +
      '<div class="d-flex justify-content-between gap-2 mb-2">' +
        '<div style="min-width:0"><b class="text-truncate d-block">' + esc(t.nama) + '</b>' +
        '<div class="text-muted-2 text-truncate" style="font-size:.78rem">' + esc(p.nama || '') +
          ' • ' + (t.labelUnit ? esc(t.labelUnit) : 'Blok ' + esc(t.blok) + '-' + esc(t.nomor)) + '</div></div>' +
        '<span class="chip ' + chipStatus(t.berkas.status || 'Diajukan') + '" style="height:fit-content;flex:none">' +
          esc(t.berkas.status || 'Diajukan') + '</span>' +
      '</div>' +

      '<div class="card-flat p-2 mb-2" style="background:var(--surface);font-size:.8rem">' +
        '<div class="d-flex justify-content-between"><span class="text-muted-2">NIK</span><b>' + esc(t.nik) + '</b></div>' +
        '<div class="d-flex justify-content-between"><span class="text-muted-2">Berkas terunggah</span>' +
          '<b>' + dok.length + ' dokumen</b></div>' +
        (t.berkas.plafon > 0
          ? '<div class="d-flex justify-content-between"><span class="text-muted-2">Plafon</span>' +
            '<b style="color:var(--primary)">' + rpSingkat(t.berkas.plafon) + '</b></div>' : '') +
      '</div>' +

      '<div class="d-flex justify-content-between align-items-center" style="font-size:.74rem">' +
        '<span class="text-muted-2">Kelengkapan berkas umum</span>' +
        '<b style="color:' + (kurang.length ? 'var(--warning)' : 'var(--success)') + '">' + persen + '%</b></div>' +
      '<div class="target-meter mb-2"><span style="width:' + persen + '%;background:' +
        (kurang.length ? 'var(--accent)' : 'var(--success)') + '"></span></div>' +

      (dok.length
        ? '<div class="d-flex flex-wrap gap-1 mb-2">' +
            dok.slice(0, 4).map(function (d) {
              return '<span class="chip" style="font-size:.66rem">' + esc(d.jenis) + '</span>';
            }).join('') +
            (dok.length > 4 ? '<span class="chip chip-soft" style="font-size:.66rem">+' + (dok.length - 4) + '</span>' : '') +
          '</div>'
        : '<div class="text-muted-2 mb-2" style="font-size:.76rem"><i class="bi bi-inbox"></i> Belum ada berkas diunggah</div>') +

      (kurang.length
        ? '<div class="text-muted-2 mb-2" style="font-size:.72rem"><i class="bi bi-exclamation-triangle" style="color:var(--warning)"></i> Belum ada: ' +
          esc(kurang.join(', ')) + '</div>' : '') +

      '<div class="d-flex gap-2 mt-auto">' +
        '<button class="btn btn-sm btn-brand flex-grow-1" onclick="kelolaBerkasKpr(\'' + t.id + '\')">' +
          '<i class="bi bi-folder2-open"></i> Kelola Berkas</button>' +
        '<button class="btn btn-sm btn-outline-brand" onclick="' + (t.indent ? 'detailIndent' : 'detailTransaksi') + '(\'' + t.id + '\')" title="Lihat data konsumen">' +
          '<i class="bi bi-eye"></i></button>' +
      '</div>' +
    '</div></div>';
}

function filterUploadBerkas() {
  const q = ((document.getElementById('ubCari') || {}).value || '').trim().toLowerCase();
  const k = (document.getElementById('ubKelengkapan') || {}).value || '';
  document.querySelectorAll('.item-berkas').forEach(function (el) {
    const cocokCari = !q || el.dataset.cari.indexOf(q) >= 0;
    const cocokLengkap = !k || el.dataset.lengkap === k;
    el.classList.toggle('hidden', !(cocokCari && cocokLengkap));
  });
}

/** Pusat pengelolaan berkas KPR seorang konsumen. */
function kelolaBerkasKpr(idTransaksi) {
  const t = App.transaksi.find(function (x) { return x.id === idTransaksi; }) || transaksiDariIndent(idTransaksi);   // v4.9.3
  if (!t) return;
  const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};

  openModal('Berkas KPR — ' + t.nama,
    '<div class="card-flat p-3 mb-3" style="background:var(--surface)">' +
      '<div class="d-flex justify-content-between flex-wrap gap-2">' +
        '<div><b>' + esc(t.nama) + '</b>' +
        '<div class="text-muted-2" style="font-size:.82rem">' + esc(p.nama || '') + ' • ' +
          (t.labelUnit ? esc(t.labelUnit) : 'Blok ' + esc(t.blok) + '-' + esc(t.nomor)) + ' • NIK ' + esc(t.nik || '-') + '</div></div>' +
        '<div class="text-end"><span class="chip ' + chipStatus(t.berkas.status || 'Diajukan') + '">' +
          esc(t.berkas.status || 'Diajukan') + '</span>' +
        (t.berkas.bank ? '<div class="text-muted-2" style="font-size:.76rem;margin-top:.2rem">' + esc(t.berkas.bank) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="d-flex gap-2 mt-2 flex-wrap">' +
        (t.linkKtp ? '<button class="btn btn-sm btn-outline-brand" onclick="previewFile(\'' + t.linkKtp + '\',\'Foto KTP\')"><i class="bi bi-person-badge"></i> KTP Konsumen</button>' : '') +
        (t.linkKk ? '<button class="btn btn-sm btn-outline-brand" onclick="previewFile(\'' + t.linkKk + '\',\'Kartu Keluarga\')"><i class="bi bi-diagram-3"></i> Kartu Keluarga</button>' : '') +
        (t.linkBukti ? '<button class="btn btn-sm btn-outline-brand" onclick="previewFile(\'' + t.linkBukti + '\',\'Bukti Pembayaran\')"><i class="bi bi-receipt"></i> Bukti Bayar</button>' : '') +
      '</div>' +
    '</div>' +

    '<div id="areaDaftarBerkas"></div>' +

    '<div class="card-flat p-3 mt-3">' +
      '<div class="sect-label mb-2"><i class="bi bi-cloud-arrow-up"></i> Unggah Berkas Baru</div>' +
      '<div class="row g-2">' +
        '<div class="col-md-6"><label class="form-label">Jenis Berkas <span class="text-danger">*</span></label>' +
          '<input class="form-control" id="jenisBerkasBaru" list="listJenisBerkas" placeholder="Pilih atau ketik sendiri">' +
          '<datalist id="listJenisBerkas">' +
            JENIS_BERKAS.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') +
          '</datalist></div>' +
        '<div class="col-md-6"><label class="form-label">Catatan (opsional)</label>' +
          '<input class="form-control" id="catatanBerkasBaru" placeholder="Contoh: periode Juli–September"></div>' +
      '</div>' +
      '<div class="upload-box mt-2" id="boxBerkasKpr" onclick="pilihFileBerkasKpr(\'' + idTransaksi + '\')">' +
        '<i class="bi bi-cloud-arrow-up"></i>' +
        '<div style="font-size:.86rem">Klik untuk memilih berkas</div>' +
        '<small>JPG / PNG / PDF — maksimal 10 MB, gambar otomatis diperkecil</small></div>' +
    '</div>',

    '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>',
    'modal-lg');

  renderDaftarBerkas(idTransaksi);
}

function renderDaftarBerkas(idTransaksi) {
  const box = document.getElementById('areaDaftarBerkas');
  if (!box) return;
  const dok = dokumenTransaksi(idTransaksi);
  const jenisAda = dok.map(function (d) { return d.jenis; });
  const kurang = BERKAS_WAJIB.filter(function (w) { return jenisAda.indexOf(w) < 0; });

  box.innerHTML =
    '<div class="sect-label mb-2">Daftar Periksa Berkas Umum</div>' +
    '<div class="d-flex flex-wrap gap-1 mb-3">' +
      BERKAS_WAJIB.map(function (w) {
        const ada = jenisAda.indexOf(w) >= 0;
        return '<span class="chip ' + (ada ? 'chip-ok' : 'chip-warn') + '">' +
          '<i class="bi bi-' + (ada ? 'check-circle' : 'circle') + '"></i> ' + esc(w) + '</span>';
      }).join('') +
    '</div>' +
    (kurang.length
      ? '<div class="text-muted-2 mb-3" style="font-size:.8rem">Daftar ini hanya panduan umum — setiap bank dapat meminta berkas berbeda. Tambahkan jenis berkas lain sesuai permintaan bank.</div>'
      : '<div class="mb-3" style="font-size:.8rem;color:var(--success)"><i class="bi bi-check2-all"></i> Seluruh berkas umum sudah lengkap.</div>') +

    '<div class="sect-label mb-2">Berkas Terunggah (' + dok.length + ')</div>' +
    (dok.length
      ? '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
          '<th>Jenis Berkas</th><th>Nama File</th><th>Diunggah</th><th class="text-end">Aksi</th>' +
        '</tr></thead><tbody>' +
        dok.map(function (d) {
          const kb = d.ukuran ? (d.ukuran / 1024).toFixed(0) + ' KB' : '';
          return '<tr>' +
            '<td><b style="font-size:.85rem">' + esc(d.jenis) + '</b>' +
              (d.catatan ? '<div class="text-muted-2" style="font-size:.74rem">' + esc(d.catatan) + '</div>' : '') + '</td>' +
            '<td style="font-size:.8rem"><span class="text-truncate d-inline-block" style="max-width:190px">' +
              esc(d.nama) + '</span>' +
              (kb ? '<div class="text-muted-2" style="font-size:.72rem">' + kb + '</div>' : '') + '</td>' +
            '<td style="font-size:.78rem">' + tglIndo(d.tanggal) +
              '<div class="text-muted-2" style="font-size:.72rem">' + esc(d.oleh || '-') + '</div></td>' +
            '<td class="text-end"><div class="d-flex gap-1 justify-content-end">' +
              '<button class="btn btn-sm btn-ghost" onclick="previewFile(\'' + escJs(d.link) + '\',\'' + escJs(d.jenis) + '\')" title="Pratinjau"><i class="bi bi-eye"></i></button>' +
              '<button class="btn btn-sm btn-ghost" onclick="ubahInfoBerkas(\'' + d.id + '\',\'' + idTransaksi + '\')" title="Ubah jenis / catatan"><i class="bi bi-pencil"></i></button>' +
              '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="hapusBerkasUi(\'' + d.id + '\',\'' + idTransaksi + '\')" title="Hapus berkas"><i class="bi bi-trash"></i></button>' +
            '</div></td></tr>';
        }).join('') +
        '</tbody></table></div>'
      : emptyState('folder2-open', 'Belum ada berkas', 'Unggah berkas pertama melalui kotak di bawah.'));
}

function pilihFileBerkasKpr(idTransaksi) {
  const jenis = (document.getElementById('jenisBerkasBaru').value || '').trim();
  if (!jenis) {
    showToast('Jenis Berkas Kosong', 'Pilih atau ketik jenis berkas terlebih dahulu.', 'warning');
    document.getElementById('jenisBerkasBaru').focus();
    return;
  }
  const catatan = (document.getElementById('catatanBerkasBaru').value || '').trim();

  let input = document.getElementById('inputBerkasKpr');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'inputBerkasKpr';
    input.className = 'hidden';
    input.accept = 'image/*,.pdf,.doc,.docx';
    document.body.appendChild(input);
  }
  input.value = '';
  input.onchange = function () {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('File Terlalu Besar', 'Maksimal 10 MB per berkas.', 'warning');
      return;
    }
    const box = document.getElementById('boxBerkasKpr');
    if (box) box.innerHTML = '<i class="bi bi-arrow-repeat"></i><div style="font-size:.86rem">Menyiapkan berkas…</div>';

    kompresGambar(file, 1800, 0.8).then(function (siap) {
      if (box) box.innerHTML = '<span class="spinner-inline" style="border-color:var(--primary-tint);border-top-color:var(--primary)"></span>' +
        '<div style="font-size:.86rem">Mengunggah ke Google Drive…</div>';
      return call('unggahBerkasKpr', App.token, idTransaksi, jenis, siap, catatan);
    }).then(function (res) {
      pulihkanKotakUnggah();
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      showToast('Berhasil', res.message, 'success');
      document.getElementById('jenisBerkasBaru').value = '';
      document.getElementById('catatanBerkasBaru').value = '';
      muatWorkspace(false).then(function () { renderDaftarBerkas(idTransaksi); });
    }).catch(function (err) {
      pulihkanKotakUnggah();
      showToast('Error', err.message, 'danger');
    });
  };
  input.click();
}

function pulihkanKotakUnggah() {
  const box = document.getElementById('boxBerkasKpr');
  if (box) {
    box.innerHTML = '<i class="bi bi-cloud-arrow-up"></i>' +
      '<div style="font-size:.86rem">Klik untuk memilih berkas</div>' +
      '<small>JPG / PNG / PDF — maksimal 10 MB, gambar otomatis diperkecil</small>';
  }
}

function ubahInfoBerkas(idDok, idTransaksi) {
  const d = (App.dokumen || []).find(function (x) { return x.id === idDok; });
  if (!d) return;
  const jenisBaru = prompt('Ubah jenis berkas:', d.jenis);
  if (jenisBaru === null) return;
  const catatanBaru = prompt('Catatan (boleh dikosongkan):', d.catatan || '');
  if (catatanBaru === null) return;

  call('ubahInfoBerkasKpr', App.token, idDok, jenisBaru.trim(), catatanBaru.trim()).then(function (res) {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false).then(function () { renderDaftarBerkas(idTransaksi); });
  }).catch(function (err) { showToast('Error', err.message, 'danger'); });
}

function hapusBerkasUi(idDok, idTransaksi) {
  const d = (App.dokumen || []).find(function (x) { return x.id === idDok; });
  if (!d) return;
  konfirmasi('Hapus Berkas',
    'Berkas "' + d.jenis + '" (' + d.nama + ') akan dihapus. File dipindahkan ke sampah Google Drive dan masih bisa dipulihkan dalam 30 hari.',
    function () {
      call('hapusBerkasKpr', App.token, idDok).then(function (res) {
        if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
        showToast('Berhasil', res.message, 'success');
        muatWorkspace(false).then(function () { renderDaftarBerkas(idTransaksi); });
      }).catch(function (err) { showToast('Error', err.message, 'danger'); });
    });
}

function renderJadwalAkad() {
  const el = document.getElementById('app-jadwalAkad');
  const kpr = App.transaksi.filter(function (t) { return t.metode === 'KPR'; });
  const terjadwal = kpr.filter(function (t) { return t.berkas.tanggalAkad; });
  const menungguBerkas = kpr.filter(function (t) { return (t.berkas.status || 'Diajukan') === 'Diajukan'; });
  const siapAkad = kpr.filter(function (t) { return ['Lengkap 100%', 'SP3K'].indexOf(t.berkas.status) >= 0 && !t.berkas.tanggalAkad; });

  el.innerHTML =
    '<h2 class="mb-1">Manajemen Jadwal Akad</h2>' +
    '<p class="text-muted-2">Kelola jadwal penandatanganan akad kredit nasabah.</p>' +
    '<div class="row g-3 mb-4">' +
      [['Total Terjadwal', terjadwal.length + ' Nasabah', 'calendar-check'],
       ['Siap Dijadwalkan', siapAkad.length + ' Nasabah', 'hourglass-split'],
       ['Menunggu Berkas', menungguBerkas.length + ' Nasabah', 'folder2-open']]
      .map(function (k) {
        return '<div class="col-md-4"><div class="stat-card">' +
          '<div class="stat-head"><div class="stat-label">' + k[0] + '</div>' +
          '<div class="stat-icon"><i class="bi bi-' + k[2] + '"></i></div></div>' +
          '<div class="stat-value">' + k[1] + '</div></div></div>';
      }).join('') + '</div>' +

    '<div class="card-lux p-3 p-md-4">' +
      '<h5 class="mb-3">Daftar Nasabah &amp; Jadwal Akad</h5>' +
      '<div class="table-wrap" style="border:none"><table class="table-lux"><thead><tr>' +
        '<th>Nasabah</th><th>Unit</th><th>Status Berkas</th>' + (kpTampil() ? '<th style="min-width:130px">Progres Rumah</th>' : '') + '<th>Tanggal Akad</th><th>Lokasi</th><th class="text-end">Aksi</th>' +
      '</tr></thead><tbody>' +
      (kpr.length ? kpr.map(function (t) {
        const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
        return '<tr><td><b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.76rem">' + esc(t.hp) + '</div></td>' +
          '<td>' + esc(p.nama || '') + '<div class="text-muted-2" style="font-size:.76rem">Blok ' + esc(t.blok) + '-' + esc(t.nomor) + '</div></td>' +
          '<td><span class="chip ' + chipStatus(t.berkas.status || 'Diajukan') + '">' + esc(t.berkas.status || 'Diajukan') + '</span></td>' +
          (kpTampil() ? '<td>' + htmlProgresMini(t.idKavling) + '</td>' : '') +                                            // v6.1
          '<td>' + (t.berkas.tanggalAkad ? '<b>' + tglIndo(t.berkas.tanggalAkad) + '</b><div class="text-muted-2" style="font-size:.76rem">' + esc(t.berkas.waktuAkad || '') + '</div>' : '<span class="text-muted-2">Belum dijadwalkan</span>') + '</td>' +
          '<td style="font-size:.82rem">' + esc(t.berkas.lokasiAkad || '-') + '</td>' +
          '<td class="text-end"><button class="btn btn-sm btn-outline-brand" onclick="formJadwalAkad(\'' + t.id + '\')">' +
          '<i class="bi bi-calendar-event"></i> ' + (t.berkas.tanggalAkad ? 'Ubah' : 'Jadwalkan') + '</button></td></tr>';
      }).join('') : '<tr><td colspan="7" class="text-center text-muted-2 py-4">Belum ada pengajuan KPR.</td></tr>') +
      '</tbody></table></div>' + (kpTampil() ? '<div class="text-muted-2 mt-2" style="font-size:.78rem"><i class="bi bi-bricks"></i> Akad dapat dijadwalkan bila progres rumah ≥ <b>' + App.kp.ambang + '%</b>' + (App.kp.wajib ? '' : ' (informasi saja — syarat tidak diwajibkan)') + '. Data dari aplikasi Kontraktor.</div>' : '') + '</div>';
  kpPastikan(function () { if (App.appPage === 'jadwalAkad') renderJadwalAkad(); });                                     // v6.1
}


// ════════ BAGIAN 11 — DATA INDENT KONSUMEN ════════

const STATUS_INDENT = ['Menunggu', 'Ditawarkan', 'Dikonversi', 'Batal'];

function chipIndent(status) {
  const s = String(status || 'Menunggu');
  if (s === 'Menunggu') return 'chip-gold';
  if (s === 'Ditawarkan') return 'chip-soft';
  if (s === 'Dikonversi') return 'chip-ok';
  if (s === 'Batal') return 'chip-danger';
  return 'chip';
}

function renderIndent() {
  const el = document.getElementById('app-indent');
  const menunggu = App.indent.filter(function (i) { return i.status === 'Menunggu'; }).length;
  const ditawarkan = App.indent.filter(function (i) { return i.status === 'Ditawarkan'; }).length;
  const konversi = App.indent.filter(function (i) { return i.status === 'Dikonversi'; }).length;

  // Proyek yang seluruh unitnya sudah habis namun punya antrean
  const proyekPenuh = App.proyek.filter(function (p) {
    const kav = App.kavling.filter(function (k) { return k.idProyek === p.id; });
    return kav.length > 0 && kav.every(function (k) { return k.status !== 'Tersedia'; });
  });
  const adaUnitBebas = App.proyek.filter(function (p) {
    const bebas = App.kavling.filter(function (k) { return k.idProyek === p.id && k.status === 'Tersedia'; }).length;
    const antre = App.indent.filter(function (i) {
      return i.idProyek === p.id && ['Menunggu', 'Ditawarkan'].indexOf(i.status) >= 0;
    }).length;
    return bebas > 0 && antre > 0;
  });

  el.innerHTML =
    '<div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">' +
      '<div><h2 class="mb-0">Data Indent Konsumen</h2>' +
      '<span class="text-muted-2" style="font-size:.86rem">Antrean konsumen yang menunggu unit tersedia kembali.</span></div>' +
      '<button class="btn btn-brand" onclick="formIndent()"><i class="bi bi-person-plus"></i> Tambah Indent</button>' +
    '</div>' +

    '<div class="row g-2 g-md-3 mb-3">' +
      [{ l: 'Menunggu Unit', v: menunggu, i: 'hourglass', g: 'is-warn' },
       { l: 'Sudah Ditawarkan', v: ditawarkan, i: 'megaphone', g: 'is-brand' },
       { l: 'Berhasil Dikonversi', v: konversi, i: 'patch-check', g: 'is-ok' },
       { l: 'Proyek Penuh Booking', v: proyekPenuh.length, i: 'building-lock', g: 'is-gold' }]
      .map(function (k) {
        return '<div class="col-6 col-xl-3"><div class="kpi-tile ' + k.g + '">' +
          '<div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
          '<div style="min-width:0"><div class="kpi-lbl">' + k.l + '</div>' +
          '<div class="kpi-val">' + k.v + '</div></div></div></div>';
      }).join('') + '</div>' +

    (adaUnitBebas.length
      ? '<div class="card-lux p-3 mb-3" style="border-color:var(--accent)">' +
          '<div class="d-flex align-items-start gap-3 flex-wrap">' +
            '<i class="bi bi-bell-fill" style="font-size:1.4rem;color:var(--accent)"></i>' +
            '<div style="flex:1;min-width:220px">' +
              '<b>Ada unit yang kembali tersedia</b>' +
              '<div class="text-muted-2" style="font-size:.85rem">' +
                adaUnitBebas.map(function (p) {
                  const bebas = App.kavling.filter(function (k) { return k.idProyek === p.id && k.status === 'Tersedia'; }).length;
                  const antre = App.indent.filter(function (i) {
                    return i.idProyek === p.id && ['Menunggu', 'Ditawarkan'].indexOf(i.status) >= 0;
                  }).length;
                  return esc(p.nama) + ': <b>' + bebas + ' unit bebas</b> • ' + antre + ' konsumen antre';
                }).join(' &nbsp;·&nbsp; ') +
              '</div>' +
            '</div>' +
          '</div></div>'
      : '') +

    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:270px">' +
        '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="indCari" placeholder="Cari nama / NIK / HP…" oninput="tundaCari(renderTabelIndent)">' +
      '</div>' +
      '<select class="form-select" style="max-width:240px" id="indProyek" onchange="renderTabelIndent()">' +
        '<option value="">Semua Proyek</option>' +
        App.proyek.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nama) + '</option>'; }).join('') +
      '</select>' +
      '<select class="form-select" style="max-width:170px" id="indStatus" onchange="renderTabelIndent()">' +
        '<option value="">Semua Status</option>' +
        STATUS_INDENT.map(function (s) { return '<option>' + s + '</option>'; }).join('') +
      '</select>' +
      '<button class="btn btn-sm btn-outline-brand ms-auto" onclick="unduhIndentPdf()">' +
        '<i class="bi bi-file-earmark-pdf"></i> Download PDF</button>' +
    '</div>' +

    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>No. Antrean</th><th>Konsumen</th><th>Proyek</th><th>Minat</th>' +
      '<th>Marketing</th><th>Status</th><th class="text-end">Aksi</th>' +
    '</tr></thead><tbody id="tbodyIndent"></tbody></table></div>';

  renderTabelIndent();
}

function indentTersaring() {
  const q = ((document.getElementById('indCari') || {}).value || '').toLowerCase();
  const p = (document.getElementById('indProyek') || {}).value || '';
  const s = (document.getElementById('indStatus') || {}).value || '';
  return App.indent.filter(function (i) {
    if (p && i.idProyek !== p) return false;
    if (s && i.status !== s) return false;
    if (q && (i.nama + ' ' + i.nik + ' ' + i.hp + ' ' + i.id).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); });
}

function renderTabelIndent() {
  const tbody = document.getElementById('tbodyIndent');
  if (!tbody) return;
  const list = indentTersaring();

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7">' +
      emptyState('hourglass', 'Belum ada data indent',
        'Konsumen yang mendaftar antrean dari etalase akan muncul di sini.') + '</td></tr>';
    return;
  }

  isiBertahap(tbody, list.map(function (i, urut) {   // v5.0 — bertahap
    const p = App.proyek.find(function (x) { return x.id === i.idProyek; }) || {};
    const bebas = App.kavling.filter(function (k) { return k.idProyek === i.idProyek && k.status === 'Tersedia'; }).length;
    return '<tr>' +
      '<td><b>' + esc(i.id) + '</b><div class="text-muted-2" style="font-size:.74rem">' + tglIndo(i.tanggal) + '</div></td>' +
      '<td><b>' + esc(i.nama) + '</b>' +
        '<div class="text-muted-2" style="font-size:.76rem">' + esc(i.hp) +
        (i.nik ? ' • NIK ' + esc(String(i.nik).substring(0, 6)) + '…' : '') + '</div></td>' +
      '<td>' + esc(p.nama || '-') +
        (bebas > 0 && ['Menunggu', 'Ditawarkan'].indexOf(i.status) >= 0
          ? '<div class="chip chip-ok" style="font-size:.66rem;margin-top:.2rem">' + bebas + ' unit bebas</div>' : '') + '</td>' +
      '<td style="font-size:.82rem">' + (esc(i.minatBlok || '-') + (i.minatTipe ? ' • ' + esc(i.minatTipe) : '')) +
        (i.budget ? '<div class="text-muted-2" style="font-size:.74rem">' + rpSingkat(i.budget) + '</div>' : '') + '</td>' +
      '<td style="font-size:.82rem">' + esc(i.marketing || '-') + '</td>' +
      '<td><span class="chip ' + chipIndent(i.status) + '">' + esc(i.status) + '</span>' + chipKeuangan(i.id) + chipAsalIndent(i) + '</td>' +   // v5.2
      '<td class="text-end"><div class="d-flex gap-1 justify-content-end flex-wrap">' +
        (i.status === 'Menunggu' && bebas > 0
          ? '<button class="btn btn-sm btn-gold" onclick="tawarkanUnit(\'' + i.id + '\')" title="Tawarkan unit yang tersedia">' +
            '<i class="bi bi-megaphone"></i> Tawarkan</button>' : '') +
        (['Menunggu', 'Ditawarkan'].indexOf(i.status) >= 0
          ? '<button class="btn btn-sm btn-outline-brand" onclick="konversiIndent(\'' + i.id + '\')" title="Buat transaksi dari data ini">' +
            '<i class="bi bi-arrow-right-circle"></i> Konversi</button>' : '') +
        '<button class="btn btn-sm btn-ghost" onclick="detailIndent(\'' + i.id + '\')" title="Dokumen, pembayaran & kwitansi"><i class="bi bi-receipt"></i></button>' +
        '<button class="btn btn-sm btn-ghost" onclick="formIndent(\'' + i.id + '\')" title="Edit"><i class="bi bi-pencil"></i></button>' +
        '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="hapusIndentUi(\'' + i.id + '\')" title="Hapus"><i class="bi bi-trash"></i></button>' +
      '</div></td></tr>';
  }));
}

function formIndent(id) {
  const d = id ? App.indent.find(function (x) { return x.id === id; }) : null;
  const blokTersedia = [...new Set(App.kavling.map(function (k) { return k.blok; }).filter(Boolean))].sort();
  const tipeTersedia = [...new Set(App.kavling.map(function (k) { return k.tipe; }).filter(Boolean))];

  openModal(d ? 'Edit Data Indent' : 'Tambah Konsumen Indent',
    '<form id="formInd"><div class="row g-3">' +
      '<div class="col-md-6"><label class="form-label">Proyek Diminati <span class="text-danger">*</span></label>' +
        '<select class="form-select" name="idProyek" required>' +
        App.proyek.map(function (p) {
          return '<option value="' + p.id + '"' + (d && d.idProyek === p.id ? ' selected' : '') + '>' + esc(p.nama) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Nama Konsumen <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="nama" required value="' + esc(d ? d.nama : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">No. HP / WhatsApp <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="hp" required value="' + esc(d ? d.hp : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">NIK (opsional)</label>' +
        '<input class="form-control" name="nik" maxlength="16" value="' + esc(d ? d.nik : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Email</label>' +
        '<input class="form-control" name="email" value="' + esc(d ? d.email : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Metode Rencana</label>' +
        '<select class="form-select" name="metode">' +
        ['', 'KPR', 'Cash', 'Tempo'].map(function (m) {
          return '<option value="' + m + '"' + (d && d.metode === m ? ' selected' : '') + '>' + (m || 'Belum ditentukan') + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-4"><label class="form-label">Blok Diminati</label>' +
        '<input class="form-control" name="minatBlok" list="listBlokInd" value="' + esc(d ? d.minatBlok : '') + '" placeholder="A / B / bebas">' +
        '<datalist id="listBlokInd">' + blokTersedia.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('') + '</datalist></div>' +
      '<div class="col-md-4"><label class="form-label">Tipe Diminati</label>' +
        '<input class="form-control" name="minatTipe" list="listTipeInd" value="' + esc(d ? d.minatTipe : '') + '" placeholder="Contoh: 120/150">' +
        '<datalist id="listTipeInd">' + tipeTersedia.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</datalist></div>' +
      '<div class="col-md-4"><label class="form-label">Anggaran (Rp)</label>' +
        '<input type="number" class="form-control" name="budget" value="' + (d ? d.budget || '' : '') + '"></div>' +
      (d ? '<div class="col-md-6"><label class="form-label">Status Antrean</label>' +
        '<select class="form-select" name="status">' +
        STATUS_INDENT.map(function (s) {
          return '<option' + (d.status === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select></div>' : '') +
      '<div class="col-md-6"><label class="form-label">Marketing Penanggung Jawab</label>' +
        '<input class="form-control" name="marketing" value="' + esc(d ? d.marketing : App.sesi.nama) + '"></div>' +
      '<div class="col-12"><label class="form-label">Catatan</label>' +
        '<textarea class="form-control" name="catatan" rows="2" placeholder="Contoh: minta blok hadap selatan, siap DP 20%">' + esc(d ? d.catatan : '') + '</textarea></div>' +
      // v4.9 — pembayaran indent + dokumen (dikonfirmasi keuangan di SiKeu)
      '<div class="col-md-6"><label class="form-label">Uang Indent / Booking Dibayar (Rp)</label>' +
        '<input class="form-control tabular" name="nominal" inputmode="numeric" placeholder="0" oninput="formatRibuan(this)" value="' +
        (d && d.nominal ? angka(d.nominal) : '') + '">' +
        '<small class="text-muted-2">Isi bila konsumen sudah membayar — dikonfirmasi bagian keuangan.</small></div>' +
      htmlUnggahDokumenManual(d) +
    '</div></form>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnInd" onclick="simpanIndentUi(' + (d ? '\'' + d.id + '\'' : 'null') + ')">' +
    '<i class="bi bi-save"></i> Simpan</button>');
}

function simpanIndentUi(id) {
  const form = document.getElementById('formInd');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const payload = {};
  Array.prototype.forEach.call(form.elements, function (el) { if (el.name) payload[el.name] = el.value; });
  if (payload.nominal !== undefined) payload.nominal = String(payload.nominal).replace(/[^0-9]/g, '');   // v4.9

  const btn = document.getElementById('btnInd');
  tombolLoading(btn, true);

  const janji = id
    ? call('updateIndent', App.token, Object.assign({ id: id, kirimNotifikasi: false }, payload))
    : call('simpanIndent', payload, App.token);

  janji.then(function (res) {
    if (!res.success) { tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan'); showToast('Gagal', res.message, 'danger'); return; }
    if (id) terapkanIndentLokal(id, payload);              // v5.2.1 — tabel langsung menampilkan data baru
    // v4.9 — lanjut unggah KTP / KK / bukti bayar yang dipilih
    const idIndent = id || (res.data && res.data.idIndent);
    unggahDokumenIndentUi(idIndent, btn, function (gagal, jumlah) {
      tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
      closeModal();
      if (gagal) showToast('Sebagian Gagal', res.message + ' Namun ' + gagal + ' dari ' + jumlah +
        ' dokumen gagal diunggah — buka Edit untuk mengunggah ulang.', 'warning');
      else showToast('Berhasil', res.message + (jumlah ? ' ' + jumlah + ' dokumen terlampir.' : ''), 'success');
      muatWorkspace(false);
    });
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    showToast('Error', err.message, 'danger');
  });
}

/** Tandai indent sebagai "Ditawarkan" + kirim kabar ke konsumen. */
function tawarkanUnit(id) {
  const d = App.indent.find(function (x) { return x.id === id; });
  if (!d) return;
  const p = App.proyek.find(function (x) { return x.id === d.idProyek; }) || {};
  const bebas = App.kavling.filter(function (k) { return k.idProyek === d.idProyek && k.status === 'Tersedia'; });

  konfirmasi('Tawarkan Unit',
    'Kabar ketersediaan ' + bebas.length + ' unit di ' + (p.nama || '') + ' akan dikirim ke ' +
    d.nama + ' (' + d.hp + ') lewat WhatsApp/email, dan statusnya menjadi "Ditawarkan".',
    function () {
      call('updateIndent', App.token, { id: id, status: 'Ditawarkan' }).then(function (res) {
        if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
        showToast('Terkirim', 'Konsumen sudah dikabari dan statusnya diperbarui.', 'success');
        muatWorkspace(false);
      }).catch(function (err) { showToast('Error', err.message, 'danger'); });
    });
}

/** Ubah data indent menjadi transaksi pada kavling yang tersedia. */
function konversiIndent(id) {
  const d = App.indent.find(function (x) { return x.id === id; });
  if (!d) return;
  const p = App.proyek.find(function (x) { return x.id === d.idProyek; });
  if (!p) { showToast('Gagal', 'Proyek tidak ditemukan.', 'danger'); return; }

  const bebas = App.kavling.filter(function (k) { return k.idProyek === d.idProyek && k.status === 'Tersedia'; })
    .sort(function (a, b) {
      if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok));
      return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
    });

  if (!bebas.length) {
    showToast('Belum Ada Unit', 'Seluruh unit pada proyek ini masih terpesan.', 'warning');
    return;
  }

  openModal('Konversi Indent → Transaksi',
    '<div class="card-flat p-3 mb-3" style="background:var(--surface)">' +
      '<b>' + esc(d.nama) + '</b>' +
      '<div class="text-muted-2" style="font-size:.82rem">' + esc(d.hp) + ' • ' + esc(p.nama) +
      (d.minatBlok ? ' • minat blok ' + esc(d.minatBlok) : '') + '</div></div>' +
    '<form id="formKonv"><div class="row g-3">' +
      '<div class="col-md-6"><label class="form-label">Pilih Kavling <span class="text-danger">*</span></label>' +
        '<select class="form-select" name="idKavling" required>' +
        bebas.map(function (k) {
          const asal = d.asalKavling && k.id === d.asalKavling;                          // v5.2 — unit sebelumnya
          const adaAsal = d.asalKavling && bebas.some(function (x) { return x.id === d.asalKavling; });
          const cocok = asal || (!adaAsal && d.minatBlok && String(k.blok).toUpperCase() === String(d.minatBlok).toUpperCase());
          return '<option value="' + k.id + '"' + (cocok ? ' selected' : '') + '>Blok ' + esc(k.blok) + ' - ' +
            esc(k.nomor) + ' • ' + rpSingkat(k.harga) + (asal ? ' ★ unit sebelumnya' : cocok ? ' ★ sesuai minat' : '') + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">NIK (16 digit) <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="nik" maxlength="16" required value="' + esc(d.nik || '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Nama Konsumen</label>' +
        '<input class="form-control" name="nama" required value="' + esc(d.nama) + '"></div>' +
      '<div class="col-md-6"><label class="form-label">No. HP</label>' +
        '<input class="form-control" name="hp" required value="' + esc(d.hp) + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Email</label>' +
        '<input class="form-control" name="email" value="' + esc(d.email || '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Metode Pembelian</label>' +
        '<select class="form-select" name="metode">' +
        ['KPR', 'Cash', 'Tempo'].map(function (m) {
          return '<option' + (d.metode === m ? ' selected' : '') + '>' + m + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-12"><label class="form-label">Catatan</label>' +
        '<textarea class="form-control" name="catatan" rows="2">' + esc(d.catatan || '') + '</textarea></div>' +
    '</div></form>' +
    '<div class="alert mt-3 mb-0" style="background:var(--info-bg);border:none;color:var(--primary);font-size:.82rem">' +
      '<i class="bi bi-info-circle"></i> Transaksi baru akan dibuat dan status indent berubah menjadi <b>Dikonversi</b>.' +
      (d.asalTransaksi ? ' Berkas KPR, KTP/KK, bukti booking &amp; riwayat pembayaran konsumen ini ikut kembali.' : '') + '</div>',   // v5.2
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnKonv" onclick="prosesKonversiIndent(\'' + id + '\')">' +
    '<i class="bi bi-arrow-right-circle"></i> Buat Transaksi</button>',
    'modal-lg');
}

function prosesKonversiIndent(id) {
  const form = document.getElementById('formKonv');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  // v5.2.2 — marketing tetap marketing yang menangani konsumen indent (bukan akun yang sedang login)
  const asal = (App.indent || []).find(function (x) { return x.id === id; }) || {};
  const payload = { marketing: asal.marketing || App.sesi.nama };
  Array.prototype.forEach.call(form.elements, function (el) { if (el.name) payload[el.name] = el.value; });

  const btn = document.getElementById('btnKonv');
  tombolLoading(btn, true);

  call('submitPembelian', payload, App.token).then(function (res) {
    if (!res.success) {
      tombolLoading(btn, false, '<i class="bi bi-arrow-right-circle"></i> Buat Transaksi');
      showToast('Gagal', res.message, 'danger');
      return;
    }
    return call('updateIndent', App.token, {
      id: id, status: 'Dikonversi', idTransaksiBaru: res.data.idTransaksi,      // v4.9.3 — berkas indent ikut pindah
      catatan: 'Dikonversi menjadi transaksi ' + res.data.idTransaksi
    }).then(function () {
      tombolLoading(btn, false, '<i class="bi bi-arrow-right-circle"></i> Buat Transaksi');
      closeModal();
      showToast('Berhasil', 'Transaksi ' + res.data.idTransaksi + ' dibuat dari antrean indent.', 'success');
      muatWorkspace(false);
    });
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-arrow-right-circle"></i> Buat Transaksi');
    showToast('Error', err.message, 'danger');
  });
}

function hapusIndentUi(id) {
  const d = App.indent.find(function (x) { return x.id === id; });
  konfirmasi('Hapus Data Indent', 'Antrean ' + (d ? d.nama : '') + ' akan dihapus permanen.', function () {
    call('hapusIndent', App.token, id).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      showToast('Berhasil', res.message, 'success');
      muatWorkspace(false);
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

function unduhIndentPdf() {
  const list = indentTersaring();
  if (!list.length) { showToast('Kosong', 'Tidak ada data untuk diekspor.', 'warning'); return; }
  const e = App.etalase || {};
  const baris = list.map(function (i, n) {
    const p = App.proyek.find(function (x) { return x.id === i.idProyek; }) || {};
    return '<tr><td>' + (n + 1) + '</td><td>' + esc(i.id) + '</td><td>' + esc(i.nama) + '</td>' +
      '<td>' + esc(i.hp) + '</td><td>' + esc(p.nama || '-') + '</td>' +
      '<td>' + esc((i.minatBlok || '-') + (i.minatTipe ? ' / ' + i.minatTipe : '')) + '</td>' +
      '<td>' + esc(i.marketing || '-') + '</td><td>' + esc(i.status) + '</td>' +
      '<td>' + tglIndo(i.tanggal) + '</td></tr>';
  }).join('');

  cetakHtml('<html><head><meta charset="utf-8"><title>Daftar Indent Konsumen</title>' +
    '<style>body{font-family:Inter,Arial,sans-serif;padding:26px;color:#241A1E}' +
    'h2{font-family:Georgia,serif;color:#7A1F3D;margin:0}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:14px}' +
    'th{background:#7A1F3D;color:#fff;text-align:left;padding:7px}td{padding:6px 7px;border-bottom:1px solid #E8DEDD}</style></head><body>' +
    '<h2>' + esc(e.namaPerusahaan || '') + '</h2>' +
    '<div style="font-size:11px;color:#6B5C60">' + esc(e.alamat || '') + '</div><hr>' +
    '<h3 style="font-family:Georgia,serif">Daftar Antrean Indent Konsumen</h3>' +
    '<div style="font-size:11px;color:#6B5C60">Dicetak: ' + new Date().toLocaleString('id-ID') +
      ' • Oleh: ' + esc(App.sesi.nama) + ' • Total: ' + list.length + ' konsumen</div>' +
    '<table><thead><tr><th>#</th><th>No. Antrean</th><th>Nama</th><th>No. HP</th><th>Proyek</th>' +
      '<th>Minat</th><th>Marketing</th><th>Status</th><th>Tanggal Daftar</th></tr></thead>' +
    '<tbody>' + baris + '</tbody></table></body></html>');
}

// ════════ BAGIAN 10 — PENGATURAN ════════

// ── 10a. Desain SPR (Marketing & Owner) ──
function renderDesainSPR() {
  const c = App.config || {};
  document.getElementById('app-desainSpr').innerHTML =
    '<div class="row g-3">' +
      '<div class="col-lg-7">' +
        '<div class="card-lux p-3 p-md-4 mb-3">' +
          '<h5 class="mb-3">Logo &amp; Identitas Dokumen</h5>' +
          '<div class="upload-box mb-3" id="boxLogoSpr" onclick="document.getElementById(\'fileLogoSpr\').click()">' +
            '<i class="bi bi-cloud-arrow-up"></i>' +
            '<div style="font-size:.88rem">Seret &amp; lepas logo di sini, atau <u>pilih file</u></div>' +
            '<small>PNG / JPG, maksimal 2 MB — disarankan 500×500 px transparan</small></div>' +
          '<input type="file" id="fileLogoSpr" class="hidden" accept="image/*" onchange="tandaiFile(\'fileLogoSpr\',\'boxLogoSpr\')">' +
          '<div class="row g-3">' +
            '<div class="col-md-6"><label class="form-label">Nama Perusahaan</label>' +
              '<input class="form-control" id="sprNamaPT" value="' + esc(c.sprNamaPerusahaan || '') + '"></div>' +
            '<div class="col-md-6"><label class="form-label">Telepon</label>' +
              '<input class="form-control" id="sprTelp" value="' + esc(c.sprTelepon || '') + '"></div>' +
            '<div class="col-md-6"><label class="form-label">Email</label>' +
              '<input class="form-control" id="sprEmail" value="' + esc(c.sprEmail || '') + '"></div>' +
            '<div class="col-md-6"><label class="form-label">Nama Penandatangan</label>' +
              '<input class="form-control" id="sprTtd" value="' + esc(c.sprPenandatangan || '') + '"></div>' +
            '<div class="col-12"><label class="form-label">Alamat Kantor</label>' +
              '<input class="form-control" id="sprAlamat" value="' + esc(c.sprAlamat || '') + '"></div>' +
          '</div>' +
        '</div>' +

        '<div class="card-lux p-3 p-md-4 mb-3">' +
          '<h5 class="mb-1">Warna Aksen Dokumen SPR</h5>' +
          '<p class="text-muted-2" style="font-size:.84rem">Warna untuk kop, garis pembatas, dan stempel dokumen.</p>' +
          '<div class="row g-2" id="palettSpr">' +
            [['#7A1F3D', 'Deep Maroon'], ['#C9A24B', 'Soft Gold'], ['#1B2A4A', 'Navy Klasik'], ['#262626', 'Hitam Arang']]
            .map(function (w) {
              const aktif = (c.sprWarna || '#7A1F3D').toLowerCase() === w[0].toLowerCase();
              return '<div class="col-6 col-md-3"><div class="card-flat p-3 text-center cursor-pointer' + (aktif ? ' border-2' : '') + '" ' +
                'style="border-color:' + (aktif ? w[0] : 'var(--border)') + ';border-width:' + (aktif ? '2px' : '1px') + '" ' +
                'onclick="pilihWarnaSpr(\'' + w[0] + '\')">' +
                '<div style="width:38px;height:38px;border-radius:50%;background:' + w[0] + ';margin:0 auto .5rem;display:grid;place-items:center;color:#fff">' +
                (aktif ? '<i class="bi bi-check-lg"></i>' : '') + '</div>' +
                '<div style="font-size:.82rem;font-weight:500">' + w[1] + '</div>' +
                '<div class="text-muted-2" style="font-size:.74rem">' + w[0] + '</div></div></div>';
            }).join('') +
          '</div>' +
          '<input type="hidden" id="sprWarnaVal" value="' + esc(c.sprWarna || '#7A1F3D') + '">' +
        '</div>' +

        '<div class="card-lux p-3 p-md-4 mb-3">' +
          '<h5 class="mb-1">Tipografi Dokumen</h5>' +
          '<p class="text-muted-2" style="font-size:.84rem">Kombinasi font resmi untuk judul dan isi surat pemesanan.</p>' +
          '<div class="row g-2">' +
            '<div class="col-md-6"><label class="card-flat p-3 d-block cursor-pointer">' +
              '<input type="radio" name="sprFont" value="playfair" class="form-check-input me-2"' + ((c.sprFont || 'playfair') === 'playfair' ? ' checked' : '') + '>' +
              '<b style="font-family:var(--font-head)">Playfair Display &amp; Inter</b>' +
              '<div class="text-muted-2" style="font-size:.8rem">Kombinasi elegan formal khas eksekutif properti mewah.</div></label></div>' +
            '<div class="col-md-6"><label class="card-flat p-3 d-block cursor-pointer">' +
              '<input type="radio" name="sprFont" value="inter" class="form-check-input me-2"' + (c.sprFont === 'inter' ? ' checked' : '') + '>' +
              '<b>Inter Sans-Serif</b>' +
              '<div class="text-muted-2" style="font-size:.8rem">Gaya modern minimalis yang bersih dan mudah dibaca.</div></label></div>' +
          '</div>' +
        '</div>' +

        '<div class="card-lux p-3 p-md-4">' +
          '<h5 class="mb-1">Syarat &amp; Ketentuan Umum SPR</h5>' +
          '<p class="text-muted-2" style="font-size:.84rem">Klausul standar yang tercetak pada dokumen pemesanan.</p>' +
          '<textarea class="form-control" id="sprSyarat" rows="8">' + esc(c.sprSyarat || '') + '</textarea>' +
        '</div>' +

        '<div class="d-flex gap-2 mt-3">' +
          '<button class="btn btn-outline-gold" onclick="pratinjauSprContoh()"><i class="bi bi-eye"></i> Pratinjau Langsung</button>' +
          '<button class="btn btn-brand" id="btnSimpanSpr" onclick="simpanDesainSpr()"><i class="bi bi-save"></i> Simpan Perubahan Desain</button>' +
        '</div>' +
      '</div>' +

      '<div class="col-lg-5">' +
        '<div class="card-lux p-3 position-sticky" style="top:90px">' +
          '<div class="d-flex justify-content-between align-items-center mb-2">' +
            '<span class="sect-label">Pratinjau Dokumen</span><span class="chip chip-gold">Live Render</span></div>' +
          '<div id="sprPreviewMini" style="transform-origin:top left"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  pratinjauSprContoh();
}

function pilihWarnaSpr(warna) {
  document.getElementById('sprWarnaVal').value = warna;
  // Perbarui penanda pilihan tanpa render ulang seluruh halaman
  document.querySelectorAll('#palettSpr .card-flat').forEach(function (kartu) {
    const bulat = kartu.querySelector('div[style*="border-radius:50%"]');
    const hex = (kartu.querySelector('.text-muted-2') || {}).textContent || '';
    const aktif = hex.trim().toLowerCase() === warna.toLowerCase();
    kartu.style.borderColor = aktif ? warna : 'var(--border)';
    kartu.style.borderWidth = aktif ? '2px' : '1px';
    if (bulat) bulat.innerHTML = aktif ? '<i class="bi bi-check-lg"></i>' : '';
  });
  pratinjauSprContoh();
}

function dataSprDariForm() {
  return {
    namaPerusahaan: document.getElementById('sprNamaPT').value,
    alamat: document.getElementById('sprAlamat').value,
    telepon: document.getElementById('sprTelp').value,
    email: document.getElementById('sprEmail').value,
    penandatangan: document.getElementById('sprTtd').value,
    warna: document.getElementById('sprWarnaVal').value,
    font: (document.querySelector('input[name="sprFont"]:checked') || {}).value || 'playfair',
    syarat: document.getElementById('sprSyarat').value
  };
}

function pratinjauSprContoh() {
  const d = dataSprDariForm();
  const contoh = {
    nomorSPR: 'SPR/2026/09/CONTOH', tanggal: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    konsumen: { nama: 'Budi Santoso, S.T.', nik: '3271045208800003', hp: '+62 812-9876-5432', pekerjaan: 'Karyawan Swasta' },
    unit: { proyek: 'Grand Vistania Residences', tipe: '120/150', blok: 'A', nomor: '12', lt: 120, lb: 150 },
    harga: { dasar: 1250000000, ppn: 137500000, ajb: 30000000, total: 1417500000 },
    transaksi: { id: 'TRX-CONTOH', metode: 'KPR', marketing: App.sesi.nama, status: 'Proses KPR' },
    desain: {
      namaPerusahaan: d.namaPerusahaan || 'PT Properti Megah Utama', alamat: d.alamat,
      telepon: d.telepon, email: d.email, logoUrl: App.config.sprLogoUrl || '',
      warna: d.warna, font: d.font, syarat: d.syarat, penandatangan: d.penandatangan
    }
  };
  const box = document.getElementById('sprPreviewMini');
  if (box) box.innerHTML = '<div style="zoom:.62">' + htmlSPR(contoh) + '</div>';
}

function simpanDesainSpr() {
  const btn = document.getElementById('btnSimpanSpr');
  tombolLoading(btn, true);
  call('simpanDesainSPR', App.token, dataSprDariForm(), fileBuffer.fileLogoSpr || null).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Perubahan Desain');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.config = res.data;
    delete fileBuffer.fileLogoSpr;
    showToast('Berhasil', res.message, 'success');
    renderDesainSPR();
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Perubahan Desain');
    showToast('Error', err.message, 'danger');
  });
}

// ── 10b. Master Proyek & Kavling (Owner) ──
function renderMasterProyek() {
  const el = document.getElementById('app-masterProyek');
  el.innerHTML =
    '<div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">' +
      '<div><h2 class="mb-0">Master Proyek &amp; Kavling</h2>' +
      '<span class="text-muted-2" style="font-size:.86rem">Kelola proyek perumahan beserta seluruh unit kavlingnya.</span></div>' +
      '<div class="d-flex gap-2">' +
        '<button class="btn btn-outline-brand" onclick="formProyek()"><i class="bi bi-plus-lg"></i> Proyek Baru</button>' +
        '<button class="btn btn-brand" onclick="formKavlingBatch()"><i class="bi bi-grid-3x3-gap"></i> Tambah Kavling Massal</button>' +
      '</div></div>' +

    '<div class="row g-3 mb-4">' + App.proyek.map(function (p) {
      const s = statistikProyek(p.id);
      return '<div class="col-md-6 col-xl-4"><div class="card-lux p-3 h-100 mp-kartu" id="mpKartu_' + p.id + '">' +
        '<div class="d-flex gap-3">' +
          '<div style="width:64px;height:64px;border-radius:12px;overflow:hidden;flex:none;background:var(--surface-2)">' +
            (p.foto ? '<img src="' + esc(p.foto) + '" class="img-cover">' : '<div class="d-grid h-100" style="place-items:center"><i class="bi bi-buildings"></i></div>') +
          '</div>' +
          '<div class="flex-grow-1"><b>' + esc(p.nama) + '</b>' +
            '<div class="text-muted-2" style="font-size:.78rem">' + esc(p.kota || p.alamat) + '</div>' +
            '<span class="chip ' + (p.aktif ? 'chip-ok' : 'chip-danger') + ' mt-1">' + (p.aktif ? 'Aktif' : 'Nonaktif') + '</span></div>' +
        '</div>' +
        '<div class="card-flat p-2 my-2 d-flex justify-content-between" style="background:var(--surface);font-size:.8rem">' +
          '<span>' + s.total + ' kavling</span><span style="color:var(--success)">' + s.tersedia + ' tersedia</span>' +
          '<span style="color:var(--primary)">' + s.terjual + ' terjual</span></div>' +
        '<div class="d-flex gap-2">' +
          '<button class="btn btn-sm btn-ghost flex-grow-1" onclick="formProyek(\'' + p.id + '\')"><i class="bi bi-pencil"></i> Edit</button>' +
          '<button class="btn btn-sm btn-outline-brand flex-grow-1" onclick="lihatKavlingMaster(\'' + p.id + '\', true)"><i class="bi bi-list-ul"></i> Kavling</button>' +
        '</div></div></div>';
    }).join('') + '</div>' +
    '<div id="masterKavlingArea"></div>';

  // Tetap pada proyek yang terakhir dibuka (tidak kembali ke proyek pertama setelah menyimpan)
  if (App.proyek.length) {
    const masih = App.proyek.some(function (p) { return p.id === App.masterProyekId; });
    lihatKavlingMaster(masih ? App.masterProyekId : App.proyek[0].id);
  }
}

function lihatKavlingMaster(idProyek, gulir) {
  const p = App.proyek.find(function (x) { return x.id === idProyek; });
  if (!p) return;
  App.masterProyekId = idProyek;
  document.querySelectorAll('#app-masterProyek .mp-kartu').forEach(function (el) {
    const aktif = el.id === 'mpKartu_' + idProyek;
    el.style.outline = aktif ? '2px solid var(--primary)' : '';
    el.style.outlineOffset = aktif ? '-2px' : '';
  });
  const list = App.kavling.filter(function (k) { return k.idProyek === idProyek; })
    .sort(function (a, b) {
      if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok));
      return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
    });

  document.getElementById('masterKavlingArea').innerHTML =
    '<div class="card-lux p-3 p-md-4">' +
      '<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">' +
        '<h5 class="mb-0">Daftar Kavling — ' + esc(p.nama) + '</h5>' +
        '<div class="d-flex gap-2 flex-wrap">' +
          '<button class="btn btn-sm btn-outline-brand" onclick="formFotoMassal(\'' + idProyek + '\')"' + (list.length ? '' : ' disabled') + '><i class="bi bi-images"></i> Foto Massal</button>' +
          '<button class="btn btn-sm btn-brand" onclick="formKavling(null,\'' + idProyek + '\')"><i class="bi bi-plus-lg"></i> Tambah Kavling</button>' +
        '</div>' +
      '</div>' +
      '<div class="table-wrap" style="border:none"><table class="table-lux"><thead><tr>' +
        '<th>Blok</th><th>No.</th><th>Tipe</th><th>LT / LB</th><th class="text-end">Harga Jual</th><th>Promo</th><th>Status</th><th class="text-end">Aksi</th>' +
      '</tr></thead><tbody id="tbodyMasterKavling"></tbody></table></div></div>';
  // v5.0 — baris kavling digambar bertahap
  isiBertahap(document.getElementById('tbodyMasterKavling'), list.length ? list.map(function (k) {
        return '<tr><td><b>' + esc(k.blok) + '</b></td><td class="tabular">' + esc(k.nomor) + '</td>' +
          '<td>' + esc(k.tipe || '-') + '</td><td class="tabular">' + k.lt + ' / ' + k.lb + ' m²</td>' +
          '<td class="text-end tabular">' + rp(k.harga) + '</td>' +
          '<td>' + (k.promoAktif ? '<span class="chip chip-gold">Aktif</span>' : '<span class="text-muted-2" style="font-size:.8rem">-</span>') + '</td>' +
          '<td><span class="chip ' + chipStatus(k.status) + '">' + esc(k.status) + '</span></td>' +
          '<td class="text-end"><div class="d-flex gap-1 justify-content-end">' +
            '<button class="btn btn-sm btn-ghost" onclick="formKavling(\'' + k.id + '\')"><i class="bi bi-pencil"></i></button>' +
            '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="hapusKavlingUi(\'' + k.id + '\')"><i class="bi bi-trash"></i></button>' +
          '</div></td></tr>';
      }) : ['<tr><td colspan="8" class="text-center text-muted-2 py-4">Belum ada kavling pada proyek ini.</td></tr>']);
  if (gulir) document.getElementById('masterKavlingArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formProyek(id) {
  const p = id ? App.proyek.find(function (x) { return x.id === id; }) : null;
  openModal(p ? 'Edit Proyek' : 'Tambah Proyek Baru',
    '<form id="formPrj"><div class="row g-3">' +
      '<div class="col-md-8"><label class="form-label">Nama Perumahan <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="nama" required value="' + esc(p ? p.nama : '') + '"></div>' +
      '<div class="col-md-4"><label class="form-label">Kota</label>' +
        '<input class="form-control" name="kota" value="' + esc(p ? p.kota : '') + '"></div>' +
      '<div class="col-12"><label class="form-label">Alamat Lengkap</label>' +
        '<input class="form-control" name="alamat" value="' + esc(p ? p.alamat : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Badge / Label</label>' +
        '<input class="form-control" name="badge" placeholder="Contoh: Cluster Eksklusif" value="' + esc(p ? p.badge : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Status</label>' +
        '<select class="form-select" name="aktif"><option value="true"' + (!p || p.aktif ? ' selected' : '') + '>Aktif</option>' +
        '<option value="false"' + (p && !p.aktif ? ' selected' : '') + '>Nonaktif</option></select></div>' +
      '<div class="col-12"><label class="form-label">Deskripsi</label>' +
        '<textarea class="form-control" name="deskripsi" rows="3">' + esc(p ? p.deskripsi : '') + '</textarea></div>' +
      '<div class="col-12"><label class="form-label">Foto Utama Proyek (unggah file langsung)</label>' +
        '<div class="upload-box" id="boxFotoProyek" onclick="document.getElementById(\'fileFotoProyek\').click()">' +
          '<i class="bi bi-image"></i><div style="font-size:.86rem">Pilih file foto utama</div>' +
          '<small>JPG / PNG, maksimal 5 MB</small></div>' +
        '<input type="file" id="fileFotoProyek" class="hidden" accept="image/*" onchange="tandaiFile(\'fileFotoProyek\',\'boxFotoProyek\')"></div>' +
    '</div></form>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnSimpanPrj" onclick="simpanProyekUi(' + (p ? '\'' + p.id + '\'' : 'null') + ')"><i class="bi bi-save"></i> Simpan</button>');
}

function simpanProyekUi(id) {
  const form = document.getElementById('formPrj');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const p = id ? App.proyek.find(function (x) { return x.id === id; }) : null;
  const payload = {
    id: id || '', nama: form.nama.value, kota: form.kota.value, alamat: form.alamat.value,
    badge: form.badge.value, deskripsi: form.deskripsi.value, aktif: form.aktif.value === 'true',
    fotoLama: ''
  };
  const btn = document.getElementById('btnSimpanPrj');
  tombolLoading(btn, true);
  call('simpanProyek', App.token, payload, fileBuffer.fileFotoProyek || null).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    delete fileBuffer.fileFotoProyek;
    closeModal();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    showToast('Error', err.message, 'danger');
  });
}

function formKavling(id, idProyekDefault) {
  const k = id ? App.kavling.find(function (x) { return x.id === id; }) : null;
  const idP = k ? k.idProyek : idProyekDefault;
  openModal(k ? 'Edit Kavling' : 'Tambah Kavling',
    '<form id="formKav"><div class="row g-3">' +
      '<div class="col-md-6"><label class="form-label">Proyek <span class="text-danger">*</span></label>' +
        '<select class="form-select" name="idProyek" required>' +
        App.proyek.map(function (p) {
          return '<option value="' + p.id + '"' + (p.id === idP ? ' selected' : '') + '>' + esc(p.nama) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-3"><label class="form-label">Blok <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="blok" required value="' + esc(k ? k.blok : '') + '" placeholder="A"></div>' +
      '<div class="col-md-3"><label class="form-label">Nomor Kavling <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="nomor" required value="' + esc(k ? k.nomor : '') + '" placeholder="01 atau 12B"></div>' +
      '<div class="col-md-6"><label class="form-label">Nama Blok / Cluster</label>' +
        '<input class="form-control" name="namaBlok" value="' + esc(k ? k.namaBlok : '') + '" placeholder="Cluster Diamond"></div>' +
      '<div class="col-md-6"><label class="form-label">Tipe Rumah</label>' +
        '<input class="form-control" name="tipe" value="' + esc(k ? k.tipe : '') + '" placeholder="120/150"></div>' +
      '<div class="col-md-3"><label class="form-label">Luas Tanah (m²)</label>' +
        '<input type="number" class="form-control" name="lt" value="' + (k ? k.lt : '') + '"></div>' +
      '<div class="col-md-3"><label class="form-label">Luas Bangunan (m²)</label>' +
        '<input type="number" class="form-control" name="lb" value="' + (k ? k.lb : '') + '"></div>' +
      '<div class="col-md-3"><label class="form-label">Kamar Tidur</label>' +
        '<input type="number" class="form-control" name="kt" value="' + (k ? k.kt : '') + '"></div>' +
      '<div class="col-md-3"><label class="form-label">Kamar Mandi</label>' +
        '<input type="number" class="form-control" name="km" value="' + (k ? k.km : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Harga Jual (Rp)</label>' +
        '<input type="number" class="form-control" name="harga" value="' + (k ? k.harga : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Status Kavling</label>' +
        '<select class="form-select" name="status">' +
        ['Tersedia', 'Proses KPR', 'SP3K', 'Terjual'].map(function (s) {
          return '<option' + (k && k.status === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-12"><label class="form-label">Foto Desain Rumah (unggah file langsung)</label>' +
        '<div class="upload-box" id="boxFotoKav" onclick="document.getElementById(\'fileFotoKav\').click()">' +
          '<i class="bi bi-house"></i><div style="font-size:.86rem">Pilih file foto desain</div>' +
          '<small>JPG / PNG, maksimal 5 MB</small></div>' +
        '<input type="file" id="fileFotoKav" class="hidden" accept="image/*" onchange="tandaiFile(\'fileFotoKav\',\'boxFotoKav\')"></div>' +
    '</div></form>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnSimpanKav" onclick="simpanKavlingUi(' + (k ? '\'' + k.id + '\'' : 'null') + ')"><i class="bi bi-save"></i> Simpan</button>');
}

function simpanKavlingUi(id) {
  const form = document.getElementById('formKav');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const payload = { id: id || '' };
  Array.prototype.forEach.call(form.elements, function (el) { if (el.name) payload[el.name] = el.value; });

  const btn = document.getElementById('btnSimpanKav');
  tombolLoading(btn, true);
  call('simpanKavling', App.token, payload, fileBuffer.fileFotoKav || null).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    delete fileBuffer.fileFotoKav;
    App.masterProyekId = payload.idProyek;   // daftar kavling tetap di proyek yang baru diisi
    closeModal();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    showToast('Error', err.message, 'danger');
  });
}

function formKavlingBatch() {
  const idDefault = App.masterProyekId || (App.proyek[0] || {}).id;
  App._fotoBatch = [];
  openModal('Tambah Kavling Massal',
    '<p class="text-muted-2" style="font-size:.86rem">Buat banyak kavling sekaligus dalam satu blok — hemat waktu untuk proyek baru.</p>' +
    '<form id="formKavBatch"><div class="row g-3">' +
      '<div class="col-md-6"><label class="form-label">Proyek <span class="text-danger">*</span></label>' +
        '<select class="form-select" name="idProyek" required>' +
        App.proyek.map(function (p) {
          return '<option value="' + p.id + '"' + (p.id === idDefault ? ' selected' : '') + '>' + esc(p.nama) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-3"><label class="form-label">Blok <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="blok" required placeholder="A"></div>' +
      '<div class="col-md-3"><label class="form-label">Nama Blok</label>' +
        '<input class="form-control" name="namaBlok" placeholder="Cluster Diamond"></div>' +
      '<div class="col-md-3"><label class="form-label">Nomor Awal</label>' +
        '<input type="number" class="form-control" name="mulai" value="1" oninput="renderInfoFotoBatch()"></div>' +
      '<div class="col-md-3"><label class="form-label">Nomor Akhir</label>' +
        '<input type="number" class="form-control" name="sampai" value="20" oninput="renderInfoFotoBatch()"></div>' +
      '<div class="col-md-6"><label class="form-label">Tipe Rumah</label>' +
        '<input class="form-control" name="tipe" placeholder="120/150"></div>' +
      '<div class="col-md-3"><label class="form-label">Luas Tanah</label><input type="number" class="form-control" name="lt"></div>' +
      '<div class="col-md-3"><label class="form-label">Luas Bangunan</label><input type="number" class="form-control" name="lb"></div>' +
      '<div class="col-md-3"><label class="form-label">Kamar Tidur</label><input type="number" class="form-control" name="kt"></div>' +
      '<div class="col-md-3"><label class="form-label">Kamar Mandi</label><input type="number" class="form-control" name="km"></div>' +
      '<div class="col-12"><label class="form-label">Harga Jual per Unit (Rp)</label><input type="number" class="form-control" name="harga"></div>' +

      '<div class="col-12"><label class="form-label mb-1">Foto Desain Rumah <span class="text-muted-2" style="font-weight:400">(opsional)</span></label>' +
        '<div class="d-flex flex-wrap gap-3 mb-2" style="font-size:.86rem">' +
          '<div class="form-check"><input class="form-check-input" type="radio" name="modeFotoBatch" id="mfbSama" value="sama" checked onchange="renderInfoFotoBatch()">' +
            '<label class="form-check-label" for="mfbSama">Satu foto untuk semua unit</label></div>' +
          '<div class="form-check"><input class="form-check-input" type="radio" name="modeFotoBatch" id="mfbUnit" value="perUnit" onchange="renderInfoFotoBatch()">' +
            '<label class="form-check-label" for="mfbUnit">Foto berbeda tiap unit</label></div>' +
        '</div>' +
        '<div class="upload-box" id="boxFotoBatch" onclick="document.getElementById(\'fileFotoBatch\').click()">' +
          '<i class="bi bi-images"></i><div style="font-size:.86rem">Pilih satu atau beberapa foto sekaligus</div>' +
          '<small>JPG / PNG — otomatis diperkecil sebelum dikirim</small></div>' +
        '<input type="file" id="fileFotoBatch" class="hidden" accept="image/*" multiple onchange="siapkanFotoBatch()">' +
        '<div id="fotoBatchInfo" class="mt-2"></div>' +
      '</div>' +
    '</div></form>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnKavBatch" onclick="simpanKavlingBatchUi()"><i class="bi bi-lightning"></i> Buat Kavling</button>');
}

/** Urutkan nama file secara alami: foto2.jpg sebelum foto10.jpg. */
function urutNamaFile(a, b) {
  return String(a.nama).localeCompare(String(b.nama), undefined, { numeric: true, sensitivity: 'base' });
}

/** Baca & perkecil semua foto yang dipilih (berurutan agar HP tidak berat). */
function siapkanFotoBatch() {
  const input = document.getElementById('fileFotoBatch');
  const box = document.getElementById('boxFotoBatch');
  const files = Array.prototype.slice.call(input.files || []);
  if (!files.length) return;
  if (files.length > 100) {
    showToast('Terlalu Banyak Foto', 'Maksimal 100 foto per proses.', 'warning');
    input.value = '';
    return;
  }
  (App._fotoBatch || []).forEach(function (f) { try { URL.revokeObjectURL(f.pratinjau); } catch (e) {} });
  App._fotoBatch = [];
  const btn = document.getElementById('btnKavBatch');
  if (btn) btn.disabled = true;

  let urutan = Promise.resolve();
  files.forEach(function (file, i) {
    urutan = urutan.then(function () {
      box.innerHTML = '<i class="bi bi-arrow-repeat"></i><div style="font-size:.86rem">Menyiapkan foto ' + (i + 1) + ' dari ' + files.length + '…</div>';
      if (file.size > 15 * 1024 * 1024) return;   // lewati file raksasa
      return kompresGambar(file, 1600, 0.78).then(function (hasil) {
        App._fotoBatch.push({ nama: file.name, hasil: hasil, pratinjau: URL.createObjectURL(file) });
      }).catch(function () {});
    });
  });
  urutan.then(function () {
    if (btn) btn.disabled = false;
    input.value = '';
    App._fotoBatch.sort(urutNamaFile);
    const n = App._fotoBatch.length;
    box.classList.toggle('has-file', n > 0);
    box.innerHTML = n
      ? '<i class="bi bi-check-circle"></i><div style="font-size:.86rem">' + n + ' foto siap</div><small>Klik untuk mengganti pilihan foto</small>'
      : '<i class="bi bi-images"></i><div style="font-size:.86rem">Pilih satu atau beberapa foto sekaligus</div><small>JPG / PNG — otomatis diperkecil sebelum dikirim</small>';
    if (n < files.length) showToast('Sebagian Dilewati', (files.length - n) + ' file tidak dapat dibaca atau terlalu besar.', 'warning');
    renderInfoFotoBatch();
  });
}

/** Nomor kavling (01, 02, …) sesuai rentang yang diisi pada formulir. */
function nomorRentangBatch() {
  const form = document.getElementById('formKavBatch');
  if (!form) return [];
  const mulai = Number(form.mulai.value) || 1;
  const sampai = Number(form.sampai.value) || mulai;
  const hasil = [];
  for (let i = mulai; i <= sampai && hasil.length < 200; i++) hasil.push((i < 10 ? '0' : '') + i);
  return hasil;
}

function modeFotoBatch() {
  const el = document.querySelector('input[name="modeFotoBatch"]:checked');
  return el ? el.value : 'sama';
}

/** Ringkasan foto: pratinjau kecil + pasangan "unit ← foto" pada mode per unit. */
function renderInfoFotoBatch() {
  const wrap = document.getElementById('fotoBatchInfo');
  if (!wrap) return;
  const foto = App._fotoBatch || [];
  if (!foto.length) { wrap.innerHTML = ''; return; }
  const thumb = function (f, label) {
    return '<div class="text-center" style="width:74px">' +
      '<div style="width:74px;height:56px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--surface-2)">' +
        '<img src="' + esc(f.pratinjau) + '" class="img-cover"></div>' +
      '<div class="text-muted-2 text-truncate" style="font-size:.68rem;margin-top:.15rem" title="' + esc(f.nama) + '">' + label + '</div></div>';
  };

  if (modeFotoBatch() === 'sama') {
    wrap.innerHTML = '<div class="d-flex gap-2 align-items-center flex-wrap">' + thumb(foto[0], esc(foto[0].nama)) +
      '<div style="font-size:.82rem">Foto ini dipasang pada <b>semua unit</b> yang dibuat.' +
      (foto.length > 1 ? '<br><span class="text-muted-2">' + (foto.length - 1) + ' foto lain diabaikan — pilih mode "Foto berbeda tiap unit" untuk memakainya.</span>' : '') +
      '</div></div>';
    return;
  }

  const nomor = nomorRentangBatch();
  const blok = (document.querySelector('#formKavBatch [name="blok"]') || {}).value || '';
  const blokTeks = blok ? esc(blok.toUpperCase()) + '-' : '';
  wrap.innerHTML =
    '<div class="text-muted-2 mb-2" style="font-size:.8rem"><i class="bi bi-info-circle"></i> ' +
      'Foto dipasangkan berurutan menurut <b>nama file</b> (foto1, foto2, …) ke unit ' + blokTeks + nomor[0] + ' dan seterusnya. ' +
      'Unit tanpa pasangan tetap dibuat tanpa foto.</div>' +
    '<div class="d-flex flex-wrap gap-2" style="max-height:220px;overflow:auto">' +
      nomor.map(function (no, i) {
        return foto[i] ? thumb(foto[i], blokTeks + no)
          : '<div class="text-center" style="width:74px"><div style="width:74px;height:56px;border-radius:8px;border:1px dashed var(--border);display:grid;place-items:center;color:var(--muted)"><i class="bi bi-image"></i></div>' +
            '<div class="text-muted-2" style="font-size:.68rem;margin-top:.15rem">' + blokTeks + no + '</div></div>';
      }).join('') +
    '</div>' +
    (foto.length > nomor.length ? '<div class="mt-2" style="font-size:.8rem;color:var(--warning)"><i class="bi bi-exclamation-triangle"></i> ' +
      (foto.length - nomor.length) + ' foto berlebih tidak dipakai.</div>' : '');
}

/** Pasang foto satu per satu (berurutan) dengan penunjuk progres di tombol. */
function unggahFotoBerurutan(tugas, btn) {
  let berhasil = 0, gagal = 0;
  let rantai = Promise.resolve();
  tugas.forEach(function (t, i) {
    rantai = rantai.then(function () {
      if (btn) btn.innerHTML = '<span class="spinner-inline"></span> Mengunggah foto ' + (i + 1) + '/' + tugas.length + '…';
      return call('pasangFotoKavling', App.token, t.ids, t.file).then(function (res) {
        if (res.success) berhasil++; else gagal++;
      }).catch(function () { gagal++; });
    });
  });
  return rantai.then(function () { return { berhasil: berhasil, gagal: gagal }; });
}

function simpanKavlingBatchUi() {
  const form = document.getElementById('formKavBatch');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const payload = {};
  Array.prototype.forEach.call(form.elements, function (el) {
    if (el.name && el.name !== 'modeFotoBatch') payload[el.name] = el.value;
  });
  const foto = App._fotoBatch || [];
  const mode = modeFotoBatch();
  const mulai = Number(payload.mulai) || 1;

  const btn = document.getElementById('btnKavBatch');
  tombolLoading(btn, true);
  call('simpanKavlingBatch', App.token, payload).then(function (res) {
    if (!res.success) {
      tombolLoading(btn, false, '<i class="bi bi-lightning"></i> Buat Kavling');
      showToast('Gagal', res.message, 'danger');
      return;
    }
    App.masterProyekId = payload.idProyek;   // daftar kavling tetap di proyek yang baru diisi
    const dibuat = (res.data && res.data.kavling) || [];

    // Susun tugas unggah foto
    let tugas = [];
    if (foto.length && dibuat.length) {
      if (mode === 'sama') {
        tugas = [{ ids: dibuat.map(function (k) { return k.id; }), file: foto[0].hasil }];
      } else {
        dibuat.forEach(function (k) {
          const f = foto[(parseInt(k.nomor, 10) || 0) - mulai];
          if (f) tugas.push({ ids: [k.id], file: f.hasil });
        });
      }
    }

    const selesai = function (hasilFoto) {
      tombolLoading(btn, false, '<i class="bi bi-lightning"></i> Buat Kavling');
      (App._fotoBatch || []).forEach(function (f) { try { URL.revokeObjectURL(f.pratinjau); } catch (e) {} });
      App._fotoBatch = [];
      closeModal();
      let pesan = res.message;
      if (hasilFoto) {
        pesan += mode === 'sama'
          ? (hasilFoto.gagal ? ' Foto gagal dipasang — coba lagi lewat tombol Foto Massal.' : ' Foto desain terpasang di semua unit.')
          : ' ' + hasilFoto.berhasil + ' foto terpasang' + (hasilFoto.gagal ? ', ' + hasilFoto.gagal + ' gagal (ulangi lewat Foto Massal).' : '.');
      }
      showToast(hasilFoto && hasilFoto.gagal ? 'Sebagian Berhasil' : 'Berhasil', pesan, hasilFoto && hasilFoto.gagal ? 'warning' : 'success');
      muatWorkspace(false);
    };

    if (!tugas.length) { selesai(null); return; }
    unggahFotoBerurutan(tugas, btn).then(selesai);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-lightning"></i> Buat Kavling');
    showToast('Error', err.message, 'danger');
  });
}

// ── Foto Massal untuk kavling yang sudah ada ──
function formFotoMassal(idProyek) {
  const p = App.proyek.find(function (x) { return x.id === idProyek; }) || {};
  const list = App.kavling.filter(function (k) { return k.idProyek === idProyek; });
  const blok = [...new Set(list.map(function (k) { return k.blok; }).filter(Boolean))].sort();
  const tipe = [...new Set(list.map(function (k) { return k.tipe; }).filter(Boolean))].sort();
  delete fileBuffer.fileFotoMassal;

  openModal('Foto Massal — ' + (p.nama || ''),
    '<p class="text-muted-2" style="font-size:.86rem">Pasang satu foto desain ke banyak kavling sekaligus. ' +
      'Cocok untuk unit dengan tipe rumah yang sama.</p>' +
    '<div class="row g-2 mb-2">' +
      '<div class="col-md-4"><label class="form-label">Blok</label><select class="form-select" id="fmBlok" onchange="renderDaftarFotoMassal(\'' + idProyek + '\')">' +
        '<option value="">Semua Blok</option>' + blok.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('') + '</select></div>' +
      '<div class="col-md-4"><label class="form-label">Tipe Rumah</label><select class="form-select" id="fmTipe" onchange="renderDaftarFotoMassal(\'' + idProyek + '\')">' +
        '<option value="">Semua Tipe</option>' + tipe.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
      '<div class="col-md-4 d-flex align-items-end"><div class="form-check mb-2">' +
        '<input class="form-check-input" type="checkbox" id="fmBelum" onchange="renderDaftarFotoMassal(\'' + idProyek + '\')">' +
        '<label class="form-check-label" for="fmBelum" style="font-size:.86rem">Hanya yang belum berfoto</label></div></div>' +
    '</div>' +
    '<div class="d-flex justify-content-between align-items-center mb-2">' +
      '<span id="fmJumlah" class="text-muted-2" style="font-size:.82rem"></span>' +
      '<div class="d-flex gap-1">' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="centangFotoMassal(true)">Pilih semua</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="centangFotoMassal(false)">Kosongkan</button>' +
      '</div></div>' +
    '<div id="fmDaftar" class="card-flat p-2 mb-3" style="max-height:240px;overflow:auto;background:var(--surface)"></div>' +
    '<label class="form-label">Foto Desain</label>' +
    '<div class="upload-box" id="boxFotoMassal" onclick="document.getElementById(\'fileFotoMassal\').click()">' +
      '<i class="bi bi-image"></i><div style="font-size:.86rem">Pilih file foto desain</div>' +
      '<small>JPG / PNG, otomatis diperkecil</small></div>' +
    '<input type="file" id="fileFotoMassal" class="hidden" accept="image/*" onchange="tandaiFile(\'fileFotoMassal\',\'boxFotoMassal\')">',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnFotoMassal" onclick="simpanFotoMassal()"><i class="bi bi-images"></i> Pasang Foto</button>');
  renderDaftarFotoMassal(idProyek);
}

function renderDaftarFotoMassal(idProyek) {
  const fBlok = document.getElementById('fmBlok').value;
  const fTipe = document.getElementById('fmTipe').value;
  const belum = document.getElementById('fmBelum').checked;
  const list = App.kavling.filter(function (k) {
    return k.idProyek === idProyek && (!fBlok || k.blok === fBlok) &&
      (!fTipe || k.tipe === fTipe) && (!belum || !k.foto);
  }).sort(function (a, b) {
    if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok));
    return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
  });
  document.getElementById('fmDaftar').innerHTML = list.length
    ? '<div class="d-flex flex-wrap gap-2">' + list.map(function (k) {
        return '<label class="chip cursor-pointer" style="gap:.35rem">' +
          '<input type="checkbox" class="form-check-input m-0 fm-cek" value="' + k.id + '" checked onchange="hitungFotoMassal()">' +
          esc(k.blok) + '-' + esc(k.nomor) +
          (k.foto ? ' <i class="bi bi-camera-fill" title="Sudah ada foto — akan diganti" style="color:var(--accent)"></i>' : '') +
        '</label>';
      }).join('') + '</div>'
    : '<div class="text-center text-muted-2 py-3" style="font-size:.86rem">Tidak ada kavling yang cocok dengan filter.</div>';
  hitungFotoMassal();
}

function centangFotoMassal(nilai) {
  document.querySelectorAll('#fmDaftar .fm-cek').forEach(function (c) { c.checked = nilai; });
  hitungFotoMassal();
}

function hitungFotoMassal() {
  const n = document.querySelectorAll('#fmDaftar .fm-cek:checked').length;
  const el = document.getElementById('fmJumlah');
  if (el) el.innerHTML = '<b>' + n + '</b> kavling dipilih <span class="text-muted-2">· <i class="bi bi-camera-fill" style="color:var(--accent)"></i> = foto lama akan diganti</span>';
}

function simpanFotoMassal() {
  const ids = Array.prototype.map.call(document.querySelectorAll('#fmDaftar .fm-cek:checked'), function (c) { return c.value; });
  if (!ids.length) { showToast('Belum Dipilih', 'Centang minimal satu kavling.', 'warning'); return; }
  if (!fileBuffer.fileFotoMassal) { showToast('Foto Belum Dipilih', 'Pilih foto desain terlebih dahulu.', 'warning'); return; }

  const btn = document.getElementById('btnFotoMassal');
  tombolLoading(btn, true);
  call('pasangFotoKavling', App.token, ids, fileBuffer.fileFotoMassal).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-images"></i> Pasang Foto');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    delete fileBuffer.fileFotoMassal;
    closeModal();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-images"></i> Pasang Foto');
    showToast('Error', err.message, 'danger');
  });
}

function hapusKavlingUi(id) {
  const k = App.kavling.find(function (x) { return x.id === id; });
  konfirmasi('Hapus Kavling', 'Kavling ' + k.blok + '-' + k.nomor + ' akan dihapus permanen.', function () {
    call('hapusKavling', App.token, id).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      showToast('Berhasil', res.message, 'success');
      muatWorkspace(false);
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

// ── 10c. Edit Harga & Promo (Owner) ──
function renderHargaPromo() {
  const el = document.getElementById('app-hargaPromo');
  el.innerHTML =
    '<h2 class="mb-1">Edit Harga &amp; Promo</h2>' +
    '<p class="text-muted-2">Ubah harga jual dan atur promo per kavling. Perubahan langsung tercermin di etalase publik.</p>' +
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<select class="form-select" style="max-width:280px" id="hpProyek" onchange="renderTabelHarga()">' +
        App.proyek.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nama) + '</option>'; }).join('') + '</select>' +
      '<select class="form-select" style="max-width:150px" id="hpBlok" onchange="renderTabelHarga()"><option value="">Semua Blok</option></select>' +
      '<button class="btn btn-brand ms-auto" id="btnSimpanHarga" onclick="simpanHargaPromoUi()"><i class="bi bi-save"></i> Simpan Semua Perubahan</button>' +
    '</div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>Kavling</th><th style="min-width:150px">Harga Jual</th><th style="min-width:140px">Diskon / Cashback</th>' +
      '<th style="min-width:200px">Keterangan Promo</th><th style="min-width:90px">Kuota</th>' +
      '<th style="min-width:140px">Mulai</th><th style="min-width:140px">Berakhir</th><th style="min-width:120px">Status</th>' +
    '</tr></thead><tbody id="tbodyHarga"></tbody></table></div>';

  if (App.proyek.length) {
    const blok = [...new Set(App.kavling.filter(function (k) { return k.idProyek === App.proyek[0].id; })
      .map(function (k) { return k.blok; }))].sort();
    document.getElementById('hpBlok').innerHTML = '<option value="">Semua Blok</option>' +
      blok.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('');
    renderTabelHarga();
  }
}

function renderTabelHarga() {
  const idP = document.getElementById('hpProyek').value;
  const blok = document.getElementById('hpBlok').value;
  const list = App.kavling.filter(function (k) {
    return k.idProyek === idP && (!blok || k.blok === blok);
  }).sort(function (a, b) {
    if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok));
    return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
  });

  isiBertahap(document.getElementById('tbodyHarga'), list.length ? list.map(function (k) {   // v5.0 — bertahap
    return '<tr data-id="' + k.id + '">' +
      '<td><b>' + esc(k.blok) + '-' + esc(k.nomor) + '</b><div class="text-muted-2" style="font-size:.74rem">' + esc(k.tipe || '-') + '</div></td>' +
      '<td><input type="number" class="form-control form-control-sm hp-harga" value="' + k.harga + '"></td>' +
      '<td><input type="number" class="form-control form-control-sm hp-promo" value="' + (k.promoNominal || '') + '"></td>' +
      '<td><input class="form-control form-control-sm hp-ket" value="' + esc(k.promoKet || '') + '" placeholder="Cashback DP, free AC…"></td>' +
      '<td><input type="number" class="form-control form-control-sm hp-kuota" value="' + esc(k.promoKuota || '') + '"></td>' +
      '<td><input type="date" class="form-control form-control-sm hp-mulai" value="' + esc(k.promoMulai || '') + '"></td>' +
      '<td><input type="date" class="form-control form-control-sm hp-selesai" value="' + esc(k.promoSelesai || '') + '"></td>' +
      '<td><select class="form-select form-select-sm hp-status">' +
        '<option' + (k.promoStatus === 'Aktif' ? ' selected' : '') + '>Aktif</option>' +
        '<option' + (k.promoStatus !== 'Aktif' ? ' selected' : '') + '>Nonaktif</option></select></td></tr>';
  }) : ['<tr><td colspan="8" class="text-center text-muted-2 py-4">Belum ada kavling pada proyek ini.</td></tr>']);
}

function simpanHargaPromoUi() {
  tuntaskanBertahap(document.getElementById('tbodyHarga'));   // v5.0 — seluruh baris ikut tersimpan
  const rows = document.querySelectorAll('#tbodyHarga tr[data-id]');
  if (!rows.length) { showToast('Kosong', 'Tidak ada data untuk disimpan.', 'warning'); return; }

  // Batch: kumpulkan seluruh perubahan lalu kirim dalam SATU panggilan
  const daftar = Array.prototype.map.call(rows, function (tr) {
    return {
      id: tr.dataset.id,
      harga: tr.querySelector('.hp-harga').value,
      promoNominal: tr.querySelector('.hp-promo').value,
      promoKet: tr.querySelector('.hp-ket').value,
      promoKuota: tr.querySelector('.hp-kuota').value,
      promoMulai: tr.querySelector('.hp-mulai').value,
      promoSelesai: tr.querySelector('.hp-selesai').value,
      promoStatus: tr.querySelector('.hp-status').value
    };
  });

  const btn = document.getElementById('btnSimpanHarga');
  tombolLoading(btn, true);
  call('simpanHargaPromo', App.token, daftar).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Semua Perubahan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Semua Perubahan');
    showToast('Error', err.message, 'danger');
  });
}

// ── 10d. Manajemen Pengguna (Owner) ──
function renderPengguna() {
  const el = document.getElementById('app-pengguna');
  el.innerHTML =
    '<div class="d-flex justify-content-between align-items-end mb-3">' +
      '<div><h2 class="mb-0">Manajemen Pengguna</h2>' +
      '<span class="text-muted-2" style="font-size:.86rem">Kelola akun internal beserta hak aksesnya.</span></div>' +
      '<button class="btn btn-brand" onclick="formPengguna()"><i class="bi bi-person-plus"></i> Pengguna Baru</button></div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>Nama Tampilan</th><th>Username</th><th>Peran</th><th>Status</th><th>Email</th><th class="text-end">Aksi</th>' +
    '</tr></thead><tbody>' +
    App.users.map(function (u) {
      return '<tr><td><b>' + esc(u.nama) + '</b></td><td>' + esc(u.username) + '</td>' +
        '<td><span class="chip ' + (u.role === 'Owner' ? 'chip-brand' : u.role === 'Perbankan' ? 'chip-soft' : 'chip') + '">' + esc(u.role) + '</span></td>' +
        '<td><span class="chip ' + (u.status === 'Aktif' ? 'chip-ok' : 'chip-danger') + '">' + esc(u.status) + '</span></td>' +
        '<td style="font-size:.82rem">' + esc(u.email || '-') + '</td>' +
        '<td class="text-end"><div class="d-flex gap-1 justify-content-end">' +
          '<button class="btn btn-sm btn-ghost" onclick="formPengguna(\'' + u.id + '\')"><i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="hapusPenggunaUi(\'' + u.id + '\')"><i class="bi bi-trash"></i></button>' +
        '</div></td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<div class="card-lux p-3 p-md-4 mt-3" style="max-width:520px">' +
      '<h5 class="mb-3">Ubah Kata Sandi Saya</h5>' +
      '<label class="form-label">Kata Sandi Lama</label>' +
      '<div class="input-group pwd-wrap mb-2"><input type="password" class="form-control" id="pwLama">' +
        '<button type="button" class="pwd-toggle" onclick="togglePassword(\'pwLama\',this)"><i class="bi bi-eye"></i></button></div>' +
      '<label class="form-label">Kata Sandi Baru</label>' +
      '<div class="input-group pwd-wrap mb-3"><input type="password" class="form-control" id="pwBaru">' +
        '<button type="button" class="pwd-toggle" onclick="togglePassword(\'pwBaru\',this)"><i class="bi bi-eye"></i></button></div>' +
      '<button class="btn btn-outline-brand" id="btnPw" onclick="ubahPasswordUi()"><i class="bi bi-key"></i> Perbarui Kata Sandi</button>' +
    '</div>';
}

function formPengguna(id) {
  const u = id ? App.users.find(function (x) { return x.id === id; }) : null;
  openModal(u ? 'Edit Pengguna' : 'Tambah Pengguna',
    '<form id="formUser"><div class="row g-3">' +
      '<div class="col-md-6"><label class="form-label">Nama Tampilan</label>' +
        '<input class="form-control" name="nama" value="' + esc(u ? u.nama : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Username <span class="text-danger">*</span></label>' +
        '<input class="form-control" name="username" required value="' + esc(u ? u.username : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Peran</label>' +
        '<select class="form-select" name="role">' +
        ['Marketing', 'Perbankan', 'Owner'].map(function (r) {
          return '<option' + (u && u.role === r ? ' selected' : '') + '>' + r + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Status Akun</label>' +
        '<select class="form-select" name="status">' +
        ['Aktif', 'Nonaktif'].map(function (s) {
          return '<option' + (u && u.status === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Email</label>' +
        '<input class="form-control" name="email" value="' + esc(u ? u.email : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Kata Sandi' + (u ? ' (kosongkan bila tidak diubah)' : ' <span class="text-danger">*</span>') + '</label>' +
        '<div class="input-group pwd-wrap"><input type="password" class="form-control" name="password" id="uPass"' + (u ? '' : ' required') + '>' +
        '<button type="button" class="pwd-toggle" onclick="togglePassword(\'uPass\',this)"><i class="bi bi-eye"></i></button></div></div>' +
    '</div></form>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnUser" onclick="simpanPenggunaUi(' + (u ? '\'' + u.id + '\'' : 'null') + ')"><i class="bi bi-save"></i> Simpan</button>',
    'modal-md');
}

function simpanPenggunaUi(id) {
  const form = document.getElementById('formUser');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const payload = { id: id || '' };
  Array.prototype.forEach.call(form.elements, function (el) { if (el.name) payload[el.name] = el.value; });

  const btn = document.getElementById('btnUser');
  tombolLoading(btn, true);
  call('simpanUser', App.token, payload).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    closeModal();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    showToast('Error', err.message, 'danger');
  });
}

function hapusPenggunaUi(id) {
  const u = App.users.find(function (x) { return x.id === id; });
  konfirmasi('Hapus Pengguna', 'Akun "' + u.username + '" akan dihapus permanen.', function () {
    call('hapusUser', App.token, id).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      showToast('Berhasil', res.message, 'success');
      muatWorkspace(false);
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

function ubahPasswordUi() {
  const lama = document.getElementById('pwLama').value;
  const baru = document.getElementById('pwBaru').value;
  if (!lama || !baru) { showToast('Lengkapi Data', 'Isi kata sandi lama dan baru.', 'warning'); return; }
  const btn = document.getElementById('btnPw');
  tombolLoading(btn, true);
  call('ubahPasswordSendiri', App.token, lama, baru).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-key"></i> Perbarui Kata Sandi');
    showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger');
    if (res.success) { document.getElementById('pwLama').value = ''; document.getElementById('pwBaru').value = ''; }
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-key"></i> Perbarui Kata Sandi');
    showToast('Error', err.message, 'danger');
  });
}

// ── 10e. Desain Tampilan Etalase (Owner) ──
function renderDesainEtalase() {
  const e = App.etalase || {};
  document.getElementById('app-desainEtalase').innerHTML =
    '<h2 class="mb-1">Desain Tampilan Etalase</h2>' +
    '<p class="text-muted-2">Ubah identitas visual — perubahan langsung tersinkron ke navbar etalase, sidebar dashboard, layar login, dan footer.</p>' +
    '<div class="row g-3">' +
      '<div class="col-lg-7"><div class="card-lux p-3 p-md-4">' +
        '<label class="form-label">Logo Perusahaan</label>' +
        '<div class="upload-box mb-3" id="boxLogoEtalase" onclick="document.getElementById(\'fileLogoEtalase\').click()">' +
          '<i class="bi bi-cloud-arrow-up"></i><div style="font-size:.88rem">Seret &amp; lepas logo di sini, atau <u>pilih file</u></div>' +
          '<small>PNG / JPG maksimal 2 MB — disarankan 500×500 px latar transparan</small></div>' +
        '<input type="file" id="fileLogoEtalase" class="hidden" accept="image/*" onchange="tandaiFile(\'fileLogoEtalase\',\'boxLogoEtalase\')">' +
        '<div class="row g-3">' +
          '<div class="col-md-7"><label class="form-label">Nama Perusahaan</label>' +
            '<input class="form-control" id="etNama" value="' + esc(e.namaPerusahaan || '') + '" oninput="pratinjauEtalase()"></div>' +
          '<div class="col-md-5"><label class="form-label">Telepon</label>' +
            '<input class="form-control" id="etTelepon" value="' + esc(e.telepon || '') + '"></div>' +
          '<div class="col-12"><label class="form-label">Alamat Perusahaan</label>' +
            '<textarea class="form-control" id="etAlamat" rows="2">' + esc(e.alamat || '') + '</textarea></div>' +
          '<div class="col-md-6"><label class="form-label">Email Kontak</label>' +
            '<input class="form-control" id="etEmail" value="' + esc(e.email || '') + '"></div>' +
          '<div class="col-md-3"><label class="form-label">Warna Utama</label>' +
            '<input type="color" class="form-control form-control-color w-100" id="etWarna" value="' + esc(e.warnaUtama || '#7A1F3D') + '" oninput="pratinjauEtalase()"></div>' +
          '<div class="col-md-3"><label class="form-label">Warna Aksen</label>' +
            '<input type="color" class="form-control form-control-color w-100" id="etAksen" value="' + esc(e.warnaAksen || '#C9A24B') + '" oninput="pratinjauEtalase()"></div>' +
          '<div class="col-12"><label class="form-label">Teks Footer</label>' +
            '<textarea class="form-control" id="etFooter" rows="2">' + esc(e.footer || '') + '</textarea></div>' +
        '</div>' +
        '<button class="btn btn-brand mt-3" id="btnEtalase" onclick="simpanEtalaseUi()"><i class="bi bi-save"></i> Simpan &amp; Sinkronkan</button>' +
      '</div>' + kartuPengaturanHero() + kartuGayaTulisan() + '</div>' +
      '<div class="col-lg-5"><div class="card-lux p-3 position-sticky" style="top:90px">' +
        '<span class="sect-label">Pratinjau</span>' +
        '<div id="etPreview" class="mt-2"></div>' +
        '<div class="sect-label mt-3 mb-2">Banner Beranda</div>' +
        '<div id="heroPreview" style="border-radius:12px;overflow:hidden;border:1px solid var(--border)"></div>' +
        '<div class="text-muted-2 mt-2" style="font-size:.76rem">Pratinjau memakai skala kecil — tampilan asli lebih lega.</div>' +
      '</div></div>' +
    '</div>';
  pratinjauEtalase();
  renderIsiStatHero();
  pratinjauGayaTulisan();
}

/** Kartu pengaturan banner beranda (hero) — khusus Owner. */
function kartuPengaturanHero() {
  const h = App.hero || {};
  const gaya = [
    { id: 'klasik', nama: 'Klasik Elegan', ket: 'Foto besar dengan gradasi warna brand. Paling megah.', ikon: 'image' },
    { id: 'split', nama: 'Split Modern', ket: 'Teks di kiri, foto berbingkai di kanan. Terkesan premium.', ikon: 'layout-split' },
    { id: 'minimalis', nama: 'Minimalis Terang', ket: 'Tanpa foto, tipografi besar di latar lembut.', ikon: 'type' }
  ];
  const ikonPilihan = ['buildings', 'patch-check', 'house-check', 'award', 'people', 'cash-stack', 'shield-check', 'star'];

  return '<div class="card-lux p-3 p-md-4 mt-3">' +
    '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-1">' +
      '<div><h5 class="mb-1">Banner Beranda (Hero)</h5>' +
      '<p class="text-muted-2 mb-0" style="font-size:.86rem">Atur tagline, foto, dan gaya tampilan bagian paling atas etalase.</p></div>' +
    '</div>' +

    '<label class="form-label mt-3">Gaya Tampilan</label>' +
    '<div class="row g-2 mb-3">' + gaya.map(function (g) {
      const aktif = (h.gaya || 'klasik') === g.id;
      return '<div class="col-md-4"><div class="card-flat p-3 h-100 cursor-pointer" id="gayaCard_' + g.id + '" ' +
        'style="border-width:' + (aktif ? '2px' : '1px') + ';border-color:' + (aktif ? 'var(--primary)' : 'var(--border)') + '" ' +
        'onclick="pilihGayaHero(\'' + g.id + '\')">' +
        '<i class="bi bi-' + g.ikon + '" style="font-size:1.3rem;color:var(--primary)"></i>' +
        '<div class="fw-semibold mt-1" style="font-size:.9rem">' + g.nama + '</div>' +
        '<div class="text-muted-2" style="font-size:.78rem">' + g.ket + '</div></div></div>';
    }).join('') + '</div>' +
    '<input type="hidden" id="heroGaya" value="' + esc(h.gaya || 'klasik') + '">' +

    '<div class="row g-3">' +
      '<div class="col-md-6"><label class="form-label">Label Kecil di Atas Judul</label>' +
        '<input class="form-control" id="heroLabel" value="' + esc(h.label || '') + '" ' +
        'placeholder="Contoh: Hunian Eksklusif Keluarga Indonesia" oninput="pratinjauHero()"></div>' +
      '<div class="col-md-6"><label class="form-label">Kata yang Disorot Emas</label>' +
        '<input class="form-control" id="heroHighlight" value="' + esc(h.highlight || '') + '" ' +
        'placeholder="Contoh: Rumah Impian" oninput="pratinjauHero()">' +
        '<small class="text-muted-2">Harus berupa potongan kata dari judul di bawah.</small></div>' +
      '<div class="col-12"><label class="form-label">Judul Utama (Tagline)</label>' +
        '<input class="form-control" id="heroJudul" value="' + esc(h.judul || '') + '" ' +
        'placeholder="Contoh: Wujudkan Rumah Impian Keluarga Anda" oninput="pratinjauHero()"></div>' +
      '<div class="col-12"><label class="form-label">Kalimat Pendukung</label>' +
        '<textarea class="form-control" id="heroSubjudul" rows="2" ' +
        'placeholder="Satu–dua kalimat yang menjelaskan keunggulan perusahaan Anda" ' +
        'oninput="pratinjauHero()">' + esc(h.subjudul || '') + '</textarea></div>' +
    '</div>' +

    '<label class="form-label mt-3">Foto Latar Banner</label>' +
    '<div class="upload-box" id="boxHeroFoto" onclick="document.getElementById(\'fileHeroFoto\').click()">' +
      '<i class="bi bi-image"></i><div style="font-size:.86rem">Pilih foto latar banner</div>' +
      '<small>Disarankan foto mendatar (landscape) minimal 1600×900 px</small></div>' +
    '<input type="file" id="fileHeroFoto" class="hidden" accept="image/*" onchange="tandaiFileHero()">' +
    (h.foto ? '<button class="btn btn-sm btn-ghost mt-2" onclick="hapusFotoHeroUi()">' +
      '<i class="bi bi-trash"></i> Hapus foto banner saat ini</button>' : '') +
    '<div class="text-muted-2 mt-1" style="font-size:.78rem">Bila dikosongkan, sistem memakai foto proyek pertama. Gaya Minimalis tidak memakai foto.</div>' +

    '<div class="row g-3 mt-1">' +
      '<div class="col-md-6"><label class="form-label d-flex justify-content-between">' +
        '<span>Kepekatan Lapisan Warna</span><b id="heroOverlayLabel">' + (h.overlay === undefined ? 72 : h.overlay) + '%</b></label>' +
        '<input type="range" class="form-range" id="heroOverlay" min="20" max="90" step="1" ' +
        'value="' + (h.overlay === undefined ? 72 : h.overlay) + '" oninput="pratinjauHero()">' +
        '<small class="text-muted-2">Makin tinggi, teks makin mudah dibaca di atas foto.</small></div>' +
      '<div class="col-md-6"><label class="form-label">Kotak Pencarian</label>' +
        '<div class="form-check form-switch mt-2">' +
          '<input class="form-check-input" type="checkbox" id="heroTampilCari"' +
          (h.tampilCari === false ? '' : ' checked') + ' onchange="pratinjauHero()">' +
          '<label class="form-check-label" for="heroTampilCari">Tampilkan kotak pencarian di banner</label>' +
        '</div></div>' +
    '</div>' +

    '<hr class="my-4">' +
    '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2">' +
      '<div><b style="font-size:.95rem">Tiga Kartu Statistik</b>' +
      '<div class="text-muted-2" style="font-size:.8rem">Kartu angka tepat di bawah banner.</div></div>' +
      '<select class="form-select" style="width:auto" id="heroStatMode" onchange="renderIsiStatHero()">' +
        '<option value="auto"' + (h.statMode !== 'manual' ? ' selected' : '') + '>Otomatis dari data</option>' +
        '<option value="manual"' + (h.statMode === 'manual' ? ' selected' : '') + '>Isi sendiri</option>' +
      '</select>' +
    '</div>' +
    '<div id="heroStatFields" class="mt-3" data-ikon="' + esc(ikonPilihan.join(',')) + '"></div>' +

    '<button class="btn btn-brand mt-4" id="btnHero" onclick="simpanHeroUi()">' +
      '<i class="bi bi-save"></i> Simpan Tampilan Banner</button>' +
  '</div>';
}

function pilihGayaHero(gaya) {
  document.getElementById('heroGaya').value = gaya;
  ['klasik', 'split', 'minimalis'].forEach(function (g) {
    const el = document.getElementById('gayaCard_' + g);
    if (!el) return;
    const aktif = g === gaya;
    el.style.borderWidth = aktif ? '2px' : '1px';
    el.style.borderColor = aktif ? 'var(--primary)' : 'var(--border)';
  });
  pratinjauHero();
}

function renderIsiStatHero() {
  const wrap = document.getElementById('heroStatFields');
  if (!wrap) return;
  const mode = document.getElementById('heroStatMode').value;
  if (mode !== 'manual') {
    wrap.innerHTML = '<div class="card-flat p-3" style="background:var(--surface);font-size:.84rem">' +
      '<i class="bi bi-magic" style="color:var(--primary)"></i> Angka dihitung otomatis: jumlah proyek, tingkat serapan kavling, dan unit siap dipesan.</div>';
    pratinjauHero();
    return;
  }
  const ikonPilihan = (wrap.dataset.ikon || 'buildings').split(',');
  const stat = (App.hero && App.hero.stat) || [];
  wrap.innerHTML = '<div class="row g-2">' + [0, 1, 2].map(function (i) {
    const s = stat[i] || {};
    return '<div class="col-md-4"><div class="card-flat p-3">' +
      '<label class="form-label">Kartu ' + (i + 1) + '</label>' +
      '<input class="form-control mb-2 hs-nilai" value="' + esc(s.nilai || '') + '" placeholder="Contoh: 150+" oninput="pratinjauHero()">' +
      '<input class="form-control mb-2 hs-label" value="' + esc(s.label || '') + '" placeholder="Contoh: Keluarga Terlayani" oninput="pratinjauHero()">' +
      '<select class="form-select hs-ikon" onchange="pratinjauHero()">' +
        ikonPilihan.map(function (ik) {
          return '<option value="' + ik + '"' + ((s.ikon || 'buildings') === ik ? ' selected' : '') + '>' + ik + '</option>';
        }).join('') +
      '</select></div></div>';
  }).join('') + '</div>';
  pratinjauHero();
}

function dataHeroDariForm() {
  const mode = (document.getElementById('heroStatMode') || {}).value || 'auto';
  const stat = [];
  if (mode === 'manual') {
    const nilai = document.querySelectorAll('#heroStatFields .hs-nilai');
    const label = document.querySelectorAll('#heroStatFields .hs-label');
    const ikon = document.querySelectorAll('#heroStatFields .hs-ikon');
    for (let i = 0; i < nilai.length; i++) {
      stat.push({ nilai: nilai[i].value, label: label[i].value, ikon: ikon[i].value });
    }
  }
  return {
    gaya: document.getElementById('heroGaya').value,
    label: document.getElementById('heroLabel').value,
    judul: document.getElementById('heroJudul').value,
    highlight: document.getElementById('heroHighlight').value,
    subjudul: document.getElementById('heroSubjudul').value,
    overlay: Number(document.getElementById('heroOverlay').value),
    tampilCari: document.getElementById('heroTampilCari').checked,
    statMode: mode,
    stat: stat
  };
}

function pratinjauHero() {
  const box = document.getElementById('heroPreview');
  if (!box) return;
  const d = dataHeroDariForm();
  const lbl = document.getElementById('heroOverlayLabel');
  if (lbl) lbl.textContent = d.overlay + '%';

  const cfg = {
    gaya: d.gaya, label: d.label, judul: d.judul, highlight: d.highlight,
    subjudul: d.subjudul, overlay: d.overlay, tampilCari: d.tampilCari,
    foto: (fileBuffer.fileHeroFoto ? 'data:image/jpeg;base64,' + fileBuffer.fileHeroFoto.data : (App.hero || {}).foto)
  };
  box.innerHTML = '<div style="zoom:.42;pointer-events:none">' + buildHeroHtml(cfg, true) + '</div>';
  // Pratinjau ikut memakai gaya tulisan yang sedang dipilih
  pasangVarFont(box, document.getElementById('gtJudul') ? dataGayaTulisanDariForm() : (App.hero || {}).font);
  box.style.fontFamily = 'var(--font-body)';
}

function tandaiFileHero() {
  tandaiFile('fileHeroFoto', 'boxHeroFoto');
  setTimeout(pratinjauHero, 700);
}

function simpanHeroUi() {
  const btn = document.getElementById('btnHero');
  tombolLoading(btn, true);
  call('simpanHero', App.token, dataHeroDariForm(), fileBuffer.fileHeroFoto || null).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Tampilan Banner');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.hero = res.data;
    delete fileBuffer.fileHeroFoto;
    showToast('Berhasil', res.message, 'success');
    renderDesainEtalase();
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Tampilan Banner');
    showToast('Error', err.message, 'danger');
  });
}

function hapusFotoHeroUi() {
  konfirmasi('Hapus Foto Banner', 'Foto latar banner akan dihapus dari pengaturan.', function () {
    call('hapusFotoHero', App.token).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      App.hero = res.data;
      showToast('Berhasil', res.message, 'success');
      renderDesainEtalase();
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

// ── Gaya Tulisan Etalase (Owner & Marketing) ──
function kartuGayaTulisan() {
  const f = Object.assign({}, FONT_BAWAAN, (App.hero || {}).font || {});
  // Muat font paduan agar contoh "Aa" pada kartu tampil sesuai aslinya
  PADUAN_FONT.forEach(function (p) { muatFontGoogle(p.judul); });

  const opsi = function (daftar, nilai) {
    return daftar.map(function (x) {
      return '<option value="' + esc(x.n) + '"' + (x.n === nilai ? ' selected' : '') + ' title="' + esc(x.k) + '">' +
        (x.n ? esc(x.n) : 'Sama dengan judul') + '</option>';
    }).join('');
  };

  return '<div class="card-lux p-3 p-md-4 mt-3">' +
    '<h5 class="mb-1">Gaya Tulisan Etalase</h5>' +
    '<p class="text-muted-2 mb-3" style="font-size:.86rem">Pilih jenis huruf untuk tampilan depan agar tidak monoton. ' +
      'Berlaku untuk seluruh etalase publik — dashboard internal tidak berubah.</p>' +

    '<label class="form-label">Paduan Siap Pakai</label>' +
    '<div class="row g-2 mb-3">' + PADUAN_FONT.map(function (p, i) {
      const aktif = p.judul === f.judul && p.isi === f.isi && (p.sorotan || '') === (f.sorotan || '');
      return '<div class="col-6 col-md-3"><div class="card-flat p-2 h-100 cursor-pointer text-center" id="gtPaduan_' + i + '" ' +
        'style="border-width:' + (aktif ? '2px' : '1px') + ';border-color:' + (aktif ? 'var(--primary)' : 'var(--border)') + '" ' +
        'onclick="pilihPaduanFont(' + i + ')">' +
        '<div style="font-family:' + esc(tumpukanFont(p.judul)) + ';font-size:1.5rem;line-height:1.2;color:var(--primary)">Aa</div>' +
        '<div class="fw-semibold" style="font-size:.8rem">' + esc(p.nama) + '</div>' +
        '<div class="text-muted-2" style="font-size:.68rem;line-height:1.3">' + esc(p.judul) + ' + ' + esc(p.isi) + '</div>' +
      '</div></div>';
    }).join('') + '</div>' +

    '<div class="row g-3">' +
      '<div class="col-md-4"><label class="form-label">Font Judul</label>' +
        '<select class="form-select" id="gtJudul" onchange="pratinjauGayaTulisan()">' + opsi(FONT_ETALASE.judul, f.judul) + '</select>' +
        '<small class="text-muted-2">Judul banner, nama proyek, harga.</small></div>' +
      '<div class="col-md-4"><label class="form-label">Font Isi</label>' +
        '<select class="form-select" id="gtIsi" onchange="pratinjauGayaTulisan()">' + opsi(FONT_ETALASE.isi, f.isi) + '</select>' +
        '<small class="text-muted-2">Deskripsi, menu, tombol.</small></div>' +
      '<div class="col-md-4"><label class="form-label">Font Kata Sorotan</label>' +
        '<select class="form-select" id="gtSorotan" onchange="pratinjauGayaTulisan()">' + opsi(FONT_ETALASE.sorotan, f.sorotan || '') + '</select>' +
        '<small class="text-muted-2">Kata emas pada judul banner.</small></div>' +
    '</div>' +

    '<div class="sect-label mt-3 mb-2">Contoh Tampilan</div>' +
    '<div id="gtContoh" class="card-flat p-3" style="background:var(--surface)"></div>' +

    '<div class="d-flex flex-wrap gap-2 mt-3">' +
      '<button class="btn btn-brand" id="btnGayaTulisan" onclick="simpanGayaTulisanUi()"><i class="bi bi-save"></i> Simpan Gaya Tulisan</button>' +
      '<button class="btn btn-ghost" onclick="kembalikanFontBawaan()"><i class="bi bi-arrow-counterclockwise"></i> Kembali ke Bawaan</button>' +
    '</div>' +
  '</div>';
}

function dataGayaTulisanDariForm() {
  return {
    judul: (document.getElementById('gtJudul') || {}).value || FONT_BAWAAN.judul,
    isi: (document.getElementById('gtIsi') || {}).value || FONT_BAWAAN.isi,
    sorotan: (document.getElementById('gtSorotan') || {}).value || ''
  };
}

function pilihPaduanFont(i) {
  const p = PADUAN_FONT[i];
  if (!p) return;
  document.getElementById('gtJudul').value = p.judul;
  document.getElementById('gtIsi').value = p.isi;
  document.getElementById('gtSorotan').value = p.sorotan || '';
  pratinjauGayaTulisan();
}

function kembalikanFontBawaan() {
  document.getElementById('gtJudul').value = FONT_BAWAAN.judul;
  document.getElementById('gtIsi').value = FONT_BAWAAN.isi;
  document.getElementById('gtSorotan').value = '';
  pratinjauGayaTulisan();
}

/** Contoh langsung + tandai paduan yang cocok + perbarui pratinjau banner. */
function pratinjauGayaTulisan() {
  const box = document.getElementById('gtContoh');
  if (!box) return;
  const f = dataGayaTulisanDariForm();
  pasangVarFont(box, f);
  box.style.fontFamily = 'var(--font-body)';

  const judulHero = (document.getElementById('heroJudul') || {}).value || 'Temukan Rumah Impian Anda';
  const sorot = (document.getElementById('heroHighlight') || {}).value || 'Rumah Impian';
  box.innerHTML =
    '<div style="background:var(--primary);border-radius:10px;padding:1rem 1.1rem;margin-bottom:.8rem">' +
      '<h1 style="font-size:1.55rem;margin:0;color:#fff;line-height:1.2">' +
      sorotJudul(judulHero, sorot).replace('<span class="hl">',
        '<span style="color:var(--accent);font-family:var(--font-hl, inherit);font-style:var(--hl-style, italic);' +
        'font-weight:var(--hl-weight, inherit);font-size:var(--hl-size, 1em)">') +
      '</h1></div>' +
    '<div class="d-flex justify-content-between align-items-end gap-2 flex-wrap">' +
      '<div><h5 class="mb-1" style="color:var(--text)">Family Asri Residence</h5>' +
      '<div class="text-muted-2" style="font-size:.84rem">Kawasan hunian di pusat perkembangan kota, nyaman dan asri.</div></div>' +
      '<div class="text-end"><div class="text-muted-2" style="font-size:.72rem">Mulai dari</div>' +
      '<div class="font-head fw-bold" style="color:var(--primary);font-size:1.1rem">' + rp(395000000) + '</div></div>' +
    '</div>';

  PADUAN_FONT.forEach(function (p, i) {
    const el = document.getElementById('gtPaduan_' + i);
    if (!el) return;
    const aktif = p.judul === f.judul && p.isi === f.isi && (p.sorotan || '') === f.sorotan;
    el.style.borderWidth = aktif ? '2px' : '1px';
    el.style.borderColor = aktif ? 'var(--primary)' : 'var(--border)';
  });
  pratinjauHero();
}

function simpanGayaTulisanUi() {
  const btn = document.getElementById('btnGayaTulisan');
  tombolLoading(btn, true);
  call('simpanGayaTulisan', App.token, dataGayaTulisanDariForm()).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Gaya Tulisan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.hero = res.data;
    terapkanGayaTulisan();
    renderHero();
    showToast('Berhasil', res.message + ' Buka etalase untuk melihat hasilnya.', 'success');
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Gaya Tulisan');
    showToast('Error', err.message, 'danger');
  });
}

function pratinjauEtalase() {
  const nama = document.getElementById('etNama').value || 'Nama Perusahaan';
  const warna = document.getElementById('etWarna').value;
  const aksen = document.getElementById('etAksen').value;
  document.getElementById('etPreview').innerHTML =
    '<div style="border-radius:12px;overflow:hidden;border:1px solid var(--border)">' +
      '<div style="background:' + warna + ';color:#fff;padding:.7rem .9rem;display:flex;align-items:center;gap:.6rem">' +
        '<div style="width:30px;height:30px;border-radius:8px;background:#fff;color:' + warna + ';display:grid;place-items:center;font-weight:700;font-family:var(--font-head)">' +
        esc(nama.charAt(0).toUpperCase()) + '</div>' +
        '<b style="font-size:.9rem">' + esc(nama) + '</b>' +
        '<span style="margin-left:auto;background:' + aksen + ';color:#2B2100;font-size:.7rem;padding:.2rem .6rem;border-radius:99px;font-weight:600">Masuk</span>' +
      '</div>' +
      '<div style="padding:1rem;background:var(--surface)">' +
        '<div style="font-family:var(--font-head);font-size:1.05rem;color:' + warna + '">Temukan Rumah Impian Anda</div>' +
        '<div class="text-muted-2" style="font-size:.78rem">Contoh tampilan navbar & aksen tombol etalase.</div>' +
        '<button class="btn btn-sm mt-2" style="background:' + warna + ';color:#fff;border:none">Beli Sekarang</button>' +
        '<button class="btn btn-sm mt-2 ms-1" style="background:transparent;border:1px solid ' + aksen + ';color:' + aksen + '">Promo</button>' +
      '</div></div>';
}

function simpanEtalaseUi() {
  const payload = {
    namaPerusahaan: document.getElementById('etNama').value,
    alamat: document.getElementById('etAlamat').value,
    email: document.getElementById('etEmail').value,
    telepon: document.getElementById('etTelepon').value,
    warnaUtama: document.getElementById('etWarna').value,
    warnaAksen: document.getElementById('etAksen').value,
    footer: document.getElementById('etFooter').value
  };
  const btn = document.getElementById('btnEtalase');
  tombolLoading(btn, true);
  call('simpanPengaturanEtalase', App.token, payload, fileBuffer.fileLogoEtalase || null).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan & Sinkronkan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.etalase = res.data;
    delete fileBuffer.fileLogoEtalase;
    terapkanIdentitas();
    showToast('Berhasil', res.message + ' Identitas tersinkron ke seluruh halaman.', 'success');
    renderDesainEtalase();
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan & Sinkronkan');
    showToast('Error', err.message, 'danger');
  });
}

// ── 10f. Konfigurasi Sistem (Owner) ──
function renderKonfigurasi() {
  const c = App.config || {};
  document.getElementById('app-konfigurasi').innerHTML =
    '<h2 class="mb-1">Konfigurasi Sistem</h2>' +
    '<p class="text-muted-2">Pengaturan notifikasi, WhatsApp Gateway, dan nilai bawaan simulasi KPR.</p>' +
    '<div class="row g-3" style="max-width:900px">' +
      '<div class="col-md-6"><div class="card-lux p-3 p-md-4 h-100">' +
        '<h5 class="mb-3">Notifikasi</h5>' +
        '<div class="form-check form-switch mb-3">' +
          '<input class="form-check-input" type="checkbox" id="cfgEmail"' + (String(c.notifEmailAktif) === 'true' ? ' checked' : '') + '>' +
          '<label class="form-check-label" for="cfgEmail">Aktifkan notifikasi email otomatis</label></div>' +
        '<label class="form-label">Email Admin Penerima</label>' +
        '<input class="form-control mb-3" id="cfgAdminEmail" value="' + esc(c.adminEmail || '') + '">' +
        '<label class="form-label">URL WhatsApp Gateway</label>' +
        '<input class="form-control mb-2" id="cfgWaUrl" value="' + esc(c.waGatewayUrl || '') + '" placeholder="https://api.fonnte.com/send">' +
        '<label class="form-label">Token Gateway</label>' +
        '<input class="form-control" id="cfgWaToken" value="' + esc(c.waGatewayToken || '') + '" placeholder="Token dari Fonnte / Wablas">' +
      '</div></div>' +
      '<div class="col-md-6"><div class="card-lux p-3 p-md-4 h-100">' +
        '<h5 class="mb-3">Nilai Bawaan Simulasi KPR</h5>' +
        '<label class="form-label">Suku Bunga Default (% p.a)</label>' +
        '<input type="number" step="0.25" class="form-control mb-3" id="cfgBunga" value="' + esc(c.bungaKprDefault || '7.5') + '">' +
        '<label class="form-label">Tenor Default (tahun)</label>' +
        '<input type="number" class="form-control mb-3" id="cfgTenor" value="' + esc(c.tenorKprDefault || '20') + '">' +
        '<hr class="my-3">' +
        '<h6 class="font-head mb-2">Target Penjualan</h6>' +
        '<label class="form-label">Target Nilai per Bulan (Rp)</label>' +
        '<input type="number" class="form-control mb-1" id="cfgTargetNilai" value="' + esc(c.targetNilaiBulanan || '') + '" placeholder="Kosongkan = rata-rata 3 bulan">' +
        '<small class="text-muted-2 d-block mb-3">Dipakai pada kartu "Target" di dashboard penjualan.</small>' +
        '<label class="form-label">Target Unit per Marketing</label>' +
        '<input type="number" class="form-control mb-1" id="cfgTargetUnit" value="' + esc(c.targetUnitMarketing || '') + '" placeholder="Kosongkan = median tim">' +
        '<small class="text-muted-2 d-block mb-3">Dipakai pada kolom "Pencapaian Target" di tabel peringkat.</small>' +
        '<div class="alert mb-0" style="background:var(--info-bg);border:none;color:var(--primary);font-size:.82rem">' +
          '<i class="bi bi-shield-check"></i> Kata sandi tersimpan sebagai hash SHA-256 dengan kunci rahasia acak milik proyek ini. ' +
          'Sebelum go-live, jalankan fungsi <b>buatSaltBaru()</b> sekali dari editor Apps Script.</div>' +
      '</div></div>' +
      // v4.6 — aturan hak Marketing atas data konsumen
      '<div class="col-12"><div class="card-lux p-3 p-md-4">' +
        '<h5 class="mb-1">Aturan Marketing</h5>' +
        '<p class="text-muted-2" style="font-size:.84rem">Menentukan data konsumen mana yang boleh diubah atau dihapus oleh akun Marketing. Owner selalu dapat mengelola semua data.</p>' +
        '<div class="row g-3">' +
          '<div class="col-md-6"><label class="form-label">Hapus data konsumen (salah input / batal)</label>' +
            '<select class="form-select" id="cfgIzinHapus">' +
              '<option value="semua"' + (c.izinMarketingHapus !== 'sendiri' ? ' selected' : '') + '>Semua konsumen</option>' +
              '<option value="sendiri"' + (c.izinMarketingHapus === 'sendiri' ? ' selected' : '') + '>Hanya konsumen miliknya sendiri</option></select></div>' +
          '<div class="col-md-6"><label class="form-label">Edit data &amp; pindah unit konsumen</label>' +
            '<select class="form-select" id="cfgIzinUbah">' +
              '<option value="semua"' + (c.izinMarketingUbah !== 'sendiri' ? ' selected' : '') + '>Semua konsumen</option>' +
              '<option value="sendiri"' + (c.izinMarketingUbah === 'sendiri' ? ' selected' : '') + '>Hanya konsumen miliknya sendiri</option></select></div>' +
        '</div>' +
        '<small class="text-muted-2 d-block mt-2"><i class="bi bi-journal-text"></i> Setiap penghapusan, perubahan, dan pindah unit tercatat di sheet <b>Log_Aktivitas</b> beserta nama pelaku dan alasannya.</small>' +
      '</div></div>' +
    '</div>' +
    '<button class="btn btn-brand mt-3" id="btnCfg" onclick="simpanKonfigurasiUi()"><i class="bi bi-save"></i> Simpan Konfigurasi</button>' +
    '<div id="kpKonfig" class="mt-4" style="max-width:900px"></div>';                 // v6.1 — integrasi aplikasi Kontraktor
  muatKonfigKontraktor();
}

function simpanKonfigurasiUi() {
  const patch = {
    notifEmailAktif: document.getElementById('cfgEmail').checked ? 'true' : 'false',
    adminEmail: document.getElementById('cfgAdminEmail').value,
    waGatewayUrl: document.getElementById('cfgWaUrl').value,
    waGatewayToken: document.getElementById('cfgWaToken').value,
    bungaKprDefault: document.getElementById('cfgBunga').value,
    tenorKprDefault: document.getElementById('cfgTenor').value,
    targetNilaiBulanan: document.getElementById('cfgTargetNilai').value,
    targetUnitMarketing: document.getElementById('cfgTargetUnit').value,
    izinMarketingHapus: document.getElementById('cfgIzinHapus').value,
    izinMarketingUbah: document.getElementById('cfgIzinUbah').value
  };
  const btn = document.getElementById('btnCfg');
  tombolLoading(btn, true);
  call('simpanKonfigurasi', App.token, patch).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Konfigurasi');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.config = res.data;
    showToast('Berhasil', res.message, 'success');
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Konfigurasi');
    showToast('Error', err.message, 'danger');
  });
}

// ── 10g. Laporan Gabungan (Owner) ──
function renderLaporan() {
  const el = document.getElementById('app-laporan');
  const perProyek = App.proyek.map(function (p) {
    const trx = App.transaksi.filter(function (t) { return t.idProyek === p.id; });
    const s = statistikProyek(p.id);
    return {
      nama: p.nama, unit: trx.length, nilai: trx.reduce(function (a, t) { return a + (t.harga || 0); }, 0),
      total: s.total, tersedia: s.tersedia, terjual: s.terjual,
      serap: s.total ? ((s.total - s.tersedia) / s.total * 100).toFixed(1) : '0'
    };
  });
  const totalNilai = perProyek.reduce(function (a, p) { return a + p.nilai; }, 0);

  el.innerHTML =
    '<div class="d-flex justify-content-between align-items-end mb-3">' +
      '<div><h2 class="mb-0">Laporan Gabungan</h2>' +
      '<span class="text-muted-2" style="font-size:.86rem">Rekapitulasi performa seluruh proyek perumahan.</span></div>' +
      '<button class="btn btn-brand" onclick="unduhLaporanPdf()"><i class="bi bi-file-earmark-pdf"></i> Unduh PDF</button></div>' +
    '<div class="table-wrap mb-3"><table class="table-lux"><thead><tr>' +
      '<th>Proyek</th><th class="text-end">Total Kavling</th><th class="text-end">Tersedia</th>' +
      '<th class="text-end">Terjual</th><th class="text-end">Serapan</th><th class="text-end">Nilai Penjualan</th>' +
    '</tr></thead><tbody>' +
    perProyek.map(function (p) {
      return '<tr><td><b>' + esc(p.nama) + '</b></td>' +
        '<td class="text-end tabular">' + p.total + '</td>' +
        '<td class="text-end tabular" style="color:var(--success)">' + p.tersedia + '</td>' +
        '<td class="text-end tabular" style="color:var(--primary)">' + p.terjual + '</td>' +
        '<td class="text-end tabular">' + p.serap + '%</td>' +
        '<td class="text-end tabular"><b>' + rp(p.nilai) + '</b></td></tr>';
    }).join('') +
    '<tr class="group-row"><td>TOTAL SELURUH PROYEK</td><td colspan="4"></td>' +
    '<td class="text-end tabular">' + rp(totalNilai) + '</td></tr>' +
    '</tbody></table></div>' +
    '<div class="card-lux p-3 p-md-4"><h5 class="mb-3">Komposisi Nilai Penjualan per Proyek</h5>' +
    '<canvas id="chartLaporan" height="120"></canvas></div>';

  buatChart('chartLaporan', {
    type: 'doughnut',
    data: {
      labels: perProyek.map(function (p) { return p.nama; }),
      datasets: [{ data: perProyek.map(function (p) { return p.nilai; }), backgroundColor: perProyek.map(function (_, i) { return warnaSeri(i); }), borderWidth: 2, borderColor: modeGelap() ? '#201A1C' : '#FFFFFF' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: warnaTeksChart(), boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: function (c) { return c.label + ': ' + rp(c.parsed); } } }
      }
    }
  });
}

function unduhLaporanPdf() {
  const e = App.etalase;
  const rows = App.proyek.map(function (p) {
    const trx = App.transaksi.filter(function (t) { return t.idProyek === p.id; });
    const s = statistikProyek(p.id);
    return '<tr><td>' + esc(p.nama) + '</td><td style="text-align:right">' + s.total + '</td>' +
      '<td style="text-align:right">' + s.tersedia + '</td><td style="text-align:right">' + s.terjual + '</td>' +
      '<td style="text-align:right">' + rp(trx.reduce(function (a, t) { return a + (t.harga || 0); }, 0)) + '</td></tr>';
  }).join('');

  cetakHtml('<html><head><meta charset="utf-8"><title>Laporan Gabungan</title>' +
    '<style>body{font-family:Inter,Arial,sans-serif;padding:26px;color:#241A1E}' +
    'h2{font-family:Georgia,serif;color:#7A1F3D;margin:0}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}' +
    'th{background:#7A1F3D;color:#fff;text-align:left;padding:8px}td{padding:7px 8px;border-bottom:1px solid #E8DEDD}</style></head><body>' +
    '<h2>' + esc(e.namaPerusahaan) + '</h2><div style="font-size:11px;color:#6B5C60">' + esc(e.alamat) + '</div><hr>' +
    '<h3 style="font-family:Georgia,serif">Laporan Gabungan Seluruh Proyek</h3>' +
    '<div style="font-size:11px;color:#6B5C60">Dicetak: ' + new Date().toLocaleString('id-ID') + '</div>' +
    '<table><thead><tr><th>Proyek</th><th style="text-align:right">Total Kavling</th>' +
    '<th style="text-align:right">Tersedia</th><th style="text-align:right">Terjual</th>' +
    '<th style="text-align:right">Nilai Penjualan</th></tr></thead><tbody>' + rows + '</tbody></table></body></html>');
}

// ════════ BAGIAN 20 — TESTIMONI KONSUMEN (v4.4) ════════
// Hanya tim internal (Marketing & Owner) yang menambah, menilai, dan memilih
// foto. Etalase publik hanya MENAMPILKAN — tidak ada formulir untuk konsumen.

function htmlBintang(n) {
  let h = '';
  for (let i = 1; i <= 5; i++) h += '<i class="bi bi-star-fill' + (i <= n ? '' : ' kosong') + '"></i>';
  return h;
}

/** "Budi Santoso Wijaya" → "Budi S." (privasi di halaman publik). */
function namaSingkat(nama) {
  const b = String(nama || '').trim().split(/\s+/).filter(Boolean);
  if (!b.length) return '';
  if (b.length === 1) return b[0];
  return b[0] + ' ' + b[b.length - 1].charAt(0).toUpperCase() + '.';
}

function renderTestimoniBeranda() {
  const wrap = document.getElementById('testimoniWrap');
  const track = document.getElementById('testimoniBeranda');
  if (!wrap || !track) return;
  const set = App.testimoniSetelan || {};
  const daftar = App.testimoniPublik || [];
  if (set.tampil === false || !daftar.length) { wrap.classList.add('hidden'); return; }

  document.getElementById('testimoniJudul').textContent = set.judul || 'Testimoni Konsumen';
  document.getElementById('testimoniSub').textContent = set.sub || '';
  document.getElementById('testimoniNav').classList.toggle('hidden', daftar.length < 2);

  track.innerHTML = daftar.slice(0, 12).map(kartuTestimoni).join('');
  wrap.classList.remove('hidden');
}

/** Satu kartu testimoni (dipakai beranda & halaman Testimoni). */
function kartuTestimoni(t) {
  const foto = (t.foto || [])[0];
  return '<article class="card-lux testi-card">' +
    '<div class="testi-foto" onclick="bukaGaleriTestimoni(\'' + escJs(t.id) + '\',0)">' +
      (foto
        ? '<img src="' + esc(foto) + '" alt="Serah terima kunci ' + esc(t.nama) + '" loading="lazy" ' +
          'onerror="this.outerHTML=\'<div class=&quot;thumb-empty&quot;><i class=&quot;bi bi-house-heart&quot;></i></div>\'">'
        : '<div class="thumb-empty"><i class="bi bi-house-heart"></i></div>') +
      '<span class="chip chip-gold testi-kunci"><i class="bi bi-key-fill"></i> Serah Terima Kunci</span>' +
      ((t.foto || []).length > 1 ? '<span class="testi-jml"><i class="bi bi-images"></i> ' + t.foto.length + ' foto</span>' : '') +
    '</div>' +
    '<div class="testi-body">' +
      (t.rating ? '<div class="testi-bintang" aria-label="Penilaian ' + t.rating + ' dari 5">' + htmlBintang(t.rating) + '</div>' : '') +
      (t.isi ? '<p class="testi-isi">' + esc(t.isi) + '</p>' : '') +
      '<div class="testi-orang">' +
        '<div class="testi-avatar">' + esc(String(t.nama || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div style="min-width:0"><div class="testi-nama text-truncate">' + esc(t.nama) + '</div>' +
        '<div class="testi-unit text-truncate">' + esc([t.unit, t.proyek].filter(Boolean).join(' · ')) + '</div>' +
        (t.tanggal ? '<div class="testi-unit">Serah terima ' + esc(tglIndo(t.tanggal)) + '</div>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
  '</article>';
}

/** v4.5 — Menu "Testimoni" di bilah atas: ikut aturan tampil/sembunyi dari tim. */
function aturNavTestimoni() {
  const set = App.testimoniSetelan || {};
  document.querySelectorAll('.nav-testimoni').forEach(function (n) { n.classList.toggle('hidden', set.tampil === false); });
}

/** v4.5 — Halaman publik Testimoni (tersendiri, di sebelah Cek Status KPR). */
function renderHalamanTestimoni() {
  const grid = document.getElementById('gridTestimoni');
  if (!grid) return;
  const set = App.testimoniSetelan || {};
  const daftar = App.testimoniPublik || [];
  document.getElementById('halTestimoniJudul').textContent = set.judul || 'Testimoni Konsumen';
  document.getElementById('halTestimoniSub').textContent = set.sub || '';
  if (set.tampil === false || !daftar.length) {
    grid.innerHTML = '<div class="col-12">' + emptyState('chat-quote', 'Belum ada testimoni',
      'Dokumentasi serah terima kunci konsumen kami akan tampil di sini.') + '</div>';
    return;
  }
  grid.innerHTML = daftar.map(function (t) {
    return '<div class="col-md-6 col-lg-4">' + kartuTestimoni(t) + '</div>';
  }).join('');
}

/** Tampilkan data yang ada seketika, lalu ambil data terbaru dari server. */
function muatHalamanTestimoni() {
  const grid = document.getElementById('gridTestimoni');
  if (grid && !(App.testimoniPublik || []).length) grid.innerHTML = '<div class="col-12">' + skeleton(120, 2) + '</div>';
  else renderHalamanTestimoni();
  call('getTestimoni').then(function (res) {
    if (!res || !res.success) { renderHalamanTestimoni(); return; }
    App.testimoniPublik = res.data.testimoni || [];
    App.testimoniSetelan = res.data.setelan || App.testimoniSetelan;
    aturNavTestimoni();
    if (App.pubPage === 'testimoni') renderHalamanTestimoni();
    try { renderTestimoniBeranda(); } catch (e) { /* abaikan */ }
  }).catch(function () { renderHalamanTestimoni(); });
}

function geserTestimoni(arah) {
  const track = document.getElementById('testimoniBeranda');
  if (!track) return;
  const kartu = track.querySelector('.testi-card');
  const lebar = kartu ? kartu.getBoundingClientRect().width + 18 : 320;
  track.scrollBy({ left: arah * lebar, behavior: 'smooth' });
}

/** Galeri foto testimoni (publik & internal). */
function bukaGaleriTestimoni(id, mulai) {
  const t = (App.testimoniPublik || []).concat(App.testimoniAdmin || []).find(function (x) { return x.id === id; });
  if (!t || !(t.foto || []).length) return;
  const i0 = Math.min(mulai || 0, t.foto.length - 1);
  openModal(t.nama + (t.proyek ? ' — ' + t.proyek : ''),
    '<div class="galeri-utama"><img id="galeriUtama" src="' + esc(t.foto[i0]) + '" alt="Foto serah terima"></div>' +
    (t.foto.length > 1
      ? '<div class="galeri-mini">' + t.foto.map(function (f, i) {
          return '<img src="' + esc(f) + '" class="' + (i === i0 ? 'aktif' : '') + '" alt="Foto ' + (i + 1) + '" ' +
            'onclick="pilihFotoGaleri(this)">';
        }).join('') + '</div>'
      : '') +
    (t.isi ? '<p class="testi-isi mt-3">' + esc(t.isi) + '</p>' : ''),
    null, 'modal-lg');
}

function pilihFotoGaleri(el) {
  document.getElementById('galeriUtama').src = el.src;
  el.parentNode.querySelectorAll('img').forEach(function (x) { x.classList.toggle('aktif', x === el); });
}

// ── Halaman internal: Testimoni Konsumen ──

function renderTestimoniAdmin() {
  const el = document.getElementById('app-testimoni');
  const set = App.testimoniSetelan || { tampil: true, judul: '', sub: '' };
  const semua = App.testimoniAdmin || [];
  const tampil = semua.filter(function (t) { return t.status === 'Tampil'; }).length;

  el.innerHTML =
    '<p class="text-muted-2">Tampilkan dokumentasi serah terima kunci konsumen yang sudah akad di halaman depan e-katalog. ' +
    'Penilaian bintang dan foto <b>hanya diberikan oleh tim internal</b> — konsumen tidak dapat mengisi testimoni sendiri.</p>' +
    '<div class="row g-3">' +
      '<div class="col-lg-4">' +
        '<div class="card-lux p-3 mb-3">' +
          '<h6 class="font-head mb-3"><i class="bi bi-sliders" style="color:var(--accent)"></i> Aturan Tampilan di Etalase</h6>' +
          '<div class="form-check form-switch mb-3">' +
            '<input class="form-check-input" type="checkbox" id="tsSetTampil"' + (set.tampil !== false ? ' checked' : '') + '>' +
            '<label class="form-check-label" for="tsSetTampil">Tampilkan menu &amp; bagian Testimoni di etalase</label>' +
          '</div>' +
          '<label class="form-label">Judul Bagian</label>' +
          '<input class="form-control mb-2" id="tsSetJudul" maxlength="120" value="' + esc(set.judul || '') + '">' +
          '<label class="form-label">Keterangan Singkat</label>' +
          '<textarea class="form-control mb-3" id="tsSetSub" rows="2" maxlength="240">' + esc(set.sub || '') + '</textarea>' +
          '<button class="btn btn-brand w-100" id="btnTsSet" onclick="simpanSetelanTestimoniUi()"><i class="bi bi-save"></i> Simpan Aturan</button>' +
          '<div class="text-muted-2 mt-2" style="font-size:.76rem"><i class="bi bi-lock"></i> Hanya Marketing &amp; Owner/Superadmin yang dapat mengubah aturan ini.</div>' +
        '</div>' +
        '<div class="card-lux p-3">' +
          '<div class="d-flex justify-content-between py-1" style="font-size:.86rem"><span class="text-muted-2">Total testimoni</span><b>' + semua.length + '</b></div>' +
          '<div class="d-flex justify-content-between py-1" style="font-size:.86rem"><span class="text-muted-2">Tampil di etalase</span><b style="color:var(--success)">' + tampil + '</b></div>' +
          '<div class="d-flex justify-content-between py-1" style="font-size:.86rem"><span class="text-muted-2">Disembunyikan</span><b>' + (semua.length - tampil) + '</b></div>' +
          '<div class="text-muted-2 mt-2" style="font-size:.76rem">Tampil di menu <b>Testimoni</b> pada etalase (maks. 60) dan 12 teratas di Beranda, diurutkan menurut kolom <b>Urutan</b> lalu tanggal serah terima terbaru.</div>' +
        '</div>' +
      '</div>' +
      '<div class="col-lg-8">' +
        '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
          '<div class="input-group" style="max-width:260px">' +
            '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
            '<input class="form-control" id="tsCari" placeholder="Cari nama / unit…" oninput="tundaCari(renderDaftarTestimoni)">' +
          '</div>' +
          '<select class="form-select" style="max-width:170px" id="tsFilter" onchange="renderDaftarTestimoni()">' +
            '<option value="">Semua Status</option><option value="Tampil">Tampil</option><option value="Sembunyi">Disembunyikan</option>' +
          '</select>' +
          '<button class="btn btn-sm btn-brand ms-auto" onclick="formTestimoni()"><i class="bi bi-plus-lg"></i> Tambah Testimoni</button>' +
        '</div>' +
        '<div class="row g-3" id="tsDaftar"></div>' +
      '</div>' +
    '</div>';
  renderDaftarTestimoni();
}

function renderDaftarTestimoni() {
  const box = document.getElementById('tsDaftar');
  if (!box) return;
  const q = ((document.getElementById('tsCari') || {}).value || '').toLowerCase();
  const f = (document.getElementById('tsFilter') || {}).value || '';
  const nmProyek = function (id) { return (App.proyek.find(function (p) { return p.id === id; }) || {}).nama || ''; };
  const list = (App.testimoniAdmin || []).filter(function (t) {
    if (f && t.status !== f) return false;
    if (q && (t.nama + ' ' + t.unit + ' ' + nmProyek(t.idProyek)).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) {
    const ua = a.urutan === '' ? 9999 : Number(a.urutan), ub = b.urutan === '' ? 9999 : Number(b.urutan);
    if (ua !== ub) return ua - ub;
    return String(b.tanggalSerahTerima || b.tanggal).localeCompare(String(a.tanggalSerahTerima || a.tanggal));
  });

  if (!list.length) {
    box.innerHTML = '<div class="col-12">' + emptyState('chat-quote', 'Belum ada testimoni',
      'Klik "Tambah Testimoni" untuk memasang foto serah terima kunci konsumen yang sudah akad.') + '</div>';
    return;
  }
  box.innerHTML = list.map(function (t) {
    const tampil = t.status === 'Tampil';
    const id = escJs(t.id);
    return '<div class="col-md-6"><div class="card-lux p-3 h-100 ts-admin' + (tampil ? '' : ' redup') + '">' +
      '<div class="ts-thumb mb-2' + (t.foto.length ? ' cursor-pointer' : '') + '"' +
        (t.foto.length ? ' onclick="bukaGaleriTestimoni(\'' + id + '\',0)"' : '') + '>' +
        (t.foto[0] ? '<img src="' + esc(t.foto[0]) + '" alt="" loading="lazy">' : '<div class="empty-state p-4"><i class="bi bi-image"></i></div>') +
        (t.foto.length > 1 ? '<span class="testi-jml"><i class="bi bi-images"></i> ' + t.foto.length + '</span>' : '') +
      '</div>' +
      '<div class="d-flex justify-content-between align-items-start gap-2">' +
        '<div style="min-width:0"><b>' + esc(t.nama) + '</b>' +
        '<div class="text-muted-2 text-truncate" style="font-size:.76rem">' + esc([t.unit, nmProyek(t.idProyek)].filter(Boolean).join(' · ')) + '</div></div>' +
        '<span class="chip chip-xs ' + (tampil ? 'chip-ok' : '') + '">' + (tampil ? 'Tampil' : 'Disembunyikan') + '</span>' +
      '</div>' +
      '<div class="testi-bintang my-1">' + htmlBintang(t.rating) + '</div>' +
      (t.isi ? '<div class="text-muted-2 line-clamp-2" style="font-size:.82rem">“' + esc(t.isi) + '”</div>' : '') +
      '<div class="text-muted-2 mt-1" style="font-size:.72rem">' +
        (t.tanggalSerahTerima ? 'Serah terima ' + esc(tglIndo(t.tanggalSerahTerima)) + ' · ' : '') +
        (t.idTransaksi ? 'Konsumen aplikasi' : 'Input manual') + (t.oleh ? ' · oleh ' + esc(t.oleh) : '') + '</div>' +
      '<div class="d-flex gap-1 mt-2 justify-content-end">' +
        '<button class="btn btn-sm btn-ghost" onclick="aturTampilTestimoniUi(\'' + id + '\',' + (!tampil) + ')" title="' +
          (tampil ? 'Sembunyikan dari etalase' : 'Tampilkan di etalase') + '"><i class="bi bi-' + (tampil ? 'eye-slash' : 'eye') + '"></i></button>' +
        '<button class="btn btn-sm btn-ghost" onclick="formTestimoni(\'' + id + '\')" title="Edit"><i class="bi bi-pencil"></i></button>' +
        '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="hapusTestimoniUi(\'' + id + '\')" title="Hapus"><i class="bi bi-trash"></i></button>' +
      '</div>' +
    '</div></div>';
  }).join('');
}

function simpanSetelanTestimoniUi() {
  const btn = document.getElementById('btnTsSet');
  tombolLoading(btn, true);
  call('simpanSetelanTestimoni', App.token, {
    tampil: document.getElementById('tsSetTampil').checked,
    judul: document.getElementById('tsSetJudul').value,
    sub: document.getElementById('tsSetSub').value
  }).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Aturan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.testimoniSetelan = res.data;
    showToast('Berhasil', res.message, 'success');
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Aturan');
    showToast('Error', err.message, 'danger');
  });
}

/** Konsumen yang sudah akad & serah terima (status Terjual). */
function konsumenSudahAkad() {
  return (App.transaksi || []).filter(function (t) { return t.status === 'Terjual'; })
    .sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); });
}

function formTestimoni(id) {
  const t = id ? (App.testimoniAdmin || []).find(function (x) { return x.id === id; }) : null;
  const akad = konsumenSudahAkad();
  const sudahAda = {};
  (App.testimoniAdmin || []).forEach(function (x) { if (x.idTransaksi) sudahAda[x.idTransaksi] = true; });
  const nmProyek = function (idp) { return (App.proyek.find(function (p) { return p.id === idp; }) || {}).nama || ''; };
  const manual = t ? !t.idTransaksi : !akad.length;

  App._tsFoto = {
    tetap: t ? t.fotoAsli.map(function (asli, i) { return { asli: asli, thumb: t.foto[i] }; }) : [],
    baru: []
  };
  App._tsRating = t ? t.rating : 5;

  openModal(t ? 'Edit Testimoni — ' + t.nama : 'Tambah Testimoni Konsumen',
    '<div class="alert mb-3" style="background:var(--info-bg);border:none;color:var(--primary);font-size:.82rem">' +
      '<i class="bi bi-person-lock"></i> Penilaian &amp; foto diisi oleh tim internal. Pastikan konsumen sudah menyetujui fotonya ditampilkan.</div>' +

    (t ? '' :
      '<label class="form-label">Sumber Data</label>' +
      '<div class="d-flex gap-2 mb-3 flex-wrap">' +
        '<span class="filter-chip' + (manual ? '' : ' active') + '" id="tsSumberApp" onclick="gantiSumberTestimoni(false)">' +
          '<i class="bi bi-person-check"></i> Konsumen di aplikasi (' + akad.length + ' sudah akad)</span>' +
        '<span class="filter-chip' + (manual ? ' active' : '') + '" id="tsSumberManual" onclick="gantiSumberTestimoni(true)">' +
          '<i class="bi bi-pencil-square"></i> Input manual</span>' +
      '</div>') +

    '<div id="tsBoxApp" class="' + (manual ? 'hidden' : '') + '">' +
      '<label class="form-label">Konsumen yang Sudah Akad &amp; Serah Terima</label>' +
      (t && t.idTransaksi
        ? '<input class="form-control mb-3" disabled value="' + esc(t.idTransaksi) + '">' +
          '<input type="hidden" id="tsTrx" value="' + esc(t.idTransaksi) + '">'
        : '<select class="form-select mb-3" id="tsTrx" onchange="isiDariKonsumenTestimoni()">' +
            '<option value="">— Pilih konsumen —</option>' +
            akad.map(function (k) {
              return '<option value="' + esc(k.id) + '">' + esc(k.nama + ' — ' + nmProyek(k.idProyek) + ' • Blok ' + k.blok + '-' + k.nomor) +
                (sudahAda[k.id] ? ' (sudah ada testimoni)' : '') + '</option>';
            }).join('') +
          '</select>') +
    '</div>' +

    '<div id="tsBoxManual" class="row g-2 mb-1' + (manual ? '' : ' hidden') + '">' +
      '<div class="col-md-6"><label class="form-label">Proyek</label>' +
        '<select class="form-select" id="tsProyek"><option value="">— Pilih proyek —</option>' +
        App.proyek.map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (t && t.idProyek === p.id ? ' selected' : '') + '>' + esc(p.nama) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Keterangan Unit</label>' +
        '<input class="form-control" id="tsUnitManual" maxlength="80" placeholder="Contoh: Blok A No. 3" value="' + esc(t && !t.idTransaksi ? t.unit : '') + '"></div>' +
    '</div>' +

    '<div class="row g-2 mt-1">' +
      '<div class="col-md-6"><label class="form-label">Nama yang Ditampilkan</label>' +
        '<input class="form-control" id="tsNama" maxlength="80" value="' + esc(t ? t.nama : '') + '" placeholder="Contoh: Budi S.">' +
        '<div class="text-muted-2" style="font-size:.72rem">Disingkat otomatis demi privasi — boleh diubah.</div></div>' +
      '<div class="col-md-6"><label class="form-label">Tanggal Serah Terima Kunci</label>' +
        '<input type="date" class="form-control" id="tsTanggal" value="' + esc(t ? String(t.tanggalSerahTerima || '').substring(0, 10) : '') + '"></div>' +
      '<input type="hidden" id="tsUnitApp" value="' + esc(t && t.idTransaksi ? t.unit : '') + '">' +
    '</div>' +

    '<label class="form-label mt-3 d-block">Penilaian Tim Internal</label>' +
    '<div class="bintang-pilih" id="tsBintang">' +
      [1, 2, 3, 4, 5].map(function (n) {
        return '<button type="button" data-n="' + n + '" onclick="pilihBintangTestimoni(' + n + ')" aria-label="' + n + ' bintang">' +
          '<i class="bi bi-star-fill"></i></button>';
      }).join('') +
    '</div>' +

    '<label class="form-label mt-3">Kesan Konsumen <span class="text-muted-2" style="font-weight:400">— ditulis oleh tim saat serah terima</span></label>' +
    '<textarea class="form-control" id="tsIsi" rows="3" maxlength="700" placeholder="Contoh: Prosesnya cepat, rumah sesuai gambar, tim sangat membantu sampai akad.">' +
      esc(t ? t.isi : '') + '</textarea>' +

    '<label class="form-label mt-3">Foto Serah Terima <span class="text-muted-2" style="font-weight:400">— maks. 6 foto</span></label>' +
    '<div class="ts-foto-grid" id="tsFotoGrid"></div>' +

    '<div class="row g-2 mt-3 align-items-end">' +
      '<div class="col-7"><div class="form-check form-switch">' +
        '<input class="form-check-input" type="checkbox" id="tsTampil"' + (!t || t.status === 'Tampil' ? ' checked' : '') + '>' +
        '<label class="form-check-label" for="tsTampil">Tampilkan di etalase</label></div></div>' +
      '<div class="col-5"><label class="form-label">Urutan <span class="text-muted-2" style="font-weight:400">(opsional)</span></label>' +
        '<input type="number" min="1" class="form-control" id="tsUrutan" value="' + esc(t ? t.urutan : '') + '" placeholder="1 = paling depan"></div>' +
    '</div>',

    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnTs" onclick="simpanTestimoniUi(' + (t ? '\'' + escJs(t.id) + '\'' : 'null') + ')">' +
      '<i class="bi bi-save"></i> Simpan Testimoni</button>',
    'modal-lg');

  pilihBintangTestimoni(App._tsRating);
  renderFotoTestimoni();
}

function gantiSumberTestimoni(manual) {
  document.getElementById('tsBoxApp').classList.toggle('hidden', manual);
  document.getElementById('tsBoxManual').classList.toggle('hidden', !manual);
  document.getElementById('tsSumberApp').classList.toggle('active', !manual);
  document.getElementById('tsSumberManual').classList.toggle('active', manual);
}

function isiDariKonsumenTestimoni() {
  const id = document.getElementById('tsTrx').value;
  const k = (App.transaksi || []).find(function (x) { return x.id === id; });
  if (!k) return;
  document.getElementById('tsNama').value = namaSingkat(k.nama);
  document.getElementById('tsUnitApp').value = 'Blok ' + k.blok + ' No. ' + k.nomor;
  const tgl = document.getElementById('tsTanggal');
  if (!tgl.value && k.berkas && k.berkas.tanggalAkad) tgl.value = String(k.berkas.tanggalAkad).substring(0, 10);
}

function pilihBintangTestimoni(n) {
  App._tsRating = n;
  document.querySelectorAll('#tsBintang button').forEach(function (b) {
    b.classList.toggle('on', Number(b.dataset.n) <= n);
  });
}

function renderFotoTestimoni() {
  const grid = document.getElementById('tsFotoGrid');
  if (!grid) return;
  const f = App._tsFoto;
  const total = f.tetap.length + f.baru.length;
  grid.innerHTML =
    f.tetap.map(function (x, i) {
      return '<div class="ts-foto-item"><img src="' + esc(x.thumb) + '" alt="">' +
        '<button type="button" class="hapus" onclick="hapusFotoTestimoni(\'tetap\',' + i + ')" title="Lepas foto"><i class="bi bi-x"></i></button></div>';
    }).join('') +
    f.baru.map(function (x, i) {
      return '<div class="ts-foto-item"><img src="data:' + esc(x.mime) + ';base64,' + x.data + '" alt="">' +
        '<span class="chip chip-gold chip-xs baru">Baru</span>' +
        '<button type="button" class="hapus" onclick="hapusFotoTestimoni(\'baru\',' + i + ')" title="Batalkan"><i class="bi bi-x"></i></button></div>';
    }).join('') +
    (total < 6
      ? '<div class="ts-foto-tambah" onclick="pilihFotoTestimoni()"><div><i class="bi bi-camera"></i>Tambah foto</div></div>'
      : '');
}

function hapusFotoTestimoni(jenis, i) {
  App._tsFoto[jenis].splice(i, 1);
  renderFotoTestimoni();
}

function pilihFotoTestimoni() {
  let input = document.getElementById('inputFotoTestimoni');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'inputFotoTestimoni';
    input.className = 'hidden';
    input.accept = 'image/*';
    input.multiple = true;
    document.body.appendChild(input);
  }
  input.value = '';
  input.onchange = function () {
    const sisa = 6 - App._tsFoto.tetap.length - App._tsFoto.baru.length;
    const files = Array.prototype.slice.call(input.files).filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) return;
    if (files.length > sisa) showToast('Maksimal 6 Foto', 'Hanya ' + sisa + ' foto pertama yang ditambahkan.', 'warning');
    const grid = document.getElementById('tsFotoGrid');
    if (grid) grid.insertAdjacentHTML('beforeend', '<div class="ts-foto-tambah" id="tsFotoProses"><div><span class="spinner-inline"></span><br>Menyiapkan…</div></div>');
    Promise.all(files.slice(0, sisa).map(function (f) { return kompresGambar(f, 1400, 0.8); }))
      .then(function (hasil) {
        App._tsFoto.baru = App._tsFoto.baru.concat(hasil);
        renderFotoTestimoni();
      })
      .catch(function (err) { renderFotoTestimoni(); showToast('Gagal', err.message, 'danger'); });
  };
  input.click();
}

function simpanTestimoniUi(id) {
  const t = id ? (App.testimoniAdmin || []).find(function (x) { return x.id === id; }) : null;
  const boxApp = document.getElementById('tsBoxApp');
  const pakaiApp = t ? !!t.idTransaksi : (boxApp && !boxApp.classList.contains('hidden'));
  const idTrx = pakaiApp ? ((document.getElementById('tsTrx') || {}).value || '') : '';

  if (pakaiApp && !idTrx) { showToast('Konsumen Belum Dipilih', 'Pilih konsumen yang sudah akad, atau gunakan Input manual.', 'warning'); return; }
  if (!pakaiApp && !document.getElementById('tsProyek').value) { showToast('Proyek Belum Dipilih', 'Pilih proyek perumahan.', 'warning'); return; }
  if (!document.getElementById('tsNama').value.trim()) { showToast('Nama Kosong', 'Isi nama yang ditampilkan.', 'warning'); return; }

  const payload = {
    id: id || '',
    idTransaksi: idTrx,
    idProyek: pakaiApp ? '' : document.getElementById('tsProyek').value,
    unit: pakaiApp ? document.getElementById('tsUnitApp').value : document.getElementById('tsUnitManual').value,
    nama: document.getElementById('tsNama').value,
    tanggalSerahTerima: document.getElementById('tsTanggal').value,
    rating: App._tsRating,
    isi: document.getElementById('tsIsi').value,
    status: document.getElementById('tsTampil').checked ? 'Tampil' : 'Sembunyi',
    urutan: document.getElementById('tsUrutan').value,
    fotoTetap: App._tsFoto.tetap.map(function (x) { return x.asli; })
  };
  const btn = document.getElementById('btnTs');
  tombolLoading(btn, true);
  call('simpanTestimoni', App.token, payload, App._tsFoto.baru).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Testimoni');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    closeModal();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Testimoni');
    showToast('Error', err.message, 'danger');
  });
}

function aturTampilTestimoniUi(id, tampil) {
  call('aturTampilTestimoni', App.token, id, tampil).then(function (res) {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) { showToast('Error', err.message, 'danger'); });
}

function hapusTestimoniUi(id) {
  const t = (App.testimoniAdmin || []).find(function (x) { return x.id === id; });
  if (!t) return;
  konfirmasi('Hapus Testimoni', 'Testimoni "' + t.nama + '" akan dihapus dari etalase dan fotonya dipindah ke Sampah Google Drive.', function () {
    call('hapusTestimoni', App.token, id).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      showToast('Berhasil', res.message, 'success');
      muatWorkspace(false);
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}


// ════════ BAGIAN 21 — CEK ID BI / SLIK OJK (v4.4) ════════
// Diinput Tim Perbankan, terlihat oleh Marketing. Konsumen KPR wajib "Lolos"
// sebelum SPR dapat dibuat (dijaga di server).

const KOL_BI = {
  '1': 'Kol 1 — Lancar', '2': 'Kol 2 — Dalam Perhatian Khusus', '3': 'Kol 3 — Kurang Lancar',
  '4': 'Kol 4 — Diragukan', '5': 'Kol 5 — Macet'
};

function statusBi(t) {
  return (t && t.berkas && t.berkas.bi && t.berkas.bi.status) || 'Belum Dicek';
}

function chipBi(t, ringkas) {
  if (!t || t.metode !== 'KPR') return '';
  const s = statusBi(t);
  const bi = (t.berkas && t.berkas.bi) || {};
  const kelas = s === 'Lolos' ? 'chip-ok' : s === 'Tidak Lolos' ? 'chip-danger' : s === 'Dalam Proses' ? 'chip-gold' : 'chip-warn';
  const ikon = s === 'Lolos' ? 'shield-check' : s === 'Tidak Lolos' ? 'shield-x' : s === 'Dalam Proses' ? 'hourglass-split' : 'shield-exclamation';
  return '<span class="chip chip-xs ' + kelas + '" title="Hasil Cek ID BI' + (bi.oleh ? ' — diinput ' + esc(bi.oleh) : '') + '">' +
    '<i class="bi bi-' + ikon + '"></i> ID BI: ' + esc(s) + (bi.kol && !ringkas ? ' · Kol ' + esc(bi.kol) : '') + '</span>';
}

function renderCekBi() {
  const el = document.getElementById('app-cekBi');
  const kpr = App.transaksi.filter(function (t) { return t.metode === 'KPR'; });
  const hitung = function (s) { return kpr.filter(function (t) { return statusBi(t) === s; }).length; };
  const kpi = [
    { l: 'Belum Dicek', v: hitung('Belum Dicek'), s: 'perlu dicek segera', i: 'shield-exclamation', g: 'is-warn' },
    { l: 'Dalam Proses', v: hitung('Dalam Proses'), s: 'menunggu hasil SLIK', i: 'hourglass-split', g: 'is-gold' },
    { l: 'Lolos', v: hitung('Lolos'), s: 'SPR boleh dibuat', i: 'shield-check', g: 'is-ok' },
    { l: 'Tidak Lolos', v: hitung('Tidak Lolos'), s: 'SPR tertahan', i: 'shield-x', g: 'is-danger' }
  ];
  el.innerHTML =
    '<p class="text-muted-2">Input hasil Cek ID BI (SLIK OJK) konsumen KPR. Hasilnya langsung terlihat oleh Marketing di ' +
    '<b>Data Konsumen</b>, dan SPR konsumen KPR baru dapat dibuat bila hasilnya <b>Lolos</b>.</p>' +
    '<div class="row g-2 g-md-3 mb-3">' + kpi.map(function (k) {
      return '<div class="col-6 col-lg-3"><div class="kpi-tile ' + k.g + '">' +
        '<div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
        '<div style="min-width:0"><div class="kpi-lbl">' + esc(k.l) + '</div>' +
        '<div class="kpi-val">' + k.v + '</div><div class="kpi-sub">' + esc(k.s) + '</div></div></div></div>';
    }).join('') + '</div>' +
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:260px">' +
        '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="biCari" placeholder="Cari nama / NIK…" oninput="tundaCari(renderTabelCekBi)">' +
      '</div>' +
      '<select class="form-select" style="max-width:200px" id="biProyek" onchange="renderTabelCekBi()">' +
        '<option value="">Semua Proyek</option>' +
        App.proyek.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.nama) + '</option>'; }).join('') +
      '</select>' +
      '<select class="form-select" style="max-width:170px" id="biStatus" onchange="renderTabelCekBi()">' +
        '<option value="">Semua Hasil</option><option>Belum Dicek</option><option>Dalam Proses</option><option>Lolos</option><option>Tidak Lolos</option>' +
      '</select>' +
    '</div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>Konsumen</th><th>Proyek &amp; Unit</th><th>Berkas KPR</th><th>Hasil Cek ID BI</th><th>Tanggal Cek</th><th class="text-end">Aksi</th>' +
    '</tr></thead><tbody id="tbodyCekBi"></tbody></table></div>';
  renderTabelCekBi();
}

function renderTabelCekBi() {
  const tbody = document.getElementById('tbodyCekBi');
  if (!tbody) return;
  const q = ((document.getElementById('biCari') || {}).value || '').toLowerCase();
  const pr = (document.getElementById('biProyek') || {}).value || '';
  const st = (document.getElementById('biStatus') || {}).value || '';
  const urutan = { 'Belum Dicek': 0, 'Dalam Proses': 1, 'Tidak Lolos': 2, 'Lolos': 3 };
  const list = App.transaksi.filter(function (t) {
    if (t.metode !== 'KPR') return false;
    if (pr && t.idProyek !== pr) return false;
    if (st && statusBi(t) !== st) return false;
    if (q && (t.nama + ' ' + t.nik + ' ' + t.id).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) {
    const d = urutan[statusBi(a)] - urutan[statusBi(b)];
    return d || String(a.tanggal).localeCompare(String(b.tanggal));
  });

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6">' + emptyState('shield-check', 'Tidak ada data',
      'Konsumen KPR akan muncul di sini setelah ada pemesanan.') + '</td></tr>';
    return;
  }
  isiBertahap(tbody, list.map(function (t) {   // v5.0 — bertahap
    const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
    const bi = t.berkas.bi || {};
    return '<tr>' +
      '<td><b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.76rem">NIK ' + esc(t.nik) + '</div></td>' +
      '<td>' + esc(p.nama || '-') + '<div class="text-muted-2" style="font-size:.76rem">Blok ' + esc(t.blok) + ' No. ' + esc(t.nomor) + '</div></td>' +
      '<td><span class="chip ' + chipStatus(t.berkas.status || 'Diajukan') + '">' + esc(t.berkas.status || 'Diajukan') + '</span></td>' +
      '<td><div class="bi-ringkas">' + chipBi(t, true) +
        (bi.kol ? '<span class="text-muted-2" style="font-size:.74rem">' + esc(KOL_BI[bi.kol] || 'Kol ' + bi.kol) + '</span>' : '') +
        (bi.catatan ? '<span class="text-muted-2 line-clamp-2" style="font-size:.74rem">' + esc(bi.catatan) + '</span>' : '') +
      '</div></td>' +
      '<td class="tabular">' + (bi.tanggal ? esc(tglIndo(bi.tanggal)) : '<span class="text-muted-2">—</span>') +
        (bi.oleh ? '<div class="text-muted-2" style="font-size:.72rem">' + esc(bi.oleh) + '</div>' : '') + '</td>' +
      '<td class="text-end"><div class="d-flex gap-1 justify-content-end">' +
        (bi.link ? '<button class="btn btn-sm btn-ghost" onclick="previewFile(\'' + escJs(bi.link) + '\',\'Hasil Cek ID BI\')" title="Lihat dokumen hasil"><i class="bi bi-file-earmark-text"></i></button>' : '') +
        '<button class="btn btn-sm btn-ghost" onclick="detailTransaksi(\'' + escJs(t.id) + '\')" title="Detail konsumen"><i class="bi bi-eye"></i></button>' +
        '<button class="btn btn-sm btn-outline-brand" onclick="formCekBi(\'' + escJs(t.id) + '\')">' +
          (statusBi(t) === 'Belum Dicek' ? 'Input Hasil' : 'Ubah Hasil') + '</button>' +
      '</div></td></tr>';
  }));
}

function formCekBi(idTransaksi) {
  const t = App.transaksi.find(function (x) { return x.id === idTransaksi; });
  if (!t) return;
  const bi = t.berkas.bi || {};
  const s = statusBi(t);
  App._biFile = null;
  const hariIni = new Date();
  const tglDefault = bi.tanggal || (hariIni.getFullYear() + '-' + String(hariIni.getMonth() + 1).padStart(2, '0') + '-' + String(hariIni.getDate()).padStart(2, '0'));

  openModal('Hasil Cek ID BI — ' + t.nama,
    '<div class="card-flat p-3 mb-3" style="background:var(--surface)">' +
      '<b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.82rem">NIK ' + esc(t.nik) +
      ' • Blok ' + esc(t.blok) + '-' + esc(t.nomor) + ' • ' + esc(t.pekerjaan || '-') + '</div></div>' +
    '<div class="row g-2">' +
      '<div class="col-md-6"><label class="form-label">Hasil Cek ID BI</label>' +
        '<select class="form-select" id="biHasil">' +
        ['Belum Dicek', 'Dalam Proses', 'Lolos', 'Tidak Lolos'].map(function (o) {
          return '<option' + (o === s ? ' selected' : '') + '>' + o + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Kolektibilitas</label>' +
        '<select class="form-select" id="biKol"><option value="">— Tidak diisi —</option>' +
        Object.keys(KOL_BI).map(function (k) {
          return '<option value="' + k + '"' + (String(bi.kol) === k ? ' selected' : '') + '>' + KOL_BI[k] + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Tanggal Pengecekan</label>' +
        '<input type="date" class="form-control" id="biTanggal" value="' + esc(String(tglDefault).substring(0, 10)) + '"></div>' +
    '</div>' +
    '<label class="form-label mt-3">Catatan</label>' +
    '<textarea class="form-control" id="biCatatan" rows="2" maxlength="500" placeholder="Contoh: Tidak ada tunggakan; ada 1 kartu kredit aktif.">' + esc(bi.catatan || '') + '</textarea>' +
    '<label class="form-label mt-3">Dokumen Hasil SLIK <span class="text-muted-2" style="font-weight:400">(opsional — PDF / foto)</span></label>' +
    (bi.link
      ? '<div class="d-flex gap-2 align-items-center mb-2 flex-wrap">' +
          '<button type="button" class="btn btn-sm btn-outline-brand" onclick="previewFile(\'' + escJs(bi.link) + '\',\'Hasil Cek ID BI\')"><i class="bi bi-eye"></i> Lihat dokumen saat ini</button>' +
          '<div class="form-check mb-0"><input class="form-check-input" type="checkbox" id="biHapusDok">' +
          '<label class="form-check-label" for="biHapusDok" style="font-size:.82rem">Hapus dokumen ini</label></div>' +
        '</div>'
      : '') +
    '<div class="upload-box" id="biBoxFile" onclick="pilihFileCekBi()"><i class="bi bi-cloud-arrow-up"></i>' +
      '<div style="font-size:.86rem">' + (bi.link ? 'Ganti dengan dokumen baru' : 'Klik untuk memilih dokumen') + '</div></div>' +
    '<div class="alert mt-3 mb-0" style="background:var(--info-bg);border:none;color:var(--primary);font-size:.82rem">' +
      '<i class="bi bi-info-circle"></i> Hasil ini langsung terlihat oleh Marketing. SPR konsumen KPR hanya dapat dibuat bila hasilnya <b>Lolos</b>. ' +
      'Hasil Cek ID BI <b>tidak</b> ditampilkan kepada konsumen di menu Cek Status.</div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnBi" onclick="simpanCekBiUi(\'' + escJs(idTransaksi) + '\')"><i class="bi bi-save"></i> Simpan Hasil</button>',
    'modal-md');
}

function pilihFileCekBi() {
  let input = document.getElementById('inputFileCekBi');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'inputFileCekBi';
    input.className = 'hidden';
    input.accept = 'image/*,.pdf';
    document.body.appendChild(input);
  }
  input.value = '';
  input.onchange = function () {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('File Terlalu Besar', 'Maksimal 10 MB.', 'warning'); return; }
    const box = document.getElementById('biBoxFile');
    if (box) box.innerHTML = '<span class="spinner-inline"></span><div style="font-size:.86rem">Menyiapkan dokumen…</div>';
    kompresGambar(file, 1800, 0.82).then(function (siap) {
      App._biFile = siap;
      if (box) {
        box.classList.add('has-file');
        box.innerHTML = '<i class="bi bi-check-circle"></i><div style="font-size:.86rem">' + esc(file.name) + '</div>';
      }
    }).catch(function (err) { showToast('Gagal', err.message, 'danger'); });
  };
  input.click();
}

function simpanCekBiUi(idTransaksi) {
  const data = {
    status: document.getElementById('biHasil').value,
    kol: document.getElementById('biKol').value,
    tanggal: document.getElementById('biTanggal').value,
    catatan: document.getElementById('biCatatan').value,
    hapusDokumen: !!(document.getElementById('biHapusDok') || {}).checked
  };
  if ((data.status === 'Lolos' || data.status === 'Tidak Lolos') && !data.tanggal) {
    showToast('Tanggal Kosong', 'Isi tanggal pengecekan ID BI.', 'warning'); return;
  }
  const btn = document.getElementById('btnBi');
  tombolLoading(btn, true);
  call('simpanCekBI', App.token, idTransaksi, data, App._biFile).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Hasil');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App._biFile = null;
    closeModal();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Hasil');
    showToast('Error', err.message, 'danger');
  });
}

// ════════ BAGIAN 22 — DOKUMEN KONSUMEN SAAT INPUT MANUAL (v4.6) ════════

const DOK_MANUAL = [
  { key: 'ktp', input: 'mfKtp', box: 'mbKtp', label: 'Foto KTP', ikon: 'person-vcard', kolom: 'linkKtp' },
  { key: 'kk', input: 'mfKk', box: 'mbKk', label: 'Kartu Keluarga (KK)', ikon: 'diagram-3', kolom: 'linkKk' },
  { key: 'bukti', input: 'mfBukti', box: 'mbBukti', label: 'Bukti Bayar', ikon: 'receipt', kolom: 'linkBukti' }
];

/** Kotak unggah KTP / KK / Bukti Bayar di formulir input manual & edit konsumen. */
function htmlUnggahDokumenManual(t) {
  DOK_MANUAL.forEach(function (d) { delete fileBuffer[d.input]; });
  return '<div class="col-12"><div class="sect-label mt-1 mb-2">Dokumen Konsumen</div>' +
    '<div class="row g-2">' + DOK_MANUAL.map(function (d) {
      const ada = t && t[d.kolom];
      return '<div class="col-md-4">' +
        '<div class="upload-box py-3" id="' + d.box + '" onclick="document.getElementById(\'' + d.input + '\').click()">' +
          '<i class="bi bi-' + d.ikon + '"></i>' +
          '<div style="font-size:.84rem;font-weight:500">' + d.label + '</div>' +
          '<small>' + (ada ? 'Sudah ada — klik untuk mengganti' : 'Klik untuk memilih file') + '</small></div>' +
        '<input type="file" id="' + d.input + '" class="hidden" accept="image/*,.pdf" onchange="tandaiFile(\'' + d.input + '\',\'' + d.box + '\')">' +
        (ada ? '<button type="button" class="btn btn-sm btn-ghost w-100 mt-1" onclick="previewFile(\'' + escJs(ada) + '\',\'' + escJs(d.label) + '\')">' +
          '<i class="bi bi-eye"></i> Lihat ' + esc(d.label) + '</button>' : '') +
      '</div>';
    }).join('') + '</div>' +
    '<small class="text-muted-2 d-block mt-1">JPG, PNG, atau PDF — foto otomatis diperkecil. Dokumen ikut terkirim ke aplikasi SiKeu untuk konfirmasi pembayaran.</small>' +
  '</div>';
}

/** Unggah dokumen yang dipilih satu per satu, lalu panggil selesai(jumlahGagal). */
function unggahDokumenManual(idTransaksi, tiket, btn, selesai) {
  const antrean = DOK_MANUAL.filter(function (d) { return fileBuffer[d.input]; });
  if (!antrean.length) { selesai(0, 0); return; }
  let i = 0, gagal = 0;
  (function lanjut() {
    if (i >= antrean.length) {
      DOK_MANUAL.forEach(function (d) { delete fileBuffer[d.input]; });
      selesai(gagal, antrean.length);
      return;
    }
    const d = antrean[i++];
    if (btn) btn.innerHTML = '<span class="spinner-inline"></span> Mengunggah ' + d.label + ' (' + i + '/' + antrean.length + ')…';
    call('unggahDokumenTransaksi', idTransaksi, d.key, fileBuffer[d.input], tiket || '', App.token)
      .then(function (r) { if (!r || !r.success) gagal++; lanjut(); })
      .catch(function () { gagal++; lanjut(); });
  })();
}


// ════════ BAGIAN 23 — HAPUS KONSUMEN & PINDAH UNIT (v4.6) ════════

function bolehMarketing(t, aksi) {
  if (!App.sesi || App.sesi.role !== 'Marketing') return true;
  const aturan = App.aturanMarketing || { hapus: 'semua', ubah: 'semua' };
  if (aturan[aksi] !== 'sendiri') return true;
  return String(t.marketing || '').trim().toLowerCase() === String(App.sesi.nama || '').trim().toLowerCase();
}

function prosesHapusTransaksi(id) {
  const t = App.transaksi.find(function (x) { return x.id === id; });
  if (!t) return;
  const pilih = document.getElementById('hpsAlasan').value;
  const ket = document.getElementById('hpsKet').value.trim();
  if (!pilih) { showToast('Alasan Kosong', 'Pilih alasan penghapusan.', 'warning'); return; }
  if (pilih === 'Lainnya' && !ket) { showToast('Keterangan Kosong', 'Tuliskan alasannya.', 'warning'); return; }
  const btn = document.getElementById('btnHps');
  tombolLoading(btn, true);
  call('batalkanTransaksi', App.token, id, pilih + (ket ? ' — ' + ket : '')).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-trash"></i> Hapus Data');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    closeModal();
    showToast('Berhasil', res.message, 'success');
    App.transaksi = App.transaksi.filter(function (x) { return x.id !== id; });
    const kv = App.kavling.find(function (k) { return k.id === t.idKavling; });
    if (kv) kv.status = 'Tersedia';
    if (App.appPage === 'dataKonsumen') renderTabelKonsumen();
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-trash"></i> Hapus Data');
    showToast('Error', err.message, 'danger');
  });
}

/** @param {string} mode v5.2 — 'unit' (bawaan) atau 'indent' (pindahkan ke daftar indent) */
function formPindahUnit(id, mode) {
  const t = App.transaksi.find(function (x) { return x.id === id; });
  if (!t) return;
  if (!bolehMarketing(t, 'ubah')) { showToast('Akses Terbatas', 'Sesuai aturan perusahaan, Anda hanya dapat mengubah konsumen milik Anda sendiri.', 'warning'); return; }
  const pAsal = App.proyek.find(function (p) { return p.id === t.idProyek; }) || {};
  openModal('Pindah Unit — ' + t.nama,
    '<div class="card-flat p-3 mb-3" style="background:var(--surface)">' +
      '<div class="text-muted-2" style="font-size:.78rem">Unit saat ini</div>' +
      '<b>' + esc(pAsal.nama || '-') + ' • Blok ' + esc(t.blok) + ' No. ' + esc(t.nomor) + '</b>' +
      '<div class="text-muted-2" style="font-size:.8rem">' + esc(t.metode) + ' • Nilai ' + rp(t.harga) + ' • Status ' + esc(t.status) + '</div></div>' +
    // v5.2 — pilihan tujuan: unit lain atau daftar indent
    '<div class="d-flex gap-2 flex-wrap mb-3">' +
      '<label class="card-flat p-2 px-3 cursor-pointer" style="flex:1 1 200px"><input type="radio" name="puMode" value="unit" class="form-check-input me-2"' +
        (mode === 'indent' ? '' : ' checked') + ' onchange="aturModePindah(\'' + escJs(id) + '\')"><b>Pindah ke unit lain</b>' +
        '<div class="text-muted-2" style="font-size:.76rem">Konsumen tetap aktif di Data Konsumen</div></label>' +
      '<label class="card-flat p-2 px-3 cursor-pointer" style="flex:1 1 200px"><input type="radio" name="puMode" value="indent" class="form-check-input me-2"' +
        (mode === 'indent' ? ' checked' : '') + ' onchange="aturModePindah(\'' + escJs(id) + '\')"><b>Pindahkan ke daftar indent</b>' +
        '<div class="text-muted-2" style="font-size:.76rem">Unit dilepas, konsumen masuk antrean indent</div></label>' +
    '</div>' +
    htmlPindahKeIndent(t) +
    '<div id="puUnitBox">' +
    '<div class="row g-3">' +
      '<div class="col-md-5"><label class="form-label">Proyek Tujuan</label>' +
        '<select class="form-select" id="puProyek" onchange="isiUnitPindah()">' +
        App.proyek.map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === t.idProyek ? ' selected' : '') + '>' + esc(p.nama) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-md-7"><label class="form-label">Unit Tujuan (hanya yang Tersedia)</label>' +
        '<select class="form-select" id="puKavling" onchange="infoHargaPindah(' + (t.harga || 0) + ')"></select></div>' +
    '</div>' +
    '<label class="form-label mt-3">Nilai Transaksi Setelah Pindah</label>' +
    '<div class="d-flex gap-2 flex-wrap mb-1">' +
      '<label class="card-flat p-2 px-3 cursor-pointer"><input type="radio" name="puHarga" value="ikut" class="form-check-input me-2" checked onchange="infoHargaPindah(' + (t.harga || 0) + ')">Pakai harga unit baru</label>' +
      '<label class="card-flat p-2 px-3 cursor-pointer"><input type="radio" name="puHarga" value="tetap" class="form-check-input me-2" onchange="infoHargaPindah(' + (t.harga || 0) + ')">Tetap ' + rp(t.harga) + '</label>' +
    '</div>' +
    '<div class="text-muted-2 mb-3" id="puInfo" style="font-size:.8rem"></div>' +
    '<label class="form-label">Alasan Pindah</label>' +
    '<input class="form-control" id="puAlasan" maxlength="200" placeholder="Contoh: konsumen ingin unit hook / dekat taman">' +
    '<div class="alert mt-3 mb-0" style="background:var(--info-bg);border:none;color:var(--primary);font-size:.82rem">' +
      '<i class="bi bi-info-circle"></i> Unit lama otomatis kembali <b>Tersedia</b>, unit baru mengikuti status unit lama. ' +
      'Data konsumen, dokumen, berkas KPR, dan hasil Cek ID BI tetap melekat. Riwayat pindah tercatat di Catatan &amp; pemberitahuan.</div>' +
    '</div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnPindah" onclick="simpanPindahUnit(\'' + escJs(id) + '\')"><i class="bi bi-arrow-left-right"></i> Pindahkan</button>' +
    '<button class="btn btn-gold hidden" id="btnPindahIndent" onclick="simpanPindahKeIndent(\'' + escJs(id) + '\')"><i class="bi bi-hourglass-split"></i> Pindahkan ke Indent</button>',   // v5.2
    'modal-md');
  isiUnitPindah();
  aturModePindah(id);                                                    // v5.2
}

function isiUnitPindah() {
  const idp = document.getElementById('puProyek').value;
  const daftar = App.kavling.filter(function (k) { return k.idProyek === idp && k.status === 'Tersedia'; })
    .sort(function (a, b) {
      if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok));
      return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
    });
  const sel = document.getElementById('puKavling');
  sel.innerHTML = daftar.length
    ? daftar.map(function (k) {
        return '<option value="' + esc(k.id) + '" data-harga="' + (k.harga || 0) + '">Blok ' + esc(k.blok) + ' No. ' + esc(k.nomor) +
          (k.tipe ? ' • Tipe ' + esc(k.tipe) : '') + ' • ' + rp(k.harga) + '</option>';
      }).join('')
    : '<option value="">— Tidak ada unit tersedia di proyek ini —</option>';
  infoHargaPindah(null);
}

function infoHargaPindah(hargaLama) {
  const sel = document.getElementById('puKavling');
  const box = document.getElementById('puInfo');
  if (!sel || !box) return;
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) { box.innerHTML = ''; return; }
  const ikut = (document.querySelector('input[name="puHarga"]:checked') || {}).value !== 'tetap';
  box.innerHTML = ikut
    ? '<i class="bi bi-calculator"></i> Nilai transaksi menjadi <b>' + rp(Number(opt.dataset.harga) || 0) + '</b> (harga unit tujuan).'
    : '<i class="bi bi-lock"></i> Nilai transaksi tidak berubah.';
}

function simpanPindahUnit(id) {
  const idKav = document.getElementById('puKavling').value;
  if (!idKav) { showToast('Unit Belum Dipilih', 'Pilih unit tujuan yang masih tersedia.', 'warning'); return; }
  const opsi = {
    harga: (document.querySelector('input[name="puHarga"]:checked') || {}).value || 'ikut',
    alasan: document.getElementById('puAlasan').value
  };
  const btn = document.getElementById('btnPindah');
  tombolLoading(btn, true);
  call('pindahUnitTransaksi', App.token, id, idKav, opsi).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-arrow-left-right"></i> Pindahkan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    closeModal();
    showToast('Berhasil', res.message, 'success');
    const p = App.proyek.find(function (x) { return x.id === res.data.idProyek; });
    if (p && App.appPage === 'dataKonsumen') App.proyekAktif = p;
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-arrow-left-right"></i> Pindahkan');
    showToast('Error', err.message, 'danger');
  });
}


// ════════ BAGIAN 24 — LONCENG PEMBERITAHUAN (v4.6) ════════

const NTF = { versi: '', daftar: [], belum: 0, idTerbaru: '', siap: false, sibuk: false, terakhir: 0 };
const NTF_JEDA = 20000;                                   // v5.2.1 — perubahan dari pengguna lain lebih cepat tampil (dulu 45 dtk)
const NTF_IKON = {
  baru: ['person-plus-fill', 'var(--success)'], ubah: ['pencil-square', 'var(--primary)'],
  hapus: ['trash3', 'var(--danger)'], pindah: ['arrow-left-right', 'var(--accent)'],
  dokumen: ['file-earmark-arrow-up', 'var(--primary)'], berkas: ['folder-check', 'var(--primary)'],
  akad: ['calendar-check', 'var(--accent)'], bi: ['shield-check', 'var(--success)'],
  indent: ['hourglass-split', 'var(--accent)'], tagihan: ['cash-coin', 'var(--success)']
};
NTF_IKON.kwitansi = ['receipt-cutoff', 'var(--success)'];     // v4.9 — kwitansi dari SiKeu

function waktuRelatif(s) {
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(s || '');
  const dt = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (dt < 60) return 'baru saja';
  if (dt < 3600) return Math.floor(dt / 60) + ' menit lalu';
  if (dt < 86400) return Math.floor(dt / 3600) + ' jam lalu';
  if (dt < 7 * 86400) return Math.floor(dt / 86400) + ' hari lalu';
  return tglIndo(s);
}

function resetNotif() {
  NTF.versi = ''; NTF.daftar = []; NTF.belum = 0; NTF.idTerbaru = ''; NTF.siap = false; NTF.terakhir = 0; NTF.token = null; NTF.sibuk = false;
  pasangBadgeNotif();
  const panel = document.getElementById('notifPanel');
  if (panel) panel.classList.add('hidden');
}

function pasangBadgeNotif() {
  const b = document.getElementById('notifBadge');
  if (!b) return;
  b.textContent = NTF.belum > 99 ? '99+' : NTF.belum;
  b.classList.toggle('hidden', !NTF.belum);
  const btn = document.getElementById('btnNotif');
  if (btn) btn.title = NTF.belum ? NTF.belum + ' pemberitahuan baru' : 'Pemberitahuan';
}

function cekNotif(diam) {
  if (!App.token || NTF.sibuk) return;
  NTF.sibuk = true;
  NTF.terakhir = Date.now();
  const tok = App.token;
  call('getNotifikasi', App.token, NTF.versi).then(function (res) {
    NTF.sibuk = false;
    if (tok !== App.token) return;                 // jawaban untuk sesi lama (sudah keluar)
    if (!res || !res.success || res.data.tidakBerubah) return;
    NTF.token = tok;
    const d = res.data;
    const lamaTerbaru = NTF.idTerbaru;
    NTF.versi = d.versi;
    NTF.daftar = d.daftar || [];
    NTF.belum = d.belumDibaca || 0;
    NTF.idTerbaru = NTF.daftar[0] ? NTF.daftar[0].id : '';
    pasangBadgeNotif();
    if (!document.getElementById('notifPanel').classList.contains('hidden')) renderPanelNotif();

    // Ada aktivitas baru dari pengguna lain sejak pemeriksaan sebelumnya
    if (NTF.siap && !diam && lamaTerbaru && NTF.idTerbaru !== lamaTerbaru) {
      const baru = [];
      for (let i = 0; i < NTF.daftar.length && NTF.daftar[i].id !== lamaTerbaru; i++) {
        if (!NTF.daftar[i].sendiri) baru.push(NTF.daftar[i]);
      }
      if (baru.length) {
        showToast(baru.length === 1 ? baru[0].judul : baru.length + ' Pemberitahuan Baru',
          baru.length === 1 ? baru[0].pesan : baru[0].judul + ' — ' + baru[0].pesan, 'info');
        goyangLonceng();
        // Segarkan data tabel — kecuali sedang mengisi formulir
        // v5.0: diambil di latar belakang; digambar ulang setelah formulir ditutup / pengguna berhenti menggulir
        muatWorkspace(false, true);
      }
    }
    NTF.siap = true;
  }).catch(function () { NTF.sibuk = false; });
}

function goyangLonceng() {
  const b = document.getElementById('btnNotif');
  if (!b) return;
  b.classList.remove('notif-goyang'); void b.offsetWidth; b.classList.add('notif-goyang');
}

function toggleNotif(ev) {
  if (ev) ev.stopPropagation();
  const panel = document.getElementById('notifPanel');
  const buka = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !buka);
  if (!buka) return;
  renderPanelNotif();
  cekNotif(true);
  if (NTF.belum) {
    call('tandaiNotifDibaca', App.token).then(function () {
      setTimeout(function () {
        NTF.belum = 0;
        NTF.daftar.forEach(function (n) { n.dibukaIni = n.baru; n.baru = false; });
        pasangBadgeNotif();
      }, 1200);
    }).catch(function () {});
  }
}

function renderPanelNotif() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  panel.innerHTML =
    '<div class="notif-head"><b>Pemberitahuan</b>' +
      '<span class="text-muted-2" style="font-size:.74rem">' +
        (App.sesi && App.sesi.role === 'Perbankan' ? 'Konsumen KPR' : 'Konsumen & perubahan data') + '</span></div>' +
    '<div class="notif-list">' +
      (NTF.daftar.length ? NTF.daftar.map(function (n) {
        const ik = NTF_IKON[n.jenis] || ['bell', 'var(--primary)'];
        return '<div class="notif-item' + (n.baru || n.dibukaIni ? ' belum' : '') + '" onclick="bukaNotif(\'' + escJs(n.id) + '\')">' +
          '<div class="notif-ic" style="color:' + ik[1] + '"><i class="bi bi-' + ik[0] + '"></i></div>' +
          '<div style="min-width:0;flex:1">' +
            '<div class="notif-judul">' + esc(n.judul) + '</div>' +
            '<div class="notif-pesan">' + esc(n.pesan) + '</div>' +
            '<div class="notif-meta">' + esc(waktuRelatif(n.waktu)) + ' · ' + esc(n.sendiri ? 'Anda' : n.oleh) + '</div>' +
          '</div></div>';
      }).join('') : emptyState('bell-slash', 'Belum ada pemberitahuan', 'Konsumen baru dan perubahan data akan muncul di sini.')) +
    '</div>';
}

function bukaNotif(id) {
  const n = NTF.daftar.find(function (x) { return x.id === id; });
  document.getElementById('notifPanel').classList.add('hidden');
  if (!n) return;
  if (n.jenis === 'indent') { if (App.sesi.role !== 'Perbankan') goApp('indent'); return; }
  if (n.jenis === 'kwitansi' && !n.idTransaksi) { goApp('indent'); return; }       // v4.9 — kwitansi indent
  if (n.jenis === 'berkasIndent') { goApp(App.sesi.role === 'Perbankan' ? 'indentBank' : 'indent'); return; }   // v4.9.3
  if (n.jenis === 'bayar' && App.sesi.role !== 'Perbankan' && App.transaksi.some(function (x) { return x.id === n.idTransaksi; })) {   // v5.1
    const pb = App.proyek.find(function (x) { return x.id === n.idProyek; });
    if (pb) { App.proyekAktif = pb; goApp('dataKonsumen'); }
    setTimeout(function () { kelolaPembayaran(n.idTransaksi); }, 350);
    return;
  }
  const p = App.proyek.find(function (x) { return x.id === n.idProyek; });
  const t = App.transaksi.find(function (x) { return x.id === n.idTransaksi; });
  if (p) { App.proyekAktif = p; goApp('dataKonsumen'); }
  if (t) setTimeout(function () { detailTransaksi(t.id); }, 350);
  else if (n.jenis !== 'hapus') showToast('Info', 'Data sedang dimuat ulang — coba buka kembali sebentar lagi.', 'info');
}

// Tutup panel saat klik di luar
document.addEventListener('click', function (e) {
  const panel = document.getElementById('notifPanel');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!e.target.closest('#notifPanel') && !e.target.closest('#btnNotif')) panel.classList.add('hidden');
});

// Penjadwal: ikut login/logout tanpa mengubah alur lama
(function () {
  let tokenTerakhir = null;
  setInterval(function () {
    if (App.token !== tokenTerakhir) {
      tokenTerakhir = App.token;
      resetNotif();
      if (App.token) setTimeout(function () { cekNotif(true); }, 2500);
      return;
    }
    if (!App.token || document.hidden) return;
    if (Date.now() - NTF.terakhir >= NTF_JEDA) cekNotif(false);
  }, 3000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && App.token && Date.now() - NTF.terakhir > 15000) cekNotif(false);
  });
})();


// ════════ BAGIAN 25 — FORM SERVICE & PPJB (v4.6) ════════

const NAMA_DOK = { service: 'Form Service', ppjb: 'PPJB', tagihan: 'Penagihan Biaya Akad' };
const dokTerakhir = { service: null, ppjb: null };

/** Terbilang bahasa Indonesia (hingga triliun). */
function terbilang(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  const s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function t(x) {
    if (x < 12) return s[x];
    if (x < 20) return t(x - 10) + ' belas';
    if (x < 100) return t(Math.floor(x / 10)) + ' puluh' + (x % 10 ? ' ' + t(x % 10) : '');
    if (x < 200) return 'seratus' + (x - 100 ? ' ' + t(x - 100) : '');
    if (x < 1000) return t(Math.floor(x / 100)) + ' ratus' + (x % 100 ? ' ' + t(x % 100) : '');
    if (x < 2000) return 'seribu' + (x - 1000 ? ' ' + t(x - 1000) : '');
    if (x < 1e6) return t(Math.floor(x / 1000)) + ' ribu' + (x % 1000 ? ' ' + t(x % 1000) : '');
    if (x < 1e9) return t(Math.floor(x / 1e6)) + ' juta' + (x % 1e6 ? ' ' + t(x % 1e6) : '');
    if (x < 1e12) return t(Math.floor(x / 1e9)) + ' miliar' + (x % 1e9 ? ' ' + t(x % 1e9) : '');
    return t(Math.floor(x / 1e12)) + ' triliun' + (x % 1e12 ? ' ' + t(x % 1e12) : '');
  }
  return n === 0 ? 'nol' : t(n).replace(/\s+/g, ' ').trim();
}

function tglPanjang(iso) {
  const d = iso ? new Date(String(iso).substring(0, 10) + 'T00:00:00') : new Date();
  if (isNaN(d.getTime())) return String(iso || '');
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return { hari: hari[d.getDay()], tgl: d.getDate() + ' ' + bulan[d.getMonth()] + ' ' + d.getFullYear() };
}

function isoHariIni() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Ganti {penanda} di isi dokumen dengan data konsumen. */
function isiPenanda(teks, d, ekstra) {
  const tg = tglPanjang(ekstra.tanggal);
  const metode = d.transaksi.metode === 'KPR'
    ? 'KPR' + (d.berkas.bank ? ' melalui ' + d.berkas.bank : '') + (d.berkas.plafon ? ' dengan plafon ' + rp(d.berkas.plafon) : '')
    : d.transaksi.metode === 'Tempo' ? 'Cash Bertahap (Tempo)' : d.transaksi.metode === 'Cash' ? 'Tunai (Cash Keras)' : (d.transaksi.metode || '-');
  const peta = {
    nama: d.konsumen.nama, nik: d.konsumen.nik, hp: d.konsumen.hp, email: d.konsumen.email || '-',
    pekerjaan: d.konsumen.pekerjaan || '-', alamat_pembeli: ekstra.alamat || '........................................',
    proyek: d.unit.proyek, alamat_proyek: d.unit.alamat + (d.unit.kota ? ', ' + d.unit.kota : ''), kota: ekstra.kota || d.unit.kota || '',
    blok: d.unit.blok, nomor: d.unit.nomor, tipe: d.unit.tipe, lt: d.unit.lt, lb: d.unit.lb,
    harga: rp(d.harga), harga_terbilang: terbilang(d.harga), metode: metode,
    bank: d.berkas.bank || '-', plafon: d.berkas.plafon ? rp(d.berkas.plafon) : '-',
    tanggal: tg.hari + ', ' + tg.tgl, tanggal_singkat: tg.tgl, nomor_dokumen: ekstra.nomor || '',
    perusahaan: d.kop.namaPerusahaan || '', alamat_perusahaan: d.kop.alamat || '',
    pihak1_nama: (d.desain.pihak1Nama || '').replace(/\{perusahaan\}/g, d.kop.namaPerusahaan || ''),
    pihak1_jabatan: (d.desain.pihak1Jabatan || '').replace(/\{perusahaan\}/g, d.kop.namaPerusahaan || ''),
    marketing: d.transaksi.marketing || '-', id_transaksi: d.transaksi.id,
    // v4.7 — penagihan biaya akad
    bank_proses: d.berkas.bankProses || d.berkas.bank || '-',
    dp: rp(Math.max((d.harga || 0) - (d.berkas.plafon || 0), 0)),
    jatuh_tempo: ekstra.jatuhTempo ? tglPanjang(ekstra.jatuhTempo).tgl : '-',
    total_tagihan: ekstra.total !== undefined ? rp(ekstra.total) : '-',
    total_terbilang: ekstra.total !== undefined ? terbilang(ekstra.total) : '-'
  };
  return String(teks || '').replace(/\{([a-z0-9_]+)\}/gi, function (m, k) {
    return Object.prototype.hasOwnProperty.call(peta, k) ? String(peta[k]) : m;
  });
}

function kopDokumen(d, warna, font, labelNo, nomor, tanggal) {
  const logo = d.kop.logoUrl
    ? '<img src="' + esc(d.kop.logoUrl) + '" style="width:54px;height:54px;object-fit:contain">'
    : '<div style="width:54px;height:54px;border-radius:10px;background:' + warna + ';color:#fff;display:grid;place-items:center;font-weight:700">' +
      esc((d.kop.namaPerusahaan || 'E').charAt(0)) + '</div>';
  return '<div class="spr-kop" style="border-color:' + warna + '">' +
    '<div style="display:flex;gap:.8rem;align-items:center">' + logo +
      '<div><div style="font-family:' + font + ';font-size:1.05rem;font-weight:700;color:' + warna + '">' + esc(d.kop.namaPerusahaan) + '</div>' +
      '<div style="font-size:.74rem;color:#6B5C60">' + esc(d.kop.alamat) + '</div>' +
      '<div style="font-size:.74rem;color:#6B5C60">Telp: ' + esc(d.kop.telepon) + ' • ' + esc(d.kop.email) + '</div></div>' +
    '</div>' +
    '<div style="text-align:right;font-size:.76rem">' +
      '<div style="font-weight:700;color:' + warna + '">' + labelNo + '</div><div>' + esc(nomor) + '</div>' +
      '<div style="margin-top:.3rem;color:#6B5C60">Tanggal: ' + esc(tanggal) + '</div></div>' +
  '</div>';
}

function htmlFormService(d, ekstra) {
  const x = d.desain;
  const font = x.font === 'inter' ? "'Inter',sans-serif" : "'Playfair Display',Georgia,serif";
  const warna = x.warna || '#7A1F3D';
  const tg = tglPanjang(ekstra.tanggal).tgl;
  const item = String(x.item || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  const baris = Math.min(Math.max(parseInt(x.barisKeluhan, 10) || 5, 1), 15);
  const kotak = '<span style="display:inline-block;width:13px;height:13px;border:1.5px solid #241A1E;border-radius:3px;margin-right:.45rem;vertical-align:-2px"></span>';
  const judulBag = function (t) { return '<div style="font-weight:700;color:' + warna + ';font-size:.78rem;letter-spacing:.06em;margin:1.1rem 0 .45rem">' + t + '</div>'; };

  return '<div class="spr-doc dok-doc" style="--primary:' + warna + '">' +
    kopDokumen(d, warna, font, 'No. Service', ekstra.nomor, tg) +
    '<div style="text-align:center;margin:1.3rem 0 .2rem">' +
      '<div style="font-family:' + font + ';font-size:1.08rem;font-weight:700;letter-spacing:.03em">' + esc(x.judul) + '</div>' +
      '<div style="font-size:.78rem;color:#6B5C60">' + esc(x.sub) + '</div></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;background:#FBF6F7;padding:1rem;border-radius:12px;margin-top:1rem">' +
      '<div><div style="font-weight:700;color:' + warna + ';font-size:.78rem;letter-spacing:.06em;margin-bottom:.4rem">I. DATA PEMILIK</div>' +
        barisSPR('Nama', d.konsumen.nama) + barisSPR('No. HP', d.konsumen.hp) + barisSPR('Email', d.konsumen.email || '-') + '</div>' +
      '<div><div style="font-weight:700;color:' + warna + ';font-size:.78rem;letter-spacing:.06em;margin-bottom:.4rem">II. DATA UNIT</div>' +
        barisSPR('Proyek', d.unit.proyek) + barisSPR('Unit', 'Blok ' + d.unit.blok + ' No. ' + d.unit.nomor) +
        barisSPR('Tipe', d.unit.tipe) + '</div>' +
    '</div>' +
    '<p style="font-size:.82rem;margin:1rem 0 0;white-space:pre-line">' + esc(isiPenanda(x.pembuka, d, ekstra)) + '</p>' +
    judulBag('III. JENIS PERMINTAAN / KELUHAN') +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.35rem 1.2rem;font-size:.82rem">' +
      item.map(function (i) { return '<div>' + kotak + esc(i) + '</div>'; }).join('') + '</div>' +
    judulBag('IV. URAIAN KELUHAN') +
    Array.apply(null, Array(baris)).map(function () { return '<div style="border-bottom:1px dotted #9C8F93;height:1.6rem"></div>'; }).join('') +
    judulBag('V. DIISI OLEH PETUGAS') +
    '<table class="tbl-harga" style="font-size:.8rem"><tbody>' +
      '<tr><td style="width:40%">Tanggal Pengecekan</td><td>:</td></tr>' +
      '<tr><td>Tindakan Perbaikan</td><td>:</td></tr>' +
      '<tr><td>Tanggal Selesai</td><td>:</td></tr>' +
      '<tr><td>Status</td><td>' + kotak + 'Selesai &nbsp;&nbsp; ' + kotak + 'Dalam Proses &nbsp;&nbsp; ' + kotak + 'Di luar tanggungan</td></tr>' +
    '</tbody></table>' +
    (x.ketentuan ? '<div style="background:#F7F2F1;border-radius:12px;padding:.9rem;margin-top:1.1rem;font-size:.78rem;white-space:pre-line">' +
      '<b>Ketentuan:</b>\n' + esc(isiPenanda(x.ketentuan, d, ekstra)) + '</div>' : '') +
    '<div class="ttd-area">' +
      '<div style="flex:1"><div>Pemohon,<br><b>Pemilik Unit</b></div><div class="ttd-line">( ' + esc(d.konsumen.nama) + ' )</div></div>' +
      '<div style="flex:1"><div>Diterima Oleh,<br><b>' + esc(x.ttdPetugas || 'Petugas') + '</b></div><div class="ttd-line">( .................................. )</div></div>' +
      '<div style="flex:1"><div>Mengetahui,<br><b>' + esc(x.ttdMengetahui || 'Kepala Teknik') + '</b></div><div class="ttd-line">( .................................. )</div></div>' +
    '</div></div>';
}

function htmlPPJB(d, ekstra) {
  const x = d.desain;
  const font = x.font === 'inter' ? "'Inter',sans-serif" : "'Playfair Display',Georgia,serif";
  const warna = x.warna || '#7A1F3D';
  const tg = tglPanjang(ekstra.tanggal).tgl;
  const blokPasal = String(isiPenanda(x.isi, d, ekstra)).split(/\n\s*\n/).map(function (b) {
    const baris = b.split('\n');
    const judul = baris.shift();
    return '<div style="margin-top:.9rem;page-break-inside:avoid">' +
      '<div style="font-family:' + font + ';font-weight:700;text-align:center;color:' + warna + ';font-size:.88rem">' + esc(judul) + '</div>' +
      '<div style="text-align:justify;white-space:pre-line;font-size:.82rem;margin-top:.25rem">' + esc(baris.join('\n')) + '</div></div>';
  }).join('');
  const saksi = String(x.saksi || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);

  return '<div class="spr-doc dok-doc" style="--primary:' + warna + '">' +
    kopDokumen(d, warna, font, 'No. PPJB', ekstra.nomor, tg) +
    '<div style="text-align:center;margin:1.3rem 0 .2rem">' +
      '<div style="font-family:' + font + ';font-size:1.1rem;font-weight:700;letter-spacing:.03em">' + esc(x.judul) + '</div>' +
      '<div style="font-size:.78rem;color:#6B5C60">' + esc(x.sub) + '</div>' +
      '<div style="font-size:.78rem;margin-top:.2rem">Nomor: <b>' + esc(ekstra.nomor) + '</b></div></div>' +
    '<div style="text-align:justify;white-space:pre-line;font-size:.82rem;margin-top:1rem">' + esc(isiPenanda(x.pembuka, d, ekstra)) + '</div>' +
    blokPasal +
    '<div style="text-align:justify;white-space:pre-line;font-size:.82rem;margin-top:1rem">' + esc(isiPenanda(x.penutup, d, ekstra)) + '</div>' +
    '<div style="text-align:right;font-size:.82rem;margin-top:1.2rem">' + esc((ekstra.kota || x.kota || '') + ', ' + tg) + '</div>' +
    '<div class="ttd-area">' +
      '<div style="flex:1"><div><b>PIHAK PERTAMA</b><br>Penjual</div>' +
        '<div class="ttd-line">( ' + esc(isiPenanda(x.pihak1Nama, d, ekstra)) + ' )</div></div>' +
      '<div style="flex:1"><div><b>PIHAK KEDUA</b><br>Pembeli</div>' +
        '<div style="font-size:.66rem;color:#9C8F93;margin-top:1.1rem">Meterai</div>' +
        '<div class="ttd-line" style="margin-top:1rem">( ' + esc(d.konsumen.nama) + ' )</div></div>' +
    '</div>' +
    (saksi.length ? '<div class="ttd-area" style="margin-top:1.4rem">' + saksi.map(function (sk) {
      return '<div style="flex:1"><div>' + esc(sk) + '</div><div class="ttd-line">( .................................. )</div></div>';
    }).join('') + '</div>' : '') +
  '</div>';
}

/** Halaman Form Service / PPJB (Marketing & Owner). */
function renderHalamanDokumen(jenis) {
  const el = document.getElementById('app-' + (jenis === 'ppjb' ? 'ppjb' : 'formService'));
  const nama = NAMA_DOK[jenis];
  const konsumen = (App.transaksi || []).slice().sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama)); });
  const nmP = function (id) { return (App.proyek.find(function (p) { return p.id === id; }) || {}).nama || ''; };
  const d = (App.dokumenDesain || {})[jenis] || {};
  el.innerHTML =
    '<div class="row g-3">' +
      '<div class="col-lg-8">' +
        '<div class="card-lux p-3 mb-3">' +
          '<label class="form-label">Pilih Konsumen</label>' +
          '<div class="row g-2">' +
            '<div class="col-md-7"><select class="form-select" id="dokPilih_' + jenis + '" onchange="cariDokumen(\'' + jenis + '\', this.value)">' +
              '<option value="">— Pilih nama konsumen —</option>' +
              konsumen.map(function (t) {
                return '<option value="' + esc(t.id) + '">' + esc(t.nama + ' — ' + nmP(t.idProyek) + ' • Blok ' + t.blok + '-' + t.nomor) + '</option>';
              }).join('') + '</select></div>' +
            '<div class="col-md-5"><div class="input-group">' +
              '<input class="form-control" id="dokNik_' + jenis + '" maxlength="16" placeholder="atau ketik NIK">' +
              '<button class="btn btn-brand" id="btnDok_' + jenis + '" onclick="cariDokumen(\'' + jenis + '\')"><i class="bi bi-search"></i></button>' +
            '</div></div>' +
          '</div>' +
          '<div class="row g-2 mt-1">' +
            '<div class="col-md-4"><label class="form-label">Nomor ' + nama + '</label><input class="form-control" id="dokNo_' + jenis + '" oninput="gambarDokumen(\'' + jenis + '\')"></div>' +
            '<div class="col-md-4"><label class="form-label">Tanggal</label><input type="date" class="form-control" id="dokTgl_' + jenis + '" value="' + isoHariIni() + '" onchange="gambarDokumen(\'' + jenis + '\')"></div>' +
            (jenis === 'ppjb'
              ? '<div class="col-md-4"><label class="form-label">Kota Penandatanganan</label><input class="form-control" id="dokKota_ppjb" value="' + esc(d.kota || '') + '" oninput="gambarDokumen(\'ppjb\')"></div>' +
                '<div class="col-12"><label class="form-label">Alamat Pembeli <span class="text-muted-2" style="font-weight:400">(sesuai KTP)</span></label>' +
                '<input class="form-control" id="dokAlamat_ppjb" oninput="gambarDokumen(\'ppjb\')" placeholder="Jl. …, RT/RW, Kel., Kec., Kota"></div>'
              : '') +
          '</div>' +
        '</div>' +
        '<div id="dokArea_' + jenis + '">' + emptyState(jenis === 'ppjb' ? 'file-earmark-ruled' : 'tools', 'Belum ada ' + nama + ' ditampilkan',
          'Pilih konsumen — ' + nama + ' terisi otomatis dari data transaksi.') + '</div>' +
      '</div>' +
      '<div class="col-lg-4">' +
        '<div class="card-lux p-3 mb-3">' +
          '<h6 class="font-head mb-2">Aksi Dokumen</h6>' +
          '<p class="text-muted-2" style="font-size:.82rem">Unduh sebagai PDF atau cetak langsung. Isi &amp; desain diatur di <b>Pengaturan → Desain Service, PPJB &amp; Tagihan</b>.</p>' +
          '<button class="btn btn-brand w-100 mb-2" onclick="cetakDokumen(\'' + jenis + '\')"><i class="bi bi-download"></i> Unduh / Simpan PDF</button>' +
          '<button class="btn btn-outline-gold w-100 mb-2" onclick="cetakDokumen(\'' + jenis + '\')"><i class="bi bi-printer"></i> Cetak Dokumen</button>' +
          '<button class="btn btn-ghost w-100" onclick="goApp(\'desainDokumen\')"><i class="bi bi-palette"></i> Atur Isi &amp; Desain</button>' +
        '</div>' +
        '<div class="card-lux p-3" id="dokStatus_' + jenis + '"><h6 class="font-head mb-2">Data Transaksi</h6>' +
          '<div class="text-muted-2" style="font-size:.84rem">Belum ada data.</div></div>' +
      '</div>' +
    '</div>';
}

function cariDokumen(jenis, idTrx) {
  const kunci = idTrx || document.getElementById('dokNik_' + jenis).value.trim();
  if (!kunci) { showToast('Konsumen Kosong', 'Pilih konsumen atau ketik NIK.', 'warning'); return; }
  const btn = document.getElementById('btnDok_' + jenis);
  tombolLoading(btn, true);
  call('getDataDokumen', App.token, kunci, jenis).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-search"></i>');
    if (!res.success) { showToast('Tidak Ditemukan', res.message, 'warning'); return; }
    dokTerakhir[jenis] = res.data;
    const t = res.data.transaksi;
    const nomor = (jenis === 'ppjb' ? 'PPJB/' : 'SRV/') + isoHariIni().substring(0, 7).replace('-', '/') + '/' + String(t.id).replace('TRX-', '');
    document.getElementById('dokNo_' + jenis).value = nomor;
    document.getElementById('dokNik_' + jenis).value = res.data.konsumen.nik || '';
    const sel = document.getElementById('dokPilih_' + jenis);
    if (sel) sel.value = t.id;
    document.getElementById('dokStatus_' + jenis).innerHTML =
      '<h6 class="font-head mb-2">Data Transaksi</h6>' +
      '<div class="card-flat p-2" style="background:var(--surface)">' +
        [['Transaksi', t.id], ['Metode', t.metode], ['Marketing', t.marketing || '-'],
         ['Nilai', rp(res.data.harga)]].concat(res.data.berkas.bank ? [['Bank', res.data.berkas.bank]] : []).map(function (r) {
          return '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">' + r[0] + '</span><b>' + esc(r[1]) + '</b></div>';
        }).join('') +
        '<div class="d-flex justify-content-between py-1" style="font-size:.84rem"><span class="text-muted-2">Status</span>' +
          '<span class="chip ' + chipStatus(t.status) + '">' + esc(t.status) + '</span></div>' +
      '</div>';
    gambarDokumen(jenis);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-search"></i>');
    showToast('Error', err.message, 'danger');
  });
}

function ekstraDokumen(jenis) {
  return {
    nomor: (document.getElementById('dokNo_' + jenis) || {}).value || '',
    tanggal: (document.getElementById('dokTgl_' + jenis) || {}).value || isoHariIni(),
    kota: (document.getElementById('dokKota_' + jenis) || {}).value || '',
    alamat: (document.getElementById('dokAlamat_' + jenis) || {}).value || ''
  };
}

function gambarDokumen(jenis) {
  const d = dokTerakhir[jenis];
  if (!d) return;
  const box = document.getElementById('dokArea_' + jenis);
  box.innerHTML = jenis === 'ppjb' ? htmlPPJB(d, ekstraDokumen(jenis)) : htmlFormService(d, ekstraDokumen(jenis));
}

function cetakDokumen(jenis) {
  const d = dokTerakhir[jenis];
  if (!d) { showToast('Belum Ada Dokumen', 'Pilih konsumen terlebih dahulu.', 'warning'); return; }
  const isi = document.getElementById('dokArea_' + jenis).innerHTML;
  cetakHtml('<html><head><meta charset="utf-8"><title>' + NAMA_DOK[jenis] + ' — ' + esc(d.konsumen.nama) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    '<style>body{font-family:Inter,sans-serif;margin:0;padding:24px;color:#241A1E;font-size:13px}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.spr-doc{padding:0}.spr-kop{display:flex;justify-content:space-between;gap:1rem;border-bottom:2px solid #7A1F3D;padding-bottom:.9rem}' +
    'table{width:100%;border-collapse:collapse}.tbl-harga th{color:#fff;text-align:left;padding:.55rem .8rem;font-size:.8rem}' +
    '.tbl-harga td{padding:.5rem .8rem;border-bottom:1px solid #EDE5E6}' +
    '.ttd-area{display:flex;justify-content:space-between;gap:1rem;margin-top:2.4rem;text-align:center;font-size:.8rem}' +
    '.ttd-line{border-top:1px solid #241A1E;margin-top:3rem;padding-top:.3rem}' +
    '@page{margin:14mm}</style></head><body>' + isi + '</body></html>');
}

// ── Pengaturan: Desain Form Service & PPJB ──

const CONTOH_DOK = {
  konsumen: { nama: 'Budi Santoso, S.T.', nik: '3271045208800003', hp: '0812-9876-5432', email: 'budi@email.com', pekerjaan: 'Karyawan Swasta' },
  unit: { proyek: 'Elevia Residence', alamat: 'Jl. Arteri Supadio', kota: 'Kubu Raya', tipe: '36/72', blok: 'A', nomor: '12', lt: 72, lb: 36 },
  harga: 235000000,
  transaksi: { id: 'TRX-CONTOH', metode: 'KPR', marketing: 'Marketing', status: 'Proses KPR' },
  berkas: { bank: 'BTN', plafon: 211500000 }
};

function renderDesainDokumen() {
  const el = document.getElementById('app-desainDokumen');
  App._dokTab = App._dokTab || 'service';
  const jenis = App._dokTab;
  const x = Object.assign({}, (App.dokumenDesain || {})[jenis] || {});
  // v4.8 — Rincian Biaya Akad memakai kunci sendiri (judulKop / warnaKop)
  if (jenis === 'tagihan') { x.judul = x.judulKop; x.warna = x.warnaKop; }
  const warna = [['#7A1F3D', 'Deep Maroon'], ['#C00000', 'Merah'], ['#C9A24B', 'Soft Gold'], ['#1B2A4A', 'Navy Klasik'], ['#262626', 'Hitam Arang'], ['#1B6B4A', 'Hijau Zamrud']];
  const kolom = function (id, label, nilai, baris, bantuan) {
    return '<label class="form-label mt-2">' + label + '</label>' +
      (baris ? '<textarea class="form-control" id="dd_' + id + '" rows="' + baris + '" oninput="pratinjauDesainDokumen()">' + esc(nilai || '') + '</textarea>'
             : '<input class="form-control" id="dd_' + id + '" value="' + esc(nilai || '') + '" oninput="pratinjauDesainDokumen()">') +
      (bantuan ? '<small class="text-muted-2 d-block">' + bantuan + '</small>' : '');
  };
  const penanda = '{nama} {nik} {pekerjaan} {alamat_pembeli} {proyek} {alamat_proyek} {blok} {nomor} {tipe} {lt} {lb} {harga} {harga_terbilang} {metode} {bank} {plafon} {tanggal} {perusahaan} {alamat_perusahaan} {pihak1_nama} {pihak1_jabatan} {marketing}';

  el.innerHTML =
    '<div class="d-flex gap-2 mb-3 flex-wrap">' +
      ['service', 'ppjb', 'tagihan'].map(function (j) {
        return '<span class="filter-chip' + (j === jenis ? ' active' : '') + '" onclick="App._dokTab=\'' + j + '\';renderDesainDokumen()">' +
          '<i class="bi bi-' + ({ ppjb: 'file-earmark-ruled', service: 'tools', tagihan: 'cash-coin' })[j] + '"></i> ' + NAMA_DOK[j] + '</span>';
      }).join('') +
    '</div>' +
    '<div class="row g-3">' +
      '<div class="col-lg-7">' +
        '<div class="card-lux p-3 p-md-4 mb-3">' +
          '<h5 class="mb-1">Judul &amp; Tampilan</h5>' +
          '<p class="text-muted-2" style="font-size:.82rem">' + (jenis === 'tagihan'
            ? 'Baris kop pertama memakai nama perusahaan dari <a href="javascript:void(0)" onclick="goApp(\'desainSpr\')">Desain SPR</a>; warna aksen = warna kop.'
            : 'Kop surat, logo, dan identitas perusahaan mengikuti <a href="javascript:void(0)" onclick="goApp(\'desainSpr\')">Desain SPR</a>.') + '</p>' +
          kolom('judul', jenis === 'tagihan' ? 'Judul Kop' : 'Judul Dokumen', x.judul) + (jenis === 'tagihan' ? '' : kolom('sub', 'Sub Judul', x.sub)) +
          '<label class="form-label mt-3">Warna Aksen</label>' +
          '<div class="d-flex gap-2 flex-wrap" id="ddWarna">' + warna.map(function (w) {
            const aktif = String(x.warna || '').toLowerCase() === w[0].toLowerCase();
            return '<span class="filter-chip' + (aktif ? ' active' : '') + '" data-w="' + w[0] + '" onclick="pilihWarnaDok(\'' + w[0] + '\')">' +
              '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + w[0] + ';margin-right:.35rem;vertical-align:-1px"></span>' + w[1] + '</span>';
          }).join('') + '</div>' +
          '<input type="hidden" id="dd_warna" value="' + esc(x.warna || '#7A1F3D') + '">' +
          '<label class="form-label mt-3">Tipografi</label>' +
          '<select class="form-select" id="dd_font" onchange="pratinjauDesainDokumen()">' +
            '<option value="playfair"' + (x.font !== 'inter' ? ' selected' : '') + '>Playfair Display &amp; Inter (elegan formal)</option>' +
            '<option value="inter"' + (x.font === 'inter' ? ' selected' : '') + '>Inter Sans-Serif (modern)</option></select>' +
        '</div>' +
        '<div class="card-lux p-3 p-md-4 mb-3">' +
          '<h5 class="mb-1">Isi Dokumen</h5>' +
          (jenis === 'tagihan'
            ? '<p class="text-muted-2" style="font-size:.8rem">Tulis satu uraian per baris. Pada baris DP, akhiri dengan <b>|+</b> (menambah) atau <b>|-</b> (mengurangi kekurangan DP). Nominal tidak diisi di sini — admin mengisinya manual di setiap tagihan.</p>'
            : '<p class="text-muted-2" style="font-size:.8rem">Penanda di dalam kurung kurawal otomatis diganti data konsumen: <span class="mono" style="font-size:.74rem">' + esc(penanda) + '</span></p>') +
          (jenis === 'tagihan'
            ? kolom('barisDp', 'Baris Kekurangan DP (satu per baris)', x.barisDp, 7,
                'Format: <b>LABEL|+</b> (menambah) atau <b>LABEL|-</b> (mengurangi). Nominal SELALU diisi manual oleh admin per konsumen.') +
              kolom('barisAkad', 'Baris Biaya Akad (satu per baris)', x.barisAkad, 5, 'Nominal diisi manual oleh admin per konsumen.') +
              '<div class="row g-2"><div class="col-md-6">' + kolom('labelTotalDp', 'Label Total DP', x.labelTotalDp) + '</div>' +
              '<div class="col-md-6">' + kolom('labelTotalAkad', 'Label Total Akad', x.labelTotalAkad) + '</div>' +
              '<div class="col-md-6">' + kolom('labelTotalSemua', 'Label Total Keseluruhan', x.labelTotalSemua) + '</div>' +
              '<div class="col-md-6">' + kolom('labelTerbayar', 'Label Terbayar', x.labelTerbayar) + '</div>' +
              '<div class="col-md-6">' + kolom('labelSisa', 'Label Sisa Pembayaran', x.labelSisa) + '</div>' +
              '<div class="col-md-6">' + kolom('labelSetor', 'Label Dana Disetor', x.labelSetor) + '</div></div>' +
              kolom('rekening', 'Rekening Penerima', x.rekening) +
              kolom('catatanKaki', 'Note (di bawah tabel)', x.catatanKaki, 3)
            : jenis === 'service'
            ? kolom('pembuka', 'Kalimat Pembuka', x.pembuka, 3) +
              kolom('item', 'Pilihan Jenis Keluhan (satu per baris)', x.item, 7, 'Tercetak sebagai kotak centang.') +
              kolom('barisKeluhan', 'Jumlah Baris Uraian Keluhan', x.barisKeluhan) +
              kolom('ketentuan', 'Ketentuan Service', x.ketentuan, 5) +
              '<div class="row g-2"><div class="col-md-6">' + kolom('ttdPetugas', 'Tanda Tangan — Penerima', x.ttdPetugas) + '</div>' +
              '<div class="col-md-6">' + kolom('ttdMengetahui', 'Tanda Tangan — Mengetahui', x.ttdMengetahui) + '</div></div>'
            : '<div class="row g-2"><div class="col-md-6">' + kolom('pihak1Nama', 'Nama Pihak Pertama (Penjual)', x.pihak1Nama) + '</div>' +
              '<div class="col-md-6">' + kolom('pihak1Jabatan', 'Jabatan Pihak Pertama', x.pihak1Jabatan) + '</div></div>' +
              kolom('kota', 'Kota Penandatanganan (bawaan)', x.kota) +
              kolom('pembuka', 'Pembukaan & Identitas Para Pihak', x.pembuka, 8) +
              kolom('isi', 'Pasal-Pasal', x.isi, 16, 'Pisahkan setiap pasal dengan satu baris kosong. Baris pertama tiap pasal menjadi judulnya.') +
              kolom('penutup', 'Penutup', x.penutup, 3) +
              kolom('saksi', 'Saksi (satu per baris, kosongkan bila tidak perlu)', x.saksi, 2)) +
        '</div>' +
        '<div class="d-flex gap-2 flex-wrap">' +
          '<button class="btn btn-brand" id="btnDd" onclick="simpanDesainDokumenUi()"><i class="bi bi-save"></i> Simpan ' + NAMA_DOK[jenis] + '</button>' +
          '<button class="btn btn-ghost" onclick="resetDesainDokumenUi()"><i class="bi bi-arrow-counterclockwise"></i> Kembalikan Isi Bawaan</button>' +
        '</div>' +
      '</div>' +
      '<div class="col-lg-5"><div class="card-lux p-3 position-sticky" style="top:90px">' +
        '<div class="d-flex justify-content-between align-items-center mb-2"><span class="sect-label">Pratinjau ' + NAMA_DOK[jenis] + '</span>' +
        '<span class="chip chip-gold">Live Render</span></div>' +
        '<div id="ddPreview" style="max-height:78vh;overflow:auto"></div></div></div>' +
    '</div>';
  pratinjauDesainDokumen();
}

function pilihWarnaDok(w) {
  document.getElementById('dd_warna').value = w;
  document.querySelectorAll('#ddWarna .filter-chip').forEach(function (c) { c.classList.toggle('active', c.dataset.w === w); });
  pratinjauDesainDokumen();
}

function dataDesainDokumenDariForm() {
  const jenis = App._dokTab;
  if (jenis === 'tagihan') {
    const o = {
      judulKop: (document.getElementById('dd_judul') || {}).value || '',
      warnaKop: (document.getElementById('dd_warna') || {}).value || '#C00000',
      font: (document.getElementById('dd_font') || {}).value || 'inter'
    };
    ['barisDp', 'barisAkad', 'labelTotalDp', 'labelTotalAkad', 'labelTotalSemua', 'labelTerbayar', 'labelSisa', 'labelSetor', 'rekening', 'catatanKaki']
      .forEach(function (k) { const el = document.getElementById('dd_' + k); if (el) o[k] = el.value; });
    return o;
  }
  const kunci = jenis === 'tagihan'
    ? []
    : jenis === 'service'
    ? ['judul', 'sub', 'warna', 'font', 'pembuka', 'item', 'barisKeluhan', 'ketentuan', 'ttdPetugas', 'ttdMengetahui']
    : ['judul', 'sub', 'warna', 'font', 'kota', 'pihak1Nama', 'pihak1Jabatan', 'pembuka', 'isi', 'penutup', 'saksi'];
  const o = {};
  kunci.forEach(function (k) { const el = document.getElementById('dd_' + k); if (el) o[k] = el.value; });
  return o;
}

function pratinjauDesainDokumen() {
  const box = document.getElementById('ddPreview');
  if (!box) return;
  const c = App.config || {};
  const d = JSON.parse(JSON.stringify(CONTOH_DOK));
  d.kop = { namaPerusahaan: c.sprNamaPerusahaan || (App.etalase || {}).namaPerusahaan || 'Nama Perusahaan', alamat: c.sprAlamat || '',
    telepon: c.sprTelepon || '', email: c.sprEmail || '', logoUrl: c.sprLogoUrl ? driveThumb(c.sprLogoUrl) : '' };
  d.desain = dataDesainDokumenDariForm();
  const ekstra = { nomor: ({ ppjb: 'PPJB/', service: 'SRV/', tagihan: 'TGH/' })[App._dokTab] + '2026/09/CONTOH', tanggal: isoHariIni(), kota: d.desain.kota || 'Kubu Raya', alamat: 'Jl. Contoh No. 1, Kubu Raya' };
  if (App._dokTab === 'tagihan') {
    // Contoh angka hanya untuk pratinjau — di formulir semua nominal diisi manual
    const contoh = [182000000, 8000000, 0, 176180000, 1000000, 4000000, 0, 2500000, 1480000, 200000];
    ekstra.baris = barisBawaanTagihan(d.desain).map(function (b, i) { b.nominal = contoh[i] || 0; return b; });
    ekstra.terbayar = 0; ekstra.tenor = '20 th / 240 bln'; ekstra.bank = 'BTN';
    ekstra.perumahan = 'ELEVIA RESIDENCE NO. 8';
    d.konsumen.nama = 'Florentina Putri';
  }
  box.innerHTML = '<div style="zoom:.6">' + (App._dokTab === 'ppjb' ? htmlPPJB(d, ekstra)
    : App._dokTab === 'tagihan' ? htmlTagihan(d, ekstra) : htmlFormService(d, ekstra)) + '</div>';
}

function driveThumb(url) {
  const m = String(url || '').match(/[-\w]{25,}/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w400' : url;
}

function simpanDesainDokumenUi() {
  const jenis = App._dokTab;
  const btn = document.getElementById('btnDd');
  tombolLoading(btn, true);
  call('simpanDesainDokumen', App.token, jenis, dataDesainDokumenDariForm()).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan ' + NAMA_DOK[jenis]);
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.dokumenDesain = res.data;
    showToast('Berhasil', res.message, 'success');
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan ' + NAMA_DOK[jenis]);
    showToast('Error', err.message, 'danger');
  });
}

function resetDesainDokumenUi() {
  const jenis = App._dokTab;
  konfirmasi('Kembalikan Isi Bawaan', 'Isi & desain ' + NAMA_DOK[jenis] + ' akan dikembalikan ke contoh bawaan. Lanjutkan?', function () {
    call('resetDesainDokumen', App.token, jenis).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      App.dokumenDesain = res.data;
      showToast('Berhasil', res.message, 'success');
      renderDesainDokumen();
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

// ════════ BAGIAN 26 — BANK PROSES & SP3K (v4.7, internal) ════════

function chipBankProses(t) {
  if (!t || t.metode !== 'KPR' || !t.berkas) return '';
  return '<div class="mt-1">' + (t.berkas.bankProses
    ? '<span class="chip chip-xs chip-soft" title="Berkas diproses ke bank ini (internal)"><i class="bi bi-bank"></i> ' + esc(t.berkas.bankProses) + '</span>'
    : '') + (t.berkas.sp3kLink
    ? ' <span class="chip chip-xs chip-ok cursor-pointer" title="Lihat dokumen SP3K" onclick="previewFile(\'' + escJs(t.berkas.sp3kLink) + '\',\'SP3K\')"><i class="bi bi-file-earmark-check"></i> SP3K</span>'
    : '') + '</div>';
}


// ════════ BAGIAN 27 — PENAGIHAN DP & BIAYA AKAD (v4.7) ════════

function tambahHari(iso, n) {
  const d = new Date(String(iso).substring(0, 10) + 'T00:00:00');
  d.setDate(d.getDate() + (n || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** v4.8 — baris bawaan dari desain ("LABEL|+" / "LABEL|-"). Nominal SELALU kosong — diisi manual admin. */
function barisBawaanTagihan(desain) {
  const ambil = function (teks, bagian) {
    return String(teks || '').split('\n').map(function (b) { return b.trim(); }).filter(Boolean).map(function (b) {
      const p = b.split('|');
      return { label: p[0].trim(), nominal: 0, bagian: bagian, tanda: bagian === 'dp' && (p[1] || '').trim() === '-' ? '-' : '+' };
    });
  };
  return ambil(desain.barisDp, 'dp').concat(ambil(desain.barisAkad, 'akad'));
}

function hitungRincianAkad(baris, terbayar) {
  let dp = 0, akad = 0;
  (baris || []).forEach(function (b) {
    const n = (b.tanda === '-' ? -1 : 1) * (Number(b.nominal) || 0);
    if (b.bagian === 'dp') dp += n; else akad += n;
  });
  return { dp: dp, akad: akad, semua: dp + akad, sisa: dp + akad - (Number(terbayar) || 0) };
}

function dataDokDariTransaksi(t, jenis) {
  const c = App.config || {};
  const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
  const k = App.kavling.find(function (x) { return x.id === t.idKavling; }) || {};
  return {
    konsumen: { nama: t.nama, nik: t.nik, hp: t.hp, email: t.email, pekerjaan: t.pekerjaan, perusahaan: t.perusahaan },
    unit: { proyek: p.nama || '-', alamat: p.alamat || '-', kota: p.kota || '', tipe: k.tipe || '-', blok: t.blok, nomor: t.nomor, lt: k.lt || '-', lb: k.lb || '-' },
    harga: t.harga || 0,
    transaksi: { id: t.id, tanggal: t.tanggal, metode: t.metode, marketing: t.marketing, status: t.status },
    berkas: { bank: t.berkas.bank, bankProses: t.berkas.bankProses, status: t.berkas.status, plafon: t.berkas.plafon, tanggalAkad: t.berkas.tanggalAkad },
    kop: { namaPerusahaan: c.sprNamaPerusahaan || (App.etalase || {}).namaPerusahaan || '', alamat: c.sprAlamat || '',
      telepon: c.sprTelepon || '', email: c.sprEmail || '', logoUrl: c.sprLogoUrl ? driveThumb(c.sprLogoUrl) : '' },
    desain: (App.dokumenDesain || {})[jenis] || {}
  };
}

/**
 * v4.8 — "Rincian Biaya Akad Kredit" mengikuti format perusahaan:
 * kop merah, identitas, kekurangan DP (+/−), biaya akad, total, terbayar, sisa, dana disetor, rekening, catatan.
 * @param ekstra { baris, terbayar, tenor, bank, perumahan }
 */
function htmlTagihan(d, ekstra) {
  const x = d.desain;
  const warna = x.warnaKop || '#C00000';
  const font = x.font === 'playfair' ? "'Playfair Display',Georgia,serif" : "'Inter',Arial,sans-serif";
  const baris = ekstra.baris || [];
  const h = hitungRincianAkad(baris, ekstra.terbayar);
  const nom = function (n) { return n ? angka(Math.abs(n)) : '-'; };
  const sel = 'padding:.22rem .5rem;font-size:.82rem;';
  const garis = 'border-left:1px solid #000;border-right:1px solid #000;';
  const baru = function (label, nilai, opsi) {
    opsi = opsi || {};
    const bg = opsi.bg ? 'background:' + opsi.bg + ';' : '';
    const warnaTeks = opsi.putih ? 'color:#fff;' : '';
    const tebal = opsi.tebal ? 'font-weight:700;' : '';
    return '<tr style="' + bg + warnaTeks + tebal + '">' +
      '<td style="' + sel + 'width:48%">' + esc(label) + '</td>' +
      '<td style="' + sel + 'width:4%;text-align:center">' + (opsi.tanpaTitik ? '' : ':') + '</td>' +
      '<td style="' + sel + 'width:14%;text-align:right;' + (opsi.bgNilai ? 'background:' + opsi.bgNilai + ';color:#fff;' : '') + '">' + (nilai === null ? '' : 'Rp') + '</td>' +
      '<td style="' + sel + 'width:28%;text-align:right;' + (opsi.bgNilai ? 'background:' + opsi.bgNilai + ';color:#fff;' : '') + (opsi.tebalNilai ? 'font-weight:700;' : '') + '">' +
        (nilai === null ? '' : nom(nilai)) + '</td>' +
      '<td style="' + sel + 'width:6%;text-align:left;font-weight:700">' + (opsi.tanda || '') + '</td></tr>';
  };
  const ident = function (label, nilai) {
    return '<tr><td style="' + sel + '">' + esc(label) + '</td><td style="' + sel + 'text-align:center">:</td>' +
      '<td colspan="3" style="' + sel + '">' + esc(nilai || '-') + '</td></tr>';
  };
  const kosong = '<tr><td colspan="5" style="height:.9rem"></td></tr>';
  const abu = '#7F7F7F';
  const dpRows = baris.filter(function (b) { return b.bagian === 'dp'; });
  const akadRows = baris.filter(function (b) { return b.bagian !== 'dp'; });
  const rek = esc(x.rekening || '').replace(/(\d[\d.\- ]{6,}\d)/g, '<span style="color:#1F5FBF">$1</span>');

  return '<div class="rba-doc" style="background:#fff;color:#000;font-family:' + font + ';max-width:760px;margin:0 auto">' +
    '<div style="border:1px solid #000">' +
      '<div style="background:' + warna + ';color:#fff;text-align:center;font-weight:700;padding:.5rem;font-family:Georgia,serif;letter-spacing:.02em">' +
        esc(String(d.kop.namaPerusahaan || '').toUpperCase()) + '</div>' +
      '<div style="background:' + warna + ';color:#fff;text-align:center;font-weight:700;padding:.5rem;border-top:1px solid #000;font-family:Georgia,serif">' +
        esc(x.judulKop || 'RINCIAN BIAYA AKAD KREDIT') + '</div>' +
    '</div>' +
    '<table style="width:100%;border-collapse:collapse;' + garis + 'border-bottom:1px solid #000">' +
      kosong +
      ident('NAMA', String(d.konsumen.nama || '').toUpperCase()) +
      ident('PERUMAHAN', ekstra.perumahan) +
      ident('BANK', ekstra.bank) +
      ident('TENOR', ekstra.tenor) +
      kosong +
      dpRows.map(function (b, i) {
        return baru(b.label, b.nominal, { tebalNilai: i < 2, tanda: b.tanda === '-' ? '-' : (i > 1 ? '+' : '') });
      }).join('') +
      baru(x.labelTotalDp || 'TOTAL KEKURANGAN DP', h.dp, { bg: abu, putih: true, tebal: true }) +
      kosong +
      akadRows.map(function (b) { return baru(b.label, b.nominal, {}); }).join('') +
      baru(x.labelTotalAkad || 'TOTAL BIAYA AKAD', h.akad, { bg: abu, putih: true, tebal: true, tanpaTitik: true }) +
      kosong +
      baru(x.labelTotalSemua || 'TOTAL KESELURUHAN BIAYA DP+AKAD', h.semua, { bg: abu, putih: true, tebal: true, tanpaTitik: true }) +
      baru(x.labelTerbayar || 'TERBAYAR', ekstra.terbayar || 0, { tebal: true, tanpaTitik: true }) +
      baru(x.labelSisa || 'SISA PEMBAYARAN', h.sisa, { tebal: true, tanpaTitik: true, bgNilai: warna }) +
      kosong +
      baru(x.labelSetor || 'DANA DI SETOR', h.sisa, { bg: '#FFC000', tebal: true, tanpaTitik: true }) +
      '<tr><td colspan="5" style="' + sel + 'font-weight:700;border-top:1px solid #000">' + rek + '</td></tr>' +
    '</table>' +
    (x.catatanKaki || ekstra.catatan
      ? '<div style="font-size:.8rem;margin-top:.4rem"><b>Note:</b><br>' + esc(x.catatanKaki || '') +
        (ekstra.catatan ? (x.catatanKaki ? '<br>' : '') + esc(ekstra.catatan) : '') + '</div>'
      : '') +
  '</div>';
}

function tagihanKonsumen(idTrx) {
  return (App.penagihan || []).find(function (g) { return g.idTransaksi === idTrx; });
}

function chipTagihan(g) {
  if (!g) return '<span class="chip chip-warn">Belum Ditagih</span>';
  return '<span class="chip ' + (g.status === 'Lunas' ? 'chip-ok' : g.status === 'Ditagih' ? 'chip-gold' : '') + '">' +
    (g.status === 'Lunas' ? 'Lunas' : g.status === 'Ditagih' ? 'Ditagih' : 'Draft') + '</span>';
}

function renderPenagihan() {
  const el = document.getElementById('app-penagihan');
  const kandidat = App.transaksi.filter(function (t) {
    return t.metode === 'KPR' && ['SP3K', 'Jadwal Akad', 'Akad Selesai'].indexOf(t.berkas.status) >= 0;
  });
  const belum = kandidat.filter(function (t) { return !tagihanKonsumen(t.id); });
  const ditagih = (App.penagihan || []).filter(function (g) { return g.status === 'Ditagih'; });
  const lunas = (App.penagihan || []).filter(function (g) { return g.status === 'Lunas'; });
  const kpi = [
    { l: 'Siap Ditagih', v: belum.length, s: 'lolos SP3K, belum ada tagihan', i: 'hourglass-split', g: 'is-warn' },
    { l: 'Sudah Ditagih', v: ditagih.length, s: 'menunggu pembayaran', i: 'send-check', g: 'is-gold' },
    { l: 'Lunas', v: lunas.length, s: 'siap akad', i: 'check2-circle', g: 'is-ok' },
    { l: 'Nilai Belum Dibayar', v: rpSingkat(ditagih.reduce(function (a, g) { return a + (g.total || 0); }, 0)), s: 'total tagihan berjalan', i: 'cash-stack', g: 'is-brand' }
  ];
  el.innerHTML =
    '<p class="text-muted-2">Tagih uang muka (DP) &amp; biaya akad kepada konsumen KPR yang sudah <b>lolos SP3K</b>. ' +
    'Rincian biaya disesuaikan dengan dokumen SP3K dari bank. Isi &amp; desain surat diatur di <b>Pengaturan → Desain Service, PPJB &amp; Tagihan</b>.</p>' +
    '<div class="row g-2 g-md-3 mb-3">' + kpi.map(function (k) {
      return '<div class="col-6 col-lg-3"><div class="kpi-tile ' + k.g + '"><div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
        '<div style="min-width:0"><div class="kpi-lbl">' + esc(k.l) + '</div><div class="kpi-val">' + k.v + '</div>' +
        '<div class="kpi-sub">' + esc(k.s) + '</div></div></div></div>';
    }).join('') + '</div>' +
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:260px"><span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="tgCari" placeholder="Cari nama / NIK…" oninput="tundaCari(renderTabelPenagihan)"></div>' +
      '<select class="form-select" style="max-width:200px" id="tgProyek" onchange="renderTabelPenagihan()"><option value="">Semua Proyek</option>' +
        App.proyek.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.nama) + '</option>'; }).join('') + '</select>' +
      '<select class="form-select" style="max-width:180px" id="tgStatus" onchange="renderTabelPenagihan()">' +
        '<option value="">Semua Status</option><option value="belum">Belum Ditagih</option><option>Draft</option><option>Ditagih</option><option>Lunas</option></select>' +
    '</div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>Konsumen</th><th>Proyek &amp; Unit</th><th>Bank &amp; Plafon</th><th>SP3K</th><th>Tagihan</th><th class="text-end">Aksi</th>' +
    '</tr></thead><tbody id="tbodyTagihan"></tbody></table></div>';
  renderTabelPenagihan();
}

function renderTabelPenagihan() {
  const tbody = document.getElementById('tbodyTagihan');
  if (!tbody) return;
  const q = ((document.getElementById('tgCari') || {}).value || '').toLowerCase();
  const pr = (document.getElementById('tgProyek') || {}).value || '';
  const st = (document.getElementById('tgStatus') || {}).value || '';
  const list = App.transaksi.filter(function (t) {
    if (t.metode !== 'KPR') return false;
    const g = tagihanKonsumen(t.id);
    if (['SP3K', 'Jadwal Akad', 'Akad Selesai'].indexOf(t.berkas.status) < 0 && !g) return false;
    if (pr && t.idProyek !== pr) return false;
    if (st === 'belum' && g) return false;
    if (st && st !== 'belum' && (!g || g.status !== st)) return false;
    if (q && (t.nama + ' ' + t.nik).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) {
    const ga = tagihanKonsumen(a.id), gb = tagihanKonsumen(b.id);
    const ra = !ga ? 0 : ga.status === 'Ditagih' ? 1 : ga.status === 'Draft' ? 2 : 3;
    const rb = !gb ? 0 : gb.status === 'Ditagih' ? 1 : gb.status === 'Draft' ? 2 : 3;
    return ra - rb || String(a.nama).localeCompare(String(b.nama));
  });
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6">' + emptyState('cash-coin', 'Belum ada konsumen siap ditagih',
      'Konsumen KPR muncul di sini setelah Tim Perbankan mengubah status berkasnya menjadi SP3K.') + '</td></tr>';
    return;
  }
  isiBertahap(tbody, list.map(function (t) {   // v5.0 — bertahap
    const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
    const g = tagihanKonsumen(t.id);
    const id = escJs(t.id);
    return '<tr>' +
      '<td><b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.76rem">' + esc(t.hp || '') + '</div></td>' +
      '<td>' + esc(p.nama || '-') + '<div class="text-muted-2" style="font-size:.76rem">Blok ' + esc(t.blok) + ' No. ' + esc(t.nomor) + ' • ' + rpSingkat(t.harga) + '</div></td>' +
      '<td>' + (t.berkas.bankProses ? '<span class="chip chip-xs chip-soft"><i class="bi bi-bank"></i> ' + esc(t.berkas.bankProses) + '</span>' : '<span class="text-muted-2">—</span>') +
        '<div class="text-muted-2" style="font-size:.76rem">Plafon ' + (t.berkas.plafon ? rpSingkat(t.berkas.plafon) : '-') + '</div>' +
        '<span class="chip chip-xs ' + chipStatus(t.berkas.status) + '">' + esc(t.berkas.status) + '</span></td>' +
      '<td>' + (t.berkas.sp3kLink
        ? '<button class="btn btn-sm btn-ghost" onclick="previewFile(\'' + escJs(t.berkas.sp3kLink) + '\',\'SP3K\')"><i class="bi bi-file-earmark-check"></i> Lihat</button>'
        : '<span class="chip chip-xs chip-warn">Belum ada</span>') + '</td>' +
      '<td>' + chipTagihan(g) + (g ? '<div class="tabular" style="font-size:.82rem;margin-top:.2rem"><b>' + rp(g.total) + '</b></div>' +
        '<div class="text-muted-2" style="font-size:.72rem">Jatuh tempo ' + esc(g.jatuhTempo ? tglIndo(g.jatuhTempo) : '-') + '</div>' : '') + '</td>' +
      '<td class="text-end"><div class="d-flex gap-1 justify-content-end flex-wrap">' +
        (g ? '<button class="btn btn-sm btn-ghost" onclick="lihatTagihan(\'' + id + '\')" title="Lihat & cetak"><i class="bi bi-printer"></i></button>' : '') +
        (g && g.status !== 'Lunas' ? '<button class="btn btn-sm btn-ghost" style="color:var(--success)" onclick="tandaiLunasTagihan(\'' + id + '\')" title="Tandai lunas"><i class="bi bi-check2-circle"></i></button>' : '') +
        '<button class="btn btn-sm ' + (g ? 'btn-ghost' : 'btn-brand') + '" onclick="formPenagihan(\'' + id + '\')">' +
          (g ? '<i class="bi bi-pencil"></i>' : '<i class="bi bi-plus-lg"></i> Buat Tagihan') + '</button>' +
      '</div></td></tr>';
  }));
}

function formPenagihan(idTrx) {
  const t = App.transaksi.find(function (x) { return x.id === idTrx; });
  if (!t) return;
  const g = tagihanKonsumen(idTrx);
  const desain = (App.dokumenDesain || {}).tagihan || {};
  const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
  const hariIni = isoHariIni();
  // v4.8 — baris diambil dari desain, SEMUA nominal kosong (diisi manual admin)
  App._tgBaris = g && g.baris.length
    ? g.baris.map(function (b) { return { label: b.label, nominal: b.nominal, bagian: b.bagian, tanda: b.tanda }; })
    : barisBawaanTagihan(desain);
  delete fileBuffer.fileSp3kTagih;

  openModal((g ? 'Edit Rincian Biaya Akad — ' : 'Rincian Biaya Akad Kredit — ') + t.nama,
    '<div class="card-flat p-3 mb-3" style="background:var(--surface)">' +
      '<div class="d-flex flex-wrap justify-content-between gap-2">' +
        '<div><b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.8rem">' + esc(p.nama || '-') + ' • Blok ' + esc(t.blok) + ' No. ' + esc(t.nomor) + '</div></div>' +
        '<div class="text-end text-muted-2" style="font-size:.78rem"><i class="bi bi-info-circle"></i> Acuan: harga unit <b>' + rp(t.harga) + '</b>' +
          (t.berkas.plafon ? ' • plafon SP3K <b>' + rp(t.berkas.plafon) + '</b>' : '') + '<br>Semua nominal diisi manual sesuai SP3K &amp; kesepakatan.</div>' +
      '</div></div>' +
    '<div class="row g-3">' +
      '<div class="col-lg-4">' +
        '<label class="form-label">Perumahan</label>' +
        '<input class="form-control mb-2" id="tgPerumahan" maxlength="120" value="' + esc(g && g.perumahan ? g.perumahan : String((p.nama || '') + ' Blok ' + t.blok + ' No. ' + t.nomor).toUpperCase()) + '">' +
        '<div class="row g-2">' +
          '<div class="col-6"><label class="form-label">Bank</label><input class="form-control" id="tgBank" maxlength="60" value="' + esc(g && g.bank ? g.bank : (t.berkas.bankProses || t.berkas.bank || '')) + '"></div>' +
          '<div class="col-6"><label class="form-label">Tenor</label><input class="form-control" id="tgTenor" maxlength="40" placeholder="20 th / 240 bln" value="' + esc(g ? g.tenor : '') + '"></div>' +
        '</div>' +
        '<label class="form-label mt-3">Dokumen SP3K dari Bank</label>' +
        (t.berkas.sp3kLink ? '<button type="button" class="btn btn-sm btn-outline-brand w-100 mb-2" onclick="previewFile(\'' + escJs(t.berkas.sp3kLink) + '\',\'SP3K\')">' +
          '<i class="bi bi-eye"></i> Lihat SP3K (acuan biaya)</button>' : '') +
        '<div class="upload-box py-3" id="boxSp3kTagih" onclick="document.getElementById(\'fileSp3kTagih\').click()">' +
          '<i class="bi bi-file-earmark-arrow-up"></i><div style="font-size:.84rem">' + (t.berkas.sp3kLink ? 'Ganti dokumen SP3K' : 'Unggah SP3K (PDF / foto)') + '</div>' +
          '<small>Internal — tidak tampil ke konsumen</small></div>' +
        '<input type="file" id="fileSp3kTagih" class="hidden" accept="image/*,.pdf" onchange="tandaiFile(\'fileSp3kTagih\',\'boxSp3kTagih\')">' +
        '<div class="row g-2 mt-1">' +
          '<div class="col-12"><label class="form-label">Nomor (internal)</label><input class="form-control" id="tgNomor" value="' +
            esc(g ? g.nomor : 'TGH/' + hariIni.substring(0, 7).replace('-', '/') + '/' + String(t.id).replace('TRX-', '')) + '"></div>' +
          '<div class="col-6"><label class="form-label">Tanggal</label><input type="date" class="form-control" id="tgTanggal" value="' +
            esc(g ? String(g.tanggal).substring(0, 10) : hariIni) + '"></div>' +
          '<div class="col-6"><label class="form-label">Batas Bayar</label><input type="date" class="form-control" id="tgJatuh" value="' +
            esc(g ? String(g.jatuhTempo || '').substring(0, 10) : '') + '"></div>' +
          '<div class="col-12"><label class="form-label">Status</label><select class="form-select" id="tgStatusIsi">' +
            ['Draft', 'Ditagih', 'Lunas'].map(function (o) {
              return '<option' + ((g ? g.status : 'Ditagih') === o ? ' selected' : '') + '>' + o + '</option>';
            }).join('') + '</select></div>' +
        '</div>' +
      '</div>' +
      '<div class="col-lg-8">' +
        '<div class="sect-label mb-2">A. Kekurangan Uang Muka (DP)</div>' +
        '<div id="tgBoxDp"></div>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="tambahBarisTagihan(\'dp\')"><i class="bi bi-plus-lg"></i> Tambah baris DP</button>' +
        '<div class="sect-label mb-2 mt-3">B. Biaya Akad</div>' +
        '<div id="tgBoxAkad"></div>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="tambahBarisTagihan(\'akad\')"><i class="bi bi-plus-lg"></i> Tambah baris biaya akad</button>' +
        '<div class="row g-2 mt-2 align-items-end">' +
          '<div class="col-md-6"><label class="form-label">Terbayar (Rp)</label>' +
            '<input class="form-control tabular text-end" id="tgTerbayar" inputmode="numeric" placeholder="0" value="' + (g && g.terbayar ? angka(g.terbayar) : '') + '" ' +
            'oninput="formatRibuan(this);hitungTotalTagihan()"></div>' +
          (pembayaranKonsumen(idTrx).length                                // v5.1 — dari riwayat pembayaran
            ? '<div class="col-md-6"><button type="button" class="btn btn-sm btn-outline-brand w-100" onclick="pakaiTerbayarDariRiwayat(\'' + escJs(idTrx) + '\')">' +
              '<i class="bi bi-wallet2"></i> Isi dari riwayat pembayaran (' + pembayaranKonsumen(idTrx).length + ')</button></div>' : '') +
        '</div>' +
        '<div class="card-flat p-3 mt-2" style="background:var(--surface);font-size:.86rem" id="tgRingkas"></div>' +
        '<label class="form-label mt-3">Catatan Tambahan <span class="text-muted-2" style="font-weight:400">(opsional, ikut tercetak di bawah Note)</span></label>' +
        '<textarea class="form-control" id="tgCatatan" rows="2" maxlength="500">' + esc(g ? g.catatan : '') + '</textarea>' +
      '</div>' +
    '</div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    (g ? '<button class="btn btn-ghost" style="color:var(--danger)" onclick="hapusPenagihanUi(\'' + escJs(g.id) + '\')"><i class="bi bi-trash"></i></button>' : '') +
    '<button class="btn btn-brand" id="btnTg" onclick="simpanPenagihanUi(\'' + escJs(idTrx) + '\')"><i class="bi bi-save"></i> Simpan &amp; Lihat Rincian</button>',
    'modal-xl');
  renderRincianTagihan();
}

function renderRincianTagihan() {
  ['dp', 'akad'].forEach(function (bagian) {
    const box = document.getElementById(bagian === 'dp' ? 'tgBoxDp' : 'tgBoxAkad');
    if (!box) return;
    box.innerHTML = App._tgBaris.map(function (r, i) {
      if ((r.bagian === 'dp') !== (bagian === 'dp')) return '';
      return '<div class="d-flex gap-2 mb-2 align-items-center">' +
        '<input class="form-control" value="' + esc(r.label) + '" placeholder="Uraian" oninput="App._tgBaris[' + i + '].label=this.value">' +
        (bagian === 'dp'
          ? '<select class="form-select" style="max-width:118px" title="Menambah / mengurangi kekurangan DP" onchange="App._tgBaris[' + i + '].tanda=this.value;hitungTotalTagihan()">' +
              '<option value="+"' + (r.tanda !== '-' ? ' selected' : '') + '>+ Tambah</option>' +
              '<option value="-"' + (r.tanda === '-' ? ' selected' : '') + '>− Kurang</option></select>'
          : '') +
        '<div class="input-group" style="max-width:200px"><span class="input-group-text">Rp</span>' +
          '<input class="form-control tabular text-end" inputmode="numeric" value="' + (r.nominal ? angka(r.nominal) : '') + '" placeholder="0" ' +
          'oninput="formatRibuan(this);App._tgBaris[' + i + '].nominal=Number(this.value.replace(/[^0-9]/g,\'\'))||0;hitungTotalTagihan()"></div>' +
        '<button type="button" class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="hapusBarisTagihan(' + i + ')" title="Hapus baris"><i class="bi bi-x-lg"></i></button>' +
      '</div>';
    }).join('');
  });
  hitungTotalTagihan();
}

function hitungTotalTagihan() {
  const el = document.getElementById('tgRingkas');
  if (!el) return;
  const terbayar = Number(((document.getElementById('tgTerbayar') || {}).value || '').replace(/[^0-9]/g, '')) || 0;
  const h = hitungRincianAkad(App._tgBaris, terbayar);
  const d = (App.dokumenDesain || {}).tagihan || {};
  const baris = function (l, v, kuat) {
    return '<div class="d-flex justify-content-between py-1"' + (kuat ? ' style="font-weight:700"' : '') + '><span>' + esc(l) + '</span><span class="tabular">' + rp(v) + '</span></div>';
  };
  el.innerHTML = baris(d.labelTotalDp || 'Total Kekurangan DP', h.dp) + baris(d.labelTotalAkad || 'Total Biaya Akad', h.akad) +
    baris(d.labelTotalSemua || 'Total Keseluruhan', h.semua, true) + baris(d.labelTerbayar || 'Terbayar', terbayar) +
    '<div class="d-flex justify-content-between py-1 mt-1" style="border-top:1px solid var(--border);font-weight:700;color:var(--primary)">' +
      '<span>' + esc(d.labelSisa || 'Sisa Pembayaran') + '</span><span class="tabular" style="font-size:1.05rem">' + rp(h.sisa) + '</span></div>';
}
function tambahBarisTagihan(bagian) { App._tgBaris.push({ label: '', nominal: 0, bagian: bagian, tanda: '+' }); renderRincianTagihan(); }
function hapusBarisTagihan(i) { App._tgBaris.splice(i, 1); renderRincianTagihan(); }

function dataPenagihanDariForm() {
  return {
    nomor: document.getElementById('tgNomor').value,
    tanggal: document.getElementById('tgTanggal').value,
    jatuhTempo: document.getElementById('tgJatuh').value,
    status: document.getElementById('tgStatusIsi').value,
    catatan: document.getElementById('tgCatatan').value,
    perumahan: document.getElementById('tgPerumahan').value,
    bank: document.getElementById('tgBank').value,
    tenor: document.getElementById('tgTenor').value,
    terbayar: (document.getElementById('tgTerbayar').value || '').replace(/[^0-9]/g, ''),
    baris: App._tgBaris.filter(function (r) { return String(r.label || '').trim(); })
  };
}

function simpanPenagihanUi(idTrx) {
  const data = dataPenagihanDariForm();
  if (!data.baris.length) { showToast('Rincian Kosong', 'Isi minimal satu baris rincian biaya.', 'warning'); return; }
  if (!data.baris.some(function (b) { return b.nominal > 0; })) {
    showToast('Nominal Kosong', 'Isi nominal rincian biaya terlebih dahulu.', 'warning'); return;
  }
  const btn = document.getElementById('btnTg');
  tombolLoading(btn, true);
  const file = fileBuffer.fileSp3kTagih;
  const langkahSp3k = file
    ? call('unggahSP3K', App.token, idTrx, file).then(function (r) {
        delete fileBuffer.fileSp3kTagih;
        if (!r.success) showToast('SP3K Gagal Diunggah', r.message, 'warning');
      })
    : Promise.resolve();
  langkahSp3k.then(function () {
    return call('simpanPenagihan', App.token, idTrx, data);
  }).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan &amp; Lihat Rincian');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    closeModal();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false).then(function () { setTimeout(function () { lihatTagihan(idTrx); }, 400); });
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan &amp; Lihat Rincian');
    showToast('Error', err.message, 'danger');
  });
}

function lihatTagihan(idTrx) {
  const t = App.transaksi.find(function (x) { return x.id === idTrx; });
  const g = tagihanKonsumen(idTrx);
  if (!t || !g) return;
  const d = dataDokDariTransaksi(t, 'tagihan');
  const isi = htmlTagihan(d, { baris: g.baris, terbayar: g.terbayar, tenor: g.tenor, bank: g.bank, perumahan: g.perumahan, catatan: g.catatan });
  App._tgCetak = { judul: 'Rincian Biaya Akad — ' + t.nama, isi: isi };
  openModal('Rincian Biaya Akad Kredit — ' + t.nama, '<div id="tgArea">' + isi + '</div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>' +
    '<button class="btn btn-outline-brand" onclick="closeModal();setTimeout(function(){formPenagihan(\'' + escJs(idTrx) + '\')},350)"><i class="bi bi-pencil"></i> Edit</button>' +
    '<button class="btn btn-brand" onclick="cetakDokHtml(App._tgCetak.judul, App._tgCetak.isi)"><i class="bi bi-printer"></i> Unduh PDF / Cetak</button>',
    'modal-lg');
}

function tandaiLunasTagihan(idTrx) {
  const t = App.transaksi.find(function (x) { return x.id === idTrx; });
  const g = tagihanKonsumen(idTrx);
  if (!t || !g) return;
  konfirmasi('Tandai Lunas', 'Tagihan ' + t.nama + ' sebesar ' + rp(g.total) + ' akan ditandai LUNAS.', function () {
    call('simpanPenagihan', App.token, idTrx, {
      nomor: g.nomor, tanggal: g.tanggal, jatuhTempo: g.jatuhTempo, baris: g.baris, terbayar: g.terbayar,
      tenor: g.tenor, bank: g.bank, perumahan: g.perumahan, catatan: g.catatan, status: 'Lunas'
    }).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      showToast('Berhasil', res.message, 'success');
      muatWorkspace(false);
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

function hapusPenagihanUi(idTagihan) {
  closeModal();
  setTimeout(function () {
    konfirmasi('Hapus Penagihan', 'Data penagihan ini akan dihapus. Dokumen SP3K tetap tersimpan.', function () {
      call('hapusPenagihan', App.token, idTagihan).then(function (res) {
        if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
        showToast('Berhasil', res.message, 'success');
        muatWorkspace(false);
      }).catch(function (err) { showToast('Error', err.message, 'danger'); });
    });
  }, 350);
}

/** Cetak dokumen (gaya sama dengan SPR / PPJB). */
function cetakDokHtml(judul, isi) {
  cetakHtml('<html><head><meta charset="utf-8"><title>' + esc(judul) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    '<style>body{font-family:Inter,sans-serif;margin:0;padding:24px;color:#241A1E;font-size:13px}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.spr-doc{padding:0}.spr-kop{display:flex;justify-content:space-between;gap:1rem;border-bottom:2px solid #7A1F3D;padding-bottom:.9rem}' +
    'table{width:100%;border-collapse:collapse}.tbl-harga th{color:#fff;text-align:left;padding:.55rem .8rem;font-size:.8rem}' +
    '.tbl-harga td{padding:.5rem .8rem;border-bottom:1px solid #EDE5E6}.tbl-harga tr.total td{background:#FBF1F4;font-weight:700}' +
    '.ttd-area{display:flex;justify-content:space-between;gap:1rem;margin-top:2.4rem;text-align:center;font-size:.8rem}' +
    '.ttd-line{border-top:1px solid #241A1E;margin-top:3rem;padding-top:.3rem}' +
    '@page{margin:14mm}</style></head><body>' + isi + '</body></html>');
}


// ════════ BAGIAN 28 — REKAP REKANAN BANK (v4.7) ════════

const JENIS_REKANAN = ['Percepatan proses SP3K', 'Appraisal / taksasi', 'Survei lokasi / wawancara', 'BI Checking / SLIK',
  'Verifikasi berkas', 'Penjadwalan akad', 'Pencairan dana', 'Lainnya'];

function renderRekanan() {
  const el = document.getElementById('app-rekanan');
  const data = App.rekanan || [];
  const bulan = isoHariIni().substring(0, 7);
  const kpi = [
    { l: 'Total Pekerjaan', v: data.length, s: 'tercatat', i: 'list-check', g: 'is-brand' },
    { l: 'Sedang Proses', v: data.filter(function (r) { return r.status === 'Proses'; }).length, s: 'menunggu hasil', i: 'hourglass-split', g: 'is-warn' },
    { l: 'Selesai', v: data.filter(function (r) { return r.status === 'Selesai'; }).length, s: 'pekerjaan tuntas', i: 'check2-circle', g: 'is-ok' },
    { l: 'Biaya Bulan Ini', v: rpSingkat(data.filter(function (r) { return String(r.tanggal).substring(0, 7) === bulan; })
        .reduce(function (a, r) { return a + (r.biaya || 0); }, 0)), s: 'fee / biaya rekanan', i: 'cash-stack', g: 'is-gold' }
  ];
  const banks = [...new Set(data.map(function (r) { return r.bank; }).filter(Boolean).concat(App.daftarBank || []))];
  el.innerHTML =
    '<p class="text-muted-2">Catat setiap pekerjaan yang meminta bantuan orang bank (rekanan) dalam proses KPR konsumen — ' +
    'siapa yang membantu, untuk konsumen mana, statusnya, dan biayanya bila ada.</p>' +
    '<div class="row g-2 g-md-3 mb-3">' + kpi.map(function (k) {
      return '<div class="col-6 col-lg-3"><div class="kpi-tile ' + k.g + '"><div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
        '<div style="min-width:0"><div class="kpi-lbl">' + esc(k.l) + '</div><div class="kpi-val">' + k.v + '</div>' +
        '<div class="kpi-sub">' + esc(k.s) + '</div></div></div></div>';
    }).join('') + '</div>' +
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:240px"><span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="rkCari" placeholder="Cari rekanan / konsumen…" oninput="tundaCari(renderTabelRekanan)"></div>' +
      '<select class="form-select" style="max-width:160px" id="rkBank" onchange="renderTabelRekanan()"><option value="">Semua Bank</option>' +
        banks.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('') + '</select>' +
      '<select class="form-select" style="max-width:150px" id="rkStatus" onchange="renderTabelRekanan()"><option value="">Semua Status</option><option>Proses</option><option>Selesai</option><option>Batal</option></select>' +
      '<input type="month" class="form-control" style="max-width:170px" id="rkBulan" onchange="renderTabelRekanan()" title="Filter bulan">' +
      '<div class="ms-auto d-flex gap-2">' +
        '<button class="btn btn-sm btn-outline-brand" onclick="cetakRekanan()"><i class="bi bi-file-earmark-pdf"></i> Unduh Rekap</button>' +
        '<button class="btn btn-sm btn-brand" onclick="formRekanan()"><i class="bi bi-plus-lg"></i> Catat Pekerjaan</button>' +
      '</div>' +
    '</div>' +
    '<div class="row g-3">' +
      '<div class="col-xl-8"><div class="table-wrap"><table class="table-lux"><thead><tr>' +
        '<th>Tanggal</th><th>Rekanan</th><th>Pekerjaan</th><th>Konsumen</th><th>Status</th><th class="text-end">Biaya</th><th class="text-end">Aksi</th>' +
      '</tr></thead><tbody id="tbodyRekanan"></tbody></table></div></div>' +
      '<div class="col-xl-4"><div class="panel"><div class="panel-head"><h6><i class="bi bi-people" style="color:var(--accent)"></i> Rekap per Rekanan</h6></div>' +
        '<div class="panel-body" id="rkRekapBox"></div></div></div>' +
    '</div>';
  renderTabelRekanan();
}

function rekananTersaring() {
  const q = ((document.getElementById('rkCari') || {}).value || '').toLowerCase();
  const bk = (document.getElementById('rkBank') || {}).value || '';
  const st = (document.getElementById('rkStatus') || {}).value || '';
  const bl = (document.getElementById('rkBulan') || {}).value || '';
  return (App.rekanan || []).filter(function (r) {
    if (bk && r.bank !== bk) return false;
    if (st && r.status !== st) return false;
    if (bl && String(r.tanggal).substring(0, 7) !== bl) return false;
    if (q && (r.nama + ' ' + r.konsumen + ' ' + r.jenis + ' ' + r.uraian).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); });
}

function rekapPerRekanan(list) {
  const peta = {};
  list.forEach(function (r) {
    const k = (r.nama || '-') + '|' + (r.bank || '-');
    if (!peta[k]) peta[k] = { nama: r.nama, bank: r.bank, jabatan: r.jabatan, jumlah: 0, selesai: 0, proses: 0, biaya: 0 };
    peta[k].jumlah++;
    if (r.status === 'Selesai') peta[k].selesai++;
    if (r.status === 'Proses') peta[k].proses++;
    peta[k].biaya += r.biaya || 0;
  });
  return Object.keys(peta).map(function (k) { return peta[k]; }).sort(function (a, b) { return b.jumlah - a.jumlah; });
}

function renderTabelRekanan() {
  const tbody = document.getElementById('tbodyRekanan');
  if (!tbody) return;
  const list = rekananTersaring();
  tbody.innerHTML = list.length ? list.map(function (r) {
    const id = escJs(r.id);
    return '<tr>' +
      '<td class="tabular" style="white-space:nowrap">' + esc(tglIndo(r.tanggal)) + '</td>' +
      '<td><b>' + esc(r.nama) + '</b><div class="text-muted-2" style="font-size:.76rem">' + esc([r.bank, r.jabatan].filter(Boolean).join(' • ')) + '</div></td>' +
      '<td>' + esc(r.jenis) + (r.uraian ? '<div class="text-muted-2 line-clamp-2" style="font-size:.76rem">' + esc(r.uraian) + '</div>' : '') + '</td>' +
      '<td>' + esc(r.konsumen || '-') + '</td>' +
      '<td><span class="chip chip-xs ' + (r.status === 'Selesai' ? 'chip-ok' : r.status === 'Batal' ? 'chip-danger' : 'chip-gold') + '">' + esc(r.status) + '</span>' +
        (r.tanggalSelesai ? '<div class="text-muted-2" style="font-size:.72rem">' + esc(tglIndo(r.tanggalSelesai)) + '</div>' : '') + '</td>' +
      '<td class="text-end tabular">' + (r.biaya ? rp(r.biaya) : '—') + '</td>' +
      '<td class="text-end"><div class="d-flex gap-1 justify-content-end">' +
        '<button class="btn btn-sm btn-ghost" onclick="formRekanan(\'' + id + '\')" title="Edit"><i class="bi bi-pencil"></i></button>' +
        '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="hapusRekananUi(\'' + id + '\')" title="Hapus"><i class="bi bi-trash"></i></button>' +
      '</div></td></tr>';
  }).join('') : '<tr><td colspan="7">' + emptyState('person-badge', 'Belum ada catatan', 'Klik "Catat Pekerjaan" untuk mencatat bantuan dari rekanan bank.') + '</td></tr>';

  const rekap = rekapPerRekanan(list);
  document.getElementById('rkRekapBox').innerHTML = rekap.length ? rekap.map(function (k) {
    return '<div class="mini-row"><div style="flex:1;min-width:0">' +
      '<div class="mini-name text-truncate">' + esc(k.nama) + '</div>' +
      '<div class="mini-sub text-truncate">' + esc(k.bank || '-') + ' • ' + k.jumlah + ' pekerjaan (' + k.selesai + ' selesai, ' + k.proses + ' proses)</div></div>' +
      '<div class="text-end tabular" style="font-size:.82rem"><b>' + (k.biaya ? rpSingkat(k.biaya) : '—') + '</b></div></div>';
  }).join('') : emptyState('people', 'Belum ada rekap', '');
}

function formRekanan(id) {
  const r = id ? (App.rekanan || []).find(function (x) { return x.id === id; }) : null;
  const nama = [...new Set((App.rekanan || []).map(function (x) { return x.nama; }).filter(Boolean))];
  const kpr = App.transaksi.filter(function (t) { return t.metode === 'KPR'; })
    .sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama)); });
  const banks = App.daftarBank || [];
  openModal(r ? 'Edit Pekerjaan Rekanan' : 'Catat Pekerjaan Rekanan Bank',
    '<datalist id="dlRekanan">' + nama.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
    '<datalist id="dlBankRk">' + banks.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
    '<datalist id="dlJenisRk">' + JENIS_REKANAN.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
    '<div class="row g-3">' +
      '<div class="col-md-4"><label class="form-label">Tanggal</label><input type="date" class="form-control" id="rkTgl" value="' + esc(r ? String(r.tanggal).substring(0, 10) : isoHariIni()) + '"></div>' +
      '<div class="col-md-8"><label class="form-label">Nama Rekanan (orang bank) <span class="text-danger">*</span></label>' +
        '<input class="form-control" id="rkNama" list="dlRekanan" maxlength="80" value="' + esc(r ? r.nama : '') + '" onchange="isiRekananLama()"></div>' +
      '<div class="col-md-4"><label class="form-label">Bank</label><input class="form-control" id="rkBankIsi" list="dlBankRk" maxlength="60" value="' + esc(r ? r.bank : '') + '"></div>' +
      '<div class="col-md-4"><label class="form-label">Jabatan</label><input class="form-control" id="rkJabatan" maxlength="80" placeholder="mis. Account Officer" value="' + esc(r ? r.jabatan : '') + '"></div>' +
      '<div class="col-md-4"><label class="form-label">No. HP</label><input class="form-control" id="rkHp" maxlength="30" value="' + esc(r ? r.hp : '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label">Jenis Pekerjaan / Bantuan <span class="text-danger">*</span></label>' +
        '<input class="form-control" id="rkJenis" list="dlJenisRk" maxlength="80" value="' + esc(r ? r.jenis : '') + '" placeholder="Pilih atau ketik"></div>' +
      '<div class="col-md-6"><label class="form-label">Konsumen Terkait <span class="text-muted-2" style="font-weight:400">(opsional)</span></label>' +
        '<select class="form-select" id="rkTrx"><option value="">— Tidak terkait konsumen tertentu —</option>' +
        kpr.map(function (t) {
          return '<option value="' + esc(t.id) + '"' + (r && r.idTransaksi === t.id ? ' selected' : '') + '>' + esc(t.nama + ' • Blok ' + t.blok + '-' + t.nomor) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="col-12"><label class="form-label">Uraian</label><textarea class="form-control" id="rkUraian" rows="2" maxlength="600">' + esc(r ? r.uraian : '') + '</textarea></div>' +
      '<div class="col-md-4"><label class="form-label">Status</label><select class="form-select" id="rkStatusIsi">' +
        ['Proses', 'Selesai', 'Batal'].map(function (o) { return '<option' + ((r ? r.status : 'Proses') === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></div>' +
      '<div class="col-md-4"><label class="form-label">Biaya / Fee (Rp)</label><input class="form-control tabular" id="rkBiaya" inputmode="numeric" oninput="formatRibuan(this)" value="' + (r && r.biaya ? angka(r.biaya) : '') + '" placeholder="0"></div>' +
      '<div class="col-md-4"><label class="form-label">Tanggal Selesai</label><input type="date" class="form-control" id="rkSelesai" value="' + esc(r ? String(r.tanggalSelesai || '').substring(0, 10) : '') + '"></div>' +
      '<div class="col-12"><label class="form-label">Catatan</label><input class="form-control" id="rkCatatan" maxlength="400" value="' + esc(r ? r.catatan : '') + '"></div>' +
    '</div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnRk" onclick="simpanRekananUi(' + (r ? '\'' + escJs(r.id) + '\'' : 'null') + ')"><i class="bi bi-save"></i> Simpan</button>',
    'modal-lg');
}

/** Pilih nama rekanan lama → bank, jabatan, HP terisi otomatis. */
function isiRekananLama() {
  const n = document.getElementById('rkNama').value.trim().toLowerCase();
  const r = (App.rekanan || []).find(function (x) { return String(x.nama).toLowerCase() === n; });
  if (!r) return;
  if (!document.getElementById('rkBankIsi').value) document.getElementById('rkBankIsi').value = r.bank || '';
  if (!document.getElementById('rkJabatan').value) document.getElementById('rkJabatan').value = r.jabatan || '';
  if (!document.getElementById('rkHp').value) document.getElementById('rkHp').value = r.hp || '';
}

function simpanRekananUi(id) {
  const data = {
    id: id || '',
    tanggal: document.getElementById('rkTgl').value,
    nama: document.getElementById('rkNama').value,
    bank: document.getElementById('rkBankIsi').value,
    jabatan: document.getElementById('rkJabatan').value,
    hp: document.getElementById('rkHp').value,
    jenis: document.getElementById('rkJenis').value,
    idTransaksi: document.getElementById('rkTrx').value,
    uraian: document.getElementById('rkUraian').value,
    status: document.getElementById('rkStatusIsi').value,
    biaya: (document.getElementById('rkBiaya').value || '').replace(/[^0-9]/g, ''),
    tanggalSelesai: document.getElementById('rkSelesai').value,
    catatan: document.getElementById('rkCatatan').value
  };
  if (!data.nama.trim() || !data.jenis.trim()) { showToast('Data Belum Lengkap', 'Isi nama rekanan dan jenis pekerjaan.', 'warning'); return; }
  const btn = document.getElementById('btnRk');
  tombolLoading(btn, true);
  call('simpanRekanan', App.token, data).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    closeModal();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false);
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    showToast('Error', err.message, 'danger');
  });
}

function hapusRekananUi(id) {
  const r = (App.rekanan || []).find(function (x) { return x.id === id; });
  if (!r) return;
  konfirmasi('Hapus Catatan', 'Catatan pekerjaan "' + r.jenis + '" oleh ' + r.nama + ' akan dihapus.', function () {
    call('hapusRekanan', App.token, id).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      showToast('Berhasil', res.message, 'success');
      muatWorkspace(false);
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

function cetakRekanan() {
  const list = rekananTersaring();
  if (!list.length) { showToast('Kosong', 'Tidak ada data pada filter ini.', 'warning'); return; }
  const e = App.etalase || {};
  const bl = (document.getElementById('rkBulan') || {}).value;
  const rekap = rekapPerRekanan(list);
  const total = list.reduce(function (a, r) { return a + (r.biaya || 0); }, 0);
  cetakHtml('<html><head><meta charset="utf-8"><title>Rekap Rekanan Bank</title>' +
    '<style>body{font-family:Inter,Arial,sans-serif;padding:26px;color:#241A1E}' +
    'h2{font-family:Georgia,serif;color:#7A1F3D;margin:0}h3{font-family:Georgia,serif;margin:18px 0 6px}' +
    'table{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:8px}' +
    'th{background:#7A1F3D;color:#fff;text-align:left;padding:7px}td{padding:6px 7px;border-bottom:1px solid #E8DEDD;vertical-align:top}' +
    '.r{text-align:right}</style></head><body>' +
    '<h2>' + esc(e.namaPerusahaan || '') + '</h2><div style="font-size:11px;color:#6B5C60">' + esc(e.alamat || '') + '</div><hr>' +
    '<h3>Rekap Pekerjaan Rekanan Bank' + (bl ? ' — ' + esc(bl) : '') + '</h3>' +
    '<div style="font-size:11px;color:#6B5C60">Dicetak: ' + new Date().toLocaleString('id-ID') + ' • ' + list.length + ' pekerjaan • Total biaya ' + rp(total) + '</div>' +
    '<table><thead><tr><th>Rekanan</th><th>Bank</th><th class="r">Pekerjaan</th><th class="r">Selesai</th><th class="r">Proses</th><th class="r">Biaya</th></tr></thead><tbody>' +
    rekap.map(function (k) {
      return '<tr><td>' + esc(k.nama) + (k.jabatan ? '<br><span style="color:#6B5C60">' + esc(k.jabatan) + '</span>' : '') + '</td><td>' + esc(k.bank || '-') + '</td>' +
        '<td class="r">' + k.jumlah + '</td><td class="r">' + k.selesai + '</td><td class="r">' + k.proses + '</td><td class="r">' + rp(k.biaya) + '</td></tr>';
    }).join('') + '</tbody></table>' +
    '<h3>Rincian</h3><table><thead><tr><th>Tanggal</th><th>Rekanan</th><th>Pekerjaan</th><th>Konsumen</th><th>Status</th><th class="r">Biaya</th></tr></thead><tbody>' +
    list.map(function (r) {
      return '<tr><td>' + esc(tglIndo(r.tanggal)) + '</td><td>' + esc(r.nama) + '<br><span style="color:#6B5C60">' + esc(r.bank || '') + '</span></td>' +
        '<td>' + esc(r.jenis) + (r.uraian ? '<br><span style="color:#6B5C60">' + esc(r.uraian) + '</span>' : '') + '</td>' +
        '<td>' + esc(r.konsumen || '-') + '</td><td>' + esc(r.status) + '</td><td class="r">' + (r.biaya ? rp(r.biaya) : '-') + '</td></tr>';
    }).join('') + '</tbody></table></body></html>');
}
// ════════ BAGIAN 26 — KWITANSI DARI SiKeu & DOKUMEN INDENT (v4.9) ════════
// Bagian keuangan mengonfirmasi pembayaran & menerbitkan kwitansi di SiKeu.
// Hasilnya tampil di Data Konsumen dan Data Indent; kwitansi bisa dilihat & diunduh.

BATAS_WAKTU_BACA.getKwitansiKeuangan = 60000;

function dataKeuangan(idRef) {
  return (App.kwitansiKeuangan || {})[idRef] || null;
}

/** Chip kecil status keuangan (hanya muncul bila keuangan sudah memeriksa). */
function chipKeuangan(idRef) {
  const k = dataKeuangan(idRef);
  if (!k || !App.sesi || App.sesi.role === 'Perbankan') return '';
  if (k.status === 'Ditolak') {
    return '<div class="mt-1"><span class="chip chip-danger" style="font-size:.66rem" title="' + esc(k.catatan || '') + '">' +
      '<i class="bi bi-x-circle"></i> Bayar ditolak keuangan</span></div>';
  }
  if (k.ada) {
    return '<div class="mt-1"><span class="chip chip-ok" style="font-size:.66rem;cursor:pointer" ' +
      'onclick="event.stopPropagation();previewKwitansi(\'' + escJs(idRef) + '\')" title="Lihat / unduh kwitansi">' +
      '<i class="bi bi-receipt-cutoff"></i> ' + esc(k.noKwitansi || 'Kwitansi') + '</span></div>';
  }
  return '<div class="mt-1"><span class="chip chip-soft" style="font-size:.66rem" title="Kwitansi belum diterbitkan keuangan">' +
    '<i class="bi bi-check2-circle"></i> Dikonfirmasi keuangan</span></div>';
}

/** Bagian "Pembayaran & Kwitansi" pada detail konsumen / indent. */
function htmlKeuangan(idRef) {
  const k = dataKeuangan(idRef);
  let isi;
  if (!k) {
    isi = '<div class="text-muted-2" style="font-size:.8rem">Menunggu konfirmasi pembayaran dari bagian keuangan (SiKeu).</div>';
  } else if (k.status === 'Ditolak') {
    isi = '<div style="font-size:.82rem;color:var(--danger)"><i class="bi bi-x-circle"></i> Pembayaran <b>ditolak</b> keuangan' +
      (k.catatan ? ' — ' + esc(k.catatan) : '') + '. Periksa ulang bukti bayar konsumen.</div>';
  } else {
    isi = '<div style="font-size:.82rem" class="mb-2">' +
        '<div class="d-flex justify-content-between"><span class="text-muted-2">Diterima</span><b class="tabular">' + rp(k.jumlah) + '</b></div>' +
        (k.tanggal ? '<div class="d-flex justify-content-between"><span class="text-muted-2">Tanggal</span><b>' + tglIndo(k.tanggal) + '</b></div>' : '') +
        (k.metodeBayar ? '<div class="d-flex justify-content-between"><span class="text-muted-2">Metode</span><b>' + esc(k.metodeBayar) + '</b></div>' : '') +
        (k.oleh ? '<div class="d-flex justify-content-between"><span class="text-muted-2">Dikonfirmasi</span><b>' + esc(k.oleh) + '</b></div>' : '') +
      '</div>' +
      (k.ada
        ? '<button class="btn btn-sm btn-brand w-100 mb-2" onclick="previewKwitansi(\'' + escJs(idRef) + '\')">' +
            '<i class="bi bi-receipt-cutoff"></i> Lihat & Unduh Kwitansi' + (k.noKwitansi ? ' ' + esc(k.noKwitansi) : '') + '</button>'
        : '<div class="text-muted-2" style="font-size:.8rem"><i class="bi bi-hourglass-split"></i> Pembayaran sudah dikonfirmasi — kwitansi belum diterbitkan.</div>');
  }
  return '<div class="sect-label mb-2 mt-3">Pembayaran & Kwitansi (Keuangan)</div>' + isi;
}

/** Pratinjau kwitansi + tombol unduh langsung (file dibaca server, tidak perlu akses Drive). */
function previewKwitansi(idRef) {
  const k = dataKeuangan(idRef) || {};
  document.getElementById('previewTitle').textContent = 'Kwitansi' + (k.noKwitansi ? ' ' + k.noKwitansi : '');
  const tombolUnduh = document.getElementById('previewDownload');
  tombolUnduh.href = '#';
  const body = document.getElementById('previewBody');
  body.innerHTML = '<div class="py-5 text-center"><div class="loader-ring mx-auto"></div>' +
    '<p class="text-muted-2 mt-3 mb-0" style="font-size:.86rem">Memuat kwitansi…</p></div>';
  tampilkanModal('modalPreview');

  call('getKwitansiKeuangan', App.token, idRef).then(function (res) {
    if (!res.success) {
      const url = res.data && res.data.url;
      body.innerHTML = url ? pratinjauGagal(url, res.message)
        : '<div class="py-5 text-center text-muted-2" style="font-size:.88rem">' + esc(res.message) + '</div>';
      if (url && /^https:\/\//i.test(url)) tombolUnduh.href = url;
      return;
    }
    const d = res.data;
    const src = buatBlobUrl(d.data, d.mime);
    const kb = (d.ukuran / 1024).toFixed(0);
    if (String(d.mime).indexOf('image/') === 0) {
      body.innerHTML = '<img src="' + src + '" alt="Kwitansi" style="max-width:100%;max-height:72vh;border-radius:12px;box-shadow:var(--shadow-card)">';
    } else if (String(d.mime).indexOf('pdf') >= 0) {
      body.innerHTML = '<div class="pdf-wadah"></div>';      // v4.9.1 — digambar pdf.js (bukan embed)
    } else {
      body.innerHTML = '<div class="py-4 text-muted-2">Jenis berkas ini tidak dapat dipratinjau — gunakan tombol Unduh.</div>';
    }
    body.insertAdjacentHTML('beforeend', '<div class="text-muted-2 mt-2" style="font-size:.78rem">' + esc(d.nama) + ' • ' + kb + ' KB</div>');
    if (body.querySelector('.pdf-wadah')) tampilPdf(body.querySelector('.pdf-wadah'), d.data, d.mime);
    tombolUnduh.href = src;
    tombolUnduh.setAttribute('download', d.nama || ('Kwitansi_' + idRef + '.pdf'));
  }).catch(function (err) {
    body.innerHTML = '<div class="py-5 text-center text-muted-2" style="font-size:.88rem">' + esc(err.message) + '</div>';
  });
}
// Tombol Unduh dipakai bersama pratinjau lain → lepas atribut download saat ditutup
(function () {
  const m = document.getElementById('modalPreview');
  if (m) m.addEventListener('hidden.bs.modal', function () {
    const t = document.getElementById('previewDownload');
    if (t) t.removeAttribute('download');
  });
})();

/** Unggah KTP / KK / bukti indent yang dipilih satu per satu, lalu panggil selesai(gagal, jumlah). */
function unggahDokumenIndentUi(idIndent, btn, selesai) {
  const antrean = DOK_MANUAL.filter(function (d) { return fileBuffer[d.input]; });
  if (!idIndent || !antrean.length) { selesai(0, 0); return; }
  let i = 0, gagal = 0;
  (function lanjut() {
    if (i >= antrean.length) {
      DOK_MANUAL.forEach(function (d) { delete fileBuffer[d.input]; });
      selesai(gagal, antrean.length);
      return;
    }
    const d = antrean[i++];
    if (btn) btn.innerHTML = '<span class="spinner-inline"></span> Mengunggah ' + d.label + ' (' + i + '/' + antrean.length + ')…';
    call('unggahDokumenIndent', App.token, idIndent, d.key, fileBuffer[d.input])
      .then(function (r) { if (!r || !r.success) gagal++; lanjut(); })
      .catch(function () { gagal++; lanjut(); });
  })();
}

/** Detail indent: data, dokumen, pembayaran & kwitansi dari keuangan. */
function detailIndent(id) {
  const d = App.indent.find(function (x) { return x.id === id; });
  if (!d) return;
  const p = App.proyek.find(function (x) { return x.id === d.idProyek; }) || {};
  const baris = [
    ['No. Antrean', d.id], ['Tanggal Daftar', tglIndo(d.tanggal)], ['Proyek', p.nama || '-'],
    ['Nama Konsumen', d.nama], ['NIK', d.nik || '-'], ['No. HP', d.hp], ['Email', d.email || '-'],
    ['Minat', (d.minatBlok || '-') + (d.minatTipe ? ' • ' + d.minatTipe : '')],
    ['Metode Rencana', d.metode || '-'], ['Marketing', d.marketing || '-'], ['Status Antrean', d.status],
    ['Uang Indent Dibayar', d.nominal ? rp(d.nominal) : '-']
  ];
  const dok = [['Foto KTP', d.linkKtp], ['Kartu Keluarga', d.linkKk], ['Bukti Pembayaran', d.linkBukti]];
  const bank = App.sesi && App.sesi.role === 'Perbankan';                     // v4.9.3
  if (bank) { baris.pop(); }
  // v5.2 — konsumen yang dipindah dari Data Konsumen
  if (d.asalTransaksi) {
    baris.push(['Dipindah dari', (d.asalUnit || d.asalTransaksi)], ['Alasan Dipindah', d.alasanPindah || '-']);
    if (!bank && d.asalLinkBukti) dok.push(['Bukti Booking (transaksi asal)', d.asalLinkBukti]);
    if (!bank && typeof pembayaranKonsumen === 'function') {
      const byr = pembayaranKonsumen(d.id);
      if (byr.length) baris.push(['Pembayaran Tercatat', rp(byr.reduce(function (a, b) { return a + (Number(b.nominal) || 0); }, 0)) + ' (' + byr.length + 'x)']);
    }
  }
  const jmlBerkas = dokumenTransaksi(d.id).length;
  openModal('Detail Indent — ' + d.nama,
    '<div class="row g-3"><div class="col-md-7">' +
      baris.map(function (b) {
        return '<div class="d-flex justify-content-between gap-3 py-1" style="font-size:.86rem;border-bottom:1px solid var(--border)">' +
          '<span class="text-muted-2">' + b[0] + '</span><b class="text-end">' + esc(b[1]) + '</b></div>';
      }).join('') +
    '</div><div class="col-md-5"><div class="sect-label mb-2">Dokumen Konsumen</div>' +
      dok.map(function (x) {
        return '<button class="btn btn-sm w-100 mb-2 ' + (x[1] ? 'btn-outline-brand' : 'btn-ghost') + '"' +
          (x[1] ? ' onclick="previewFile(\'' + escJs(x[1]) + '\',\'' + escJs(x[0]) + '\')"' : ' disabled') + '>' +
          '<i class="bi bi-' + (x[1] ? 'eye' : 'x-circle') + '"></i> ' + x[0] + (x[1] ? '' : ' (belum ada)') + '</button>';
      }).join('') +
      '<button class="btn btn-sm btn-brand w-100 mt-2" onclick="closeModal();setTimeout(function(){kelolaBerkasKpr(\'' + escJs(d.id) + '\')},350)">' +
        '<i class="bi bi-folder2-open"></i> Berkas KPR (' + jmlBerkas + ')</button>' +            // v4.9.3
      (bank ? '' : htmlKeuangan(d.id)) +
    '</div></div>' +
    (d.asalTransaksi && d.catatan                                                   // v5.2 — riwayat saat dipindah
      ? '<div class="sect-label mb-2 mt-3">Riwayat Konsumen</div><div class="card-flat p-3" style="font-size:.82rem;white-space:pre-wrap;background:var(--surface)">' +
        esc(d.catatan) + '</div>' : ''),
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>' +
    (bank ? '' : '<button class="btn btn-outline-brand" onclick="closeModal();setTimeout(function(){formIndent(\'' + escJs(d.id) + '\')},350)">' +
      '<i class="bi bi-pencil"></i> Edit & Unggah Dokumen</button>'));
}

// ════════ BAGIAN 27 — PRATINJAU PDF DI DALAM APLIKASI (v4.9.1) ════════
// Apps Script menjalankan aplikasi di dalam bingkai (iframe) ber-sandbox; di sana
// penampil PDF bawaan Chrome/Edge diblokir sehingga <embed> PDF tampil PUTIH.
// Solusi: pustaka pdf.js menggambar setiap halaman PDF ke kanvas (seperti gambar).
// Pustaka dimuat sekali saja, hanya saat pertama membuka PDF (jsDelivr → unpkg).

const PDFJS_SUMBER = [
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/',
  'https://unpkg.com/pdfjs-dist@5.7.284/legacy/build/'
];
let _pdfjsJanji = null;

function muatPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfjsJanji) return _pdfjsJanji;
  let i = 0;
  _pdfjsJanji = new Promise(function (berhasil, gagal) {
    (function coba() {
      if (i >= PDFJS_SUMBER.length) { _pdfjsJanji = null; gagal(new Error('Pustaka PDF tidak dapat dimuat (periksa koneksi internet).')); return; }
      const dasar = PDFJS_SUMBER[i++];
      let selesai = false;
      const batas = setTimeout(function () { if (!selesai) { selesai = true; coba(); } }, 15000);
      import(dasar + 'pdf.min.mjs').then(function (lib) {
        if (selesai) return;
        selesai = true; clearTimeout(batas);
        lib.GlobalWorkerOptions.workerSrc = dasar + 'pdf.worker.min.mjs';
        window.pdfjsLib = lib;
        berhasil(lib);
      }).catch(function () {
        if (selesai) return;
        selesai = true; clearTimeout(batas); coba();
      });
    })();
  });
  return _pdfjsJanji;
}

/** Gambar PDF (base64) ke dalam wadah; bila gagal, tampilkan tombol buka di tab baru. */
function tampilPdf(wadah, base64, mime) {
  if (!wadah) return Promise.resolve();
  wadah.innerHTML = '<div class="py-5 text-center"><div class="loader-ring mx-auto"></div>' +
    '<p class="text-muted-2 mt-3 mb-0" style="font-size:.86rem">Menyiapkan pratinjau PDF…</p></div>';
  const urlBlob = buatBlobUrl(base64, mime || 'application/pdf');
  const tombolTab = '<button type="button" class="btn btn-sm btn-ghost mt-2" onclick="window.open(\'' + escJs(urlBlob) + '\', \'_blank\')">' +
    '<i class="bi bi-box-arrow-up-right"></i> Buka PDF di tab baru</button>';
  return muatPdfJs().then(function (lib) {
    const biner = atob(base64);
    const data = new Uint8Array(biner.length);
    for (let k = 0; k < biner.length; k++) data[k] = biner.charCodeAt(k);
    return lib.getDocument({ data: data }).promise;
  }).then(function (pdf) {
    if (!wadah.isConnected) return;
    wadah.innerHTML = '';
    const lebar = Math.max(280, Math.min((wadah.clientWidth || 760) - 4, 1000));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maks = Math.min(pdf.numPages, 15);
    let rantai = Promise.resolve();
    for (let n = 1; n <= maks; n++) {
      rantai = rantai.then(function () {
        return pdf.getPage(n).then(function (hal) {
          if (!wadah.isConnected) return;
          const skala = lebar / hal.getViewport({ scale: 1 }).width;
          const vp = hal.getViewport({ scale: skala * dpr });
          const kanvas = document.createElement('canvas');
          kanvas.width = Math.floor(vp.width);
          kanvas.height = Math.floor(vp.height);
          kanvas.style.cssText = 'width:100%;max-width:' + lebar + 'px;display:block;margin:0 auto 10px;background:#fff;' +
            'border-radius:8px;box-shadow:var(--shadow-card)';
          wadah.appendChild(kanvas);
          return hal.render({ canvasContext: kanvas.getContext('2d'), canvas: kanvas, viewport: vp }).promise;
        });
      });
    }
    return rantai.then(function () {
      if (!wadah.isConnected) return;
      if (pdf.numPages > maks) {
        wadah.insertAdjacentHTML('beforeend', '<div class="text-muted-2" style="font-size:.78rem">Menampilkan ' + maks +
          ' dari ' + pdf.numPages + ' halaman — unduh untuk melihat semuanya.</div>');
      }
      wadah.insertAdjacentHTML('beforeend', tombolTab);
    });
  }).catch(function (err) {
    if (!wadah.isConnected) return;
    wadah.innerHTML = '<div class="py-4 text-center">' +
      '<i class="bi bi-file-earmark-pdf" style="font-size:2.4rem;color:var(--danger)"></i>' +
      '<p class="text-muted-2 mt-2 mb-2" style="font-size:.86rem">Pratinjau tidak dapat ditampilkan di sini' +
      (err && err.message ? ' (' + esc(err.message) + ')' : '') + '.<br>Buka di tab baru atau gunakan tombol Unduh.</p>' +
      tombolTab + '</div>';
  });
}

// ════════ BAGIAN 28 — TETAP DI HALAMAN YANG SAMA SAAT REFRESH (v4.9.3) ════════
// Sesi login & halaman yang sedang dibuka disimpan per tab (sessionStorage).
// Saat halaman di-refresh, pengguna langsung kembali ke halaman yang sama
// (beserta proyek yang sedang dibuka dan posisi gulir), bukan ke etalase.
// Menutup tab = sesi tab ikut hilang (kecuali "Ingat saya" dicentang).

function simpanPosisiHalaman() {
  try {
    if (!App.sesi || !App.token) return;
    if (document.getElementById('viewApp').classList.contains('hidden')) return;
    SS.set('halaman', {
      page: App.appPage || 'dashboard',
      proyek: App.proyekAktif ? App.proyekAktif.id : '',
      master: App.masterProyekId || '',
      dokTab: App._dokTab || '',
      gulir: Math.round(window.scrollY || 0),
      user: App.sesi.idUser || App.sesi.username || ''
    });
  } catch (e) { /* opsional */ }
}

function lupakanSesiTab() {
  SS.del('token');
  SS.del('halaman');
  hapusCuplikanRuangKerja();                 // v5.0
}

/** Halaman yang boleh dibuka peran ini (menu + sub-halaman). */
function halamanBolehPeran(role) {
  const boleh = {};
  (menuUntukRole(role) || []).forEach(function (m) { if (m.id) boleh[m.id] = true; });
  if (boleh.pilihProyek) boleh.dataKonsumen = true;
  return boleh;
}

/** Dipanggil sebelum masukDashboard() saat sesi dipulihkan setelah refresh. */
function pulihkanPosisiHalaman() {
  App._pulih = null;
  const h = SS.get('halaman', null);
  if (!h || !h.page || !App.sesi) return;
  const pemilik = App.sesi.idUser || App.sesi.username || '';
  if (h.user && pemilik && h.user !== pemilik) return;           // akun lain di tab ini
  if (!halamanBolehPeran(App.sesi.role)[h.page]) return;
  let halaman = h.page;
  if (halaman === 'dataKonsumen') {
    const p = (App.proyek || []).find(function (x) { return x.id === h.proyek; });
    if (p) App.proyekAktif = p; else halaman = 'pilihProyek';
  }
  if (h.master) App.masterProyekId = h.master;
  if (h.dokTab) App._dokTab = h.dokTab;
  App.appPage = halaman;
  App._pulih = { gulir: Number(h.gulir) || 0, page: halaman };
}

/** Setelah masukDashboard(): tandai halaman aktif selama data dimuat, lalu kembalikan posisi gulir. */
function tandaiHalamanPulih() {
  const pulih = App._pulih;
  if (!pulih) return;
  document.querySelectorAll('#viewApp .page').forEach(function (s) { s.classList.remove('active'); });
  const el = document.getElementById('app-' + pulih.page);
  if (el) el.classList.add('active');
  const judul = document.getElementById('appPageTitle');
  if (judul) judul.textContent = JUDUL_HALAMAN[pulih.page] || 'Dashboard';
  document.querySelectorAll('#sidebarNav a').forEach(function (a) {
    a.classList.toggle('active', a.dataset.menu === pulih.page ||
      (pulih.page === 'dataKonsumen' && a.dataset.menu === 'pilihProyek'));
  });
  if (!pulih.gulir) { App._pulih = null; return; }
  // Gulir dikembalikan setelah data selesai dimuat & halaman tergambar
  let coba = 0;
  const tunggu = setInterval(function () {
    coba++;
    if ((!App._memuatAwal && App.appPage === pulih.page) || coba > 60) {
      clearInterval(tunggu);
      setTimeout(function () { window.scrollTo(0, pulih.gulir); App._pulih = null; }, 350);
    }
  }, 250);
}

// Posisi gulir & halaman terakhir ikut tersimpan sebelum halaman dimuat ulang
window.addEventListener('pagehide', simpanPosisiHalaman);
window.addEventListener('beforeunload', simpanPosisiHalaman);
document.addEventListener('visibilitychange', function () { if (document.hidden) simpanPosisiHalaman(); });
window.addEventListener('scroll', debounce(simpanPosisiHalaman, 400), { passive: true });

// ════════ BAGIAN 29 — DATA INDENT UNTUK TIM PERBANKAN (v4.9.3) ════════
// Konsumen indent calon KPR (atau metode belum ditentukan) tampil di Perbankan
// agar berkas-berkasnya bisa diunggah sejak masa indent — sama seperti konsumen
// biasa. Saat indent dikonversi menjadi transaksi, berkasnya ikut pindah.

JUDUL_HALAMAN.indentBank = 'Data Indent Konsumen';
NTF_IKON.berkasIndent = ['folder-check', 'var(--accent)'];

// Halaman baru dibuat dari kerangka halaman Data Indent (Index.html tidak perlu diubah)
(function () {
  const ref = document.getElementById('app-indent');
  if (ref && !document.getElementById('app-indentBank')) {
    const sec = ref.cloneNode(false);
    sec.id = 'app-indentBank';
    sec.classList.remove('active');
    ref.parentNode.insertBefore(sec, ref.nextSibling);
  }
})();

/** Bentuk "transaksi" dari data indent agar modul berkas KPR bisa dipakai bersama. */
function transaksiDariIndent(id) {
  const d = (App.indent || []).find(function (x) { return x.id === id; });
  if (!d) return null;
  return {
    id: d.id, indent: true, nama: d.nama, nik: d.nik || '', hp: d.hp, idProyek: d.idProyek,
    blok: d.minatBlok || '', nomor: '', metode: d.metode || 'KPR',
    labelUnit: 'Indent' + (d.minatBlok ? ' — minat Blok ' + d.minatBlok : '') + (d.minatTipe ? ' • ' + d.minatTipe : ''),
    berkas: { status: 'Indent', bank: '', plafon: 0 },
    linkKtp: d.linkKtp, linkKk: d.linkKk, linkBukti: d.linkBukti
  };
}

/** Indent yang ditangani Perbankan (server sudah menyaring; Owner melihat semua yang aktif). */
function indentUntukBerkas() {
  return (App.indent || []).filter(function (i) {
    return ['Menunggu', 'Ditawarkan'].indexOf(i.status) >= 0 && i.metode !== 'Cash' && i.metode !== 'Tempo';
  }).sort(function (a, b) { return String(a.tanggal).localeCompare(String(b.tanggal)); });
}

/** Bagian kartu konsumen indent di halaman Upload Berkas. */
function htmlBerkasIndentUpload() {
  const list = indentUntukBerkas();
  if (!list.length) return '';
  return '<div class="sect-label mt-4 mb-2"><i class="bi bi-hourglass-split"></i> Konsumen Indent (' + list.length + ')</div>' +
    '<div class="text-muted-2 mb-2" style="font-size:.8rem">Calon KPR yang masih dalam antrean indent. Berkasnya otomatis pindah ke data konsumen saat indent dikonversi.</div>' +
    '<div class="row g-3">' + list.map(function (i) { return kartuUploadBerkas(transaksiDariIndent(i.id)); }).join('') + '</div>';
}

function renderIndentBank() {
  const el = document.getElementById('app-indentBank');
  if (!el) return;
  const list = indentUntukBerkas();
  const adaBerkas = list.filter(function (i) { return dokumenTransaksi(i.id).length; }).length;
  el.innerHTML =
    '<div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">' +
      '<div><h2 class="mb-0">Data Indent Konsumen</h2>' +
      '<span class="text-muted-2" style="font-size:.86rem">Calon KPR dalam antrean indent — unggah berkas konsumen sejak dini.</span></div>' +
    '</div>' +
    '<div class="row g-2 g-md-3 mb-3">' +
      [{ l: 'Konsumen Indent', v: list.length, i: 'hourglass', g: 'is-brand' },
       { l: 'Sudah Ada Berkas', v: adaBerkas, i: 'folder-check', g: 'is-ok' },
       { l: 'Belum Ada Berkas', v: list.length - adaBerkas, i: 'folder', g: 'is-warn' }]
      .map(function (k) {
        return '<div class="col-12 col-md-4"><div class="kpi-tile ' + k.g + '">' +
          '<div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
          '<div style="min-width:0"><div class="kpi-lbl">' + k.l + '</div>' +
          '<div class="kpi-val">' + k.v + '</div></div></div></div>';
      }).join('') + '</div>' +
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:280px">' +
        '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="ibCari" placeholder="Cari nama / NIK / HP…" oninput="renderTabelIndentBank()">' +
      '</div>' +
      '<select class="form-select" style="max-width:240px" id="ibProyek" onchange="renderTabelIndentBank()">' +
        '<option value="">Semua Proyek</option>' +
        App.proyek.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nama) + '</option>'; }).join('') +
      '</select>' +
    '</div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>No. Antrean</th><th>Konsumen</th><th>Proyek & Minat</th><th>Marketing</th><th>Berkas</th><th class="text-end">Aksi</th>' +
    '</tr></thead><tbody id="tbodyIndentBank"></tbody></table></div>';
  renderTabelIndentBank();
}

function renderTabelIndentBank() {
  const tbody = document.getElementById('tbodyIndentBank');
  if (!tbody) return;
  const q = ((document.getElementById('ibCari') || {}).value || '').toLowerCase();
  const pr = (document.getElementById('ibProyek') || {}).value || '';
  const list = indentUntukBerkas().filter(function (i) {
    if (pr && i.idProyek !== pr) return false;
    if (q && (i.nama + ' ' + i.nik + ' ' + i.hp + ' ' + i.id).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6">' + emptyState('hourglass', 'Belum ada konsumen indent',
      'Konsumen indent calon KPR akan muncul di sini.') + '</td></tr>';
    return;
  }
  isiBertahap(tbody, list.map(function (i) {   // v5.0 — bertahap
    const p = App.proyek.find(function (x) { return x.id === i.idProyek; }) || {};
    const dok = dokumenTransaksi(i.id);
    return '<tr>' +
      '<td><b>' + esc(i.id) + '</b><div class="text-muted-2" style="font-size:.74rem">' + tglIndo(i.tanggal) + '</div></td>' +
      '<td><b>' + esc(i.nama) + '</b><div class="text-muted-2" style="font-size:.76rem">' + esc(i.hp || '') +
        (i.nik ? ' • NIK ' + esc(String(i.nik).substring(0, 6)) + '…' : '') + '</div></td>' +
      '<td style="font-size:.82rem">' + esc(p.nama || '-') +
        '<div class="text-muted-2" style="font-size:.74rem">' + esc(i.minatBlok ? 'Blok ' + i.minatBlok : 'Blok bebas') +
        (i.minatTipe ? ' • ' + esc(i.minatTipe) : '') + ' • ' + esc(i.metode || 'Metode belum ditentukan') + '</div></td>' +
      '<td style="font-size:.82rem">' + esc(i.marketing || '-') + '</td>' +
      '<td><span class="chip ' + (dok.length ? 'chip-ok' : 'chip-warn') + '">' + dok.length + ' berkas</span></td>' +
      '<td class="text-end"><div class="d-flex gap-1 justify-content-end">' +
        '<button class="btn btn-sm btn-ghost" onclick="detailIndent(\'' + i.id + '\')" title="Lihat data konsumen"><i class="bi bi-eye"></i></button>' +
        '<button class="btn btn-sm btn-brand" onclick="kelolaBerkasKpr(\'' + i.id + '\')"><i class="bi bi-folder2-open"></i> Kelola Berkas</button>' +
      '</div></td></tr>';
  }));
}

// ════════ BAGIAN 30 — KINERJA HP: CEPAT & TIDAK MACET (v5.0 · gas-instant-ux) ════════
// 1) Tampil instan saat refresh: data terakhir disimpan per tab (sessionStorage),
//    langsung digambar, lalu diperiksa ulang ke server di latar belakang.
// 2) Server menjawab "tidak berubah" bila data sama → tanpa unduh & gambar ulang.
// 3) Penyegaran latar (lonceng / kembali ke tab) menunggu sampai pengguna
//    tidak sedang menggulir, menyentuh layar, mengetik, atau membuka formulir.
// 4) Tabel panjang digambar bertahap: baris awal langsung tampil, sisanya
//    menyusul saat digulir — HP tidak "membeku" menggambar ratusan baris.
// 5) Kolom pencarian menunggu ketikan selesai sebelum menyaring.

const KUNCI_CUPLIKAN = 'ws';

function simpanCuplikanRuangKerja(data) {
  if (!App.token || !data) return;
  const token = App.token;
  setTimeout(function () {                       // di luar jalur gambar agar tidak memperlambat tampilan
    try {
      if (token !== App.token) return;
      const teks = JSON.stringify({ token: token, waktu: Date.now(), versi: data.versiData || '', data: data });
      if (teks.length > 3500000) { hapusCuplikanRuangKerja(); return; }     // terlalu besar: lewati
      sessionStorage.setItem('ecp_' + KUNCI_CUPLIKAN, teks);
    } catch (e) { hapusCuplikanRuangKerja(); }
  }, 60);
}

function bacaCuplikanRuangKerja(token) {
  try {
    const c = SS.get(KUNCI_CUPLIKAN, null);
    if (!c || !c.data || c.token !== token || !c.data.sesi) return null;
    if (Date.now() - (c.waktu || 0) > 12 * 3600 * 1000) return null;    // lebih dari 12 jam: muat biasa
    return c;
  } catch (e) { return null; }
}

function hapusCuplikanRuangKerja() { SS.del(KUNCI_CUPLIKAN); }

/**
 * Refresh halaman saat sudah masuk: tampilkan data terakhir SEKETIKA (0 detik),
 * lalu periksa sesi & data terbaru di latar belakang.
 * @return {boolean} true bila tampilan instan berhasil
 */
function bootInstan() {
  let token = null;
  try { token = LS.get('token', null) || SS.get('token', null); } catch (e) { token = null; }
  if (!token) return false;
  const c = bacaCuplikanRuangKerja(token);
  if (!c) return false;
  try {
    const d = c.data;
    App.token = token;
    App.sesi = d.sesi;
    App.proyek = d.proyek || [];
    App.kavling = d.kavling || [];
    App.etalase = d.etalase || App.etalase;
    App.hero = d.hero || App.hero || {};
    App.siap = true;
    pulihkanPosisiHalaman();
    const pulih = App._pulih;
    App._pulih = null;
    tampilkanView('viewApp');
    terapkanRuangKerja(d, false);
    window.scrollTo(0, pulih && pulih.gulir ? pulih.gulir : 0);
    App._bootInstan = true;
    sembunyikanLoading();
  } catch (err) {
    console.warn('Tampil instan gagal, memuat biasa:', err);
    App.token = null; App.sesi = null; App.siap = false; App._bootInstan = false;
    hapusCuplikanRuangKerja();
    return false;
  }
  segarkanSetelahBootInstan(token);
  return true;
}

/** Latar belakang setelah tampil instan: data etalase, keabsahan sesi, data terbaru. */
function segarkanSetelahBootInstan(token) {
  call('getBootstrapData').then(function (res) {
    if (!res || !res.success) return;
    App.testimoniPublik = res.data.testimoni || [];
    App.testimoniSetelan = App.testimoniSetelan || res.data.testimoniSetelan || null;
    if (App.config && !App.config.kpr) App.config.kpr = res.data.kpr;
    App._terakhirSegar = Date.now();
    try { aturNavTestimoni(); } catch (e) { /* opsional */ }
    jalankanAman(renderEtalaseAwal, document.getElementById('pub-beranda'), 'renderEtalaseAwal');
  }).catch(function () { /* etalase akan dimuat saat dibuka */ });

  call('pingSession', token).then(function (r) {
    if (token !== App.token) return;
    if (r && r.success) { SS.set('token', token); return; }
    // Sesi sudah tidak berlaku → kembali ke etalase seperti sebelumnya
    App.token = null; App.sesi = null;
    LS.del('token'); lupakanSesiTab();
    showPublic();
  }).catch(function () { /* koneksi putus: tetap pakai data yang ada */ });

  muatWorkspace(false, true);
}

/** Halaman aktif kosong / masih kerangka memuat? */
function halamanAktifKosong() {
  const el = document.querySelector('#viewApp .page.active');
  if (!el) return true;
  return (!el.firstElementChild && !el.textContent.trim()) || !!el.querySelector('.skeleton');
}

// ── Deteksi pengguna sedang berinteraksi ──
(function () {
  function tandai() { App._interaksiTerakhir = Date.now(); }
  ['touchstart', 'touchmove', 'pointerdown', 'wheel', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, tandai, { passive: true, capture: true });
  });
  window.addEventListener('scroll', tandai, { passive: true });
})();

function penggunaSibuk() {
  if (document.querySelector('.modal.show')) return true;
  if (Date.now() - (App._interaksiTerakhir || 0) < 1500) return true;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest && a.closest('#viewApp')) return true;
  return false;
}

/** Simpan data yang datang saat pengguna sibuk; terapkan begitu senggang. */
function tundaTerapkanRuangKerja(data, urutan) {
  App._tertunda = { data: data, urutan: urutan };
  if (App._pewaktuTunda) return;
  App._pewaktuTunda = setInterval(function () {
    const t = App._tertunda;
    if (!t || !App.token || t.urutan !== App._urutMuat) {      // sudah ada data yang lebih baru
      clearInterval(App._pewaktuTunda); App._pewaktuTunda = null; App._tertunda = null; return;
    }
    if (penggunaSibuk() || document.hidden) return;
    clearInterval(App._pewaktuTunda); App._pewaktuTunda = null; App._tertunda = null;
    const jalan = function () {
      if (t.urutan !== App._urutMuat || !App.token) return;
      jalankanAman(function () { terapkanRuangKerja(t.data, false); }, null, 'ruangKerja');
    };
    if (window.requestIdleCallback) requestIdleCallback(jalan, { timeout: 1200 }); else setTimeout(jalan, 30);
  }, 700);
}

// ── Pencarian: tunggu ketikan selesai (HP tidak tersendat di setiap huruf) ──
function tundaCari(fn, jeda) {
  const k = (fn && fn.name) || 'cari';
  clearTimeout(tundaCari._t[k]);
  tundaCari._t[k] = setTimeout(function () {
    try { fn(); } catch (e) { console.warn('Pencarian gagal:', e); }
  }, jeda || 200);
}
tundaCari._t = {};

// ── Tabel bertahap ──
function layarKecil() { return window.matchMedia ? window.matchMedia('(max-width: 991.98px)').matches : window.innerWidth < 992; }

/**
 * Isi tbody / wadah dengan potongan HTML secara bertahap.
 * @param {Element} wadah
 * @param {string[]} potongan HTML per baris (boleh berisi lebih dari 1 <tr>)
 */
function isiBertahap(wadah, potongan) {
  if (!wadah) return;
  wadah._bertahapId = (wadah._bertahapId || 0) + 1;
  if (wadah._bertahapObs) { try { wadah._bertahapObs.disconnect(); } catch (e) {} wadah._bertahapObs = null; }
  const awal = layarKecil() ? 30 : 60;
  if (!('IntersectionObserver' in window) || potongan.length <= awal + 15) {
    wadah._sisa = null;
    wadah.innerHTML = potongan.join('');
    return;
  }
  wadah.innerHTML = potongan.slice(0, awal).join('');
  wadah._sisa = potongan.slice(awal);
  pasangPengamatBertahap(wadah, wadah._bertahapId);
}

function pasangPengamatBertahap(wadah, id) {
  if (!wadah._sisa || !wadah._sisa.length || !wadah.lastElementChild) return;
  const obs = new IntersectionObserver(function (entri) {
    if (!entri.some(function (e) { return e.isIntersecting; })) return;
    obs.disconnect();
    if (wadah._bertahapId !== id || !wadah._sisa) return;
    const ambil = wadah._sisa.splice(0, 40);
    wadah.insertAdjacentHTML('beforeend', ambil.join(''));
    pasangPengamatBertahap(wadah, id);
  }, { rootMargin: '0px 0px 1200px 0px' });
  obs.observe(wadah.lastElementChild);
  wadah._bertahapObs = obs;
}

/** Pastikan seluruh baris sudah tergambar (dipakai sebelum menyimpan dari tabel). */
function tuntaskanBertahap(wadah) {
  if (!wadah || !wadah._sisa || !wadah._sisa.length) return;
  if (wadah._bertahapObs) { try { wadah._bertahapObs.disconnect(); } catch (e) {} wadah._bertahapObs = null; }
  wadah.insertAdjacentHTML('beforeend', wadah._sisa.join(''));
  wadah._sisa = null;
}

// ════════ BAGIAN 31 — SITEPLAN KAVLING (v5.0) ════════
// Denah per proyek dengan warna status setiap kavling — memudahkan marketing
// & kantor melihat unit yang sudah terjual / dalam proses.
// • Tanpa pengaturan apa pun: denah otomatis tersusun per blok.
// • Owner / Marketing dapat mengunggah gambar siteplan asli lalu menempatkan
//   setiap kavling di atasnya (ketuk-pilih, ketuk-tempatkan — nyaman di HP).
// • Cetak Denah PDF, Download Denah JPG, Reset tampilan, zoom, cari & saring.

JUDUL_HALAMAN.siteplan = 'Siteplan Kavling';

// Halaman dibuat dari kerangka halaman lain (Index.html tidak perlu diubah)
(function () {
  const ref = document.getElementById('app-indent');
  if (ref && !document.getElementById('app-siteplan')) {
    const sec = ref.cloneNode(false);
    sec.id = 'app-siteplan';
    sec.classList.remove('active');
    ref.parentNode.insertBefore(sec, ref.nextSibling);
  }
})();

const SP_KATEGORI = [
  { id: 'tersedia', t: 'Tersedia',              c: '#FFFFFF', tx: '#3A2E31', g: '#B9AEB1' },
  { id: 'booking',  t: 'Booking / Diajukan',    c: '#9FDDAA', tx: '#163D22', g: '#5BAA6A' },
  { id: 'lengkap',  t: 'Berkas Lengkap',        c: '#86B6F2', tx: '#10305C', g: '#4A7FC4' },
  { id: 'bank',     t: 'Proses Bank',           c: '#FFD966', tx: '#4D3A00', g: '#C9A227' },
  { id: 'sp3k',     t: 'SP3K',                  c: '#1F7A4F', tx: '#FFFFFF', g: '#135234' },
  { id: 'akad',     t: 'Jadwal Akad',           c: '#F39A3D', tx: '#3F2200', g: '#C06C14' },
  { id: 'terjual',  t: 'Akad Selesai / Terjual', c: '#8C5BC8', tx: '#FFFFFF', g: '#5F3794' },
  { id: 'cash',     t: 'Pembelian Cash',        c: '#A9A9A9', tx: '#222222', g: '#777777' },
  { id: 'tempo',    t: 'Pembelian Tempo',       c: '#B8875C', tx: '#FFFFFF', g: '#8A5E38' },
  { id: 'ditolak',  t: 'Ditolak Bank',          c: '#E35D57', tx: '#FFFFFF', g: '#A93430' }
];

const SP = { proyek: null, zoom: 1, filter: '', cari: '', atur: false, draf: null, pilih: '', lanjut: true, gambar: {}, memuat: {} };

function spKat(id) { return SP_KATEGORI.find(function (k) { return k.id === id; }) || SP_KATEGORI[0]; }
function spBolehAtur() { return !!(App.sesi && (App.sesi.role === 'Owner' || App.sesi.role === 'Marketing')); }
function spCfg(idP) { return (App.siteplan && App.siteplan[idP]) || {}; }
function spUrutNomor(a, b) {
  if (a.blok !== b.blok) return String(a.blok).localeCompare(String(b.blok), undefined, { numeric: true });
  return String(a.nomor).localeCompare(String(b.nomor), undefined, { numeric: true });
}

/** Kategori warna dari status kavling + transaksi + berkas KPR. */
function spKategori(k, t) {
  if (!t) {
    const st = String(k.status || 'Tersedia');
    if (st === 'Tersedia') return 'tersedia';
    if (st === 'SP3K') return 'sp3k';
    if (st === 'Terjual') return 'terjual';
    return 'booking';
  }
  if (t.metode === 'Cash') return 'cash';
  if (t.metode === 'Tempo') return 'tempo';
  const b = t.berkas || {};
  const bs = String(b.status || '');
  if (bs === 'Akad Selesai' || t.status === 'Terjual') return 'terjual';
  if (bs === 'Ditolak' || t.status === 'Ditolak') return 'ditolak';
  if (bs === 'Jadwal Akad' || b.tanggalAkad) return 'akad';
  if (bs === 'SP3K' || t.status === 'SP3K') return 'sp3k';
  if (b.bankProses) return 'bank';
  if (bs === 'Lengkap 100%') return 'lengkap';
  return 'booking';
}

/** Data kavling satu proyek + transaksi + kategori. */
function spData(idP) {
  const trx = {};
  (App.transaksi || []).forEach(function (t) {
    if (t.idProyek !== idP || !t.idKavling) return;
    const ada = trx[t.idKavling];
    if (!ada || String(t.tanggal || '') >= String(ada.tanggal || '')) trx[t.idKavling] = t;
  });
  return (App.kavling || []).filter(function (k) { return k.idProyek === idP; }).sort(spUrutNomor).map(function (k) {
    const t = trx[k.id] || null;
    return { k: k, t: t, kat: spKategori(k, t) };
  });
}

function spProyekList() {
  const punya = {};
  (App.kavling || []).forEach(function (k) { punya[k.idProyek] = true; });
  return (App.proyek || []).filter(function (p) { return punya[p.id]; });
}

function spCocok(d) {
  const q = String(SP.cari || '').trim().toLowerCase();
  if (!q) return false;
  const k = d.k, t = d.t;
  const teks = [k.blok + '-' + k.nomor, k.blok + k.nomor, k.blok + ' ' + k.nomor, 'no ' + k.nomor, k.tipe,
    t ? t.nama : '', t ? t.marketing : ''].join(' | ').toLowerCase();
  if (/^\d+$/.test(q)) return String(k.nomor).toLowerCase() === q;
  return teks.indexOf(q) >= 0;
}

// ── Halaman ──
function renderSiteplan() {
  const el = document.getElementById('app-siteplan');
  if (!el) return;
  const daftar = spProyekList();
  if (!daftar.length) {
    el.innerHTML = '<h2 class="mb-1">Siteplan</h2>' +
      emptyState('map', 'Belum ada kavling', 'Tambahkan proyek & kavling di menu Master Proyek & Kavling terlebih dahulu.');
    return;
  }
  if (!SP.proyek || !daftar.some(function (p) { return p.id === SP.proyek; })) {
    SP.proyek = (App.proyekAktif && daftar.some(function (p) { return p.id === App.proyekAktif.id; })) ? App.proyekAktif.id : daftar[0].id;
  }
  el.innerHTML =
    '<div class="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">' +
      '<div><h2 class="mb-0">Siteplan</h2>' +
        '<span class="text-muted-2" style="font-size:.86rem">Pantau kavling yang sudah terjual & dalam proses langsung di denah.</span></div>' +
      '<div class="d-flex gap-2 flex-wrap sp-aksi">' +
        '<button class="btn btn-sm btn-brand" onclick="spCetakPdf()"><i class="bi bi-file-earmark-pdf"></i> Cetak Denah PDF</button>' +
        '<button class="btn btn-sm btn-outline-brand" id="btnSpJpg" onclick="spUnduhJpg()"><i class="bi bi-image"></i> Download Denah JPG</button>' +
        '<button class="btn btn-sm btn-ghost" onclick="spReset()"><i class="bi bi-arrow-counterclockwise"></i> Reset Siteplan</button>' +
        (spBolehAtur() && !SP.atur ? '<button class="btn btn-sm btn-outline-gold" id="btnSpAtur" onclick="spMulaiAtur()"><i class="bi bi-pencil-square"></i> Atur Denah</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="sp-tabs mb-3" id="spTabs">' + daftar.map(function (p) {
      return '<button class="sp-tab' + (p.id === SP.proyek ? ' aktif' : '') + '" onclick="spPilihProyek(\'' + escJs(p.id) + '\')">' +
        '<i class="bi bi-buildings"></i> ' + esc(p.nama) + '</button>';
    }).join('') + '</div>' +
    '<div id="spIsi"></div>';
  spGambarIsi();
}

function spPilihProyek(id) {
  if (SP.atur && SP.proyek !== id) {
    konfirmasi('Tinggalkan Pengaturan?', 'Perubahan denah yang belum disimpan tetap tersimpan sebagai draf di perangkat ini. Pindah proyek?', function () {
      SP.atur = false; SP.draf = null; SP.proyek = id; SP.filter = ''; SP.cari = ''; renderSiteplan();
    });
    return;
  }
  SP.proyek = id; SP.filter = ''; SP.cari = '';
  renderSiteplan();
}

function spGambarIsi() {
  const wadah = document.getElementById('spIsi');
  if (!wadah) return;
  const idP = SP.proyek;
  const data = spData(idP);
  const cfg = spCfg(idP);
  const hitung = {};
  data.forEach(function (d) { hitung[d.kat] = (hitung[d.kat] || 0) + 1; });
  const total = data.length;
  const tersedia = hitung.tersedia || 0;
  const terjual = (hitung.terjual || 0) + (hitung.cash || 0) + (hitung.tempo || 0);
  const proses = total - tersedia - terjual;

  const pakaiGambar = !!(cfg.fileId || (SP.atur && SP.draf && SP.draf.gambarLokal));
  const fileId = cfg.fileId;
  const urlGambar = (SP.atur && SP.draf && SP.draf.gambarLokal) || (fileId ? SP.gambar[fileId] : '');
  if (fileId && !SP.gambar[fileId]) spMuatGambar(idP, fileId);

  wadah.innerHTML =
    '<div class="row g-2 mb-3 sp-ringkas">' +
      [['Total Unit', total, ''], ['Tersedia', tersedia, 'var(--success)'], ['Dalam Proses', proses, 'var(--accent)'], ['Terjual', terjual, 'var(--primary)']]
        .map(function (r) {
          return '<div class="col-6 col-md-3"><div class="card-flat p-2 px-3 h-100"><div class="text-muted-2" style="font-size:.74rem">' + r[0] + '</div>' +
            '<div class="font-head" style="font-size:1.3rem;font-weight:700' + (r[2] ? ';color:' + r[2] : '') + '">' + r[1] + '</div></div></div>';
        }).join('') +
    '</div>' +
    '<div class="sp-legenda mb-2">' + SP_KATEGORI.filter(function (k) { return hitung[k.id] || k.id === 'tersedia'; }).map(function (k) {
      return '<button class="sp-leg' + (SP.filter === k.id ? ' aktif' : '') + (SP.filter && SP.filter !== k.id ? ' redup' : '') + '" ' +
        'onclick="spFilter(\'' + k.id + '\')" title="Tampilkan hanya: ' + esc(k.t) + '">' +
        '<span class="sp-dot" style="background:' + k.c + ';border-color:' + k.g + '"></span>' + esc(k.t) + ' <b>' + (hitung[k.id] || 0) + '</b></button>';
    }).join('') + '</div>' +
    '<div class="d-flex flex-wrap gap-2 align-items-center mb-2">' +
      '<div class="input-group input-group-sm" style="max-width:300px;flex:1 1 200px">' +
        '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="spCari" placeholder="Cari no. kavling / nama konsumen…" value="' + esc(SP.cari) + '" oninput="tundaCari(spCariUi)">' +
      '</div>' +
      '<span class="text-muted-2" id="spInfoCari" style="font-size:.78rem"></span>' +
      '<div class="btn-group btn-group-sm ms-auto sp-zoom-btn" role="group">' +
        '<button class="btn btn-ghost" onclick="spZoom(-1)" title="Perkecil"><i class="bi bi-zoom-out"></i></button>' +
        '<button class="btn btn-ghost" id="spZoomTeks" onclick="spZoom(0)" title="Pas layar">' + Math.round(SP.zoom * 100) + '%</button>' +
        '<button class="btn btn-ghost" onclick="spZoom(1)" title="Perbesar"><i class="bi bi-zoom-in"></i></button>' +
      '</div>' +
    '</div>' +
    (SP.atur ? spHtmlPanelAtur(data, cfg) : '') +
    (fileId && !urlGambar && !(SP.atur && SP.draf && SP.draf.hapusGambar)
      ? '<div class="text-muted-2 mb-2" style="font-size:.8rem"><span class="spinner-inline"></span> Memuat gambar siteplan… sementara ditampilkan denah otomatis.</div>' : '') +
    '<div class="sp-kanvas card-lux' + (SP.atur ? ' sp-mode-atur' : '') + '" id="spKanvas">' +
      '<div class="sp-zoom" id="spZoomWadah" style="width:' + Math.round(SP.zoom * 100) + '%">' +
        spSvgTampil(idP, data, cfg, pakaiGambar && urlGambar && !(SP.atur && SP.draf && SP.draf.hapusGambar) ? urlGambar : '') +
      '</div>' +
    '</div>' +
    spHtmlBelumDitempatkan(data, cfg, pakaiGambar && urlGambar) +
    '<div class="text-muted-2 mt-2" style="font-size:.76rem"><i class="bi bi-hand-index"></i> ' +
      (SP.atur ? 'Ketuk penanda untuk memilih kavling, lalu ketuk lokasinya pada gambar.' : 'Ketuk kavling untuk melihat detail unit & konsumen.') +
      (cfg.update && !SP.atur ? ' · Denah diperbarui ' + esc(tglIndo(String(cfg.update).slice(0, 10))) + (cfg.oleh ? ' oleh ' + esc(cfg.oleh) : '') : '') + '</div>';

  spPasangInteraksi();
  if (SP.cari) {
    const el = document.querySelector('#spKanvas .sp-cocok');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
  }
}

/** SVG yang tampil di layar (gambar asli bila ada, selain itu denah otomatis). */
function spSvgTampil(idP, data, cfg, urlGambar) {
  if (urlGambar) return spSvgGambar(data, spCfgAktif(cfg), urlGambar, { layar: true });
  const lebar = (document.getElementById('spIsi') || {}).clientWidth || 800;
  return spSvgOtomatis(data, lebar, { layar: true });
}

function spCfgAktif(cfg) {
  if (SP.atur && SP.draf) return { rasio: SP.draf.rasio || cfg.rasio, penanda: SP.draf.penanda, posisi: SP.draf.posisi };
  return { rasio: cfg.rasio, penanda: cfg.penanda || { w: 3.2, h: 4.2 }, posisi: cfg.posisi || {} };
}

function spWarnaTeks(kat) { return spKat(kat).tx; }

/** Denah otomatis: blok demi blok, dipisahkan jalan. */
function spSvgOtomatis(data, lebarWadah, opsi) {
  opsi = opsi || {};
  const W = 52, H = 64, GAP = 4, PAD = 22, LABEL = 28, JALAN = 30;
  const perBaris = opsi.perBaris || Math.max(6, Math.min(18, Math.floor((lebarWadah - 24) / 46)));
  const grup = {}, urut = [];
  data.forEach(function (d) {
    const b = d.k.blok || '-';
    if (!grup[b]) { grup[b] = []; urut.push(b); }
    grup[b].push(d);
  });
  const lebar = PAD * 2 + perBaris * (W + GAP) - GAP;
  let y = PAD, isi = '';
  urut.forEach(function (b, iB) {
    const items = grup[b];
    const namaBlok = items[0].k.namaBlok ? ' — ' + items[0].k.namaBlok : '';
    isi += '<text x="' + PAD + '" y="' + (y + 18) + '" class="sp-label-blok" font-size="15" font-weight="700" fill="' + (opsi.layar ? 'currentColor' : '#5C0427') + '">BLOK ' +
      esc(String(b).toUpperCase()) + esc(namaBlok) + '</text>' +
      '<text x="' + (lebar - PAD) + '" y="' + (y + 18) + '" text-anchor="end" font-size="11" fill="' + (opsi.layar ? 'currentColor' : '#6B5C60') + '" opacity=".75">' +
      items.length + ' unit · ' + items.filter(function (d) { return d.kat === 'tersedia'; }).length + ' tersedia</text>';
    y += LABEL;
    for (let i = 0; i < items.length; i += perBaris) {
      items.slice(i, i + perBaris).forEach(function (d, j) {
        isi += spHtmlPlot(d, PAD + j * (W + GAP), y, W, H, opsi);
      });
      y += H + GAP;
    }
    y += 8;
    if (iB < urut.length - 1) {
      isi += '<rect x="0" y="' + y + '" width="' + lebar + '" height="' + JALAN + '" fill="' + (opsi.layar ? 'var(--sp-jalan)' : '#E4DFDD') + '"/>' +
        '<line x1="' + PAD + '" y1="' + (y + JALAN / 2) + '" x2="' + (lebar - PAD) + '" y2="' + (y + JALAN / 2) + '" stroke="#FFFFFF" stroke-width="2" stroke-dasharray="14 10"/>';
      y += JALAN + 10;
    }
  });
  const tinggi = y + PAD - 10;
  return '<svg class="sp-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + lebar + ' ' + tinggi + '" width="' + (opsi.lebarPx || '100%') + '"' +
    (opsi.lebarPx ? ' height="' + Math.round(opsi.lebarPx * tinggi / lebar) + '"' : '') +
    ' font-family="Arial, Helvetica, sans-serif" data-w="' + lebar + '" data-h="' + tinggi + '">' + isi + '</svg>';
}

function spHtmlPlot(d, x, y, w, h, opsi) {
  const kat = spKat(d.kat);
  const redup = SP.filter && SP.filter !== d.kat;
  const cocok = spCocok(d);
  const pilih = SP.atur && SP.pilih === d.k.id;
  const fs = Math.max(7, Math.min(w, h) * 0.34);
  return '<g class="sp-kav' + (cocok ? ' sp-cocok' : '') + (pilih ? ' sp-pilih' : '') + '" data-kav="' + esc(d.k.id) + '" transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')"' +
    (redup && !cocok ? ' opacity="0.18"' : '') + '>' +
    '<title>' + esc('Blok ' + d.k.blok + ' No. ' + d.k.nomor + ' — ' + kat.t + (d.t ? ' — ' + d.t.nama : '')) + '</title>' +
    '<rect width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(4, w / 8).toFixed(1) + '" fill="' + kat.c + '" stroke="' +
      (cocok || pilih ? '#C9A24B' : kat.g) + '" stroke-width="' + (cocok || pilih ? 3 : 1.2) + '"' + (opsi.gambar ? ' fill-opacity="0.9"' : '') + '/>' +
    '<text x="' + (w / 2).toFixed(1) + '" y="' + (h / 2 + fs * 0.36).toFixed(1) + '" text-anchor="middle" font-size="' + fs.toFixed(1) + '" font-weight="700" fill="' + kat.tx + '">' +
      esc(String(d.k.nomor)) + '</text>' +
    (!opsi.gambar && d.k.tipe ? '<text x="' + (w / 2) + '" y="' + (h - 7) + '" text-anchor="middle" font-size="8.5" fill="' + kat.tx + '" opacity=".8">' +
      esc(String(d.k.tipe).slice(0, 9)) + '</text>' : '') +
    (!opsi.gambar ? '<text x="' + (w / 2) + '" y="13" text-anchor="middle" font-size="8.5" fill="' + kat.tx + '" opacity=".75">' + esc(String(d.k.blok).slice(0, 6)) + '</text>' : '') +
    '</g>';
}

/** Denah dari gambar siteplan asli + penanda kavling. */
function spSvgGambar(data, cfg, urlGambar, opsi) {
  opsi = opsi || {};
  const VW = 1000;
  const rasio = cfg.rasio > 0 ? cfg.rasio : 0.7;
  const VH = Math.round(VW * rasio);
  const pn = cfg.penanda || { w: 3.2, h: 4.2 };
  const w = pn.w / 100 * VW, h = pn.h / 100 * VW;
  const pos = cfg.posisi || {};
  let isi = urlGambar && !opsi.tanpaGambar
    ? '<image href="' + urlGambar + '" x="0" y="0" width="' + VW + '" height="' + VH + '" preserveAspectRatio="none"/>' : '';
  data.forEach(function (d) {
    const p = pos[d.k.id];
    if (!p) return;
    isi += spHtmlPlot(d, p[0] / 100 * VW - w / 2, p[1] / 100 * VH - h / 2, w, h, { gambar: true, layar: opsi.layar });
  });
  return '<svg class="sp-svg sp-svg-gambar" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VW + ' ' + VH + '" width="' + (opsi.lebarPx || '100%') + '"' +
    (opsi.lebarPx ? ' height="' + Math.round(opsi.lebarPx * rasio) + '"' : '') +
    ' font-family="Arial, Helvetica, sans-serif" data-w="' + VW + '" data-h="' + VH + '">' + isi + '</svg>';
}

function spHtmlBelumDitempatkan(data, cfg, adaGambar) {
  if (!adaGambar) return '';
  const pos = spCfgAktif(cfg).posisi || {};
  const belum = data.filter(function (d) { return !pos[d.k.id]; });
  if (!belum.length) return '';
  return '<div class="card-flat p-2 px-3 mt-2"><div class="text-muted-2 mb-1" style="font-size:.76rem">' +
    '<i class="bi bi-exclamation-circle"></i> ' + belum.length + ' kavling belum ditempatkan pada gambar' +
    (spBolehAtur() && !SP.atur ? ' — tekan <b>Atur Denah</b> untuk menempatkannya' : '') + ':</div>' +
    '<div class="d-flex flex-wrap gap-1">' + belum.slice(0, 120).map(function (d) {
      const k = spKat(d.kat);
      return '<button class="sp-mini" data-kav="' + esc(d.k.id) + '" style="background:' + k.c + ';color:' + k.tx + ';border-color:' + k.g + '"' +
        ' onclick="' + (SP.atur ? 'spPilihKavling(\'' + escJs(d.k.id) + '\')' : 'spInfo(\'' + escJs(d.k.id) + '\')') + '">' +
        esc(d.k.blok + '-' + d.k.nomor) + '</button>';
    }).join('') + (belum.length > 120 ? '<span class="text-muted-2" style="font-size:.76rem">+' + (belum.length - 120) + ' lagi</span>' : '') +
    '</div></div>';
}

// ── Interaksi ──
function spPasangInteraksi() {
  const kanvas = document.getElementById('spKanvas');
  if (!kanvas) return;
  kanvas.onclick = function (e) {
    const g = e.target.closest ? e.target.closest('[data-kav]') : null;
    if (SP.atur) {
      if (SP._barusanGeser) { SP._barusanGeser = false; return; }
      if (g) { spPilihKavling(g.getAttribute('data-kav')); return; }
      const svg = kanvas.querySelector('svg.sp-svg-gambar');
      if (svg && SP.pilih) spTempatkan(svg, e.clientX, e.clientY);
      else if (svg && !SP.pilih) showToast('Pilih Kavling', 'Pilih kavling dahulu (ketuk penanda atau pilih dari daftar).', 'info');
      return;
    }
    if (g) spInfo(g.getAttribute('data-kav'));
  };
  // Geser penanda dengan mouse (komputer). Di HP: ketuk-pilih lalu ketuk lokasi baru.
  kanvas.onpointerdown = function (e) {
    if (!SP.atur || e.pointerType !== 'mouse') return;
    const g = e.target.closest ? e.target.closest('[data-kav]') : null;
    const svg = kanvas.querySelector('svg.sp-svg-gambar');
    if (!g || !svg) return;
    const id = g.getAttribute('data-kav');
    const awal = { x: e.clientX, y: e.clientY };
    let geser = false;
    function gerak(ev) {
      if (!geser && Math.abs(ev.clientX - awal.x) + Math.abs(ev.clientY - awal.y) < 5) return;
      geser = true;
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const pn = SP.draf.penanda;
      const px = (ev.clientX - r.left) / r.width * vb.width - pn.w / 100 * vb.width / 2;
      const py = (ev.clientY - r.top) / r.height * vb.height - pn.h / 100 * vb.width / 2;
      g.setAttribute('transform', 'translate(' + px.toFixed(1) + ',' + py.toFixed(1) + ')');
    }
    function lepas(ev) {
      window.removeEventListener('pointermove', gerak);
      window.removeEventListener('pointerup', lepas);
      if (!geser) return;
      SP._barusanGeser = true;
      SP.pilih = id;
      spTempatkan(svg, ev.clientX, ev.clientY, true);
    }
    window.addEventListener('pointermove', gerak);
    window.addEventListener('pointerup', lepas);
    e.preventDefault();
  };
}

function spInfo(idKav) {
  const d = spData(SP.proyek).find(function (x) { return x.k.id === idKav; });
  if (!d) return;
  const k = d.k, t = d.t, kat = spKat(d.kat);
  const p = (App.proyek || []).find(function (x) { return x.id === k.idProyek; }) || {};
  const role = App.sesi.role;
  const baris = [
    ['Proyek', p.nama || '-'], ['Unit', 'Blok ' + k.blok + (k.namaBlok ? ' (' + k.namaBlok + ')' : '') + ' No. ' + k.nomor],
    ['Tipe', k.tipe || '-'], ['Luas Tanah / Bangunan', (k.lt || 0) + ' m² / ' + (k.lb || 0) + ' m²'],
    ['Harga', rp(k.promoAktif ? Math.max(k.harga - k.promoNominal, 0) : k.harga)], ['Status Kavling', k.status || 'Tersedia']
  ];
  if (t) {
    baris.push(['Nama Konsumen', t.nama || '-']);
    if (role !== 'Perbankan' && t.hp) baris.push(['No. HP', t.hp]);
    baris.push(['Metode Pembelian', t.metode || '-'], ['Marketing', t.marketing || '-'], ['Tanggal Transaksi', tglIndo(t.tanggal)]);
    if (t.metode === 'KPR') {
      const b = t.berkas || {};
      baris.push(['Status Berkas KPR', b.status || 'Diajukan']);
      if (b.bank) baris.push(['Bank', b.bank]);
      if (b.bankProses) baris.push(['Proses di Bank', b.bankProses + (b.bankProsesTgl ? ' · ' + tglIndo(b.bankProsesTgl) : '')]);
      if (b.plafon > 0) baris.push(['Plafon Disetujui', rp(b.plafon)]);
      if (b.tanggalAkad) baris.push(['Jadwal Akad', tglIndo(b.tanggalAkad) + ' ' + (b.waktuAkad || '') + (b.lokasiAkad ? ' · ' + b.lokasiAkad : '')]);
    }
  } else if (k.status && k.status !== 'Tersedia') {
    baris.push(['Konsumen', role === 'Perbankan' ? 'Bukan konsumen KPR' : 'Data transaksi tidak ditemukan']);
  }
  const isi = '<div class="d-flex align-items-center gap-2 mb-3">' +
      '<span class="sp-dot sp-dot-lg" style="background:' + kat.c + ';border-color:' + kat.g + '"></span>' +
      '<b>' + esc(kat.t) + '</b></div>' +
    '<table class="table table-sm mb-0" style="font-size:.88rem">' + baris.map(function (r) {
      return '<tr><td class="text-muted-2" style="width:42%">' + esc(r[0]) + '</td><td><b>' + esc(r[1]) + '</b></td></tr>';
    }).join('') + '</table>';
  const tombol = '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>' +
    (t ? '<button class="btn btn-outline-brand" onclick="closeModal();setTimeout(function(){detailTransaksi(\'' + escJs(t.id) + '\')},350)"><i class="bi bi-person-vcard"></i> Detail Konsumen</button>' : '') +
    (t ? '<button class="btn btn-brand" onclick="spKeDataKonsumen(\'' + escJs(k.idProyek) + '\')"><i class="bi bi-people"></i> Data Konsumen</button>' : '');
  openModal('Kavling ' + k.blok + '-' + k.nomor, isi, tombol, 'modal-md');
}

function spKeDataKonsumen(idP) {
  closeModal();
  const p = (App.proyek || []).find(function (x) { return x.id === idP; });
  if (p) { App.proyekAktif = p; goApp('dataKonsumen'); }
}

function spFilter(id) {
  SP.filter = SP.filter === id ? '' : id;
  spGambarIsi();
}

function spCariUi() {
  const el = document.getElementById('spCari');
  const fokus = !!el && el === document.activeElement;
  SP.cari = el ? el.value : '';
  const pos = el ? el.selectionStart : 0;
  spGambarIsi();
  const baru = document.getElementById('spCari');
  if (baru && fokus) { try { baru.focus({ preventScroll: true }); baru.setSelectionRange(pos, pos); } catch (e) {} }
  const n = document.querySelectorAll('#spKanvas .sp-cocok').length;
  const info = document.getElementById('spInfoCari');
  if (info) info.textContent = SP.cari.trim() ? (n ? n + ' kavling ditemukan' : 'Tidak ada yang cocok') : '';
}

const SP_ZOOM = [1, 1.5, 2, 3, 4];
function spZoom(arah) {
  const kanvas = document.getElementById('spKanvas');
  const wadah = document.getElementById('spZoomWadah');
  let i = SP_ZOOM.indexOf(SP.zoom);
  if (i < 0) i = 0;
  const lama = SP.zoom;
  SP.zoom = arah === 0 ? 1 : SP_ZOOM[Math.max(0, Math.min(SP_ZOOM.length - 1, i + arah))];
  if (!kanvas || !wadah) return;
  const cx = (kanvas.scrollLeft + kanvas.clientWidth / 2) / lama;
  const cy = (kanvas.scrollTop + kanvas.clientHeight / 2) / lama;
  wadah.style.width = Math.round(SP.zoom * 100) + '%';
  kanvas.scrollLeft = cx * SP.zoom - kanvas.clientWidth / 2;
  kanvas.scrollTop = cy * SP.zoom - kanvas.clientHeight / 2;
  const t = document.getElementById('spZoomTeks');
  if (t) t.textContent = Math.round(SP.zoom * 100) + '%';
}

/** Reset Siteplan: kembalikan tampilan (zoom, saringan, pencarian) seperti semula. Data tidak berubah. */
function spReset() {
  SP.zoom = 1; SP.filter = ''; SP.cari = '';
  renderSiteplan();
  const k = document.getElementById('spKanvas');
  if (k) { k.scrollLeft = 0; k.scrollTop = 0; }
  showToast('Siteplan', 'Tampilan denah dikembalikan seperti semula.', 'info');
}

// ── Gambar siteplan (diambil sekali sebagai data URL agar bisa dicetak & diunduh) ──
function spMuatGambar(idP, fileId) {
  if (!fileId || SP.gambar[fileId] || SP.memuat[fileId]) return;
  try {
    const simpan = sessionStorage.getItem('ecp_spimg_' + fileId);
    if (simpan) { SP.gambar[fileId] = simpan; return; }
  } catch (e) { /* lanjut ambil */ }
  SP.memuat[fileId] = true;
  call('getFilePratinjau', App.token, fileId).then(function (res) {
    SP.memuat[fileId] = false;
    if (!res || !res.success || !res.data || !res.data.data) {
      showToast('Gambar Siteplan', (res && res.message) || 'Gambar siteplan belum dapat dimuat — denah otomatis ditampilkan.', 'warning');
      SP.gambar[fileId] = '';
      return;
    }
    const url = 'data:' + (res.data.mime || 'image/jpeg') + ';base64,' + res.data.data;
    SP.gambar[fileId] = url;
    try { if (url.length < 1800000) sessionStorage.setItem('ecp_spimg_' + fileId, url); } catch (e) { /* penuh: abaikan */ }
    if (App.appPage === 'siteplan' && SP.proyek === idP) spGambarIsi();
  }).catch(function () { SP.memuat[fileId] = false; });
}

// ── Atur denah (Owner & Marketing) ──
function spKunciDraf(idP) { return 'spdraf_' + idP; }

function spMulaiAtur() {
  if (!spBolehAtur()) return;
  const idP = SP.proyek;
  const cfg = spCfg(idP);
  const draf = LS.get(spKunciDraf(idP), null);
  SP.draf = {
    posisi: JSON.parse(JSON.stringify(cfg.posisi || {})),
    penanda: Object.assign({ w: 3.2, h: 4.2 }, cfg.penanda || {}),
    rasio: cfg.rasio || 0
  };
  if (draf && draf.posisi && draf.waktu && (!cfg.update || draf.waktu > Date.parse(cfg.update) || isNaN(Date.parse(cfg.update)))) {
    SP.draf.posisi = draf.posisi;
    SP.draf.penanda = Object.assign(SP.draf.penanda, draf.penanda || {});
    showToast('Draf Dipulihkan', 'Penempatan kavling yang belum disimpan sebelumnya dipulihkan.', 'info');
  }
  SP.atur = true;
  SP.filter = '';
  SP.pilih = spBerikutnyaBelum(idP, '');
  renderSiteplan();
  const b = document.getElementById('btnSpAtur'); if (b) b.classList.add('hidden');
}

function spSimpanDraf() {
  if (!SP.draf) return;
  LS.set(spKunciDraf(SP.proyek), { posisi: SP.draf.posisi, penanda: SP.draf.penanda, waktu: Date.now() });
}

function spBerikutnyaBelum(idP, setelah) {
  const pos = (SP.draf && SP.draf.posisi) || {};
  const data = spData(idP);
  let mulai = 0;
  if (setelah) mulai = data.findIndex(function (d) { return d.k.id === setelah; }) + 1;
  for (let n = 0; n < data.length; n++) {
    const d = data[(mulai + n) % data.length];
    if (!pos[d.k.id]) return d.k.id;
  }
  return '';
}

function spHtmlPanelAtur(data, cfg) {
  const adaGambar = !!((cfg.fileId && !SP.draf.hapusGambar) || SP.draf.gambarLokal);
  const pos = SP.draf.posisi || {};
  const sudah = data.filter(function (d) { return pos[d.k.id]; }).length;
  const opsi = data.slice().sort(function (a, b) { return (pos[a.k.id] ? 1 : 0) - (pos[b.k.id] ? 1 : 0); }).map(function (d) {
    return '<option value="' + esc(d.k.id) + '"' + (SP.pilih === d.k.id ? ' selected' : '') + '>' +
      (pos[d.k.id] ? '✓ ' : '• ') + 'Blok ' + esc(d.k.blok) + ' No. ' + esc(d.k.nomor) + '</option>';
  }).join('');
  return '<div class="card-lux p-3 mb-3 sp-panel-atur">' +
    '<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">' +
      '<h5 class="mb-0"><i class="bi bi-pencil-square"></i> Atur Denah</h5>' +
      '<div class="d-flex gap-2 flex-wrap">' +
        '<button class="btn btn-sm btn-ghost" onclick="spBatalAtur()">Batal</button>' +
        '<button class="btn btn-sm btn-brand" id="btnSpSimpan" onclick="spSimpanAtur()"><i class="bi bi-save"></i> Simpan Denah</button>' +
      '</div></div>' +
    '<div class="row g-3">' +
      '<div class="col-md-5">' +
        '<label class="form-label">1. Gambar siteplan (opsional)</label>' +
        '<div class="d-flex gap-2 flex-wrap">' +
          '<button class="btn btn-sm btn-outline-brand" onclick="document.getElementById(\'spFile\').click()"><i class="bi bi-upload"></i> ' +
            (adaGambar ? 'Ganti Gambar' : 'Unggah Gambar') + '</button>' +
          (adaGambar ? '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="spHapusGambar()"><i class="bi bi-trash"></i> Hapus Gambar</button>' : '') +
        '</div>' +
        '<input type="file" id="spFile" class="hidden" accept="image/jpeg,image/png,image/webp" onchange="spPilihGambar(this)">' +
        '<div class="text-muted-2 mt-1" style="font-size:.76rem">JPG / PNG dari arsitek / brosur. Tanpa gambar, denah otomatis disusun per blok.</div>' +
      '</div>' +
      (adaGambar
        ? '<div class="col-md-7">' +
            '<label class="form-label">2. Tempatkan kavling — <b>' + sudah + '</b> dari ' + data.length + ' sudah ditempatkan</label>' +
            '<select class="form-select form-select-sm mb-2" id="spPilihKav" onchange="spPilihKavling(this.value)">' +
              '<option value="">— Pilih kavling —</option>' + opsi + '</select>' +
            '<div class="form-check form-switch mb-2" style="font-size:.84rem">' +
              '<input class="form-check-input" type="checkbox" id="spLanjut"' + (SP.lanjut ? ' checked' : '') + ' onchange="SP.lanjut=this.checked">' +
              '<label class="form-check-label" for="spLanjut">Setelah ditempatkan, lanjut ke kavling berikutnya</label></div>' +
            '<div class="row g-2 align-items-center" style="font-size:.8rem">' +
              '<div class="col-6"><label class="form-label mb-0">Lebar penanda</label>' +
                '<input type="range" class="form-range" min="0.8" max="10" step="0.1" value="' + SP.draf.penanda.w + '" oninput="spUkuranPenanda(\'w\',this.value)"></div>' +
              '<div class="col-6"><label class="form-label mb-0">Tinggi penanda</label>' +
                '<input type="range" class="form-range" min="0.8" max="10" step="0.1" value="' + SP.draf.penanda.h + '" oninput="spUkuranPenanda(\'h\',this.value)"></div>' +
            '</div>' +
            '<div class="d-flex gap-2 flex-wrap mt-1">' +
              (SP.pilih && pos[SP.pilih] ? '<button class="btn btn-sm btn-ghost" onclick="spLepasPenanda()"><i class="bi bi-x-circle"></i> Lepas penanda terpilih</button>' : '') +
              (sudah ? '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="spHapusSemuaPosisi()"><i class="bi bi-eraser"></i> Hapus Semua Posisi</button>' : '') +
            '</div>' +
          '</div>'
        : '<div class="col-md-7 text-muted-2" style="font-size:.84rem"><i class="bi bi-info-circle"></i> Unggah gambar siteplan untuk menempatkan kavling sesuai denah asli. ' +
            'Penanda kavling akan berwarna otomatis mengikuti status penjualan.</div>') +
    '</div></div>';
}

function spPilihKavling(id) {
  SP.pilih = id || '';
  spGambarIsi();
}

function spTempatkan(svg, clientX, clientY, dariGeser) {
  if (!SP.draf || !SP.pilih) return;
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const x = Math.max(0, Math.min(100, (clientX - r.left) / r.width * 100));
  const y = Math.max(0, Math.min(100, (clientY - r.top) / r.height * 100));
  const id = SP.pilih;
  const sebelumnya = !!SP.draf.posisi[id];
  SP.draf.posisi[id] = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  spSimpanDraf();
  if (!dariGeser && !sebelumnya && SP.lanjut) SP.pilih = spBerikutnyaBelum(SP.proyek, id);
  const kanvas = document.getElementById('spKanvas');
  const gl = kanvas ? kanvas.scrollLeft : 0, gt = kanvas ? kanvas.scrollTop : 0;
  spGambarIsi();
  const k2 = document.getElementById('spKanvas');
  if (k2) { k2.scrollLeft = gl; k2.scrollTop = gt; }
}

function spLepasPenanda() {
  if (!SP.draf || !SP.pilih) return;
  delete SP.draf.posisi[SP.pilih];
  spSimpanDraf();
  spGambarIsi();
}

function spUkuranPenanda(sisi, nilai) {
  if (!SP.draf) return;
  SP.draf.penanda[sisi] = Number(nilai) || 3;
  spSimpanDraf();
  clearTimeout(SP._tUkuran);
  SP._tUkuran = setTimeout(function () {
    const kanvas = document.getElementById('spKanvas');
    const gl = kanvas ? kanvas.scrollLeft : 0, gt = kanvas ? kanvas.scrollTop : 0;
    const wadah = document.getElementById('spZoomWadah');
    const cfg = spCfg(SP.proyek);
    const url = SP.draf.gambarLokal || (cfg.fileId ? SP.gambar[cfg.fileId] : '');
    if (wadah && url) wadah.innerHTML = spSvgGambar(spData(SP.proyek), spCfgAktif(cfg), url, { layar: true });
    if (kanvas) { kanvas.scrollLeft = gl; kanvas.scrollTop = gt; }
  }, 60);
}

function spHapusSemuaPosisi() {
  konfirmasi('Hapus Semua Posisi', 'Seluruh penempatan kavling pada gambar akan dikosongkan (baru berlaku setelah Simpan Denah). Lanjutkan?', function () {
    SP.draf.posisi = {};
    spSimpanDraf();
    SP.pilih = spBerikutnyaBelum(SP.proyek, '');
    spGambarIsi();
  });
}

function spBatalAtur() {
  SP.atur = false; SP.draf = null; SP.pilih = '';
  LS.del(spKunciDraf(SP.proyek));
  renderSiteplan();
}

/** Pilih gambar → kompres → tampil seketika → unggah di latar belakang (Optimistic UI). */
function spPilihGambar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { showToast('Format Salah', 'Pilih file gambar JPG / PNG.', 'warning'); return; }
  const idP = SP.proyek;
  kompresGambar(file, 2400, 0.85).then(function (f) {
    const url = 'data:' + f.mime + ';base64,' + f.data;
    const img = new Image();
    img.onload = function () {
      const rasio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
      if (!SP.draf || SP.proyek !== idP) return;
      SP.draf.gambarLokal = url;
      SP.draf.hapusGambar = false;
      SP.draf.rasio = rasio;
      SP.pilih = SP.pilih || spBerikutnyaBelum(idP, '');
      spGambarIsi();
      showToast('Mengunggah', 'Gambar siteplan sedang diunggah…', 'info');
      call('simpanSiteplan', App.token, idP, { gambar: f, rasio: rasio }).then(function (res) {
        if (!res.success) { showToast('Gagal Mengunggah', res.message, 'danger'); return; }
        App.siteplan = App.siteplan || {};
        App.siteplan[idP] = Object.assign({}, res.data || {});
        if (res.data && res.data.fileId) SP.gambar[res.data.fileId] = url;
        if (SP.draf && SP.proyek === idP) SP.draf.gambarLokal = '';
        if (App.appPage === 'siteplan' && SP.proyek === idP) spGambarIsi();
        showToast('Berhasil', 'Gambar siteplan tersimpan. Sekarang tempatkan kavling pada gambar.', 'success');
      }).catch(function (err) { showToast('Error', err.message, 'danger'); });
    };
    img.src = url;
  }).catch(function () { showToast('Gagal', 'Gambar tidak dapat dibaca.', 'danger'); });
}

function spHapusGambar() {
  const idP = SP.proyek;
  konfirmasi('Hapus Gambar Siteplan', 'Gambar & seluruh penempatan kavling proyek ini akan dihapus, denah kembali ke susunan otomatis. Lanjutkan?', function () {
    call('simpanSiteplan', App.token, idP, { hapusGambar: true }).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      App.siteplan[idP] = res.data || {};
      LS.del(spKunciDraf(idP));
      if (SP.draf) { SP.draf.posisi = {}; SP.draf.gambarLokal = ''; }
      spGambarIsi();
      showToast('Berhasil', 'Gambar siteplan dihapus.', 'success');
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

/** Simpan seluruh posisi dalam SATU panggilan; tampilan langsung berubah (Optimistic UI). */
function spSimpanAtur() {
  if (!SP.draf) return;
  const idP = SP.proyek;
  const draf = SP.draf;
  const lama = App.siteplan[idP] ? JSON.parse(JSON.stringify(App.siteplan[idP])) : null;
  const payload = { posisi: draf.posisi, penanda: draf.penanda };
  if (draf.rasio) payload.rasio = draf.rasio;
  App.siteplan = App.siteplan || {};
  App.siteplan[idP] = Object.assign({}, lama || {}, { posisi: draf.posisi, penanda: draf.penanda, rasio: draf.rasio || (lama && lama.rasio) || 0 });
  SP.atur = false; SP.draf = null; SP.pilih = '';
  renderSiteplan();
  showToast('Menyimpan', 'Denah sedang disimpan…', 'info');
  call('simpanSiteplan', App.token, idP, payload).then(function (res) {
    if (!res.success) throw new Error(res.message);
    App.siteplan[idP] = res.data || App.siteplan[idP];
    LS.del(spKunciDraf(idP));
    showToast('Berhasil', 'Denah siteplan tersimpan.', 'success');
    muatWorkspace(false, true);
  }).catch(function (err) {
    // Gagal: kembalikan mode atur beserta draf agar tidak ada pekerjaan yang hilang
    if (lama) App.siteplan[idP] = lama; else delete App.siteplan[idP];
    SP.proyek = idP; SP.atur = true; SP.draf = draf;
    if (App.appPage === 'siteplan') renderSiteplan();
    showToast('Gagal Menyimpan', (err && err.message) || 'Koneksi bermasalah. Draf tetap tersimpan di perangkat ini.', 'danger');
  });
}

// ── Ekspor: Cetak PDF & Download JPG ──
function spRakitEkspor(idP) {
  // Ekspor selalu menampilkan seluruh kavling (tanpa saringan / sorotan pencarian)
  const simpan = { filter: SP.filter, cari: SP.cari, pilih: SP.pilih };
  SP.filter = ''; SP.cari = ''; SP.pilih = '';
  try { return spRakitEksporInti(idP); } finally { SP.filter = simpan.filter; SP.cari = simpan.cari; SP.pilih = simpan.pilih; }
}

function spRakitEksporInti(idP) {
  const p = (App.proyek || []).find(function (x) { return x.id === idP; }) || {};
  const data = spData(idP);
  const cfg = spCfg(idP);
  const url = cfg.fileId ? SP.gambar[cfg.fileId] : '';
  const EW = 1600, PAD = 40, KEPALA = 120;
  let peta, petaH, bg = null;
  if (url) {
    const c = spCfgAktif(cfg);
    petaH = Math.round((EW - PAD * 2) * (c.rasio > 0 ? c.rasio : 0.7));
    peta = spSvgGambar(data, c, url, { tanpaGambar: true, lebarPx: EW - PAD * 2 });
    bg = { url: url, x: PAD, y: KEPALA, w: EW - PAD * 2, h: petaH };
  } else {
    peta = spSvgOtomatis(data, 0, { perBaris: Math.max(10, Math.min(20, Math.ceil(Math.sqrt(data.length * 1.6)))), lebarPx: EW - PAD * 2 });
    const m = peta.match(/data-w="(\d+(?:\.\d+)?)" data-h="(\d+(?:\.\d+)?)"/);
    petaH = m ? Math.round((EW - PAD * 2) * Number(m[2]) / Number(m[1])) : 900;
  }
  const hitung = {};
  data.forEach(function (d) { hitung[d.kat] = (hitung[d.kat] || 0) + 1; });
  const kat = SP_KATEGORI.filter(function (k) { return hitung[k.id] || k.id === 'tersedia'; });
  const perBarisLeg = 4, legH = Math.ceil(kat.length / perBarisLeg) * 34 + 20;
  const total = KEPALA + petaH + 30 + legH + PAD;
  const e = App.etalase || {};
  const tgl = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let leg = '';
  kat.forEach(function (k, i) {
    const x = PAD + (i % perBarisLeg) * ((EW - PAD * 2) / perBarisLeg);
    const y = KEPALA + petaH + 40 + Math.floor(i / perBarisLeg) * 34;
    leg += '<rect x="' + x + '" y="' + y + '" width="26" height="20" rx="4" fill="' + k.c + '" stroke="' + k.g + '"/>' +
      '<text x="' + (x + 36) + '" y="' + (y + 15) + '" font-size="17" fill="#241A1E">' + esc(k.t) + ' (' + (hitung[k.id] || 0) + ')</text>';
  });
  const petaBersarang = peta.replace('<svg ', '<svg x="' + PAD + '" y="' + KEPALA + '" ');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + EW + '" height="' + total + '" viewBox="0 0 ' + EW + ' ' + total + '" font-family="Arial, Helvetica, sans-serif">' +
    (bg ? '' : '<rect width="' + EW + '" height="' + total + '" fill="#FFFFFF"/>') +
    '<text x="' + PAD + '" y="52" font-size="32" font-weight="700" fill="#5C0427" font-family="Georgia, serif">Siteplan — ' + esc(p.nama || '') + '</text>' +
    '<text x="' + PAD + '" y="84" font-size="17" fill="#6B5C60">' + esc(e.namaPerusahaan || '') + (p.alamat || p.kota ? ' · ' + esc([p.alamat, p.kota].filter(Boolean).join(', ')) : '') + '</text>' +
    '<text x="' + (EW - PAD) + '" y="52" text-anchor="end" font-size="16" fill="#6B5C60">Dicetak ' + esc(tgl) + '</text>' +
    '<text x="' + (EW - PAD) + '" y="84" text-anchor="end" font-size="16" fill="#6B5C60">' + data.length + ' unit · ' + (hitung.tersedia || 0) + ' tersedia</text>' +
    '<line x1="' + PAD + '" y1="100" x2="' + (EW - PAD) + '" y2="100" stroke="#C9A24B" stroke-width="2"/>' +
    petaBersarang + leg + '</svg>';
  return { svg: svg, w: EW, h: total, bg: bg, nama: p.nama || 'Proyek', petaSvg: url ? spSvgGambar(data, spCfgAktif(cfg), url, {}) : peta, kategori: kat, hitung: hitung };
}

function spUnduhJpg() {
  const idP = SP.proyek;
  const cfg = spCfg(idP);
  if (cfg.fileId && !SP.gambar[cfg.fileId]) {
    showToast('Tunggu Sebentar', 'Gambar siteplan masih dimuat. Coba lagi beberapa detik lagi.', 'warning');
    spMuatGambar(idP, cfg.fileId);
    return;
  }
  const btn = document.getElementById('btnSpJpg');
  tombolLoading(btn, true);
  const x = spRakitEkspor(idP);
  const skala = 1.5;
  const kanvas = document.createElement('canvas');
  kanvas.width = Math.round(x.w * skala); kanvas.height = Math.round(x.h * skala);
  const ctx = kanvas.getContext('2d');
  ctx.scale(skala, skala);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, x.w, x.h);
  function muat(src) {
    return new Promise(function (ok, gagal) { const im = new Image(); im.onload = function () { ok(im); }; im.onerror = gagal; im.src = src; });
  }
  const urlSvg = URL.createObjectURL(new Blob([x.svg], { type: 'image/svg+xml;charset=utf-8' }));
  (x.bg ? muat(x.bg.url) : Promise.resolve(null)).then(function (bgImg) {
    if (bgImg) ctx.drawImage(bgImg, x.bg.x, x.bg.y, x.bg.w, x.bg.h);
    return muat(urlSvg);
  }).then(function (im) {
    ctx.drawImage(im, 0, 0, x.w, x.h);
    URL.revokeObjectURL(urlSvg);
    kanvas.toBlob(function (blob) {
      tombolLoading(btn, false);
      if (!blob) { showToast('Gagal', 'Gambar denah tidak dapat dibuat.', 'danger'); return; }
      const nama = 'Siteplan_' + String(x.nama).replace(/[^\w-]+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.jpg';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nama; a.style.display = 'none';
      document.body.appendChild(a);
      try { a.click(); } catch (e) { /* lihat pratinjau */ }
      setTimeout(function () { a.remove(); }, 1000);
      // Pratinjau + tautan unduh (cadangan bila unduhan otomatis diblokir; di HP tekan lama gambar → Simpan)
      openModal('Denah JPG — ' + x.nama,
        '<img src="' + url + '" alt="Denah siteplan" style="width:100%;border-radius:12px;border:1px solid var(--border)">' +
        '<div class="text-muted-2 mt-2" style="font-size:.8rem">Bila unduhan tidak berjalan otomatis: tekan tombol Unduh, atau di HP tekan lama gambar lalu pilih <b>Simpan gambar</b>.</div>',
        '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>' +
        '<a class="btn btn-brand" href="' + url + '" download="' + esc(nama) + '"><i class="bi bi-download"></i> Unduh JPG</a>');
      showToast('Berhasil', 'Denah JPG siap diunduh.', 'success');
    }, 'image/jpeg', 0.92);
  }).catch(function (err) {
    tombolLoading(btn, false);
    URL.revokeObjectURL(urlSvg);
    showToast('Gagal', 'Gambar denah tidak dapat dibuat' + (err && err.message ? ': ' + err.message : '.'), 'danger');
  });
}

function spCetakPdf() {
  const idP = SP.proyek;
  const cfg = spCfg(idP);
  if (cfg.fileId && !SP.gambar[cfg.fileId]) {
    showToast('Tunggu Sebentar', 'Gambar siteplan masih dimuat. Coba lagi beberapa detik lagi.', 'warning');
    spMuatGambar(idP, cfg.fileId);
    return;
  }
  const x = spRakitEkspor(idP);
  const e = App.etalase || {};
  const p = (App.proyek || []).find(function (q) { return q.id === idP; }) || {};
  const html = '<html><head><meta charset="utf-8"><title>Siteplan — ' + esc(x.nama) + '</title>' +
    '<style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,Helvetica,sans-serif;color:#241A1E;margin:0}' +
    'h2{font-family:Georgia,serif;color:#5C0427;margin:0 0 2px}.kecil{font-size:11px;color:#6B5C60}' +
    '.peta{margin-top:10px;border:1px solid #E8DEDD;border-radius:8px;padding:6px}.peta svg{width:100%;height:auto;display:block}' +
    '.leg{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:11px}.leg span{display:inline-flex;align-items:center;gap:6px}' +
    '.leg i{display:inline-block;width:16px;height:12px;border-radius:3px;border:1px solid #999;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>' +
    '<h2>Siteplan — ' + esc(x.nama) + '</h2>' +
    '<div class="kecil">' + esc(e.namaPerusahaan || '') + (p.alamat || p.kota ? ' · ' + esc([p.alamat, p.kota].filter(Boolean).join(', ')) : '') +
      ' · Dicetak ' + new Date().toLocaleString('id-ID') + ' oleh ' + esc(App.sesi.nama || App.sesi.username || '') + '</div>' +
    '<div class="peta">' + x.petaSvg.replace(/ class="sp-kav[^"]*"/g, '') + '</div>' +
    '<div class="leg">' + x.kategori.map(function (k) {
      return '<span><i style="background:' + k.c + ';border-color:' + k.g + '"></i>' + esc(k.t) + ' (' + (x.hitung[k.id] || 0) + ')</span>';
    }).join('') + '</div></body></html>';
  cetakHtml(html);
}

// ════════ BAGIAN 32 — LOGIN DI HP TIDAK MACET (v5.0.1) ════════
// • Permintaan lama (token yang sudah habis) tidak lagi melempar ulang ke layar
//   login & memindahkan kursor saat pengguna sedang mengetik.
// • Login diberi batas waktu 25 detik; tombol Masuk selalu kembali normal.
// • Setelah salah sandi: kolom sandi dikosongkan & siap diketik ulang.
// • Lapisan tak terlihat (sisa modal / layar memuat) dibersihkan dari layar login.
// • iPhone: setelah keyboard ditutup, posisi layar dirapikan agar ketukan tepat sasaran.

/** Hentikan semua pekerjaan latar milik sesi sebelumnya (data tertunda & muat ulang yang sedang berjalan). */
function hentikanPekerjaanLatar() {
  App._urutMuat = (App._urutMuat || 0) + 1;          // jawaban getWorkspaceData yang masih di jalan diabaikan
  if (App._pewaktuTunda) { clearInterval(App._pewaktuTunda); App._pewaktuTunda = null; }
  App._tertunda = null;
  App._memuatAwal = false;
  App._loginSejak = 0;
}

/** Pastikan tidak ada lapisan yang menutupi formulir masuk. */
function bersihkanPenghalangLogin() {
  try {
    document.querySelectorAll('.modal.show').forEach(function (m) {
      try { if (window.bootstrap && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(m).hide(); } catch (e) { /* abaikan */ }
    });
    setTimeout(function () {
      if (!document.querySelector('.modal.show')) {
        document.querySelectorAll('.modal-backdrop').forEach(function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      }
    }, 450);
    const ov = document.getElementById('loadingOverlay');
    const gagal = document.getElementById('loaderAksi') && !document.getElementById('loaderAksi').classList.contains('hidden');
    if (ov && ov.style.display !== 'none' && !gagal && App.siap) { ov.style.opacity = '0'; ov.style.display = 'none'; }
    const panel = document.getElementById('notifPanel'); if (panel) panel.classList.add('hidden');
    closeSidebar();
    const btn = document.getElementById('btnLogin');
    if (btn && btn.disabled && !App._loginSejak) tombolLoading(btn, false, 'Masuk <i class="bi bi-arrow-right"></i>');
    ['loginUser', 'loginPass'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) { el.disabled = false; el.readOnly = false; }
    });
  } catch (e) { /* tidak boleh menimbulkan error baru */ }
}

/** Setelah gagal masuk: kolom sandi dikosongkan & langsung bisa diketik ulang. */
function siapIsiUlangLogin() {
  bersihkanPenghalangLogin();
  const pass = document.getElementById('loginPass');
  if (!pass) return;
  pass.value = '';
  try { pass.focus({ preventScroll: true }); } catch (e) { try { pass.focus(); } catch (e2) {} }
  const alertBox = document.getElementById('loginAlert');
  if (alertBox && alertBox.scrollIntoView) {
    setTimeout(function () { try { alertBox.scrollIntoView({ block: 'nearest' }); } catch (e) {} }, 60);
  }
}

// iPhone/Android: setelah keyboard menutup, rapikan posisi layar (mencegah ketukan "meleset")
(function () {
  let t = null;
  document.addEventListener('focusout', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('#viewLogin')) return;
    clearTimeout(t);
    t = setTimeout(function () {
      const a = document.activeElement;
      if (a && a.closest && a.closest('#viewLogin') && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
      window.scrollTo(window.scrollX, window.scrollY);
    }, 120);
  });
  // Tombol kembali/maju browser HP (bfcache): tombol Masuk tidak boleh tertinggal "Memproses…"
  window.addEventListener('pageshow', function () {
    App._loginSejak = 0;
    if (!document.getElementById('viewLogin').classList.contains('hidden')) bersihkanPenghalangLogin();
  });
})();

// ════════ BAGIAN 33 — CETAK TANPA "about:blank" (v5.1) ════════
// Browser menulis judul, tanggal, "about:blank" & nomor halaman di MARGIN kertas.
// Margin kertas dijadikan 0 sehingga tulisan browser itu hilang; jarak tepi
// dibuat oleh dokumen sendiri (bingkai tabel yang berulang di setiap halaman),
// jadi kop / header dokumen tetap tampil persis seperti sebelumnya.
function rapikanCetak(html) {
  try {
    html = String(html || '');
    if (html.indexOf('data-cetak-rapi') >= 0) return html;
    // Margin yang dipakai dokumen (mis. @page{margin:14mm}) dipertahankan sebagai jarak tepi
    const m = html.match(/@page\s*\{[^}]*margin\s*:\s*(\d+(?:\.\d+)?)mm/i);
    const tepi = m ? Number(m[1]) : 12;
    const gaya = '<style data-cetak-rapi>' +
      '@page{margin:0 !important}' +
      '@media print{html,body{margin:0 !important}' +
        'body{padding:0 ' + tepi + 'mm !important}' +
        'table.cetak-bingkai{width:100% !important;border-collapse:collapse !important;border:0 !important;margin:0 !important;' +
          'font-size:inherit !important;color:inherit !important;background:transparent !important}' +
        'table.cetak-bingkai>thead>tr>td,table.cetak-bingkai>tfoot>tr>td,table.cetak-bingkai>tbody>tr>td.cetak-isi{' +
          'padding:0 !important;border:0 !important;background:transparent !important;font-size:inherit !important;' +
          'font-weight:inherit !important;color:inherit !important;text-align:inherit !important;vertical-align:top !important}' +
        '.cetak-jarak{height:' + tepi + 'mm}' +
        '.cetak-jarak-bawah{height:' + Math.max(6, Math.round(tepi * 0.6)) + 'mm}' +      // v5.1.1 — footer kosong: cukup jarak tipis
        '.ttd-area{break-inside:avoid;page-break-inside:avoid}' +                          // tanda tangan tidak terpotong ke halaman berikutnya
        // v5.1.1 — header cetak dari aplikasi: tanggal & jam cetak + judul dokumen di setiap halaman
        '.cetak-kepala{display:flex !important;align-items:flex-end !important;gap:8px;padding-bottom:' + Math.min(4, tepi / 3).toFixed(1) + 'mm;box-sizing:border-box;' +
          'font-family:Arial,Helvetica,sans-serif !important;font-size:8.5pt !important;font-weight:400 !important;color:#444 !important;line-height:1.2 !important;text-align:left !important}' +
        '.cetak-kepala>span{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.cetak-kepala>span.kj-judul{flex:2 1 0;text-align:center}' +
      '}' +
      '@media screen{table.cetak-bingkai{width:100%;border-collapse:collapse;border:0}' +
        'table.cetak-bingkai>thead,table.cetak-bingkai>tfoot{display:none}' +
        'table.cetak-bingkai>tbody>tr>td.cetak-isi{padding:0;border:0;background:transparent}}' +
      '</style>';
    if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, gaya + '</head>');
    else html = gaya + html;
    // v5.1.1 — isi header: tanggal & jam cetak (kiri) + judul dokumen (tengah)
    const mJudul = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const judulCetak = mJudul ? mJudul[1].replace(/<[^>]*>/g, '').trim() : '';
    let waktuCetak = '';
    try {
      waktuCetak = new Date().toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { waktuCetak = new Date().toLocaleString(); }
    const kepala = '<div class="cetak-jarak cetak-kepala"><span>' + esc(waktuCetak) + '</span><span class="kj-judul">' + judulCetak + '</span><span></span></div>';
    const buka = html.match(/<body[^>]*>/i);
    const tutup = html.search(/<\/body>/i);
    if (buka && tutup > buka.index) {
      const awal = buka.index + buka[0].length;
      html = html.slice(0, awal) +
        '<table class="cetak-bingkai" role="presentation"><thead><tr><td>' + kepala + '</td></tr></thead>' +
        '<tfoot><tr><td><div class="cetak-jarak-bawah"></div></td></tr></tfoot><tbody><tr><td class="cetak-isi">' +
        html.slice(awal, tutup) +
        '</td></tr></tbody></table>' + html.slice(tutup);
    }
    return html;
  } catch (e) { return html; }
}

// ════════ BAGIAN 34 — PEMBAYARAN KONSUMEN (v5.1 · Marketing & Owner) ════════
// • KPR: total DP + biaya akad yang ditagihkan (dari Penagihan), booking awal,
//   pembayaran yang sudah masuk + bukti, dan sisa yang masih harus ditagih.
// • Cash / Tempo: harga deal, setiap pembayaran / cicilan + bukti, sisa & persen lunas.
// • Halaman "Pembayaran Konsumen" untuk mengontrol semua sisa pembayaran sekaligus.

JUDUL_HALAMAN.pembayaran = 'Pembayaran Konsumen';
NTF_IKON.bayar = ['wallet2', 'var(--success)'];

(function () {
  const ref = document.getElementById('app-indent');
  if (ref && !document.getElementById('app-pembayaran')) {
    const sec = ref.cloneNode(false);
    sec.id = 'app-pembayaran';
    sec.classList.remove('active');
    ref.parentNode.insertBefore(sec, ref.nextSibling);
  }
})();

const JENIS_BAYAR_UI = [
  { v: 'Booking', t: 'Booking / Tanda Jadi' }, { v: 'DP', t: 'Uang Muka (DP)' }, { v: 'Biaya Akad', t: 'Biaya Akad' },
  { v: 'Cicilan', t: 'Cicilan / Angsuran' }, { v: 'Pelunasan', t: 'Pelunasan' }, { v: 'Lainnya', t: 'Lainnya' }
];
const METODE_BAYAR = ['Transfer Bank', 'Tunai', 'QRIS', 'Lainnya'];

function bolehLihatBayar() { return !!(App.sesi && App.sesi.role !== 'Perbankan'); }
function labelJenisBayar(v) { const j = JENIS_BAYAR_UI.find(function (x) { return x.v === v; }); return j ? j.t : (v || 'Lainnya'); }

function pembayaranKonsumen(idTrx) {
  return (App.pembayaran || []).filter(function (b) { return b.idTransaksi === idTrx; })
    .sort(function (a, b) { return String(a.tanggal).localeCompare(String(b.tanggal)) || String(a.input).localeCompare(String(b.input)); });
}

/** Booking sudah dipotong di rincian tagihan (baris DP "DANA MASUK / BOOKING" bertanda −)? */
function bookingDipotongTagihan(baris) {
  return (baris || []).some(function (b) {
    return b.bagian === 'dp' && b.tanda === '-' && Number(b.nominal) > 0 && /booking|dana\s*masuk|tanda\s*jadi/i.test(b.label || '');
  });
}

/** Ringkasan kewajiban, pembayaran & sisa satu konsumen. */
function ringkasBayar(t) {
  const list = pembayaranKonsumen(t.id);
  const jumlah = function (arr) { return arr.reduce(function (a, b) { return a + (Number(b.nominal) || 0); }, 0); };
  const booking = jumlah(list.filter(function (b) { return b.jenis === 'Booking'; }));
  const r = { list: list, booking: booking, kpr: t.metode === 'KPR', total: null, dp: 0, akad: 0, tagihan: null, bookingDipotong: false };
  if (r.kpr) {
    const g = tagihanKonsumen(t.id);
    r.tagihan = g || null;
    if (g) {
      const h = hitungRincianAkad(g.baris, 0);
      r.dp = h.dp; r.akad = h.akad; r.total = h.semua;
      r.bookingDipotong = bookingDipotongTagihan(g.baris);
    }
    r.dibayar = jumlah(r.bookingDipotong ? list.filter(function (b) { return b.jenis !== 'Booking'; }) : list);
  } else {
    r.total = Number(t.harga) || 0;
    r.dibayar = jumlah(list);
  }
  r.sisa = r.total === null ? null : r.total - r.dibayar;
  r.persen = r.total ? Math.max(0, Math.min(100, Math.round(r.dibayar / r.total * 100))) : 0;
  r.lunas = r.total !== null && r.total > 0 && r.sisa <= 0;
  r.terakhir = list.length ? list[list.length - 1] : null;
  return r;
}

/** Chip kecil di tabel Data Konsumen. */
function chipBayar(t) {
  if (!bolehLihatBayar()) return '';
  const r = ringkasBayar(t);
  const klik = ' style="font-size:.66rem;cursor:pointer" onclick="event.stopPropagation();kelolaPembayaran(\'' + escJs(t.id) + '\')"';
  if (r.kpr) {
    if (r.total === null && !r.list.length) return '';
    if (r.total === null) return '<div class="mt-1"><span class="chip chip-soft"' + klik + ' title="Belum ada tagihan DP & akad"><i class="bi bi-wallet2"></i> Dibayar ' + rpSingkat(r.dibayar) + '</span></div>';
    return '<div class="mt-1"><span class="chip ' + (r.lunas ? 'chip-ok' : 'chip-gold') + '"' + klik + ' title="Total DP + akad ' + esc(rp(r.total)) + '">' +
      '<i class="bi bi-wallet2"></i> ' + (r.lunas ? 'DP &amp; Akad Lunas' : 'Sisa DP+Akad ' + rpSingkat(r.sisa)) + '</span></div>';
  }
  if (!r.list.length) return '<div class="mt-1"><span class="chip chip-warn"' + klik + ' title="Belum ada pembayaran tercatat"><i class="bi bi-wallet2"></i> Catat Pembayaran</span></div>';
  return '<div class="mt-1"><span class="chip ' + (r.lunas ? 'chip-ok' : 'chip-gold') + '"' + klik + '>' +
    '<i class="bi bi-wallet2"></i> ' + (r.lunas ? 'Lunas' : 'Sisa ' + rpSingkat(r.sisa) + ' · ' + r.persen + '%') + '</span></div>';
}

function barPersen(persen, lunas) {
  return '<div style="height:6px;border-radius:9px;background:var(--surface-2);overflow:hidden;margin-top:.3rem">' +
    '<div style="height:100%;width:' + Math.max(0, Math.min(100, persen)) + '%;background:' + (lunas ? 'var(--success)' : 'var(--accent)') + '"></div></div>';
}

/** Bagian ringkas di Detail Transaksi. */
function htmlRingkasBayar(t) {
  if (!bolehLihatBayar()) return '';
  const r = ringkasBayar(t);
  const baris = function (l, v, gaya) {
    return '<div class="d-flex justify-content-between"' + (gaya ? ' style="' + gaya + '"' : '') + '><span class="text-muted-2">' + l + '</span><b class="tabular">' + v + '</b></div>';
  };
  let isi = '<div style="font-size:.82rem" class="mb-2">';
  if (r.kpr) {
    if (r.total === null) {
      isi += '<div class="text-muted-2 mb-1"><i class="bi bi-info-circle"></i> Rincian DP &amp; biaya akad belum dibuat (menu Penagihan).</div>';
    } else {
      isi += baris('Kekurangan DP', rp(r.dp)) + baris('Biaya Akad', rp(r.akad)) + baris('Total DP + Akad', rp(r.total), 'border-top:1px dashed var(--border);margin-top:.15rem;padding-top:.15rem');
    }
    isi += baris('Booking awal', rp(r.booking)) + baris('Sudah dibayar' + (r.bookingDipotong ? ' (DP/akad)' : ''), rp(r.dibayar));
  } else {
    isi += baris('Harga deal', rp(r.total)) + baris('Sudah dibayar', rp(r.dibayar));
  }
  if (r.sisa !== null) {
    isi += baris('Sisa', rp(Math.max(r.sisa, 0)), 'color:' + (r.lunas ? 'var(--success)' : 'var(--primary)') + ';font-size:.9rem') + barPersen(r.persen, r.lunas);
  }
  isi += '</div><button class="btn btn-sm btn-outline-brand w-100 mb-2" onclick="closeModal();setTimeout(function(){kelolaPembayaran(\'' + escJs(t.id) + '\')},350)">' +
    '<i class="bi bi-wallet2"></i> Kelola Pembayaran (' + r.list.length + ')</button>';
  return '<div class="sect-label mb-2 mt-3">Rincian Pembayaran Konsumen</div>' + isi;
}

// ── Modal kelola pembayaran per konsumen ──
function kelolaPembayaran(idTrx) {
  if (!bolehLihatBayar()) return;
  const t = App.transaksi.find(function (x) { return x.id === idTrx; });
  if (!t) return;
  const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
  App._byTrx = idTrx;
  App._byEdit = null;
  delete fileBuffer.fileBuktiBayar;
  openModal('Pembayaran Konsumen — ' + t.nama,
    '<div class="card-flat p-3 mb-3" style="background:var(--surface)">' +
      '<div class="d-flex flex-wrap justify-content-between gap-2 align-items-center">' +
        '<div><b>' + esc(t.nama) + '</b> <span class="chip chip-xs">' + esc(t.metode) + '</span>' +
          '<div class="text-muted-2" style="font-size:.8rem">' + esc(p.nama || '-') + ' • Blok ' + esc(t.blok) + ' No. ' + esc(t.nomor) +
          ' • Harga ' + rp(t.harga) + (t.marketing ? ' • ' + esc(t.marketing) : '') + '</div></div>' +
        '<span class="chip ' + chipStatus(t.status) + '">' + esc(t.status) + '</span>' +
      '</div></div>' +
    '<div id="byRingkas"></div>' +
    '<div id="byBooking"></div>' +
    '<div class="sect-label mb-2 mt-3">Riwayat Pembayaran &amp; Bukti</div>' +
    '<div id="byTabel"></div>' +
    '<div id="byForm"></div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>' +
    '<button class="btn btn-outline-brand" onclick="cetakRekapBayar(\'' + escJs(idTrx) + '\')"><i class="bi bi-printer"></i> Cetak Rekap</button>',
    'modal-xl');
  gambarModalBayar();
  gambarFormBayar();
}

function gambarModalBayar() {
  const t = App.transaksi.find(function (x) { return x.id === App._byTrx; });
  if (!t || !document.getElementById('byRingkas')) return;
  const r = ringkasBayar(t);
  const kartu = function (l, v, sub, warna) {
    return '<div class="col-6 col-lg-3"><div class="card-flat p-2 px-3 h-100"><div class="text-muted-2" style="font-size:.74rem">' + l + '</div>' +
      '<div class="tabular" style="font-size:1.12rem;font-weight:700' + (warna ? ';color:' + warna : '') + '">' + v + '</div>' +
      (sub ? '<div class="text-muted-2" style="font-size:.72rem">' + sub + '</div>' : '') + '</div></div>';
  };
  let h = '<div class="row g-2">';
  if (r.kpr) {
    const g = r.tagihan;
    const bolehTagih = ['SP3K', 'Jadwal Akad', 'Akad Selesai'].indexOf(t.berkas.status) >= 0;
    h += kartu('Total DP + Akad Ditagihkan', r.total === null ? '—' : rp(r.total),
      r.total === null
        ? (bolehTagih ? '<a class="cursor-pointer" onclick="closeModal();setTimeout(function(){formPenagihan(\'' + escJs(t.id) + '\')},350)">Buat rincian tagihan</a>'
          : 'Rincian dibuat setelah lolos SP3K')
        : 'DP ' + rp(r.dp) + ' · Akad ' + rp(r.akad) + ' · ' + chipTagihan(g).replace('class="chip', 'class="chip chip-xs'));
    h += kartu('Booking Awal', rp(r.booking), r.bookingDipotong ? 'sudah dipotong di rincian DP' : 'tanda jadi saat pemesanan');
    h += kartu('Sudah Dibayar', rp(r.dibayar), r.bookingDipotong ? 'pembayaran DP &amp; akad' : (r.list.length + ' kali pembayaran'), 'var(--success)');
    h += kartu('Sisa Ditagihkan', r.sisa === null ? '—' : rp(Math.max(r.sisa, 0)), r.sisa === null ? '' : (r.lunas ? 'LUNAS' : r.persen + '% terbayar') + barPersen(r.persen, r.lunas), r.lunas ? 'var(--success)' : 'var(--primary)');
  } else {
    h += kartu('Harga Deal (' + esc(t.metode) + ')', rp(r.total), '');
    h += kartu('Booking Awal', rp(r.booking), 'tanda jadi saat pemesanan');
    h += kartu('Sudah Dibayar', rp(r.dibayar), r.list.length + ' kali pembayaran', 'var(--success)');
    h += kartu('Sisa Pembayaran', rp(Math.max(r.sisa, 0)), (r.lunas ? 'LUNAS' : r.persen + '% terbayar') + barPersen(r.persen, r.lunas), r.lunas ? 'var(--success)' : 'var(--primary)');
  }
  h += '</div>';
  document.getElementById('byRingkas').innerHTML = h;

  // Booking awal dari input penjualan & konfirmasi keuangan (SiKeu)
  const k = dataKeuangan(t.id);
  const adaBookingCatat = r.list.some(function (b) { return b.jenis === 'Booking'; });
  document.getElementById('byBooking').innerHTML =
    '<div class="card-flat p-3 mt-2"><div class="d-flex flex-wrap gap-2 align-items-center justify-content-between">' +
      '<div style="font-size:.84rem"><b><i class="bi bi-bookmark-check"></i> Pembayaran booking awal</b>' +
        '<div class="text-muted-2" style="font-size:.78rem">' +
          (k && k.status !== 'Ditolak' && k.jumlah ? 'Dikonfirmasi keuangan: <b>' + rp(k.jumlah) + '</b>' + (k.tanggal ? ' · ' + tglIndo(k.tanggal) : '') + (k.noKwitansi ? ' · ' + esc(k.noKwitansi) : '')
            : k && k.status === 'Ditolak' ? '<span style="color:var(--danger)">Ditolak keuangan' + (k.catatan ? ' — ' + esc(k.catatan) : '') + '</span>'
            : 'Belum dikonfirmasi keuangan') +
          (adaBookingCatat ? ' · <span style="color:var(--success)">sudah masuk riwayat</span>' : '') + '</div></div>' +
      '<div class="d-flex gap-2 flex-wrap">' +
        (t.linkBukti ? '<button class="btn btn-sm btn-ghost" onclick="previewFile(\'' + escJs(t.linkBukti) + '\',\'Bukti Booking — ' + escJs(t.nama) + '\')"><i class="bi bi-eye"></i> Bukti Booking</button>' : '<span class="chip chip-xs chip-warn">Bukti booking belum ada</span>') +
        (k && k.ada ? '<button class="btn btn-sm btn-ghost" onclick="previewKwitansi(\'' + escJs(t.id) + '\')"><i class="bi bi-receipt-cutoff"></i> Kwitansi</button>' : '') +
        (!adaBookingCatat && (t.linkBukti || (k && k.jumlah)) ? '<button class="btn btn-sm btn-outline-brand" onclick="isiBookingDariPenjualan()"><i class="bi bi-plus-lg"></i> Catat ke riwayat</button>' : '') +
      '</div></div></div>';

  // Tabel riwayat
  const boleh = bolehMarketing(t, 'ubah'), bolehHapus = bolehMarketing(t, 'hapus');
  document.getElementById('byTabel').innerHTML = r.list.length
    ? '<div class="table-wrap"><table class="table-lux"><thead><tr><th>#</th><th>Tanggal</th><th>Jenis</th><th class="text-end">Nominal</th><th>Metode &amp; Keterangan</th><th>Bukti</th><th class="text-end">Aksi</th></tr></thead><tbody>' +
      r.list.map(function (b, i) {
        const tdk = r.kpr && r.bookingDipotong && b.jenis === 'Booking';
        return '<tr' + (b.sementara ? ' style="opacity:.6"' : '') + '><td class="tabular">' + (i + 1) + '</td>' +
          '<td class="tabular" style="white-space:nowrap">' + esc(tglIndo(b.tanggal)) + '</td>' +
          '<td><span class="chip chip-xs ' + (b.jenis === 'Booking' ? 'chip-soft' : b.jenis === 'Pelunasan' ? 'chip-ok' : '') + '">' + esc(labelJenisBayar(b.jenis)) + '</span>' +
            (tdk ? '<div class="text-muted-2" style="font-size:.68rem">sudah dipotong di rincian DP</div>' : '') + '</td>' +
          '<td class="text-end tabular"><b>' + rp(b.nominal) + '</b></td>' +
          '<td style="font-size:.8rem">' + esc(b.metode || '-') + (b.keterangan ? '<div class="text-muted-2">' + esc(b.keterangan) + '</div>' : '') +
            '<div class="text-muted-2" style="font-size:.7rem">' + (b.sementara ? '<span class="spinner-inline"></span> menyimpan…' : 'dicatat ' + esc(b.oleh || '-')) + '</div></td>' +
          '<td>' + (b.link ? '<button class="btn btn-sm btn-ghost" onclick="previewFile(\'' + escJs(b.link) + '\',\'Bukti ' + escJs(labelJenisBayar(b.jenis)) + ' — ' + escJs(tglIndo(b.tanggal)) + '\')"><i class="bi bi-image"></i> Lihat</button>'
            : '<span class="chip chip-xs chip-warn">Tanpa bukti</span>') + '</td>' +
          '<td class="text-end" style="white-space:nowrap">' + (b.sementara ? '' :
            (boleh ? '<button class="btn btn-sm btn-ghost" onclick="ubahPembayaranUi(\'' + escJs(b.id) + '\')" title="Ubah"><i class="bi bi-pencil"></i></button>' : '') +
            (bolehHapus ? '<button class="btn btn-sm btn-ghost" style="color:var(--danger)" onclick="hapusPembayaranUi(\'' + escJs(b.id) + '\')" title="Hapus"><i class="bi bi-trash"></i></button>' : '')) + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td colspan="3"><b>Total dibayar</b></td><td class="text-end tabular"><b>' +
        rp(r.list.reduce(function (a, b) { return a + (Number(b.nominal) || 0); }, 0)) + '</b></td><td colspan="3"></td></tr></tfoot></table></div>'
    : emptyState('wallet2', 'Belum ada pembayaran tercatat', 'Catat setiap pembayaran konsumen beserta bukti transfernya di formulir di bawah.');
}

function gambarFormBayar(b) {
  const t = App.transaksi.find(function (x) { return x.id === App._byTrx; });
  const wadah = document.getElementById('byForm');
  if (!t || !wadah) return;
  if (!bolehMarketing(t, 'ubah')) { wadah.innerHTML = ''; return; }
  const r = ringkasBayar(t);
  const bawaan = b ? b.jenis : (!r.list.some(function (x) { return x.jenis === 'Booking'; }) ? 'Booking' : (r.kpr ? 'DP' : 'Cicilan'));
  App._byEdit = b ? b.id : null;
  delete fileBuffer.fileBuktiBayar;
  wadah.innerHTML =
    '<div class="card-lux p-3 mt-3" id="byKartuForm" style="border-color:var(--accent)">' +
      '<div class="d-flex justify-content-between align-items-center mb-2"><h6 class="mb-0"><i class="bi bi-' + (b ? 'pencil-square' : 'plus-circle') + '"></i> ' +
        (b ? 'Ubah Pembayaran' : 'Catat Pembayaran Baru') + '</h6>' +
        (b ? '<button class="btn btn-sm btn-ghost" onclick="gambarFormBayar()">Batal ubah</button>' : '') + '</div>' +
      '<div class="row g-2">' +
        '<div class="col-6 col-md-3"><label class="form-label">Tanggal Bayar</label><input type="date" class="form-control" id="byTanggal" value="' + esc(b ? b.tanggal : isoHariIni()) + '"></div>' +
        '<div class="col-6 col-md-3"><label class="form-label">Jenis</label><select class="form-select" id="byJenis">' +
          JENIS_BAYAR_UI.map(function (j) { return '<option value="' + j.v + '"' + (j.v === bawaan ? ' selected' : '') + '>' + j.t + '</option>'; }).join('') + '</select></div>' +
        '<div class="col-6 col-md-3"><label class="form-label">Nominal (Rp) <span class="text-danger">*</span></label>' +
          '<input class="form-control tabular text-end" id="byNominal" inputmode="numeric" placeholder="0" oninput="formatRibuan(this)" value="' + (b ? angka(b.nominal) : '') + '"></div>' +
        '<div class="col-6 col-md-3"><label class="form-label">Metode</label><select class="form-select" id="byMetode">' +
          METODE_BAYAR.map(function (m) { return '<option' + ((b ? b.metode : 'Transfer Bank') === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div>' +
        '<div class="col-md-6"><label class="form-label">Keterangan <span class="text-muted-2" style="font-weight:400">(opsional)</span></label>' +
          '<input class="form-control" id="byKet" maxlength="300" placeholder="mis. Cicilan ke-3, transfer BCA a.n. konsumen" value="' + esc(b ? b.keterangan : '') + '"></div>' +
        '<div class="col-md-6"><label class="form-label">Bukti Pembayaran ' + (b && b.link ? '<span class="text-muted-2" style="font-weight:400">(kosongkan bila tidak diganti)</span>' : '') + '</label>' +
          '<div class="upload-box py-2" id="boxBuktiBayar" onclick="document.getElementById(\'fileBuktiBayar\').click()">' +
            '<i class="bi bi-cloud-arrow-up"></i><div style="font-size:.84rem">' + (b && b.link ? 'Ganti foto / PDF bukti' : 'Pilih foto / PDF bukti transfer') + '</div>' +
            '<small>JPG / PNG / PDF, foto otomatis diperkecil</small></div>' +
          '<input type="file" id="fileBuktiBayar" class="hidden" accept="image/*,.pdf" onchange="tandaiFile(\'fileBuktiBayar\',\'boxBuktiBayar\')"></div>' +
      '</div>' +
      '<input type="hidden" id="byPakaiBukti" value="">' +
      '<div class="d-flex justify-content-end mt-2"><button class="btn btn-brand" id="btnSimpanBayar" onclick="simpanPembayaranUi()"><i class="bi bi-save"></i> ' +
        (b ? 'Simpan Perubahan' : 'Simpan Pembayaran') + '</button></div>' +
    '</div>';
}

/** Isi formulir dari booking saat penjualan (bukti dari input penjualan + nominal konfirmasi keuangan). */
function isiBookingDariPenjualan() {
  const t = App.transaksi.find(function (x) { return x.id === App._byTrx; });
  if (!t) return;
  gambarFormBayar();
  const k = dataKeuangan(t.id);
  document.getElementById('byJenis').value = 'Booking';
  if (k && k.jumlah && k.status !== 'Ditolak') {
    document.getElementById('byNominal').value = angka(k.jumlah);
    if (k.tanggal) document.getElementById('byTanggal').value = String(k.tanggal).substring(0, 10);
    if (k.metodeBayar && METODE_BAYAR.indexOf(k.metodeBayar) >= 0) document.getElementById('byMetode').value = k.metodeBayar;
    document.getElementById('byKet').value = 'Booking awal' + (k.noKwitansi ? ' — kwitansi ' + k.noKwitansi : '');
  } else {
    document.getElementById('byTanggal').value = String(t.tanggal || isoHariIni()).substring(0, 10);
    document.getElementById('byKet').value = 'Booking awal saat pemesanan';
  }
  if (t.linkBukti) {
    document.getElementById('byPakaiBukti').value = '1';
    document.getElementById('boxBuktiBayar').innerHTML = '<i class="bi bi-check-circle"></i><div style="font-size:.84rem">Memakai bukti booking dari input penjualan</div><small>klik untuk mengganti</small>';
    document.getElementById('boxBuktiBayar').classList.add('has-file');
  }
  const el = document.getElementById('byKartuForm');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (!document.getElementById('byNominal').value) document.getElementById('byNominal').focus();
}

function ubahPembayaranUi(idBayar) {
  const b = (App.pembayaran || []).find(function (x) { return x.id === idBayar; });
  if (!b) return;
  gambarFormBayar(b);
  const el = document.getElementById('byKartuForm');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Simpan: baris langsung tampil (Optimistic UI), unggah bukti & simpan di latar belakang. */
function simpanPembayaranUi() {
  const idTrx = App._byTrx;
  const t = App.transaksi.find(function (x) { return x.id === idTrx; });
  if (!t) return;
  const nominal = Number((document.getElementById('byNominal').value || '').replace(/[^0-9]/g, '')) || 0;
  if (!nominal) { showToast('Nominal Kosong', 'Isi nominal pembayaran terlebih dahulu.', 'warning'); document.getElementById('byNominal').focus(); return; }
  const payload = {
    id: App._byEdit || '', idTransaksi: idTrx,
    tanggal: document.getElementById('byTanggal').value, jenis: document.getElementById('byJenis').value, nominal: nominal,
    metode: document.getElementById('byMetode').value, keterangan: document.getElementById('byKet').value.trim(),
    pakaiBuktiTransaksi: document.getElementById('byPakaiBukti').value === '1' && !fileBuffer.fileBuktiBayar
  };
  const file = fileBuffer.fileBuktiBayar || null;
  const btn = document.getElementById('btnSimpanBayar');
  tombolLoading(btn, true);

  // Optimistic UI: tampilkan di riwayat seketika
  App.pembayaran = App.pembayaran || [];
  const cadangan = App.pembayaran.slice();
  const sementara = Object.assign({}, payload.id ? (App.pembayaran.find(function (x) { return x.id === payload.id; }) || {}) : {}, {
    id: payload.id || 'TMP-' + Date.now(), idTransaksi: idTrx, tanggal: payload.tanggal, jenis: payload.jenis, nominal: nominal,
    metode: payload.metode, keterangan: payload.keterangan, sementara: true, input: '9999', oleh: App.sesi.nama
  });
  if (payload.pakaiBuktiTransaksi) sementara.link = t.linkBukti;
  App.pembayaran = App.pembayaran.filter(function (x) { return x.id !== sementara.id; }).concat([sementara]);
  gambarModalBayar();

  call('simpanPembayaran', App.token, payload, file).then(function (res) {
    tombolLoading(btn, false);
    if (!res.success) throw new Error(res.message);
    App.pembayaran = cadangan.filter(function (x) { return x.idTransaksi !== idTrx; }).concat(res.data || []);
    delete fileBuffer.fileBuktiBayar;
    if (App._byTrx === idTrx) { gambarModalBayar(); gambarFormBayar(); }
    segarkanTampilanBayar();
    showToast('Berhasil', res.message, 'success');
    muatWorkspace(false, true);
  }).catch(function (err) {
    tombolLoading(btn, false);
    App.pembayaran = cadangan;
    if (App._byTrx === idTrx) gambarModalBayar();
    showToast('Gagal Menyimpan', (err && err.message) || 'Koneksi bermasalah. Data di formulir tidak hilang, silakan coba lagi.', 'danger');
  });
}

function hapusPembayaranUi(idBayar) {
  const b = (App.pembayaran || []).find(function (x) { return x.id === idBayar; });
  if (!b) return;
  konfirmasi('Hapus Catatan Pembayaran', 'Hapus ' + labelJenisBayar(b.jenis) + ' ' + rp(b.nominal) + ' tanggal ' + tglIndo(b.tanggal) + '? Berkas bukti di Drive tidak ikut terhapus.', function () {
    const cadangan = (App.pembayaran || []).slice();
    App.pembayaran = cadangan.filter(function (x) { return x.id !== idBayar; });
    gambarModalBayar();
    call('hapusPembayaran', App.token, idBayar).then(function (res) {
      if (!res.success) throw new Error(res.message);
      App.pembayaran = cadangan.filter(function (x) { return x.idTransaksi !== b.idTransaksi; }).concat(res.data || []);
      if (App._byTrx === b.idTransaksi) gambarModalBayar();
      segarkanTampilanBayar();
      showToast('Terhapus', res.message, 'success');
      muatWorkspace(false, true);
    }).catch(function (err) {
      App.pembayaran = cadangan;
      if (App._byTrx === b.idTransaksi) gambarModalBayar();
      showToast('Gagal', (err && err.message) || 'Gagal menghapus.', 'danger');
    });
  });
}

/** Perbarui chip di tabel di belakang modal (tanpa menutup modal). */
function segarkanTampilanBayar() {
  try {
    if (App.appPage === 'dataKonsumen' && document.getElementById('tbodyKonsumen')) renderTabelKonsumen();
    if (App.appPage === 'pembayaran' && document.getElementById('tbodyBayar')) { renderKpiBayar(); renderTabelBayar(); }
  } catch (e) { /* opsional */ }
}

// ── Cetak rekap pembayaran satu konsumen ──
function cetakRekapBayar(idTrx) {
  const t = App.transaksi.find(function (x) { return x.id === idTrx; });
  if (!t) return;
  const r = ringkasBayar(t);
  const p = App.proyek.find(function (x) { return x.id === t.idProyek; }) || {};
  const c = App.config || {};
  const e = App.etalase || {};
  const nmPt = c.sprNamaPerusahaan || e.namaPerusahaan || '';
  const ringkas = (r.kpr
    ? [['Kekurangan DP', r.total === null ? '-' : rp(r.dp)], ['Biaya Akad', r.total === null ? '-' : rp(r.akad)],
       ['Total DP + Akad Ditagihkan', r.total === null ? 'Belum ada rincian tagihan' : rp(r.total)], ['Booking Awal', rp(r.booking) + (r.bookingDipotong ? ' (sudah dipotong di rincian DP)' : '')],
       ['Sudah Dibayar', rp(r.dibayar)], ['Sisa Ditagihkan', r.sisa === null ? '-' : rp(Math.max(r.sisa, 0)) + (r.lunas ? ' — LUNAS' : '')]]
    : [['Harga Deal', rp(r.total)], ['Booking Awal', rp(r.booking)], ['Sudah Dibayar', rp(r.dibayar) + ' (' + r.persen + '%)'],
       ['Sisa Pembayaran', rp(Math.max(r.sisa, 0)) + (r.lunas ? ' — LUNAS' : '')]]);
  const html = '<html><head><meta charset="utf-8"><title>Rekap Pembayaran — ' + esc(t.nama) + '</title>' +
    '<style>body{font-family:Inter,Arial,sans-serif;color:#241A1E;font-size:12px;margin:0}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{font-family:Georgia,serif;color:#7A1F3D;margin:0}' +
    '.kop{border-bottom:2px solid #7A1F3D;padding-bottom:8px;margin-bottom:12px}.kecil{font-size:11px;color:#6B5C60}' +
    'table.data{width:100%;border-collapse:collapse;margin-top:8px}table.data th{background:#7A1F3D;color:#fff;text-align:left;padding:6px 7px;font-size:11px}' +
    'table.data td{padding:6px 7px;border-bottom:1px solid #E8DEDD}.ring{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-top:6px}' +
    '.ring div{display:flex;justify-content:space-between;border-bottom:1px dashed #E8DEDD;padding:3px 0}.r{text-align:right}' +
    '@page{margin:14mm}</style></head><body>' +
    '<div class="kop"><h2>' + esc(nmPt) + '</h2><div class="kecil">' + esc(c.sprAlamat || e.alamat || '') + '</div></div>' +
    '<h3 style="font-family:Georgia,serif;margin:0 0 2px">Rekap Pembayaran Konsumen</h3>' +
    '<div class="kecil">Dicetak ' + new Date().toLocaleString('id-ID') + ' oleh ' + esc(App.sesi.nama || '') + '</div>' +
    '<div class="ring" style="margin-top:10px">' +
      [['Nama Konsumen', t.nama], ['No. Transaksi', t.id], ['Proyek', p.nama || '-'], ['Unit', 'Blok ' + t.blok + ' No. ' + t.nomor],
       ['Metode', t.metode], ['Harga Deal', rp(t.harga)]].map(function (x) { return '<div><span class="kecil">' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') +
    '</div>' +
    '<h4 style="margin:14px 0 2px">Ringkasan</h4><div class="ring">' +
      ringkas.map(function (x) { return '<div><span class="kecil">' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>' +
    '<h4 style="margin:14px 0 2px">Riwayat Pembayaran</h4>' +
    '<table class="data"><thead><tr><th>#</th><th>Tanggal</th><th>Jenis</th><th>Metode</th><th>Keterangan</th><th>Bukti</th><th class="r">Nominal</th></tr></thead><tbody>' +
      (r.list.length ? r.list.map(function (b, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(tglIndo(b.tanggal)) + '</td><td>' + esc(labelJenisBayar(b.jenis)) + '</td><td>' + esc(b.metode || '-') + '</td>' +
          '<td>' + esc(b.keterangan || '') + '</td><td>' + (b.link ? 'Ada' : '-') + '</td><td class="r">' + rp(b.nominal) + '</td></tr>';
      }).join('') : '<tr><td colspan="7" style="text-align:center;color:#6B5C60">Belum ada pembayaran tercatat</td></tr>') +
    '</tbody><tfoot><tr><td colspan="6"><b>Total dibayar</b></td><td class="r"><b>' +
      rp(r.list.reduce(function (a, b) { return a + (Number(b.nominal) || 0); }, 0)) + '</b></td></tr></tfoot></table>' +
    '</body></html>';
  cetakHtml(html);
}

// ── Halaman kontrol: Pembayaran Konsumen ──
function daftarKontrolBayar() {
  return (App.transaksi || []).map(function (t) { return { t: t, r: ringkasBayar(t) }; });
}

function renderPembayaran() {
  const el = document.getElementById('app-pembayaran');
  if (!el) return;
  el.innerHTML =
    '<p class="text-muted-2">Kontrol sisa pembayaran setiap konsumen: <b>DP &amp; biaya akad</b> konsumen KPR, serta <b>cicilan / pelunasan</b> konsumen Cash &amp; Tempo — lengkap dengan bukti bayarnya.</p>' +
    '<div class="row g-2 g-md-3 mb-3" id="kpiBayar"></div>' +
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:260px"><span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="byCari" placeholder="Cari nama / NIK / unit…" oninput="tundaCari(renderTabelBayar)"></div>' +
      '<select class="form-select" style="max-width:200px" id="byProyek" onchange="renderTabelBayar()"><option value="">Semua Proyek</option>' +
        App.proyek.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.nama) + '</option>'; }).join('') + '</select>' +
      '<select class="form-select" style="max-width:160px" id="byMetodeF" onchange="renderTabelBayar()">' +
        '<option value="">Semua Metode</option><option>KPR</option><option>Cash</option><option>Tempo</option></select>' +
      '<select class="form-select" style="max-width:200px" id="byStatusF" onchange="renderTabelBayar()">' +
        '<option value="">Semua Status</option><option value="belum">Belum Lunas</option><option value="lunas">Lunas</option>' +
        '<option value="kosong">Belum Ada Pembayaran</option><option value="tagihan">KPR Belum Ada Tagihan</option></select>' +
      '<button class="btn btn-sm btn-outline-brand ms-auto" onclick="cetakDaftarBayar()"><i class="bi bi-printer"></i> Cetak Daftar</button>' +
    '</div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>Konsumen</th><th>Proyek &amp; Unit</th><th>Metode</th><th class="text-end">Kewajiban</th><th class="text-end">Dibayar</th>' +
      '<th style="min-width:150px">Sisa</th><th>Terakhir Bayar</th><th class="text-end">Aksi</th>' +
    '</tr></thead><tbody id="tbodyBayar"></tbody></table></div>';
  renderKpiBayar();
  renderTabelBayar();
}

function renderKpiBayar() {
  const box = document.getElementById('kpiBayar');
  if (!box) return;
  const semua = daftarKontrolBayar();
  const tunai = semua.filter(function (x) { return !x.r.kpr; });
  const kpr = semua.filter(function (x) { return x.r.kpr && x.r.total !== null; });
  const bulan = isoHariIni().substring(0, 7);
  const bulanIni = (App.pembayaran || []).filter(function (b) { return String(b.tanggal).substring(0, 7) === bulan; });
  const kpi = [
    { l: 'Sisa Cash / Tempo', v: rpSingkat(tunai.reduce(function (a, x) { return a + Math.max(x.r.sisa || 0, 0); }, 0)), s: tunai.filter(function (x) { return !x.r.lunas; }).length + ' konsumen belum lunas', i: 'cash-stack', g: 'is-brand' },
    { l: 'Sisa DP + Akad KPR', v: rpSingkat(kpr.reduce(function (a, x) { return a + Math.max(x.r.sisa || 0, 0); }, 0)), s: kpr.filter(function (x) { return !x.r.lunas; }).length + ' konsumen belum lunas', i: 'bank', g: 'is-gold' },
    { l: 'Lunas', v: semua.filter(function (x) { return x.r.lunas; }).length, s: 'konsumen', i: 'check2-circle', g: 'is-ok' },
    { l: 'Masuk Bulan Ini', v: rpSingkat(bulanIni.reduce(function (a, b) { return a + (Number(b.nominal) || 0); }, 0)), s: bulanIni.length + ' pembayaran tercatat', i: 'calendar-check', g: 'is-warn' }
  ];
  box.innerHTML = kpi.map(function (k) {
    return '<div class="col-6 col-lg-3"><div class="kpi-tile ' + k.g + '"><div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
      '<div style="min-width:0"><div class="kpi-lbl">' + esc(k.l) + '</div><div class="kpi-val">' + k.v + '</div>' +
      '<div class="kpi-sub">' + esc(k.s) + '</div></div></div></div>';
  }).join('');
}

function daftarBayarTersaring() {
  const q = ((document.getElementById('byCari') || {}).value || '').toLowerCase();
  const pr = (document.getElementById('byProyek') || {}).value || '';
  const mt = (document.getElementById('byMetodeF') || {}).value || '';
  const st = (document.getElementById('byStatusF') || {}).value || '';
  return daftarKontrolBayar().filter(function (x) {
    const t = x.t, r = x.r;
    if (pr && t.idProyek !== pr) return false;
    if (mt && t.metode !== mt) return false;
    if (st === 'belum' && (r.lunas || r.total === null)) return false;
    if (st === 'lunas' && !r.lunas) return false;
    if (st === 'kosong' && r.list.length) return false;
    if (st === 'tagihan' && !(r.kpr && r.total === null)) return false;
    if (q && (t.nama + ' ' + t.nik + ' ' + t.blok + '-' + t.nomor + ' ' + t.id).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) {
    const ra = a.r.lunas ? 2 : a.r.total === null ? 1 : 0, rb = b.r.lunas ? 2 : b.r.total === null ? 1 : 0;
    return ra - rb || (Math.max(b.r.sisa || 0, 0) - Math.max(a.r.sisa || 0, 0)) || String(a.t.nama).localeCompare(String(b.t.nama));
  });
}

function renderTabelBayar() {
  const tbody = document.getElementById('tbodyBayar');
  if (!tbody) return;
  const list = daftarBayarTersaring();
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8">' + emptyState('wallet2', 'Tidak ada data', 'Ubah saringan atau tambahkan pembayaran dari Data Konsumen.') + '</td></tr>';
    return;
  }
  isiBertahap(tbody, list.map(function (x) {
    const t = x.t, r = x.r;
    const p = App.proyek.find(function (q) { return q.id === t.idProyek; }) || {};
    const id = escJs(t.id);
    return '<tr>' +
      '<td><b>' + esc(t.nama) + '</b><div class="text-muted-2" style="font-size:.76rem">' + esc(t.hp || '') + '</div></td>' +
      '<td>' + esc(p.nama || '-') + '<div class="text-muted-2" style="font-size:.76rem">Blok ' + esc(t.blok) + ' No. ' + esc(t.nomor) + '</div></td>' +
      '<td><span class="chip">' + esc(t.metode) + '</span>' + (r.kpr ? '<div class="text-muted-2" style="font-size:.7rem">' + esc(t.berkas.status || 'Diajukan') + '</div>' : '') + '</td>' +
      '<td class="text-end tabular">' + (r.total === null ? '<span class="chip chip-xs chip-warn">Belum ada tagihan</span>' : '<span class="text-nowrap">' + rp(r.total) + '</span>') +
        '<div class="text-muted-2" style="font-size:.7rem">' + (r.kpr ? 'DP + biaya akad' : 'harga deal') + '</div></td>' +
      '<td class="text-end tabular"><span class="text-nowrap">' + rp(r.dibayar) + '</span><div class="text-muted-2" style="font-size:.7rem">' + r.list.length + ' kali' +
        (r.booking ? ' · booking ' + rpSingkat(r.booking) : '') + '</div></td>' +
      '<td>' + (r.sisa === null ? '<span class="text-muted-2">—</span>'
        : '<b class="tabular" style="color:' + (r.lunas ? 'var(--success)' : 'var(--primary)') + '">' + (r.lunas ? 'Lunas' : '<span class="text-nowrap">' + rp(r.sisa) + '</span>') + '</b>' +
          barPersen(r.persen, r.lunas) + '<div class="text-muted-2" style="font-size:.7rem">' + r.persen + '% terbayar</div>') + '</td>' +
      '<td style="font-size:.8rem">' + (r.terakhir ? esc(tglIndo(r.terakhir.tanggal)) + '<div class="text-muted-2" style="font-size:.72rem">' +
        esc(labelJenisBayar(r.terakhir.jenis)) + ' · ' + rpSingkat(r.terakhir.nominal) + '</div>' : '<span class="text-muted-2">Belum ada</span>') + '</td>' +
      '<td class="text-end"><div class="d-flex gap-1 justify-content-end">' +
        '<button class="btn btn-sm btn-ghost" onclick="detailTransaksi(\'' + id + '\')" title="Detail konsumen"><i class="bi bi-eye"></i></button>' +
        '<button class="btn btn-sm btn-brand" onclick="kelolaPembayaran(\'' + id + '\')"><i class="bi bi-wallet2"></i> Kelola</button>' +
      '</div></td></tr>';
  }));
}

function cetakDaftarBayar() {
  const list = daftarBayarTersaring();
  if (!list.length) { showToast('Kosong', 'Tidak ada data untuk dicetak.', 'warning'); return; }
  const c = App.config || {}, e = App.etalase || {};
  const total = function (f) { return list.reduce(function (a, x) { return a + f(x); }, 0); };
  const html = '<html><head><meta charset="utf-8"><title>Daftar Pembayaran Konsumen</title>' +
    '<style>body{font-family:Inter,Arial,sans-serif;color:#241A1E;margin:0}h2{font-family:Georgia,serif;color:#7A1F3D;margin:0 0 2px}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}table{width:100%;border-collapse:collapse;font-size:10.5px;margin-top:12px}' +
    'th{background:#7A1F3D;color:#fff;text-align:left;padding:6px}td{padding:5px 6px;border-bottom:1px solid #E8DEDD}.r{text-align:right}' +
    'tfoot td{font-weight:700;background:#FBF1F4}@page{size:A4 landscape;margin:12mm}</style></head><body>' +
    '<h2>' + esc(c.sprNamaPerusahaan || e.namaPerusahaan || '') + '</h2><div style="font-size:11px;color:#6B5C60">' + esc(c.sprAlamat || e.alamat || '') + '</div><hr>' +
    '<h3 style="font-family:Georgia,serif;margin:6px 0 2px">Daftar Pembayaran Konsumen</h3>' +
    '<div style="font-size:11px;color:#6B5C60">Dicetak ' + new Date().toLocaleString('id-ID') + ' oleh ' + esc(App.sesi.nama || '') + ' · ' + list.length + ' konsumen</div>' +
    '<table><thead><tr><th>#</th><th>Konsumen</th><th>Proyek / Unit</th><th>Metode</th><th class="r">Kewajiban</th><th class="r">Dibayar</th><th class="r">Sisa</th><th>Terakhir Bayar</th></tr></thead><tbody>' +
    list.map(function (x, i) {
      const p = App.proyek.find(function (q) { return q.id === x.t.idProyek; }) || {};
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(x.t.nama) + '</td><td>' + esc(p.nama || '-') + ' · ' + esc(x.t.blok) + '-' + esc(x.t.nomor) + '</td>' +
        '<td>' + esc(x.t.metode) + '</td><td class="r">' + (x.r.total === null ? 'Belum ada tagihan' : rp(x.r.total)) + '</td><td class="r">' + rp(x.r.dibayar) + '</td>' +
        '<td class="r">' + (x.r.sisa === null ? '-' : x.r.lunas ? 'LUNAS' : rp(x.r.sisa)) + '</td>' +
        '<td>' + (x.r.terakhir ? esc(tglIndo(x.r.terakhir.tanggal)) + ' · ' + esc(labelJenisBayar(x.r.terakhir.jenis)) : '-') + '</td></tr>';
    }).join('') + '</tbody><tfoot><tr><td colspan="4">TOTAL</td><td class="r">' + rp(total(function (x) { return x.r.total || 0; })) + '</td>' +
    '<td class="r">' + rp(total(function (x) { return x.r.dibayar || 0; })) + '</td><td class="r">' + rp(total(function (x) { return Math.max(x.r.sisa || 0, 0); })) + '</td><td></td></tr></tfoot></table></body></html>';
  cetakHtml(html);
}

/** Formulir Penagihan: isi "Terbayar" dari riwayat pembayaran. */
function pakaiTerbayarDariRiwayat(idTrx) {
  const list = pembayaranKonsumen(idTrx);
  const dipotong = bookingDipotongTagihan(App._tgBaris);
  const n = list.filter(function (b) { return !(dipotong && b.jenis === 'Booking'); }).reduce(function (a, b) { return a + (Number(b.nominal) || 0); }, 0);
  const el = document.getElementById('tgTerbayar');
  if (!el) return;
  el.value = n ? angka(n) : '';
  hitungTotalTagihan();
  showToast('Terbayar Diisi', 'Diisi ' + rp(n) + ' dari riwayat pembayaran' + (dipotong ? ' (booking tidak dihitung karena sudah dipotong di rincian DP).' : '.'), 'info');
}


// ════════ BAGIAN 35 — PINDAHKAN KONSUMEN KE DAFTAR INDENT (v5.2) ════════
// Aturan perusahaan: konsumen yang terlalu lama melengkapi berkas, atau tidak
// memberi kabar terkait berkas & akad, dipindahkan ke antrean indent.
// Unit dilepas (kembali Tersedia); data, KTP/KK, berkas KPR & riwayat
// pembayaran ikut pindah ke data indent dan kembali lagi saat dikonversi.

const ALASAN_INDENT = [
  'Terlalu lama melengkapi berkas',
  'Tidak memberi kabar terkait berkas / akad',
  'Konsumen menunda pembelian',
  'Lainnya'
];

function hariSejak(tgl) {
  const d = new Date(String(tgl || '').substring(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function htmlPindahKeIndent(t) {
  const hari = hariSejak(t.tanggal);
  const b = t.berkas || {};
  const akadSelesai = t.metode === 'KPR' && b.status === 'Akad Selesai';
  const bayar = (typeof pembayaranKonsumen === 'function') ? pembayaranKonsumen(t.id) : [];
  const dok = (App.dokumen || []).filter(function (d) { return d.idTransaksi === t.id; }).length;
  return '<div id="puIndentBox" class="hidden">' +
    '<div class="card-flat p-3 mb-3" style="font-size:.84rem">' +
      '<div class="d-flex justify-content-between flex-wrap gap-2"><span class="text-muted-2">Tanggal transaksi</span><b>' +
        esc(tglIndo(t.tanggal)) + (hari !== null ? ' · ' + hari + ' hari lalu' : '') + '</b></div>' +
      (t.metode === 'KPR'
        ? '<div class="d-flex justify-content-between flex-wrap gap-2"><span class="text-muted-2">Status berkas KPR</span><b>' + esc(b.status || 'Diajukan') +
            (b.bankProses || b.bank ? ' · ' + esc(b.bankProses || b.bank) : '') + '</b></div>' +
          '<div class="d-flex justify-content-between flex-wrap gap-2"><span class="text-muted-2">Jadwal akad</span><b>' +
            (b.tanggalAkad ? esc(tglIndo(b.tanggalAkad)) : 'Belum dijadwalkan') + '</b></div>'
        : '') +
    '</div>' +
    (akadSelesai
      ? '<div class="alert mb-0" style="background:var(--danger-bg);border:none;color:var(--danger);font-size:.84rem">' +
          '<i class="bi bi-x-circle"></i> Akad konsumen ini sudah <b>selesai</b>, sehingga tidak dapat dipindahkan ke daftar indent.</div>'
      : '<label class="form-label">Alasan dipindahkan ke indent <span class="text-danger">*</span></label>' +
        '<div class="d-grid gap-2 mb-2">' + ALASAN_INDENT.map(function (a, i) {
          return '<label class="card-flat p-2 px-3 cursor-pointer" style="font-size:.86rem"><input type="radio" name="piAlasan" value="' + esc(a) + '" class="form-check-input me-2"' +
            (i === 0 ? ' checked' : '') + '>' + esc(a) + '</label>';
        }).join('') + '</div>' +
        '<label class="form-label">Keterangan <span class="text-muted-2" style="font-weight:400">(wajib bila "Lainnya")</span></label>' +
        '<textarea class="form-control" id="piCatatan" rows="2" maxlength="400" placeholder="Contoh: berkas slip gaji belum diserahkan sejak 30 hari, sudah diingatkan 3x via WA"></textarea>' +
        '<div class="alert mt-3 mb-0" style="background:var(--warning-bg);border:none;color:var(--warning);font-size:.82rem">' +
          '<i class="bi bi-info-circle"></i> Yang terjadi:<ul class="mb-0 ps-3 mt-1">' +
            '<li>Unit <b>Blok ' + esc(t.blok) + ' No. ' + esc(t.nomor) + '</b> kembali <b>Tersedia</b> dan bisa dijual ke konsumen lain.</li>' +
            '<li>Konsumen masuk <b>Data Indent</b> (status Menunggu) dengan data diri, KTP &amp; KK' +
              (dok ? ', ' + dok + ' berkas KPR' : '') + (bayar.length ? ', dan ' + bayar.length + ' catatan pembayaran' : '') + '.</li>' +
            '<li>Status berkas, bank &amp; hasil Cek ID BI terakhir disimpan di catatan indent.</li>' +
            '<li>Saat indent <b>dikonversi</b> lagi, berkas, bukti booking &amp; riwayat pembayaran ikut kembali.</li>' +
          '</ul></div>') +
  '</div>';
}

function aturModePindah(id) {
  const mode = (document.querySelector('input[name="puMode"]:checked') || {}).value || 'unit';
  const indent = mode === 'indent';
  const t = App.transaksi.find(function (x) { return x.id === id; }) || {};
  const box = document.getElementById('puIndentBox');
  const unit = document.getElementById('puUnitBox');
  if (box) box.classList.toggle('hidden', !indent);
  if (unit) unit.classList.toggle('hidden', indent);
  const b1 = document.getElementById('btnPindah'), b2 = document.getElementById('btnPindahIndent');
  if (b1) b1.classList.toggle('hidden', indent);
  if (b2) {
    b2.classList.toggle('hidden', !indent);
    b2.disabled = t.metode === 'KPR' && (t.berkas || {}).status === 'Akad Selesai';
  }
  const judul = document.getElementById('modalUmumTitle');
  if (judul) judul.textContent = (indent ? 'Pindahkan ke Indent — ' : 'Pindah Unit — ') + (t.nama || '');
}

function simpanPindahKeIndent(id) {
  const t = App.transaksi.find(function (x) { return x.id === id; });
  if (!t) return;
  const alasan = (document.querySelector('input[name="piAlasan"]:checked') || {}).value || '';
  const catatan = ((document.getElementById('piCatatan') || {}).value || '').trim();
  if (!alasan) { showToast('Alasan Kosong', 'Pilih alasan konsumen dipindahkan ke indent.', 'warning'); return; }
  if (alasan === 'Lainnya' && !catatan) {
    showToast('Keterangan Kosong', 'Tuliskan keterangan untuk alasan "Lainnya".', 'warning');
    document.getElementById('piCatatan').focus();
    return;
  }
  const btn = document.getElementById('btnPindahIndent');
  const TEKS = '<i class="bi bi-hourglass-split"></i> Pindahkan ke Indent';
  sembunyikanModal('modalUmum');
  konfirmasi('Pindahkan ke Daftar Indent?',
    t.nama + ' akan dikeluarkan dari Data Konsumen dan masuk antrean indent. Unit Blok ' + t.blok + ' No. ' + t.nomor +
    ' kembali Tersedia untuk dijual. Lanjutkan?', function () {
      showToast('Memproses', 'Memindahkan ' + t.nama + ' ke daftar indent…', 'info');
      call('pindahKeIndent', App.token, id, { alasan: alasan, catatan: catatan }).then(function (res) {
        if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
        showToast('Berhasil', res.message, 'success');
        muatWorkspace(false);
      }).catch(function (err) { showToast('Error', err.message, 'danger'); });
    });
  if (btn) tombolLoading(btn, false, TEKS);
}

/** Chip kecil di tabel Data Indent untuk konsumen pindahan. */
function chipAsalIndent(i) {
  if (!i || !i.asalTransaksi) return '';
  return '<div class="mt-1"><span class="chip chip-warn" style="font-size:.66rem" title="' +
    esc('Dipindah dari ' + (i.asalUnit || i.asalTransaksi) + (i.alasanPindah ? ' — ' + i.alasanPindah : '')) + '">' +
    '<i class="bi bi-arrow-return-left"></i> Dari Data Konsumen</span></div>';
}


// ════════ BAGIAN 36 — PERUBAHAN DATA LANGSUNG TERASA (v5.2.1) ════════
// • Simpan data indent → tabel langsung memakai data baru (tanpa menunggu
//   pemuatan ulang seluruh data dari server).
// • Pindah menu setelah ≥ 30 detik → data diperiksa ulang diam-diam; bila
//   tidak ada perubahan server cukup menjawab "tidak berubah" (sangat ringan).

/** Terapkan perubahan indent ke data di memori lalu gambar ulang halaman aktif. */
function terapkanIndentLokal(id, p) {
  try {
    const d = (App.indent || []).find(function (x) { return x.id === id; });
    if (!d || !p) return;
    const peta = { idProyek: 'idProyek', nama: 'nama', hp: 'hp', nik: 'nik', email: 'email', metode: 'metode',
      minatBlok: 'minatBlok', minatTipe: 'minatTipe', status: 'status', marketing: 'marketing', catatan: 'catatan' };
    Object.keys(peta).forEach(function (k) { if (p[k] !== undefined) d[peta[k]] = p[k]; });
    if (p.budget !== undefined) d.budget = Number(p.budget) || 0;
    if (p.nominal !== undefined) d.nominal = Number(String(p.nominal).replace(/[^0-9]/g, '')) || 0;
    d.update = new Date().toISOString();
    App._gambarDiam = true;
    try { if (App.sesi && document.getElementById('app-' + App.appPage)) goApp(App.appPage, true); } finally { App._gambarDiam = false; }
  } catch (e) { /* pemuatan ulang dari server tetap berjalan */ }
}

/** Data di memori sudah lama? Periksa ulang di latar belakang (paling cepat tiap 30 detik). */
function cekDataBasi() {
  try {
    if (!App.sesi || !App.token || App._memuatAwal) return;
    if (Date.now() - (App._terakhirSegar || 0) < 30000) return;
    if (Date.now() - (App._cekBasiTerakhir || 0) < 30000) return;
    App._cekBasiTerakhir = Date.now();
    setTimeout(function () { muatWorkspace(false, true); }, 50);
  } catch (e) { /* opsional */ }
}


// ════════ v5.3 — WHATSAPP & NOTIFIKASI (Owner) ════════
// Notifikasi otomatis ke GRUP WhatsApp perusahaan lewat Fonnte (konsumen baru, dll),
// antrean & riwayat kirim, Blast WA per batch, dan CRM Kontak.

App.ntf = { info: null, tab: 'atur', draf: null, grupDitemukan: null, antrean: null, filter: { status: '', jenis: '' }, blast: null };
App.crm = { kontak: null, pilih: {}, batas: 200, terakhirSinkron: 0 };

// Halaman dibuat dari kerangka halaman lain bila Index.html lama belum memuatnya
(function () {
  const ref = document.getElementById('app-indent');
  ['notifWa', 'crm'].forEach(function (id) {
    if (ref && !document.getElementById('app-' + id)) {
      const sec = ref.cloneNode(false);
      sec.id = 'app-' + id;
      sec.classList.remove('active');
      ref.parentNode.appendChild(sec);
    }
  });
})();

/** Dipanggil oleh call() bila server baru saja mengantrekan notifikasi — kirim seketika di latar belakang. */
function dorongNotifLatar() {
  clearTimeout(dorongNotifLatar._t);
  dorongNotifLatar._t = setTimeout(function () {
    try { call('dorongAntrianNotif').catch(function () { /* pemicu tiap menit tetap mengirim */ }); } catch (e) { /* abaikan */ }
  }, 300);
}

/** Isi template di browser (untuk pratinjau) — sama persis dengan server. */
function isiTemplateNtf(tpl, v) {
  return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null || v[k] === '' ? '-' : String(v[k]); });
}
const CONTOH_NTF = {
  nama: 'Contoh Konsumen', hp: '081234567890', proyek: 'Perumahan Contoh', unit: 'Blok A No. 1', tipe: '36/72', metode: 'KPR',
  harga: 'Rp 185.000.000', marketing: 'Budi Santoso', sumber: 'Input manual — Budi Santoso', idTransaksi: 'TRX-1A2B3C4D',
  idIndent: 'IND-1A2B3C4D', minat: 'Blok B, Tipe 36', budget: 'Rp 180.000.000', status: 'SP3K', plafon: 'Rp 165.000.000', bank: 'BTN',
  tanggal: '2026-10-25', jam: '10:00', lokasi: 'BTN Cabang Kota', jenis: 'Booking', nominal: 'Rp 5.000.000', metodeBayar: 'Transfer',
  alasan: 'Berkas belum lengkap', perusahaan: 'PT Perusahaan Anda', waktu: '2026-10-20 09:30', oleh: 'Budi Santoso', link: '',
  segmen: 'Konsumen', info: 'Perumahan Contoh · Blok A No. 1', hariIni: 'Selasa, 20 Oktober 2026', pukul: '09:30'
};
/** Format tebal WhatsApp (*teks*) untuk pratinjau. */
function pratinjauWa(teks) {
  return esc(teks).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>').replace(/\n/g, '<br>');
}

function renderNotifWa() {
  const el = document.getElementById('app-notifWa');
  if (!el) return;
  if (!App.ntf.info) {
    el.innerHTML = '<p class="text-muted-2">Memuat pengaturan WhatsApp & notifikasi…</p>' + skeleton(80, 4);
    muatInfoNtf();
    return;
  }
  const i = App.ntf.info;
  const tab = function (id, ikon, judul) {
    return '<button class="btn btn-sm ' + (App.ntf.tab === id ? 'btn-brand' : 'btn-ghost') + '" onclick="gantiTabNtf(\'' + id + '\')">' +
      '<i class="bi bi-' + ikon + '"></i> ' + judul + '</button>';
  };
  el.innerHTML =
    '<p class="text-muted-2">Kirim pemberitahuan otomatis ke <b>grup WhatsApp perusahaan</b> setiap ada konsumen baru diinput — seluruh tim langsung tahu. Pengiriman memakai layanan <b>Fonnte</b> dan berjalan di latar belakang, sehingga simpan data tetap secepat biasa.</p>' +
    '<div class="row g-2 g-md-3 mb-3">' + kpiNtf(i) + '</div>' +
    '<div class="d-flex flex-wrap gap-2 mb-3 ntf-tabs">' +
      tab('atur', 'gear', 'Pengaturan') + tab('jenis', 'list-check', 'Jenis Pemberitahuan') +
      tab('antrean', 'clock-history', 'Antrean & Riwayat') + tab('blast', 'megaphone', 'Blast WA') +
    '</div>' +
    '<div id="ntfIsi"></div>';
  renderIsiNtf();
}

function kpiNtf(i) {
  const s = i.setelan;
  const jmlGrup = hitungGrupNtf(s);                                   // v5.4 — grup utama + grup proyek
  const aktif = s.waAktif && i.token.ada && jmlGrup;
  const kpi = [
    { l: 'Notifikasi Grup WA', v: aktif ? 'Aktif' : 'Nonaktif', s: jmlGrup ? jmlGrup + ' grup tujuan' : 'belum ada grup', i: 'whatsapp', g: aktif ? 'is-ok' : 'is-warn' },
    { l: 'Token Fonnte', v: i.token.ada ? 'Tersimpan' : 'Belum diisi', s: i.token.ada ? i.token.samaran : 'isi di tab Pengaturan', i: 'key', g: i.token.ada ? 'is-brand' : 'is-warn' },
    { l: 'Terkirim Hari Ini', v: i.ringkas.terkirimHariIni, s: 'pesan WA & email', i: 'send-check', g: 'is-gold' },
    { l: 'Menunggu / Gagal', v: i.ringkas.antri + ' / ' + i.ringkas.gagal, s: i.pemicu ? 'pemroses otomatis aktif' : 'pemroses otomatis belum terpasang', i: 'hourglass-split', g: i.ringkas.gagal ? 'is-warn' : 'is-brand' }
  ];
  return kpi.map(function (k) {
    return '<div class="col-6 col-lg-3"><div class="kpi-tile ' + k.g + '"><div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
      '<div style="min-width:0"><div class="kpi-lbl">' + esc(k.l) + '</div><div class="kpi-val">' + esc(String(k.v)) + '</div>' +
      '<div class="kpi-sub">' + esc(k.s) + '</div></div></div></div>';
  }).join('');
}

function muatInfoNtf(lalu) {
  return call('getPengaturanNotif', App.token).then(function (res) {
    if (!res.success) {
      const el = document.getElementById('app-notifWa');
      if (el && !App.ntf.info) tampilkanKartuPulih(el, res.message, 'renderNotifWa()');
      else showToast('Gagal', res.message, 'danger');
      return;
    }
    terimaInfoNtf(res.data);
    if (App.appPage === 'notifWa') renderNotifWa();
    if (lalu) lalu();
  }).catch(function (err) {
    const el = document.getElementById('app-notifWa');
    if (el && !App.ntf.info) tampilkanKartuPulih(el, err.message, 'renderNotifWa()');
  });
}

function terimaInfoNtf(data) {
  App.ntf.info = data;
  App.ntf.draf = {
    waAktif: data.setelan.waAktif, emailAktif: data.setelan.emailAktif, grup: data.setelan.grup.slice(),
    emailTim: data.setelan.emailTim, jedaGrup: data.setelan.jedaGrup, sertakanHp: data.setelan.sertakanHp,
    grupProyek: JSON.parse(JSON.stringify(data.setelan.grupProyek || {})), utamaSemua: !!data.setelan.utamaSemua,   // v5.4
    ukuranBatch: data.setelan.ukuranBatch, jedaBlast: data.setelan.jedaBlast, deteksiOtomatis: data.setelan.deteksiOtomatis,
    crmSyncMenit: data.setelan.crmSyncMenit,
    matriks: JSON.parse(JSON.stringify(data.matriks))
  };
}

function gantiTabNtf(t) {
  ambilDrafAturNtf();
  App.ntf.tab = t;
  renderNotifWa();
}

function renderIsiNtf() {
  const box = document.getElementById('ntfIsi');
  if (!box) return;
  if (App.ntf.tab === 'jenis') return renderTabJenisNtf(box);
  if (App.ntf.tab === 'antrean') return renderTabAntreanNtf(box);
  if (App.ntf.tab === 'blast') return renderTabBlastNtf(box);
  renderTabAturNtf(box);
}

// ── Tab 1: Pengaturan ──
function renderTabAturNtf(box) {
  const i = App.ntf.info, d = App.ntf.draf;
  const statusPemicu = i.pemicu === true ? '<span class="chip chip-ok"><i class="bi bi-check-circle"></i> Terpasang — berjalan tiap 1 menit</span>'
    : i.pemicu === false ? '<span class="chip chip-warn">Belum terpasang</span>'
    : '<span class="chip chip-warn">Belum diberi izin</span>';
  box.innerHTML =
    '<div class="row g-3" style="max-width:1100px">' +
      '<div class="col-lg-6"><div class="card-lux p-3 p-md-4 h-100">' +
        '<h5 class="mb-1"><span class="ntf-no">1</span> Koneksi Fonnte</h5>' +
        '<p class="text-muted-2" style="font-size:.84rem">Daftar di <b>fonnte.com</b> → hubungkan nomor WhatsApp kantor (scan QR) → salin <b>Token</b> perangkat ke sini.</p>' +
        (i.token.ada
          ? '<div class="mb-2"><span class="chip chip-ok"><i class="bi bi-key"></i> Token tersimpan: ' + esc(i.token.samaran) + '</span>' +
            (i.token.sumber === 'konfigurasi' ? '<div class="text-muted-2 mt-1" style="font-size:.78rem">Memakai token dari Konfigurasi Sistem (URL Fonnte). Isi kolom di bawah bila ingin token khusus notifikasi grup.</div>' : '') + '</div>'
          : '<div class="mb-2"><span class="chip chip-warn">Token belum diisi</span></div>') +
        '<label class="form-label">Token Fonnte' + (i.token.ada ? ' baru (kosongkan bila tidak diubah)' : '') + '</label>' +
        '<div class="input-group mb-2"><input type="password" class="form-control" id="ntfToken" autocomplete="off" placeholder="Tempel token dari dashboard Fonnte">' +
          '<button class="btn btn-outline-brand" type="button" onclick="var x=document.getElementById(\'ntfToken\');x.type=x.type===\'password\'?\'text\':\'password\'"><i class="bi bi-eye"></i></button></div>' +
        '<div class="d-flex flex-wrap gap-2">' +
          '<button class="btn btn-sm btn-outline-brand" id="btnNtfDevice" onclick="cekPerangkatNtf()"><i class="bi bi-phone"></i> Cek Perangkat</button>' +
          (i.token.ada && i.token.sumber === 'notif' ? '<button class="btn btn-sm btn-ghost" onclick="hapusTokenNtf()"><i class="bi bi-trash"></i> Hapus Token</button>' : '') +
        '</div>' +
        '<div id="ntfDevice" class="mt-2"></div>' +
        '<div class="text-muted-2 mt-2" style="font-size:.76rem"><i class="bi bi-info-circle"></i> Tulisan <i>"Sent via fonnte.com"</i> di bawah pesan ditambahkan oleh Fonnte pada <b>paket Free</b>. Agar pesan bersih seperti chat biasa, gunakan paket berbayar Fonnte tanpa watermark (mis. <b>Lite</b>) — tidak perlu mengubah apa pun di aplikasi.</div>' +   // v5.4
      '</div></div>' +

      '<div class="col-lg-6"><div class="card-lux p-3 p-md-4 h-100">' +
        '<h5 class="mb-1"><span class="ntf-no">2</span> Grup WhatsApp Utama</h5>' +
        '<p class="text-muted-2 mb-0" style="font-size:.8rem">Menerima pemberitahuan proyek yang <b>belum punya grup sendiri</b> (lihat <b>Grup per Proyek</b> di bawah).</p>' +
        '<div class="form-check form-switch my-2">' +
          '<input class="form-check-input" type="checkbox" id="ntfWaAktif"' + (d.waAktif ? ' checked' : '') + '>' +
          '<label class="form-check-label" for="ntfWaAktif"><b>Kirim pemberitahuan otomatis ke grup WhatsApp</b></label></div>' +
        '<div id="ntfGrupTerpilih" class="mb-2">' + htmlGrupTerpilihNtf() + '</div>' +
        '<div class="d-flex flex-wrap gap-2 mb-2">' +
          '<button class="btn btn-sm btn-outline-brand" id="btnNtfGrup" onclick="ambilGrupNtf(false)"><i class="bi bi-people"></i> Pilih dari Daftar Grup</button>' +
          '<button class="btn btn-sm btn-ghost" id="btnNtfGrup2" onclick="ambilGrupNtf(true)"><i class="bi bi-arrow-repeat"></i> Perbarui dari WhatsApp</button>' +
        '</div>' +
        '<div id="ntfGrupDaftar"></div>' +
        '<details class="mt-2"><summary class="text-muted-2" style="font-size:.82rem;cursor:pointer">Isi ID grup secara manual</summary>' +
          '<div class="d-flex flex-wrap gap-2 mt-2">' +
            '<input class="form-control form-control-sm" style="max-width:250px" id="ntfGrupId" placeholder="120363xxxxxxxx@g.us">' +
            '<input class="form-control form-control-sm" style="max-width:180px" id="ntfGrupNama" placeholder="Nama grup">' +
            '<button class="btn btn-sm btn-outline-brand" onclick="tambahGrupManualNtf()"><i class="bi bi-plus-lg"></i> Tambah</button></div></details>' +
        '<div class="form-check form-switch mt-3">' +
          '<input class="form-check-input" type="checkbox" id="ntfHp"' + (d.sertakanHp ? ' checked' : '') + '>' +
          '<label class="form-check-label" for="ntfHp">Tampilkan No. HP konsumen di pesan grup</label></div>' +
      '</div></div>' +

      '<div class="col-lg-6"><div class="card-lux p-3 p-md-4 h-100">' +
        '<h5 class="mb-1"><span class="ntf-no">3</span> Email Tim <span class="text-muted-2" style="font-size:.8rem">(opsional)</span></h5>' +
        '<div class="form-check form-switch my-2">' +
          '<input class="form-check-input" type="checkbox" id="ntfEmailAktif"' + (d.emailAktif ? ' checked' : '') + '>' +
          '<label class="form-check-label" for="ntfEmailAktif">Kirim juga salinan pemberitahuan lewat email</label></div>' +
        '<label class="form-label">Alamat email tim (pisahkan dengan koma)</label>' +
        '<input class="form-control mb-1" id="ntfEmailTim" value="' + esc(d.emailTim) + '" placeholder="' + esc(i.adminEmail || 'admin@perusahaan.com') + '">' +
        '<small class="text-muted-2 d-block">Kosong = dikirim ke Email Admin di Konfigurasi Sistem.' +
          (i.kuotaEmail !== null && i.kuotaEmail !== undefined ? ' Sisa kuota email Google hari ini: <b>' + esc(String(i.kuotaEmail)) + '</b>.' : '') + '</small>' +
      '</div></div>' +

      '<div class="col-lg-6"><div class="card-lux p-3 p-md-4 h-100">' +
        '<h5 class="mb-1"><span class="ntf-no">4</span> Pemroses Otomatis</h5>' +
        '<p class="text-muted-2" style="font-size:.84rem">Pesan dikirim seketika setelah data disimpan. Bila gagal (mis. HP kantor offline), pemroses otomatis mengulang tiap menit, maksimal 3 kali.</p>' +
        '<div class="mb-2">' + statusPemicu + '</div>' +
        (i.pemicu !== true ? '<button class="btn btn-sm btn-outline-brand mb-2" id="btnNtfPemicu" onclick="pasangPemicuNtf()"><i class="bi bi-lightning-charge"></i> Pasang Pemroses Otomatis</button>' +
          '<div class="text-muted-2 mb-2" style="font-size:.78rem">Bila gagal: buka editor Apps Script → pilih fungsi <b>pasangNotifikasiWA</b> → <b>Run</b> → Izinkan (sekali saja).</div>' : '') +
        '<label class="form-label">Jeda antarpesan ke grup (detik)</label>' +
        '<input class="form-control" style="max-width:140px" id="ntfJeda" value="' + esc(d.jedaGrup) + '">' +
      '</div></div>' +
      // v5.4 — grup WhatsApp khusus per proyek
      '<div class="col-12"><div class="card-lux p-3 p-md-4">' +
        '<h5 class="mb-1"><span class="ntf-no">5</span> Grup per Proyek</h5>' +
        '<p class="text-muted-2" style="font-size:.84rem">Atur sekali: pilih grup WhatsApp khusus untuk tiap proyek. Setelah itu pemberitahuan <b>otomatis masuk ke grup proyeknya</b> — mis. konsumen proyek FAR → grup FAR. Proyek baru yang belum diatur dikirim ke <b>Grup Utama</b>.</p>' +
        '<div id="ntfGrupProyek">' + htmlGrupProyekNtf() + '</div>' +
        '<div class="form-check form-switch mt-2">' +
          '<input class="form-check-input" type="checkbox" id="ntfUtamaSemua"' + (d.utamaSemua ? ' checked' : '') + '>' +
          '<label class="form-check-label" for="ntfUtamaSemua">Grup Utama tetap menerima <b>salinan semua proyek</b> (mis. untuk grup direksi)</label></div>' +
      '</div></div>' +
    '</div>' +
    '<button class="btn btn-brand mt-3" id="btnNtfSimpan" onclick="simpanPengaturanNtf()"><i class="bi bi-save"></i> Simpan Pengaturan</button>';
}

function htmlGrupTerpilihNtf() {
  const g = App.ntf.draf.grup;
  if (!g.length) return '<div class="text-muted-2" style="font-size:.84rem"><i class="bi bi-info-circle"></i> Belum ada grup utama. Klik <b>Pilih dari Daftar Grup</b>' +
    (hitungGrupNtf(App.ntf.draf) ? ' (boleh dikosongkan bila semua proyek sudah punya grup sendiri).' : '.') + '</div>';
  return g.map(function (x, idx) {
    return '<div class="ntf-grup"><i class="bi bi-people-fill" style="color:var(--success)"></i>' +
      '<div style="min-width:0;flex:1"><b>' + esc(x.nama) + '</b><div class="text-muted-2 text-truncate" style="font-size:.74rem">' + esc(x.id) + '</div></div>' +
      '<button class="btn btn-sm btn-ghost" title="Kirim pesan uji" onclick="tesGrupNtf(' + idx + ', this)"><i class="bi bi-send"></i> Tes</button>' +
      '<button class="btn btn-sm btn-ghost" title="Hapus" onclick="hapusGrupNtf(' + idx + ')"><i class="bi bi-x-lg"></i></button></div>';
  }).join('');
}

/** Simpan isian formulir tab Pengaturan ke draf (dipanggil sebelum pindah tab / simpan). */
function ambilDrafAturNtf() {
  const d = App.ntf.draf; if (!d) return;
  const v = function (id) { const e = document.getElementById(id); return e ? e : null; };
  if (v('ntfWaAktif')) d.waAktif = v('ntfWaAktif').checked;
  if (v('ntfEmailAktif')) d.emailAktif = v('ntfEmailAktif').checked;
  if (v('ntfEmailTim')) d.emailTim = v('ntfEmailTim').value;
  if (v('ntfJeda')) d.jedaGrup = v('ntfJeda').value.trim() || '2';
  if (v('ntfHp')) d.sertakanHp = v('ntfHp').checked;
  if (v('ntfUtamaSemua')) d.utamaSemua = v('ntfUtamaSemua').checked;                 // v5.4
  if (v('ntfToken') && v('ntfToken').value.trim()) d._token = v('ntfToken').value.trim();
}

function simpanPengaturanNtf(btnId) {
  ambilDrafAturNtf();
  const d = App.ntf.draf;
  const patch = {
    waAktif: d.waAktif, emailAktif: d.emailAktif, grup: d.grup, emailTim: d.emailTim, jedaGrup: d.jedaGrup,
    sertakanHp: d.sertakanHp, matriks: d.matriks, grupProyek: d.grupProyek, utamaSemua: d.utamaSemua
  };
  if (d._token) patch.token = d._token;
  const btn = document.getElementById(btnId || 'btnNtfSimpan');
  tombolLoading(btn, true);
  return call('simpanPengaturanNotif', App.token, patch).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Pengaturan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    terimaInfoNtf(res.data);
    showToast('Berhasil', res.message, res.message.indexOf('Catatan') >= 0 ? 'warning' : 'success');
    renderNotifWa();
  }).catch(function (err) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Pengaturan');
    showToast('Error', err.message, 'danger');
  });
}

function hapusTokenNtf() {
  konfirmasi('Hapus Token Fonnte', 'Token akan dihapus dan notifikasi WhatsApp grup berhenti sampai token baru diisi.', function () {
    call('simpanPengaturanNotif', App.token, { token: '__HAPUS__', waAktif: false }).then(function (res) {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      terimaInfoNtf(res.data); showToast('Berhasil', 'Token dihapus.', 'success'); renderNotifWa();
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

function cekPerangkatNtf() {
  const btn = document.getElementById('btnNtfDevice');
  const tok = (document.getElementById('ntfToken') || {}).value || '';
  tombolLoading(btn, true);
  call('cekPerangkatWa', App.token, tok.trim()).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-phone"></i> Cek Perangkat');
    const box = document.getElementById('ntfDevice');
    if (!res.success) { if (box) box.innerHTML = '<div class="alert alert-danger py-2 mb-0" style="font-size:.84rem">' + esc(res.message) + '</div>'; return; }
    const x = res.data, ok = String(x.status).toLowerCase() === 'connect';
    if (box) box.innerHTML = '<div class="card-flat p-2" style="font-size:.84rem">' +
      '<div><span class="chip ' + (ok ? 'chip-ok' : 'chip-danger') + '">' + (ok ? 'Terhubung' : 'Tidak terhubung') + '</span> ' +
      '<b>' + esc(x.nomor || '-') + '</b> ' + esc(x.nama || '') + '</div>' +
      '<div class="text-muted-2 mt-1">Paket: ' + esc(x.paket || '-') + ' · Kuota: ' + esc(String(x.kuota || '-')) + ' · Aktif s/d: ' + esc(x.kedaluwarsa || '-') + '</div>' +
      (ok ? '' : '<div class="mt-1" style="color:var(--danger)">Buka dashboard Fonnte → menu <b>Device</b> → <b>Connect</b> → scan QR dengan WhatsApp kantor.</div>') + '</div>';
  }).catch(function (err) { tombolLoading(btn, false, '<i class="bi bi-phone"></i> Cek Perangkat'); showToast('Error', err.message, 'danger'); });
}

function ambilGrupNtf(segarkan) {
  ambilDrafAturNtf();
  const btn = document.getElementById(segarkan ? 'btnNtfGrup2' : 'btnNtfGrup');
  if (!App.ntf.info.token.ada && !App.ntf.draf._token) { showToast('Token Belum Ada', 'Isi token Fonnte lalu klik Simpan Pengaturan terlebih dahulu.', 'warning'); return; }
  if (!App.ntf.info.token.ada) { showToast('Simpan Dulu', 'Klik Simpan Pengaturan agar token tersimpan, lalu ambil daftar grup.', 'warning'); return; }
  tombolLoading(btn, true);
  call('ambilGrupWa', App.token, !!segarkan).then(function (res) {
    tombolLoading(btn, false);
    const box = document.getElementById('ntfGrupDaftar');
    if (!res.success) { if (box) box.innerHTML = '<div class="alert alert-danger py-2" style="font-size:.84rem">' + esc(res.message) + '</div>'; return; }
    App.ntf.grupDitemukan = res.data;
    renderGrupDitemukanNtf();
    if (!res.data.length) showToast('Info', res.message, 'info');
  }).catch(function (err) { tombolLoading(btn, false); showToast('Error', err.message, 'danger'); });
}

function renderGrupDitemukanNtf() {
  const box = document.getElementById('ntfGrupDaftar');
  const g = App.ntf.grupDitemukan || [];
  if (!box) return;
  if (!g.length) { box.innerHTML = '<div class="text-muted-2" style="font-size:.84rem">Belum ada grup. Pastikan nomor WhatsApp kantor sudah menjadi anggota grup, lalu klik <b>Perbarui dari WhatsApp</b>.</div>'; return; }
  box.innerHTML = '<div class="ntf-daftar-grup">' +
    '<input class="form-control form-control-sm mb-2" placeholder="Cari nama grup…" oninput="saringGrupNtf(this.value)">' +
    g.map(function (x, idx) {
      const sudah = App.ntf.draf.grup.some(function (y) { return y.id === x.id; });
      return '<div class="ntf-grup" data-nama="' + esc(String(x.nama).toLowerCase()) + '"><i class="bi bi-people"></i>' +
        '<div style="min-width:0;flex:1"><b>' + esc(x.nama) + '</b><div class="text-muted-2 text-truncate" style="font-size:.72rem">' + esc(x.id) + '</div></div>' +
        (sudah ? '<span class="chip chip-ok">Dipilih</span>' : '<button class="btn btn-sm btn-outline-brand" onclick="pilihGrupNtf(' + idx + ')">Pilih</button>') + '</div>';
    }).join('') + '</div>';
}

function saringGrupNtf(q) {
  q = String(q || '').toLowerCase();
  document.querySelectorAll('#ntfGrupDaftar .ntf-grup').forEach(function (r) { r.style.display = r.dataset.nama.indexOf(q) >= 0 ? '' : 'none'; });
}

function pilihGrupNtf(idx) {
  ambilDrafAturNtf();
  const x = App.ntf.grupDitemukan[idx];
  if (!x) return;
  if (App.ntf.draf.grup.length >= 5) { showToast('Batas', 'Maksimal 5 grup tujuan.', 'warning'); return; }
  App.ntf.draf.grup.push({ id: x.id, nama: x.nama });
  if (App.ntf.draf.grup.length === 1) App.ntf.draf.waAktif = true;
  document.getElementById('ntfGrupTerpilih').innerHTML = htmlGrupTerpilihNtf();
  const sw = document.getElementById('ntfWaAktif'); if (sw) sw.checked = App.ntf.draf.waAktif;
  renderGrupDitemukanNtf();
  showToast('Grup Dipilih', x.nama + ' — klik Simpan Pengaturan untuk menerapkan.', 'info');
}

function tambahGrupManualNtf() {
  ambilDrafAturNtf();
  const id = document.getElementById('ntfGrupId').value.trim();
  const nama = document.getElementById('ntfGrupNama').value.trim() || 'Grup WhatsApp';
  if (!/^[0-9-]{6,40}@g\.us$/.test(id)) { showToast('ID Tidak Valid', 'ID grup berbentuk angka diakhiri @g.us, mis. 120363012345678901@g.us', 'warning'); return; }
  if (App.ntf.draf.grup.some(function (y) { return y.id === id; })) { showToast('Info', 'Grup sudah ada di daftar.', 'info'); return; }
  App.ntf.draf.grup.push({ id: id, nama: nama });
  document.getElementById('ntfGrupTerpilih').innerHTML = htmlGrupTerpilihNtf();
  document.getElementById('ntfGrupId').value = ''; document.getElementById('ntfGrupNama').value = '';
}

function hapusGrupNtf(idx) {
  ambilDrafAturNtf();
  App.ntf.draf.grup.splice(idx, 1);
  document.getElementById('ntfGrupTerpilih').innerHTML = htmlGrupTerpilihNtf();
  if (App.ntf.grupDitemukan) renderGrupDitemukanNtf();
}

function tesGrupNtf(idx, btn) {
  const g = App.ntf.draf.grup[idx];
  if (!g) return;
  if (!App.ntf.info.token.ada) { showToast('Token Belum Ada', 'Simpan token Fonnte terlebih dahulu.', 'warning'); return; }
  tombolLoading(btn, true);
  call('tesKirimWa', App.token, g.id, '').then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-send"></i> Tes');
    showToast(res.success ? 'Terkirim' : 'Gagal', res.success ? 'Pesan uji terkirim ke grup ' + g.nama + '. Cek WhatsApp.' : res.message, res.success ? 'success' : 'danger');
  }).catch(function (err) { tombolLoading(btn, false, '<i class="bi bi-send"></i> Tes'); showToast('Error', err.message, 'danger'); });
}

function pasangPemicuNtf() {
  const btn = document.getElementById('btnNtfPemicu');
  tombolLoading(btn, true);
  call('pasangPemicuNotif', App.token).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-lightning-charge"></i> Pasang Pemroses Otomatis');
    if (!res.success) { showToast('Belum Bisa', res.message, 'warning'); return; }
    ambilDrafAturNtf();
    const draf = App.ntf.draf;
    terimaInfoNtf(res.data); App.ntf.draf = draf;
    showToast('Berhasil', res.message, 'success'); renderNotifWa();
  }).catch(function (err) { tombolLoading(btn, false); showToast('Error', err.message, 'danger'); });
}

// ── Tab 2: Jenis pemberitahuan (matriks kejadian × kanal) ──
function renderTabJenisNtf(box) {
  const m = App.ntf.draf.matriks;
  box.innerHTML =
    '<div class="card-lux p-3 p-md-4" style="max-width:1100px">' +
      '<h5 class="mb-1">Kejadian yang dikirim ke grup</h5>' +
      '<p class="text-muted-2" style="font-size:.84rem">Nyalakan kejadian yang ingin diumumkan ke grup WhatsApp. <b>Konsumen baru</b> aktif sejak awal; lainnya bisa dinyalakan kapan saja. Isi pesan bisa diubah sesuai gaya perusahaan.</p>' +
      '<div class="d-flex flex-wrap align-items-center gap-2 mb-3" style="font-size:.84rem"><span class="text-muted-2">Tombol <b>Contoh</b> dikirim ke:</span>' +   // v5.4
        '<select class="form-select form-select-sm" style="max-width:260px" onchange="App.ntf.contohProyek=this.value">' +
          '<option value="">Grup Utama</option>' + (App.proyek || []).map(function (p) {
            return '<option value="' + esc(p.id) + '"' + (App.ntf.contohProyek === p.id ? ' selected' : '') + '>Grup proyek ' + esc(p.nama) + '</option>'; }).join('') +
        '</select></div>' +
      '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
        '<th>Kejadian</th><th class="text-center">Grup WA</th><th class="text-center">Email Tim</th><th class="text-end">Pesan</th>' +
      '</tr></thead><tbody>' +
      Object.keys(m).map(function (k) {
        const x = m[k], ubahan = x.pesan !== x.pesanDefault;
        return '<tr><td><b>' + esc(x.label) + '</b><div class="text-muted-2" style="font-size:.76rem">' + esc(x.ket) + '</div></td>' +
          '<td class="text-center"><div class="form-check form-switch d-inline-block m-0"><input class="form-check-input" type="checkbox"' + (x.wa ? ' checked' : '') +
            ' onchange="App.ntf.draf.matriks[\'' + k + '\'].wa=this.checked"></div></td>' +
          '<td class="text-center"><div class="form-check form-switch d-inline-block m-0"><input class="form-check-input" type="checkbox"' + (x.email ? ' checked' : '') +
            ' onchange="App.ntf.draf.matriks[\'' + k + '\'].email=this.checked"></div></td>' +
          '<td class="text-end text-nowrap">' + (ubahan ? '<span class="chip chip-soft me-1">diubah</span>' : '') +
            '<button class="btn btn-sm btn-ghost" onclick="ubahPesanNtf(\'' + k + '\')"><i class="bi bi-pencil"></i> Ubah</button>' +
            '<button class="btn btn-sm btn-ghost" onclick="kirimContohNtf(\'' + k + '\', this)" title="Kirim contoh ke grup"><i class="bi bi-send"></i> Contoh</button></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      (!App.ntf.info.setelan.waAktif ? '<div class="alert alert-warning py-2 mt-3 mb-0" style="font-size:.84rem"><i class="bi bi-exclamation-triangle"></i> Saklar utama notifikasi grup WA masih <b>nonaktif</b> (tab Pengaturan) — tidak ada pesan yang dikirim.</div>' : '') +
    '</div>' +
    '<button class="btn btn-brand mt-3" id="btnNtfSimpan" onclick="simpanPengaturanNtf()"><i class="bi bi-save"></i> Simpan Pengaturan</button>';
}

function ubahPesanNtf(k) {
  const x = App.ntf.draf.matriks[k];
  const vars = ['perusahaan', 'hariIni', 'pukul', 'waktu', 'oleh'].concat(x.vars || []);
  const gaya = gayaNtf(k);
  openModal('Ubah Pesan — ' + x.label,
    '<div class="row g-3"><div class="col-md-6">' +
      '<label class="form-label">Gaya siap pakai <span class="text-muted-2" style="font-weight:400">— pilih, lalu sesuaikan kata-katanya</span></label>' +
      '<div class="d-flex flex-wrap gap-2 mb-3">' + gaya.map(function (g, i) {
        return '<button type="button" class="btn btn-sm btn-outline-brand" onclick="pakaiGayaNtf(\'' + k + '\',' + i + ')" title="' + esc(g.ket) + '">' +
          '<i class="bi bi-' + g.ikon + '"></i> ' + esc(g.nama) + '</button>';
      }).join('') + '</div>' +
      '<label class="form-label">Isi pesan WhatsApp</label>' +
      '<textarea class="form-control font-monospace" id="ntfTpl" rows="14" style="font-size:.8rem" oninput="pratinjauTplNtf()">' + esc(x.pesan) + '</textarea>' +
      '<div class="mt-2" style="font-size:.76rem"><span class="text-muted-2">Klik untuk menyisipkan:</span> ' +
        vars.map(function (v) { return '<span class="chip chip-soft cursor-pointer me-1 mb-1" onclick="sisipVarNtf(\'' + v + '\')">{' + v + '}</span>'; }).join('') + '</div>' +
      '<div class="text-muted-2 mt-1" style="font-size:.74rem">Tulis <b>*teks*</b> untuk huruf tebal dan <i>_teks_</i> untuk miring di WhatsApp.</div>' +
      '<label class="form-label mt-3">Subjek email</label>' +
      '<input class="form-control" id="ntfSubj" value="' + esc(x.subjek) + '">' +
    '</div><div class="col-md-6">' +
      '<label class="form-label">Pratinjau (data contoh)</label>' +
      '<div class="ntf-wa-bubble" id="ntfPrev"></div>' +
    '</div></div>',
    '<button class="btn btn-ghost me-auto" onclick="bawaanTplNtf(\'' + k + '\')"><i class="bi bi-arrow-counterclockwise"></i> Kembalikan Bawaan</button>' +
    '<button class="btn btn-outline-brand" id="btnNtfContohModal" onclick="kirimContohNtf(\'' + k + '\', this, true)"><i class="bi bi-send"></i> Kirim Contoh</button>' +
    '<button class="btn btn-brand" onclick="terapkanTplNtf(\'' + k + '\')"><i class="bi bi-check-lg"></i> Terapkan &amp; Simpan</button>',
    'modal-xl');
  pratinjauTplNtf();
}

function pratinjauTplNtf() {
  const t = document.getElementById('ntfTpl'), p = document.getElementById('ntfPrev');
  if (t && p) p.innerHTML = pratinjauWa(isiTemplateNtf(t.value, CONTOH_NTF));
}
function sisipVarNtf(v) {
  const t = document.getElementById('ntfTpl'); if (!t) return;
  const a = t.selectionStart || t.value.length, b = t.selectionEnd || a;
  t.value = t.value.substring(0, a) + '{' + v + '}' + t.value.substring(b);
  t.focus(); t.selectionStart = t.selectionEnd = a + v.length + 2;
  pratinjauTplNtf();
}
function bawaanTplNtf(k) {
  const x = App.ntf.draf.matriks[k];
  document.getElementById('ntfTpl').value = x.pesanDefault;
  document.getElementById('ntfSubj').value = x.subjekDefault;
  pratinjauTplNtf();
}
function terapkanTplNtf(k) {
  const x = App.ntf.draf.matriks[k];
  x.pesan = document.getElementById('ntfTpl').value.trim() || x.pesanDefault;
  x.subjek = document.getElementById('ntfSubj').value.trim() || x.subjekDefault;
  closeModal();
  renderIsiNtf();
  simpanPengaturanNtf();                       // v5.3.1 — langsung tersimpan (tidak perlu klik Simpan lagi)
}

function kirimContohNtf(k, btn, dariModal) {
  if (!App.ntf.info.token.ada || !hitungGrupNtf(App.ntf.info.setelan)) {
    showToast('Belum Siap', 'Simpan token Fonnte & grup tujuan dulu di tab Pengaturan.', 'warning'); return;
  }
  const draf = dariModal ? (document.getElementById('ntfTpl') || {}).value : App.ntf.draf.matriks[k].pesan;
  tombolLoading(btn, true);
  call('tesNotifEvent', App.token, k, draf || '', App.ntf.contohProyek || '').then(function (res) {
    tombolLoading(btn, false);
    showToast(res.success ? 'Contoh Dikirim' : 'Gagal', res.message, res.success ? 'success' : 'danger');
    App.ntf.antrean = null;
  }).catch(function (err) { tombolLoading(btn, false); showToast('Error', err.message, 'danger'); });
}

// ── Tab 3: Antrean & riwayat ──
function renderTabAntreanNtf(box) {
  const f = App.ntf.filter;
  box.innerHTML =
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<select class="form-select" style="max-width:190px" id="ntfFStatus" onchange="App.ntf.filter.status=this.value;muatAntreanNtf()">' +
        ['', 'Antri', 'Terkirim', 'Gagal', 'Batal'].map(function (s) { return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + (s || 'Semua Status') + (s === 'Antri' ? ' / Proses' : '') + '</option>'; }).join('') + '</select>' +
      '<select class="form-select" style="max-width:190px" id="ntfFJenis" onchange="App.ntf.filter.jenis=this.value;muatAntreanNtf()">' +
        '<option value=""' + (!f.jenis ? ' selected' : '') + '>Semua Jenis</option><option value="event"' + (f.jenis === 'event' ? ' selected' : '') + '>Pemberitahuan Grup</option>' +
        '<option value="blast"' + (f.jenis === 'blast' ? ' selected' : '') + '>Blast WA</option></select>' +
      '<div class="ms-auto d-flex flex-wrap gap-2">' +
        '<button class="btn btn-sm btn-ghost" onclick="muatAntreanNtf()"><i class="bi bi-arrow-clockwise"></i> Muat Ulang</button>' +
        '<button class="btn btn-sm btn-outline-brand" id="btnNtfUlang" onclick="ulangiGagalNtf()"><i class="bi bi-arrow-repeat"></i> Kirim Ulang yang Gagal</button>' +
        '<button class="btn btn-sm btn-brand" id="btnNtfProses" onclick="prosesSekarangNtf()"><i class="bi bi-lightning-charge"></i> Proses Sekarang</button>' +
      '</div></div>' +
    '<div id="ntfAntreanRingkas" class="mb-2"></div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>Waktu</th><th>Jenis</th><th>Tujuan</th><th style="min-width:260px">Isi Pesan</th><th>Status</th><th>Keterangan</th>' +
    '</tr></thead><tbody id="tbodyNtfAntrean"><tr><td colspan="6">' + skeleton(30, 3) + '</td></tr></tbody></table></div>';
  if (App.ntf.antrean) isiTabelAntreanNtf(); else muatAntreanNtf();
}

function muatAntreanNtf() {
  return call('getAntrianNotif', App.token, App.ntf.filter).then(function (res) {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.ntf.antrean = res.data;
    isiTabelAntreanNtf();
  }).catch(function (err) { showToast('Error', err.message, 'danger'); });
}

function isiTabelAntreanNtf() {
  const tb = document.getElementById('tbodyNtfAntrean');
  if (!tb || !App.ntf.antrean) return;
  const r = App.ntf.antrean.ringkas;
  const rg = document.getElementById('ntfAntreanRingkas');
  if (rg) rg.innerHTML = '<span class="chip chip-soft me-1">Menunggu: ' + r.antri + '</span><span class="chip chip-ok me-1">Terkirim: ' + r.terkirim + '</span>' +
    '<span class="chip chip-danger me-1">Gagal: ' + r.gagal + '</span><span class="chip me-1">Batal: ' + r.batal + '</span>';
  const d = App.ntf.antrean.daftar;
  if (!d.length) { tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted-2 py-4">Belum ada pesan.</td></tr>'; return; }
  const chip = { Antri: 'chip-soft', Proses: 'chip-gold', Terkirim: 'chip-ok', Gagal: 'chip-danger', Batal: '' };
  tb.innerHTML = d.map(function (x) {
    const grup = /@g\.us$/.test(x.tujuan);
    return '<tr><td class="text-nowrap" style="font-size:.8rem">' + esc(x.dibuat) + (x.dikirim ? '<div class="text-muted-2">kirim ' + esc(String(x.dikirim).substring(11, 16)) + '</div>' : '') + '</td>' +
      '<td style="font-size:.82rem">' + esc(x.label) + '<div class="text-muted-2">' + esc(x.kanal === 'EMAIL' ? 'Email' : 'WhatsApp') + '</div></td>' +
      '<td style="font-size:.82rem">' + (grup ? '<i class="bi bi-people-fill"></i> ' : '') + esc(x.nama || '') + '<div class="text-muted-2 text-truncate" style="max-width:170px">' + esc(grup ? 'grup' : x.tujuan) + '</div></td>' +
      '<td><div class="ntf-isi" onclick="this.classList.toggle(\'buka\')">' + pratinjauWa(x.pesan) + '</div></td>' +
      '<td><span class="chip ' + (chip[x.status] || '') + '">' + esc(x.status) + '</span>' + (x.coba ? '<div class="text-muted-2" style="font-size:.72rem">percobaan ' + x.coba + '</div>' : '') + '</td>' +
      '<td class="text-muted-2" style="font-size:.76rem;max-width:200px">' + esc(x.respon || '') + '</td></tr>';
  }).join('');
}

function prosesSekarangNtf() {
  const btn = document.getElementById('btnNtfProses');
  tombolLoading(btn, true);
  call('prosesAntrianSekarang', App.token).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-lightning-charge"></i> Proses Sekarang');
    showToast(res.success ? 'Selesai' : 'Gagal', res.message, res.success ? 'success' : 'danger');
    muatAntreanNtf();
  }).catch(function (err) { tombolLoading(btn, false); showToast('Error', err.message, 'danger'); });
}

function ulangiGagalNtf() {
  const btn = document.getElementById('btnNtfUlang');
  tombolLoading(btn, true);
  call('ulangiAntrianNotif', App.token, []).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-arrow-repeat"></i> Kirim Ulang yang Gagal');
    showToast(res.success ? 'Selesai' : 'Gagal', res.message, res.success ? 'success' : 'danger');
    muatAntreanNtf();
  }).catch(function (err) { tombolLoading(btn, false); showToast('Error', err.message, 'danger'); });
}

// ── Tab 4: Blast WA per batch ──
function renderTabBlastNtf(box) {
  box.innerHTML =
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="text-muted-2" style="font-size:.84rem;flex:1;min-width:240px"><i class="bi bi-shield-check"></i> Blast dikirim <b>bertahap per batch</b> (10/20/50 pesan per menit) dengan jeda antarpesan agar nomor WhatsApp kantor aman dari blokir. Kontak <b>Opt-Out</b> tidak pernah dikirimi.</div>' +
      '<button class="btn btn-sm btn-ghost" onclick="muatBlastNtf()"><i class="bi bi-arrow-clockwise"></i> Muat Ulang</button>' +
      '<button class="btn btn-sm btn-brand" onclick="formBlastNtf()"><i class="bi bi-plus-lg"></i> Buat Blast Baru</button>' +
    '</div><div id="ntfBlastDaftar">' + skeleton(60, 2) + '</div>';
  if (App.ntf.blast) isiDaftarBlastNtf(); else muatBlastNtf();
}

function muatBlastNtf() {
  return call('getDaftarBlast', App.token).then(function (res) {
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.ntf.blast = res.data; isiDaftarBlastNtf();
  }).catch(function (err) { showToast('Error', err.message, 'danger'); });
}

function isiDaftarBlastNtf() {
  const box = document.getElementById('ntfBlastDaftar');
  if (!box) return;
  const d = App.ntf.blast || [];
  if (!d.length) { box.innerHTML = '<div class="card-flat p-4 text-center text-muted-2">Belum ada blast. Klik <b>Buat Blast Baru</b>, atau pilih kontak di menu <b>CRM Kontak</b>.</div>'; return; }
  box.innerHTML = d.map(function (b) {
    const chip = b.status === 'Berjalan' ? 'chip-gold' : b.status === 'Selesai' ? 'chip-ok' : 'chip-danger';
    return '<div class="card-lux p-3 mb-2"><div class="d-flex flex-wrap gap-2 align-items-start">' +
      '<div style="flex:1;min-width:220px"><b>' + esc(b.judul) + '</b> <span class="chip ' + chip + '">' + esc(b.status) + '</span>' +
        '<div class="text-muted-2" style="font-size:.78rem">' + esc(b.tanggal) + ' · ' + esc(b.oleh) + ' · ' + esc(b.sasaran || '') + ' · batch ' + b.batch + ', jeda ' + esc(String(b.jeda)) + ' dtk</div></div>' +
      (b.status === 'Berjalan' ? '<button class="btn btn-sm btn-outline-brand" onclick="batchBerikutNtf(\'' + b.id + '\', this)"><i class="bi bi-skip-forward"></i> Kirim Batch Berikutnya</button>' +
        '<button class="btn btn-sm btn-ghost" onclick="hentikanBlastNtf(\'' + b.id + '\')"><i class="bi bi-stop-circle"></i> Hentikan</button>' : '') +
      '</div>' +
      '<div class="ntf-bar mt-2"><span style="width:' + b.persen + '%"></span></div>' +
      '<div class="d-flex justify-content-between text-muted-2 mt-1" style="font-size:.78rem"><span>' + b.terkirim + ' terkirim · ' + b.gagal + ' gagal · ' + b.sisa + ' sisa</span><span>' + b.persen + '% dari ' + b.total + '</span></div>' +
    '</div>';
  }).join('');
}

function batchBerikutNtf(id, btn) {
  tombolLoading(btn, true);
  call('prosesBlastSekarang', App.token, id).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-skip-forward"></i> Kirim Batch Berikutnya');
    showToast(res.success ? 'Batch Dikirim' : 'Gagal', res.message, res.success ? 'success' : 'danger');
    muatBlastNtf();
  }).catch(function (err) { tombolLoading(btn, false); showToast('Error', err.message, 'danger'); });
}

function hentikanBlastNtf(id) {
  konfirmasi('Hentikan Blast', 'Pesan yang belum terkirim akan dibatalkan. Lanjutkan?', function () {
    call('hentikanBlast', App.token, id).then(function (res) {
      showToast(res.success ? 'Dihentikan' : 'Gagal', res.message, res.success ? 'success' : 'danger');
      muatBlastNtf();
    }).catch(function (err) { showToast('Error', err.message, 'danger'); });
  });
}

/** Form blast. idTerpilih = kontak yang dipilih di CRM (opsional). */
function formBlastNtf(idTerpilih) {
  const lanjut = function () {
    const kontak = App.crm.kontak || [];
    const segmen = {};
    kontak.forEach(function (k) { String(k.sumber || k.segmen).split(', ').forEach(function (s) { if (s) segmen[s] = true; }); });
    const d = (App.ntf.info && App.ntf.info.setelan) || { ukuranBatch: 20, jedaBlast: '5' };
    openModal('Buat Blast WhatsApp',
      '<div class="row g-3"><div class="col-md-6">' +
        '<label class="form-label">Judul blast (catatan internal)</label><input class="form-control mb-2" id="blJudul" placeholder="Promo akhir tahun">' +
        (idTerpilih && idTerpilih.length
          ? '<input type="hidden" id="blPilih" value="1"><div class="alert py-2 mb-2" style="background:var(--info-bg);border:none;font-size:.84rem"><b>' + idTerpilih.length + '</b> kontak dipilih dari CRM.</div>'
          : '<label class="form-label">Sasaran</label><select class="form-select mb-2" id="blSegmen" onchange="hitungSasaranBlastNtf()"><option value="">Semua kontak</option>' +
            Object.keys(segmen).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select>' +
            '<input class="form-control mb-2" id="blTag" placeholder="Saring tag (opsional), mis. VIP" oninput="hitungSasaranBlastNtf()">') +
        '<div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="blLewati" checked onchange="hitungSasaranBlastNtf()"><label class="form-check-label" for="blLewati" style="font-size:.86rem">Lewati nomor yang <b>Tidak Terdaftar</b> WhatsApp</label></div>' +
        '<div id="blHitung" class="mb-2" style="font-size:.86rem"></div>' +
        '<div class="row g-2"><div class="col-6"><label class="form-label">Ukuran batch</label><select class="form-select" id="blBatch">' +
          [10, 20, 50].map(function (n) { return '<option value="' + n + '"' + (Number(d.ukuranBatch) === n ? ' selected' : '') + '>' + n + ' pesan / menit</option>'; }).join('') + '</select></div>' +
          '<div class="col-6"><label class="form-label">Jeda antarpesan (dtk)</label><input class="form-control" id="blJeda" value="' + esc(d.jedaBlast || '5') + '" placeholder="5 atau 3-8"></div></div>' +
      '</div><div class="col-md-6">' +
        '<label class="form-label">Isi pesan</label>' +
        '<textarea class="form-control" id="blPesan" rows="8" oninput="pratinjauBlastNtf()" placeholder="Halo {nama}, …"></textarea>' +
        '<div class="mt-1" style="font-size:.76rem">' + ['nama', 'segmen', 'info', 'perusahaan'].map(function (v) {
          return '<span class="chip chip-soft cursor-pointer me-1" onclick="var t=document.getElementById(\'blPesan\');t.value+=\'{' + v + '}\';pratinjauBlastNtf()">{' + v + '}</span>'; }).join('') + '</div>' +
        '<label class="form-label mt-2">Pratinjau</label><div class="ntf-wa-bubble" id="blPrev" style="min-height:80px"></div>' +
      '</div></div>',
      '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
      '<button class="btn btn-brand" id="btnBlast" onclick="kirimBlastNtf()"><i class="bi bi-megaphone"></i> Mulai Blast</button>', 'modal-xl');
    App.ntf._blastPilih = idTerpilih && idTerpilih.length ? idTerpilih.slice() : null;
    hitungSasaranBlastNtf(); pratinjauBlastNtf();
  };
  if (!App.crm.kontak) {
    showToast('Memuat', 'Mengambil data kontak…', 'info');
    muatCrm(false).then(lanjut);
  } else lanjut();
}

function sasaranBlastNtf() {
  const kontak = App.crm.kontak || [];
  const lewati = (document.getElementById('blLewati') || {}).checked;
  let list;
  if (App.ntf._blastPilih) list = kontak.filter(function (k) { return App.ntf._blastPilih.indexOf(k.id) >= 0; });
  else {
    const seg = (document.getElementById('blSegmen') || {}).value || '';
    const tag = ((document.getElementById('blTag') || {}).value || '').trim().toLowerCase();
    list = kontak.filter(function (k) {
      if (seg && String(k.sumber || k.segmen).split(', ').indexOf(seg) < 0) return false;
      if (tag && String(k.tag || '').toLowerCase().indexOf(tag) < 0) return false;
      return true;
    });
  }
  const sudah = {};
  const valid = list.filter(function (k) {
    if (!/^08\d{8,12}$/.test(k.wa) || k.optOut || sudah[k.wa]) return false;
    if (lewati && k.statusWA === 'Tidak Terdaftar') return false;
    sudah[k.wa] = true; return true;
  });
  return { semua: list.length, valid: valid };
}
function hitungSasaranBlastNtf() {
  const s = sasaranBlastNtf(), el = document.getElementById('blHitung');
  if (el) el.innerHTML = '<i class="bi bi-people"></i> <b>' + s.valid.length + '</b> penerima siap dikirimi' +
    (s.semua > s.valid.length ? ' <span class="text-muted-2">(' + (s.semua - s.valid.length) + ' dilewati: nomor kosong / ganda / opt-out' + ((document.getElementById('blLewati') || {}).checked ? ' / tidak terdaftar' : '') + ')</span>' : '');
}
function pratinjauBlastNtf() {
  const t = document.getElementById('blPesan'), p = document.getElementById('blPrev');
  const k = (sasaranBlastNtf().valid[0]) || { nama: 'Bapak/Ibu', segmen: 'Konsumen', info: '' };
  if (t && p) p.innerHTML = t.value ? pratinjauWa(isiTemplateNtf(t.value, { nama: k.nama, segmen: k.segmen, info: k.info, perusahaan: (App.etalase && App.etalase.namaPerusahaan) || '' })) : '<span class="text-muted-2">Pratinjau pesan tampil di sini.</span>';
}
function kirimBlastNtf() {
  const s = sasaranBlastNtf();
  const judul = document.getElementById('blJudul').value.trim(), pesan = document.getElementById('blPesan').value.trim();
  if (!judul || !pesan) { showToast('Lengkapi', 'Judul dan isi pesan wajib diisi.', 'warning'); return; }
  if (!s.valid.length) { showToast('Tidak Ada Penerima', 'Tidak ada kontak dengan nomor WhatsApp valid.', 'warning'); return; }
  const seg = (document.getElementById('blSegmen') || {}).value;
  const payload = {
    judul: judul, pesan: pesan, ukuranBatch: Number(document.getElementById('blBatch').value), jeda: document.getElementById('blJeda').value.trim(),
    idKontak: s.valid.map(function (k) { return k.id; }), lewatiTidakTerdaftar: (document.getElementById('blLewati') || {}).checked,
    sasaran: App.ntf._blastPilih ? 'Pilihan CRM (' + s.valid.length + ')' : (seg || 'Semua kontak')
  };
  konfirmasi('Mulai Blast', 'Kirim pesan ke ' + s.valid.length + ' kontak secara bertahap (' + payload.ukuranBatch + ' pesan per menit)?', function () {
    const btn = document.getElementById('btnBlast');
    tombolLoading(btn, true);
    call('buatBlastWa', App.token, payload).then(function (res) {
      tombolLoading(btn, false, '<i class="bi bi-megaphone"></i> Mulai Blast');
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      closeModal();
      showToast('Blast Dimulai', res.message, 'success');
      App.ntf.blast = null; App.ntf.tab = 'blast';
      if (App.appPage === 'notifWa') renderNotifWa(); else goApp('notifWa');
    }).catch(function (err) { tombolLoading(btn, false); showToast('Error', err.message, 'danger'); });
  });
}

// ════════ CRM KONTAK (Owner) ════════
function renderCrm() {
  const el = document.getElementById('app-crm');
  if (!el) return;
  if (!App.crm.kontak) { el.innerHTML = '<p class="text-muted-2">Memuat &amp; menyinkronkan kontak konsumen…</p>' + skeleton(80, 4); muatCrm(false); return; }
  const k = App.crm.kontak;
  const segmen = {};
  k.forEach(function (x) { String(x.sumber || x.segmen).split(', ').forEach(function (s) { if (s) segmen[s] = true; }); });
  const valid = k.filter(function (x) { return /^08\d{8,12}$/.test(x.wa); });
  const kpi = [
    { l: 'Total Kontak', v: k.length, s: Object.keys(segmen).join(' · ') || '-', i: 'person-lines-fill', g: 'is-brand' },
    { l: 'Nomor WA Valid', v: valid.length, s: (k.length - valid.length) + ' tanpa nomor valid', i: 'whatsapp', g: 'is-ok' },
    { l: 'Terdaftar WhatsApp', v: k.filter(function (x) { return x.statusWA === 'Terdaftar'; }).length, s: valid.filter(function (x) { return !x.statusWA; }).length + ' belum dicek', i: 'patch-check', g: 'is-gold' },
    { l: 'Opt-Out', v: k.filter(function (x) { return x.optOut; }).length, s: 'tidak menerima blast', i: 'slash-circle', g: 'is-warn' }
  ];
  el.innerHTML =
    '<p class="text-muted-2">Semua kontak <b>konsumen, indent, dan rekanan bank</b> dalam satu daftar (Nama · Email · WhatsApp) — tersinkron otomatis dari data aplikasi. Satu nomor = satu kontak.</p>' +
    '<div class="row g-2 g-md-3 mb-3">' + kpi.map(function (x) {
      return '<div class="col-6 col-lg-3"><div class="kpi-tile ' + x.g + '"><div class="kpi-ic"><i class="bi bi-' + x.i + '"></i></div>' +
        '<div style="min-width:0"><div class="kpi-lbl">' + esc(x.l) + '</div><div class="kpi-val">' + esc(String(x.v)) + '</div><div class="kpi-sub text-truncate">' + esc(x.s) + '</div></div></div></div>';
    }).join('') + '</div>' +
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:250px"><span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="crmCari" placeholder="Cari nama / nomor / email…" oninput="tundaCari(renderTabelCrm)"></div>' +
      '<select class="form-select" style="max-width:170px" id="crmSeg" onchange="renderTabelCrm()"><option value="">Semua Segmen</option>' +
        Object.keys(segmen).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select>' +
      '<select class="form-select" style="max-width:190px" id="crmWa" onchange="renderTabelCrm()"><option value="">Semua Status WA</option>' +
        '<option value="Terdaftar">Terdaftar WA</option><option value="Tidak Terdaftar">Tidak Terdaftar</option><option value="belum">Belum Dicek</option><option value="kosong">Tanpa Nomor</option><option value="optout">Opt-Out</option></select>' +
      '<div class="ms-auto d-flex flex-wrap gap-2">' +
        '<button class="btn btn-sm btn-ghost" id="btnCrmSync" onclick="muatCrm(true)"><i class="bi bi-arrow-repeat"></i> Sinkron</button>' +
        '<button class="btn btn-sm btn-ghost" onclick="formKontakCrm()"><i class="bi bi-person-plus"></i> Tambah</button>' +
        '<button class="btn btn-sm btn-ghost" onclick="unduhCsvCrm()"><i class="bi bi-filetype-csv"></i> CSV</button>' +
        '<button class="btn btn-sm btn-outline-brand" id="btnCrmCek" onclick="cekWaCrm()"><i class="bi bi-patch-check"></i> Cek Nomor WA</button>' +
        '<button class="btn btn-sm btn-brand" onclick="blastDariCrm()"><i class="bi bi-megaphone"></i> Blast</button>' +
      '</div></div>' +
    '<div id="crmInfoPilih" class="mb-2" style="font-size:.84rem"></div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th style="width:32px"><input type="checkbox" class="form-check-input" id="crmSemua" onchange="pilihSemuaCrm(this.checked)"></th>' +
      '<th>Nama</th><th>WhatsApp</th><th>Email</th><th>Segmen</th><th>Tag</th><th class="text-end">Pesan</th><th class="text-end">Aksi</th>' +
    '</tr></thead><tbody id="tbodyCrm"></tbody></table></div>' +
    '<div id="crmLagi" class="text-center mt-2"></div>' +
    '<div class="text-muted-2 mt-2" style="font-size:.76rem">Sinkron terakhir: ' + (App.crm.terakhirSinkron ? esc(new Date(App.crm.terakhirSinkron).toLocaleString('id-ID')) : '-') + ' · otomatis tiap ±30 menit saat notifikasi aktif.</div>';
  renderTabelCrm();
}

function muatCrm(sinkron) {
  const btn = document.getElementById('btnCrmSync');
  if (sinkron) tombolLoading(btn, true);
  return call('getCrmKontak', App.token, !!sinkron).then(function (res) {
    if (sinkron) tombolLoading(btn, false, '<i class="bi bi-arrow-repeat"></i> Sinkron');
    if (!res.success) {
      const el = document.getElementById('app-crm');
      if (el && !App.crm.kontak) tampilkanKartuPulih(el, res.message, 'renderCrm()'); else showToast('Gagal', res.message, 'danger');
      return;
    }
    App.crm.kontak = res.data.kontak;
    App.crm.terakhirSinkron = res.data.terakhirSinkron;
    if (sinkron || res.data.sinkron) showToast('CRM', res.message, 'success');
    if (App.appPage === 'crm') renderCrm();
  }).catch(function (err) {
    if (sinkron) tombolLoading(btn, false, '<i class="bi bi-arrow-repeat"></i> Sinkron');
    const el = document.getElementById('app-crm');
    if (el && !App.crm.kontak) tampilkanKartuPulih(el, err.message, 'renderCrm()'); else showToast('Error', err.message, 'danger');
  });
}

function saringCrm() {
  const q = ((document.getElementById('crmCari') || {}).value || '').trim().toLowerCase();
  const seg = (document.getElementById('crmSeg') || {}).value || '';
  const wa = (document.getElementById('crmWa') || {}).value || '';
  return (App.crm.kontak || []).filter(function (k) {
    if (q && (k.nama + ' ' + k.wa + ' ' + k.email + ' ' + k.tag + ' ' + k.info).toLowerCase().indexOf(q) < 0) return false;
    if (seg && String(k.sumber || k.segmen).split(', ').indexOf(seg) < 0) return false;
    if (wa === 'belum' && (k.statusWA || !/^08\d{8,12}$/.test(k.wa))) return false;
    if (wa === 'kosong' && /^08\d{8,12}$/.test(k.wa)) return false;
    if (wa === 'optout' && !k.optOut) return false;
    if ((wa === 'Terdaftar' || wa === 'Tidak Terdaftar') && k.statusWA !== wa) return false;
    return true;
  }).sort(function (a, b) { return String(b.dibuat).localeCompare(String(a.dibuat)); });
}

function renderTabelCrm() {
  const tb = document.getElementById('tbodyCrm');
  if (!tb) return;
  const list = saringCrm();
  const tampil = list.slice(0, App.crm.batas);
  if (!list.length) tb.innerHTML = '<tr><td colspan="8" class="text-center text-muted-2 py-4">Tidak ada kontak.</td></tr>';
  else tb.innerHTML = tampil.map(function (k) {
    const st = k.statusWA === 'Terdaftar' ? '<span class="chip chip-ok" title="Dicek ' + esc(k.cekWA) + '">WA ✓</span>'
      : k.statusWA === 'Tidak Terdaftar' ? '<span class="chip chip-danger">Bukan WA</span>' : '';
    return '<tr><td><input type="checkbox" class="form-check-input" ' + (App.crm.pilih[k.id] ? 'checked ' : '') + 'onchange="pilihCrm(\'' + k.id + '\', this.checked)"></td>' +
      '<td><b>' + esc(k.nama) + '</b>' + (k.optOut ? ' <span class="chip chip-danger">Opt-Out</span>' : '') +
        '<div class="text-muted-2 text-truncate" style="font-size:.74rem;max-width:280px">' + esc(k.info || '') + '</div></td>' +
      '<td class="text-nowrap">' + (k.wa ? '<a href="https://wa.me/' + esc('62' + k.wa.substring(1)) + '" target="_blank" rel="noopener">' + esc(k.wa) + '</a> ' : '<span class="text-muted-2">-</span> ') + st + '</td>' +
      '<td style="font-size:.84rem">' + (k.email ? esc(k.email) : '<span class="text-muted-2">-</span>') + '</td>' +
      '<td>' + String(k.sumber || k.segmen).split(', ').map(function (s) { return '<span class="chip chip-soft me-1">' + esc(s) + '</span>'; }).join('') + '</td>' +
      '<td style="font-size:.82rem">' + esc(k.tag || '') + '</td>' +
      '<td class="text-end" style="font-size:.8rem">' + (k.jumlahPesan || 0) + (k.terakhir ? '<div class="text-muted-2">' + esc(String(k.terakhir).substring(0, 10)) + '</div>' : '') + '</td>' +
      '<td class="text-end"><button class="btn btn-sm btn-ghost" onclick="formKontakCrm(\'' + k.id + '\')" title="Detail & catatan"><i class="bi bi-pencil-square"></i></button></td></tr>';
  }).join('');
  const lagi = document.getElementById('crmLagi');
  if (lagi) lagi.innerHTML = list.length > tampil.length ? '<button class="btn btn-sm btn-ghost" onclick="App.crm.batas+=200;renderTabelCrm()">Tampilkan lebih banyak (' + (list.length - tampil.length) + ' lagi)</button>' : '';
  infoPilihCrm();
}

function pilihCrm(id, ya) { if (ya) App.crm.pilih[id] = true; else delete App.crm.pilih[id]; infoPilihCrm(); }
function pilihSemuaCrm(ya) {
  saringCrm().forEach(function (k) { if (ya) App.crm.pilih[k.id] = true; else delete App.crm.pilih[k.id]; });
  renderTabelCrm();
}
function infoPilihCrm() {
  const n = Object.keys(App.crm.pilih).length, el = document.getElementById('crmInfoPilih');
  if (el) el.innerHTML = n ? '<span class="chip chip-brand">' + n + ' kontak dipilih</span> <a class="cursor-pointer ms-1" onclick="App.crm.pilih={};renderTabelCrm()">batalkan pilihan</a>' : '';
}

function blastDariCrm() {
  const ids = Object.keys(App.crm.pilih);
  if (!App.ntf.info) muatInfoNtf();
  formBlastNtf(ids.length ? ids : null);
}

/** Cek nomor WA: kontak terpilih, atau (bila tidak ada pilihan) yang belum pernah dicek. Diproses per 50 nomor. */
function cekWaCrm() {
  let ids = Object.keys(App.crm.pilih);
  const peta = {}; (App.crm.kontak || []).forEach(function (k) { peta[k.id] = k; });
  if (!ids.length) ids = (App.crm.kontak || []).filter(function (k) { return /^08\d{8,12}$/.test(k.wa) && !k.statusWA; }).map(function (k) { return k.id; });
  ids = ids.filter(function (id) { return peta[id] && /^08\d{8,12}$/.test(peta[id].wa); });
  if (!ids.length) { showToast('Info', 'Semua nomor sudah dicek. Pilih kontak tertentu untuk mengecek ulang.', 'info'); return; }
  const btn = document.getElementById('btnCrmCek');
  let i = 0, ya = 0, tidak = 0;
  btn.disabled = true;
  const lanjut = function () {
    if (i >= ids.length) {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-patch-check"></i> Cek Nomor WA';
      showToast('Selesai', ids.length + ' nomor dicek: ' + ya + ' terdaftar, ' + tidak + ' tidak terdaftar.', 'success');
      muatCrm(false); return;
    }
    const potong = ids.slice(i, i + 50);
    btn.innerHTML = '<span class="spinner-inline"></span> Mengecek ' + Math.min(i + 50, ids.length) + '/' + ids.length;
    call('cekNomorWaCrm', App.token, potong).then(function (res) {
      if (!res.success) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-patch-check"></i> Cek Nomor WA'; showToast('Gagal', res.message, 'danger'); return; }
      ya += res.data.terdaftar; tidak += res.data.tidak; i += 50; lanjut();
    }).catch(function (err) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-patch-check"></i> Cek Nomor WA'; showToast('Error', err.message, 'danger'); });
  };
  lanjut();
}

function formKontakCrm(id) {
  const k = id ? (App.crm.kontak || []).find(function (x) { return x.id === id; }) : null;
  const manual = !k || k.sumber === 'Manual';
  openModal(k ? 'Kontak — ' + k.nama : 'Tambah Kontak',
    '<div class="row g-3"><div class="col-md-6">' +
      (manual
        ? '<label class="form-label">Nama</label><input class="form-control mb-2" id="ktNama" value="' + esc(k ? k.nama : '') + '">' +
          '<label class="form-label">No. WhatsApp</label><input class="form-control mb-2" id="ktWa" inputmode="tel" value="' + esc(k ? k.wa : '') + '" placeholder="08…">' +
          '<label class="form-label">Email</label><input class="form-control mb-2" id="ktEmail" value="' + esc(k ? k.email : '') + '">' +
          '<label class="form-label">Segmen</label><input class="form-control mb-2" id="ktSegmen" value="' + esc(k ? k.segmen : 'Prospek') + '">'
        : '<div class="card-flat p-2 mb-2" style="font-size:.86rem"><b>' + esc(k.nama) + '</b><div>' + esc(k.wa || '-') + ' · ' + esc(k.email || '-') + '</div>' +
          '<div class="text-muted-2">' + esc(k.sumber) + ' · ' + esc(k.info || '') + '</div>' +
          '<div class="text-muted-2" style="font-size:.74rem">Nama/nomor mengikuti data ' + esc(k.segmen) + ' (ubah di menu asalnya).</div></div>') +
      '<label class="form-label">Tag</label><input class="form-control mb-2" id="ktTag" value="' + esc(k ? k.tag : '') + '" placeholder="mis. VIP, Investor, Prospek Panas">' +
      '<label class="form-label">Catatan</label><textarea class="form-control mb-2" id="ktCatatan" rows="3">' + esc(k ? k.catatan : '') + '</textarea>' +
      '<div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="ktOpt"' + (k && k.optOut ? ' checked' : '') + '>' +
        '<label class="form-check-label" for="ktOpt">Opt-Out (jangan kirimi blast)</label></div>' +
    '</div><div class="col-md-6">' +
      (k ? '<h6 class="font-head">Riwayat Interaksi</h6>' +
        '<div class="d-flex gap-2 mb-2"><select class="form-select form-select-sm" style="max-width:120px" id="ktIKanal"><option>WA</option><option>Telepon</option><option>Email</option><option>Kunjungan</option><option>Lainnya</option></select>' +
          '<input class="form-control form-control-sm" id="ktIRing" placeholder="Ringkasan percakapan…">' +
          '<button class="btn btn-sm btn-outline-brand" onclick="catatInteraksiCrmUi(\'' + k.id + '\', this)"><i class="bi bi-plus-lg"></i></button></div>' +
        '<div id="ktRiwayat" style="max-height:300px;overflow:auto">' + skeleton(30, 2) + '</div>'
        : '<div class="text-muted-2" style="font-size:.86rem">Kontak manual cocok untuk prospek dari pameran, telepon masuk, atau referensi — belum menjadi konsumen di aplikasi.</div>') +
    '</div></div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>' +
    '<button class="btn btn-brand" id="btnKt" onclick="simpanKontakCrmUi(' + (k ? '\'' + k.id + '\'' : '') + ')"><i class="bi bi-save"></i> Simpan</button>', 'modal-xl');
  if (k) muatRiwayatCrm(k.id);
}

function muatRiwayatCrm(id) {
  call('getInteraksiCrm', App.token, id).then(function (res) {
    const box = document.getElementById('ktRiwayat'); if (!box) return;
    if (!res.success) { box.innerHTML = '<div class="text-muted-2">' + esc(res.message) + '</div>'; return; }
    box.innerHTML = res.data.length ? res.data.map(function (r) {
      return '<div class="card-flat p-2 mb-1" style="font-size:.82rem"><div class="d-flex justify-content-between"><b>' + esc(r.kanal) + ' · ' + esc(r.arah) + '</b>' +
        '<span class="text-muted-2">' + esc(r.tanggal) + '</span></div><div>' + esc(r.ringkasan) + '</div><div class="text-muted-2" style="font-size:.72rem">' + esc(r.oleh) + '</div></div>';
    }).join('') : '<div class="text-muted-2" style="font-size:.84rem">Belum ada interaksi tercatat.</div>';
  }).catch(function () { /* abaikan */ });
}

function catatInteraksiCrmUi(id, btn) {
  const ring = document.getElementById('ktIRing').value.trim();
  if (!ring) { showToast('Lengkapi', 'Tulis ringkasan interaksi.', 'warning'); return; }
  tombolLoading(btn, true);
  call('catatInteraksiCrm', App.token, { idKontak: id, kanal: document.getElementById('ktIKanal').value, ringkasan: ring, arah: 'Keluar' }).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-plus-lg"></i>');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    document.getElementById('ktIRing').value = '';
    muatRiwayatCrm(id);
  }).catch(function (err) { tombolLoading(btn, false, '<i class="bi bi-plus-lg"></i>'); showToast('Error', err.message, 'danger'); });
}

function simpanKontakCrmUi(id) {
  const v = function (x) { const e = document.getElementById(x); return e ? e.value : undefined; };
  const p = { id: id || '', tag: v('ktTag'), catatan: v('ktCatatan'), optOut: document.getElementById('ktOpt').checked };
  if (document.getElementById('ktNama')) { p.nama = v('ktNama'); p.wa = v('ktWa'); p.email = v('ktEmail'); p.segmen = v('ktSegmen'); }
  const btn = document.getElementById('btnKt');
  tombolLoading(btn, true);
  call('simpanKontakCrm', App.token, p).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    const list = App.crm.kontak || [];
    const idx = list.findIndex(function (x) { return x.id === res.data.id; });
    if (idx >= 0) list[idx] = res.data; else list.unshift(res.data);
    closeModal(); showToast('Berhasil', res.message, 'success'); renderCrm();
  }).catch(function (err) { tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan'); showToast('Error', err.message, 'danger'); });
}

function unduhCsvCrm() {
  const list = saringCrm();
  const sel = function (s) { s = String(s == null ? '' : s); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const baris = [['Nama', 'WhatsApp', 'Email', 'Segmen', 'Status WA', 'Tag', 'Opt-Out', 'Catatan', 'Info']].concat(list.map(function (k) {
    return [k.nama, k.wa ? "'" + k.wa : '', k.email, k.sumber || k.segmen, k.statusWA, k.tag, k.optOut ? 'YA' : 'TIDAK', k.catatan, k.info];
  }));
  const csv = '﻿' + baris.map(function (r) { return r.map(sel).join(','); }).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'CRM_Kontak_' + new Date().toISOString().slice(0, 10) + '.csv'; a.style.display = 'none';
  document.body.appendChild(a);
  try { a.click(); } catch (e) { /* abaikan */ }
  setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1500);
  showToast('CSV', list.length + ' kontak diunduh.', 'success');
}


// ── v5.3.1 — Gaya pesan siap pakai (dipilih di jendela Ubah Pesan, lalu kata-katanya bisa disesuaikan) ──
const GAYA_PESAN_NTF = {
  KONSUMEN_BARU: [
    { nama: 'Laporan Resmi', ikon: 'file-earmark-text', ket: 'Bahasa laporan formal bernomor',
      subjek: 'Laporan Konsumen Baru — {nama} ({proyek})',
      pesan: '*LAPORAN PENJUALAN — KONSUMEN BARU*\n{perusahaan}\n{hariIni}, pukul {pukul} WIB\n\nDengan hormat, berikut kami laporkan data konsumen baru:\n\n' +
        '1. Nama Konsumen : *{nama}*\n2. No. HP : {hp}\n3. Perumahan : {proyek}\n4. Unit : {unit} (Tipe {tipe})\n5. Cara Pembayaran : {metode}\n' +
        '6. Harga : {harga}\n7. Marketing : {marketing}\n8. Sumber Data : {sumber}\n9. No. Transaksi : {idTransaksi}\n\nDemikian laporan ini kami sampaikan. Terima kasih.' },
    { nama: 'Singkat', ikon: 'lightning', ket: 'Satu baris ringkas',
      subjek: 'Konsumen baru: {nama}',
      pesan: '✅ *Konsumen baru:* {nama} — {proyek}, {unit} ({metode}, {harga}). Marketing: {marketing}.' },
    { nama: 'Semangat Tim', ikon: 'trophy', ket: 'Ucapan selamat closing untuk marketing',
      subjek: 'Closing! {nama} — {proyek}',
      pesan: '🎉 *CLOSING!* 🎉\n\nSelamat untuk *{marketing}* atas konsumen baru:\n👤 {nama}\n🏡 {proyek} — {unit}\n💳 {metode} · {harga}\n\nAyo tim, terus semangat! 💪\n_{perusahaan}_' }
  ],
  INDENT_BARU: [
    { nama: 'Laporan Resmi', ikon: 'file-earmark-text', ket: 'Bahasa laporan formal bernomor', subjek: 'Laporan Indent Baru — {nama}',
      pesan: '*LAPORAN PENDAFTAR INDENT*\n{perusahaan}\n{hariIni}, pukul {pukul} WIB\n\nDengan hormat, berikut data pendaftar indent baru:\n\n' +
        '1. Nama : *{nama}*\n2. No. HP : {hp}\n3. Perumahan : {proyek}\n4. Minat Unit : {minat}\n5. Budget : {budget}\n6. Cara Pembayaran : {metode}\n' +
        '7. Marketing : {marketing}\n8. Sumber Data : {sumber}\n9. No. Indent : {idIndent}\n\nMohon segera ditindaklanjuti. Terima kasih.' },
    { nama: 'Singkat', ikon: 'lightning', ket: 'Satu baris ringkas', subjek: 'Indent baru: {nama}',
      pesan: '⏳ *Indent baru:* {nama} ({hp}) — {proyek}, minat {minat}. Marketing: {marketing}.' }
  ],
  STATUS_KPR: [
    { nama: 'Laporan Resmi', ikon: 'file-earmark-text', ket: 'Bahasa laporan formal bernomor', subjek: 'Laporan Status KPR — {nama}: {status}',
      pesan: '*LAPORAN PERKEMBANGAN BERKAS KPR*\n{perusahaan}\n{hariIni}, pukul {pukul} WIB\n\n' +
        '1. Nama Konsumen : *{nama}*\n2. Unit : {proyek} — {unit}\n3. Status Terbaru : *{status}*\n4. Plafon : {plafon}\n5. Bank : {bank}\n' +
        '6. Marketing : {marketing}\n7. Diperbarui oleh : {oleh}\n\nDemikian disampaikan. Terima kasih.' },
    { nama: 'Singkat', ikon: 'lightning', ket: 'Satu baris ringkas', subjek: 'KPR {nama}: {status}',
      pesan: '📄 *KPR {nama}* ({proyek} {unit}) → *{status}*. Plafon {plafon}, Bank {bank}.' }
  ],
  AKAD_DIJADWALKAN: [
    { nama: 'Laporan Resmi', ikon: 'file-earmark-text', ket: 'Bahasa laporan formal bernomor', subjek: 'Jadwal Akad — {nama}, {tanggal}',
      pesan: '*PEMBERITAHUAN JADWAL AKAD KREDIT*\n{perusahaan}\n\nDengan hormat, akad kredit konsumen berikut telah dijadwalkan:\n\n' +
        '1. Nama Konsumen : *{nama}*\n2. Unit : {proyek} — {unit}\n3. Hari/Tanggal : *{tanggal}*\n4. Pukul : {jam}\n5. Tempat : {lokasi}\n' +
        '6. Marketing : {marketing}\n\nMohon tim terkait mempersiapkan berkas. Terima kasih.' },
    { nama: 'Singkat', ikon: 'lightning', ket: 'Satu baris ringkas', subjek: 'Akad {nama} {tanggal}',
      pesan: '🤝 *Akad {nama}* — {tanggal} {jam} di {lokasi} ({proyek} {unit}).' },
    { nama: 'Semangat Tim', ikon: 'trophy', ket: 'Ucapan selamat untuk tim', subjek: 'Akad terjadwal: {nama}',
      pesan: '🎊 *Selangkah lagi!* 🎊\n\nAkad *{nama}* ({proyek} — {unit}) dijadwalkan *{tanggal}* {jam} di {lokasi}.\nSelamat untuk *{marketing}* & tim! 👏\n_{perusahaan}_' }
  ],
  PEMBAYARAN_MASUK: [
    { nama: 'Laporan Resmi', ikon: 'file-earmark-text', ket: 'Bahasa laporan formal bernomor', subjek: 'Laporan Pembayaran — {nama} {nominal}',
      pesan: '*LAPORAN PENERIMAAN PEMBAYARAN*\n{perusahaan}\n{hariIni}, pukul {pukul} WIB\n\n' +
        '1. Nama Konsumen : *{nama}*\n2. Unit : {proyek} — {unit}\n3. Jenis Pembayaran : {jenis}\n4. Nominal : *{nominal}*\n5. Metode : {metodeBayar}\n' +
        '6. Dicatat oleh : {oleh}\n\nDemikian laporan ini kami sampaikan. Terima kasih.' },
    { nama: 'Singkat', ikon: 'lightning', ket: 'Satu baris ringkas', subjek: 'Pembayaran {nama}',
      pesan: '💰 *{jenis} masuk:* {nama} — {nominal} via {metodeBayar} ({proyek} {unit}).' }
  ],
  KONSUMEN_BATAL: [
    { nama: 'Laporan Resmi', ikon: 'file-earmark-text', ket: 'Bahasa laporan formal bernomor', subjek: 'Laporan Pembatalan — {nama}',
      pesan: '*LAPORAN PEMBATALAN KONSUMEN*\n{perusahaan}\n{hariIni}, pukul {pukul} WIB\n\n' +
        '1. Nama Konsumen : *{nama}*\n2. Unit : {proyek} — {unit} (kembali Tersedia)\n3. Cara Pembayaran : {metode}\n4. Alasan : {alasan}\n' +
        '5. Marketing : {marketing}\n6. Diproses oleh : {oleh}\n\nDemikian disampaikan. Terima kasih.' },
    { nama: 'Singkat', ikon: 'lightning', ket: 'Satu baris ringkas', subjek: 'Batal: {nama}',
      pesan: '❌ *Batal:* {nama} — {proyek} {unit} kembali Tersedia. Alasan: {alasan}.' }
  ],
  PINDAH_KE_INDENT: [
    { nama: 'Laporan Resmi', ikon: 'file-earmark-text', ket: 'Bahasa laporan formal bernomor', subjek: 'Laporan Pemindahan ke Indent — {nama}',
      pesan: '*LAPORAN PEMINDAHAN KONSUMEN KE INDENT*\n{perusahaan}\n{hariIni}, pukul {pukul} WIB\n\n' +
        '1. Nama Konsumen : *{nama}*\n2. Unit Lama : {proyek} — {unit} (kembali Tersedia)\n3. Alasan : {alasan}\n4. No. Indent : {idIndent}\n' +
        '5. Marketing : {marketing}\n6. Diproses oleh : {oleh}\n\nDemikian disampaikan. Terima kasih.' },
    { nama: 'Singkat', ikon: 'lightning', ket: 'Satu baris ringkas', subjek: 'Pindah ke indent: {nama}',
      pesan: '🔁 *{nama}* dipindah ke indent ({idIndent}). Unit {proyek} {unit} kembali Tersedia. Alasan: {alasan}.' }
  ]
};

/** Daftar gaya untuk satu kejadian: gaya siap pakai + "Bawaan Aplikasi". */
function gayaNtf(k) {
  const x = (App.ntf.draf && App.ntf.draf.matriks[k]) || {};
  return (GAYA_PESAN_NTF[k] || []).concat([{ nama: 'Bawaan Aplikasi', ikon: 'arrow-counterclockwise', ket: 'Format awal aplikasi',
    subjek: x.subjekDefault || '', pesan: x.pesanDefault || '' }]);
}

function pakaiGayaNtf(k, i) {
  const g = gayaNtf(k)[i];
  if (!g) return;
  const t = document.getElementById('ntfTpl'), sj = document.getElementById('ntfSubj');
  if (t) t.value = g.pesan;
  if (sj && g.subjek) sj.value = g.subjek;
  pratinjauTplNtf();
  showToast('Gaya "' + g.nama + '"', 'Silakan sesuaikan kata-katanya, lalu klik Terapkan & Simpan.', 'info');
}


// ── v5.4 — Grup WhatsApp per proyek ──
function hitungGrupNtf(st) {
  const ada = {};
  (st.grup || []).forEach(function (g) { ada[g.id] = 1; });
  Object.keys(st.grupProyek || {}).forEach(function (k) { (st.grupProyek[k] || []).forEach(function (g) { ada[g.id] = 1; }); });
  return Object.keys(ada).length;
}

function htmlGrupProyekNtf() {
  const d = App.ntf.draf, proyek = App.proyek || [];
  if (!proyek.length) return '<div class="text-muted-2" style="font-size:.84rem">Belum ada proyek.</div>';
  const utama = (d.grup || []).map(function (g) { return g.nama; }).join(', ');
  return '<div class="table-wrap"><table class="table-lux"><thead><tr><th>Proyek</th><th>Grup WhatsApp tujuan</th><th class="text-end">Aksi</th></tr></thead><tbody>' +
    proyek.map(function (p) {
      const g = (d.grupProyek || {})[p.id] || [];
      return '<tr><td><b>' + esc(p.nama) + '</b></td><td>' +
        (g.length ? g.map(function (x) { return '<span class="chip chip-ok me-1 mb-1"><i class="bi bi-people-fill"></i> ' + esc(x.nama) + '</span>'; }).join('')
          : '<span class="text-muted-2" style="font-size:.82rem">→ ' + (utama ? 'Grup Utama (' + esc(utama) + ')' : '<span style="color:var(--danger)">belum ada grup — pemberitahuan proyek ini tidak terkirim</span>') + '</span>') +
        '</td><td class="text-end text-nowrap">' +
        '<button class="btn btn-sm btn-outline-brand" onclick="pilihGrupProyekNtf(\'' + escJs(p.id) + '\')"><i class="bi bi-people"></i> ' + (g.length ? 'Ubah' : 'Atur Grup') + '</button>' +
        (g.length ? '<button class="btn btn-sm btn-ghost" onclick="tesGrupProyekNtf(\'' + escJs(p.id) + '\', this)"><i class="bi bi-send"></i> Tes</button>' : '') +
        '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

/** Jendela pilih grup untuk satu proyek (centang grup dari daftar Fonnte, atau isi ID manual). */
function pilihGrupProyekNtf(pid) {
  ambilDrafAturNtf();
  const p = (App.proyek || []).find(function (x) { return x.id === pid; }) || { nama: pid };
  if (!App.ntf.info.token.ada) { showToast('Token Belum Ada', 'Isi & simpan token Fonnte terlebih dahulu.', 'warning'); return; }
  App.ntf._pilihProyek = { pid: pid, dipilih: ((App.ntf.draf.grupProyek || {})[pid] || []).map(function (g) { return { id: g.id, nama: g.nama }; }) };
  openModal('Grup WhatsApp — ' + p.nama,
    '<p class="text-muted-2" style="font-size:.84rem">Centang grup yang menerima pemberitahuan proyek <b>' + esc(p.nama) + '</b>. Nomor WhatsApp kantor harus menjadi anggota grup tersebut.</p>' +
    '<div class="d-flex flex-wrap gap-2 mb-2">' +
      '<input class="form-control form-control-sm" style="max-width:260px" placeholder="Cari nama grup…" oninput="saringGrupProyekNtf(this.value)">' +
      '<button class="btn btn-sm btn-ghost" id="btnGpSegar" onclick="muatGrupProyekNtf(true)"><i class="bi bi-arrow-repeat"></i> Perbarui dari WhatsApp</button></div>' +
    '<div id="gpDaftar" class="ntf-daftar-grup">' + skeleton(40, 3) + '</div>' +
    '<details class="mt-2"><summary class="text-muted-2" style="font-size:.82rem;cursor:pointer">Isi ID grup secara manual</summary>' +
      '<div class="d-flex flex-wrap gap-2 mt-2"><input class="form-control form-control-sm" style="max-width:250px" id="gpId" placeholder="120363xxxxxxxx@g.us">' +
      '<input class="form-control form-control-sm" style="max-width:180px" id="gpNama" placeholder="Nama grup">' +
      '<button class="btn btn-sm btn-outline-brand" onclick="tambahGrupProyekManualNtf()"><i class="bi bi-plus-lg"></i> Tambah</button></div></details>' +
    '<div class="mt-3" style="font-size:.84rem"><b>Terpilih:</b> <span id="gpTerpilih"></span></div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' +
    '<button class="btn btn-brand" id="btnGpSimpan" onclick="simpanGrupProyekNtf()"><i class="bi bi-check-lg"></i> Terapkan &amp; Simpan</button>');
  isiTerpilihGrupProyekNtf();
  if (App.ntf.grupDitemukan) renderDaftarGrupProyekNtf(); else muatGrupProyekNtf(false);
}

function muatGrupProyekNtf(segarkan) {
  const btn = document.getElementById('btnGpSegar');
  if (segarkan) tombolLoading(btn, true);
  call('ambilGrupWa', App.token, !!segarkan).then(function (res) {
    if (segarkan) tombolLoading(btn, false, '<i class="bi bi-arrow-repeat"></i> Perbarui dari WhatsApp');
    const box = document.getElementById('gpDaftar');
    if (!res.success) { if (box) box.innerHTML = '<div class="alert alert-danger py-2 mb-0" style="font-size:.84rem">' + esc(res.message) + '</div>'; return; }
    App.ntf.grupDitemukan = res.data;
    renderDaftarGrupProyekNtf();
  }).catch(function (err) { if (segarkan) tombolLoading(btn, false); showToast('Error', err.message, 'danger'); });
}

function renderDaftarGrupProyekNtf() {
  const box = document.getElementById('gpDaftar');
  if (!box || !App.ntf._pilihProyek) return;
  const g = App.ntf.grupDitemukan || [];
  const dipilih = App.ntf._pilihProyek.dipilih;
  if (!g.length) { box.innerHTML = '<div class="text-muted-2" style="font-size:.84rem">Belum ada grup. Klik <b>Perbarui dari WhatsApp</b>, atau isi ID grup secara manual.</div>'; return; }
  box.innerHTML = g.map(function (x, idx) {
    const cek = dipilih.some(function (y) { return y.id === x.id; });
    return '<label class="ntf-grup cursor-pointer" data-nama="' + esc(String(x.nama).toLowerCase()) + '">' +
      '<input type="checkbox" class="form-check-input m-0"' + (cek ? ' checked' : '') + ' onchange="centangGrupProyekNtf(' + idx + ', this.checked)">' +
      '<div style="min-width:0;flex:1"><b>' + esc(x.nama) + '</b><div class="text-muted-2 text-truncate" style="font-size:.72rem">' + esc(x.id) + '</div></div></label>';
  }).join('');
}

function saringGrupProyekNtf(q) {
  q = String(q || '').toLowerCase();
  document.querySelectorAll('#gpDaftar .ntf-grup').forEach(function (r) { r.style.display = r.dataset.nama.indexOf(q) >= 0 ? '' : 'none'; });
}

function centangGrupProyekNtf(idx, ya) {
  const x = (App.ntf.grupDitemukan || [])[idx], st = App.ntf._pilihProyek;
  if (!x || !st) return;
  st.dipilih = st.dipilih.filter(function (y) { return y.id !== x.id; });
  if (ya) {
    if (st.dipilih.length >= 5) { showToast('Batas', 'Maksimal 5 grup per proyek.', 'warning'); renderDaftarGrupProyekNtf(); return; }
    st.dipilih.push({ id: x.id, nama: x.nama });
  }
  isiTerpilihGrupProyekNtf();
}

function tambahGrupProyekManualNtf() {
  const id = document.getElementById('gpId').value.trim(), nama = document.getElementById('gpNama').value.trim() || 'Grup WhatsApp';
  const st = App.ntf._pilihProyek;
  if (!/^[0-9-]{6,40}@g\.us$/.test(id)) { showToast('ID Tidak Valid', 'ID grup berbentuk angka diakhiri @g.us, mis. 120363012345678901@g.us', 'warning'); return; }
  if (st.dipilih.some(function (y) { return y.id === id; })) return;
  if (st.dipilih.length >= 5) { showToast('Batas', 'Maksimal 5 grup per proyek.', 'warning'); return; }
  st.dipilih.push({ id: id, nama: nama });
  document.getElementById('gpId').value = ''; document.getElementById('gpNama').value = '';
  isiTerpilihGrupProyekNtf();
}

function isiTerpilihGrupProyekNtf() {
  const el = document.getElementById('gpTerpilih'), st = App.ntf._pilihProyek;
  if (!el || !st) return;
  el.innerHTML = st.dipilih.length ? st.dipilih.map(function (g, i) {
    return '<span class="chip chip-ok me-1 mb-1">' + esc(g.nama) + ' <a class="cursor-pointer ms-1" onclick="App.ntf._pilihProyek.dipilih.splice(' + i + ',1);isiTerpilihGrupProyekNtf();renderDaftarGrupProyekNtf()">×</a></span>';
  }).join('') : '<span class="text-muted-2">belum ada — pemberitahuan proyek ini dikirim ke Grup Utama</span>';
}

function simpanGrupProyekNtf() {
  const st = App.ntf._pilihProyek, d = App.ntf.draf;
  if (!st) return;
  d.grupProyek = d.grupProyek || {};
  if (st.dipilih.length) d.grupProyek[st.pid] = st.dipilih.slice(); else delete d.grupProyek[st.pid];
  if (st.dipilih.length && !d.waAktif) d.waAktif = true;              // grup pertama → saklar ikut menyala
  closeModal();
  simpanPengaturanNtf();
}

function tesGrupProyekNtf(pid, btn) {
  const g = ((App.ntf.draf.grupProyek || {})[pid] || [])[0];
  if (!g) return;
  tombolLoading(btn, true);
  call('tesKirimWa', App.token, g.id, '').then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-send"></i> Tes');
    showToast(res.success ? 'Terkirim' : 'Gagal', res.success ? 'Pesan uji terkirim ke grup ' + g.nama + '.' : res.message, res.success ? 'success' : 'danger');
  }).catch(function (err) { tombolLoading(btn, false, '<i class="bi bi-send"></i> Tes'); showToast('Error', err.message, 'danger'); });
}


// ════════ v6.1 — PROGRES RUMAH (integrasi aplikasi Kontraktor) ════════
// Data progres fisik per unit diambil SERVER E-Catalog dari aplikasi Kontraktor
// (kunci rahasia tidak pernah ke browser). Hanya untuk pengguna internal yang login.

App.kp = null;            // hasil getProgresRumah: { aktif, wajib, ambang, terhubung, unit[], tahapan{}, ... }
App.kpKonfig = null;      // pengaturan integrasi (Owner)

(function () {
  const ref = document.getElementById('app-indent');
  if (ref && !document.getElementById('app-progresRumah')) {
    const sec = ref.cloneNode(false);
    sec.id = 'app-progresRumah';
    sec.classList.remove('active');
    ref.parentNode.appendChild(sec);
  }
})();

/** Integrasi aktif & data sudah dimuat → kolom/panel progres boleh ditampilkan. */
function kpTampil() { return !!(App.kp && App.kp.aktif && App.kp.terhubung); }

function kpUnit(idKavling) {
  if (!App.kp || !App.kp.unit) return null;
  return App.kp.unit.find(function (u) { return u.idKavling === idKavling; }) || null;
}

/** Muat data progres sekali (di latar), lalu panggil lalu() bila ada data baru. */
function kpPastikan(lalu, paksa) {
  if (App.kp && !paksa && Date.now() - (App.kp._t || 0) < 300000) return;
  if (App._kpMemuat) return;
  App._kpMemuat = true;
  return call('getProgresRumah', App.token, !!paksa).then(function (res) {
    App._kpMemuat = false;
    if (!res || !res.success) return;
    const lama = App.kp;
    res.data._t = Date.now();
    App.kp = res.data;
    if (lalu && (!lama || paksa || JSON.stringify(lama.unit) !== JSON.stringify(res.data.unit) || lama.aktif !== res.data.aktif)) lalu();
  }).catch(function () { App._kpMemuat = false; });
}

function kpSiap(u) { return !!(u && u.kp && App.kp && u.kp.progres >= App.kp.ambang); }

function warnaProgres(p) {
  if (p >= 100) return 'var(--success)';
  if (p >= ((App.kp && App.kp.ambang) || 80)) return '#1F8A70';
  if (p >= 50) return 'var(--accent)';
  return 'var(--primary)';
}

function htmlBarProgres(p) {
  p = Math.max(0, Math.min(100, Number(p) || 0));
  return '<div class="kp-bar"><span style="width:' + p + '%;background:' + warnaProgres(p) + '"></span></div>';
}

function htmlProgresMini(idKavling) {
  const u = kpUnit(idKavling);
  if (!u || !u.kp) return '<span class="text-muted-2" style="font-size:.78rem">' + (u && !u.proyekTerhubung ? 'Proyek belum dipetakan' : 'Belum terhubung') + '</span>';
  return '<div style="font-size:.82rem"><b class="tabular">' + u.kp.progres + '%</b> ' +
    (kpSiap(u) ? '<span class="chip chip-ok">Siap akad</span>' : '<span class="chip chip-warn">&lt; ' + App.kp.ambang + '%</span>') +
    htmlBarProgres(u.kp.progres) + '</div>';
}

// ── Halaman Progres Rumah ──
function renderProgresRumah() {
  const el = document.getElementById('app-progresRumah');
  if (!el) return;
  if (!App.kp) {
    el.innerHTML = '<p class="text-muted-2">Memuat progres pembangunan dari aplikasi Kontraktor…</p>' + skeleton(80, 4);
    kpPastikan(function () { if (App.appPage === 'progresRumah') renderProgresRumah(); }, false);
    return;
  }
  const d = App.kp;
  if (!d.aktif || !d.terhubung) {
    el.innerHTML = '<p class="text-muted-2">Progres fisik setiap unit rumah dari aplikasi Kontraktor.</p>' +
      '<div class="card-lux p-4 text-center" style="max-width:640px">' +
        '<i class="bi bi-plug" style="font-size:2rem;color:var(--primary)"></i>' +
        '<h5 class="mt-2">' + (d.aktif ? 'Aplikasi Kontraktor belum bisa dihubungi' : 'Integrasi aplikasi Kontraktor belum aktif') + '</h5>' +
        '<p class="text-muted-2" style="font-size:.88rem">' + esc(d.pesan || '') + '</p>' +
        (d.bisaAtur ? '<button class="btn btn-brand" onclick="goApp(\'konfigurasi\');setTimeout(function(){var x=document.getElementById(\'kpKonfig\');if(x)x.scrollIntoView({behavior:\'smooth\'});},400)"><i class="bi bi-gear"></i> Atur di Konfigurasi Sistem</button>'
          : '<p class="text-muted-2 mb-0" style="font-size:.84rem">Minta Owner mengaktifkan di <b>Konfigurasi Sistem → Integrasi Aplikasi Kontraktor</b>.</p>') +
        (d.aktif ? '<div class="mt-3"><button class="btn btn-sm btn-outline-brand" id="btnKpSegar" onclick="segarkanProgres()"><i class="bi bi-arrow-repeat"></i> Coba Lagi</button></div>' : '') +
      '</div>';
    return;
  }
  const semua = d.unit;
  const terhubung = semua.filter(function (u) { return u.kp; });
  const siap = terhubung.filter(kpSiap);
  const rata = terhubung.length ? Math.round(terhubung.reduce(function (a, u) { return a + u.kp.progres; }, 0) / terhubung.length * 10) / 10 : 0;
  const kpi = [
    { l: 'Siap Akad', v: siap.length, s: 'unit progres ≥ ' + d.ambang + '%', i: 'check2-circle', g: 'is-ok' },
    { l: 'Menunggu Pembangunan', v: terhubung.length - siap.length, s: 'unit < ' + d.ambang + '%', i: 'hourglass-split', g: 'is-warn' },
    { l: 'Rata-rata Progres', v: rata + '%', s: terhubung.length + ' unit terhubung', i: 'bricks', g: 'is-brand' },
    { l: 'Belum Terhubung', v: semua.length - terhubung.length, s: 'kavling tanpa data Kontraktor', i: 'plug', g: 'is-gold' }
  ];
  const f = App.kpFilter || (App.kpFilter = { proyek: '', status: '', q: '' });
  el.innerHTML =
    '<p class="text-muted-2">Progres fisik setiap unit rumah, langsung dari aplikasi Kontraktor. Akad dapat dijadwalkan bila progres ≥ <b>' + d.ambang + '%</b>' +
      (d.wajib ? '' : ' <span class="chip chip-soft">informasi saja</span>') + '.</p>' +
    (d.peringatan ? '<div class="alert alert-warning py-2" style="font-size:.84rem"><i class="bi bi-exclamation-triangle"></i> ' + esc(d.peringatan) + '</div>' : '') +
    '<div class="row g-2 g-md-3 mb-3">' + kpi.map(function (k) {
      return '<div class="col-6 col-lg-3"><div class="kpi-tile ' + k.g + '"><div class="kpi-ic"><i class="bi bi-' + k.i + '"></i></div>' +
        '<div style="min-width:0"><div class="kpi-lbl">' + esc(k.l) + '</div><div class="kpi-val">' + esc(String(k.v)) + '</div><div class="kpi-sub">' + esc(k.s) + '</div></div></div></div>';
    }).join('') + '</div>' +
    '<div class="card-lux p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">' +
      '<div class="input-group" style="max-width:240px"><span class="input-group-text"><i class="bi bi-search"></i></span>' +
        '<input class="form-control" id="kpCari" value="' + esc(f.q) + '" placeholder="Cari blok / konsumen…" oninput="App.kpFilter.q=this.value;tundaCari(renderTabelProgres)"></div>' +
      '<select class="form-select" style="max-width:220px" onchange="App.kpFilter.proyek=this.value;renderTabelProgres()"><option value="">Semua Proyek</option>' +
        (d.proyek || []).map(function (p) { return '<option value="' + esc(p.id) + '"' + (f.proyek === p.id ? ' selected' : '') + '>' + esc(p.nama) + '</option>'; }).join('') + '</select>' +
      '<select class="form-select" style="max-width:220px" onchange="App.kpFilter.status=this.value;renderTabelProgres()">' +
        [['', 'Semua Unit'], ['konsumen', 'Unit dengan konsumen'], ['siap', 'Siap akad'], ['belum', 'Menunggu pembangunan'], ['putus', 'Belum terhubung']]
          .map(function (o) { return '<option value="' + o[0] + '"' + (f.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<button class="btn btn-sm btn-outline-brand ms-auto" id="btnKpSegar" onclick="segarkanProgres()"><i class="bi bi-arrow-repeat"></i> Ambil Data Terbaru</button>' +
    '</div>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr>' +
      '<th>Unit</th><th>Konsumen</th><th style="min-width:150px">Progres Fisik</th><th>Tahap Berjalan</th><th>Update Lapangan</th><th>Kesiapan Akad</th><th class="text-end">Detail</th>' +
    '</tr></thead><tbody id="tbodyKp"></tbody></table></div>' +
    '<div class="text-muted-2 mt-2" style="font-size:.76rem">Diambil: ' + esc(d.diambil || '-') + ' · data disimpan sementara 10 menit.</div>';
  renderTabelProgres();
}

function renderTabelProgres() {
  const tb = document.getElementById('tbodyKp');
  if (!tb || !App.kp) return;
  const f = App.kpFilter || {};
  const q = String(f.q || '').toLowerCase();
  const nmProyek = {}; (App.kp.proyek || []).forEach(function (p) { nmProyek[p.id] = p.nama; });
  const list = App.kp.unit.filter(function (u) {
    if (f.proyek && u.idProyek !== f.proyek) return false;
    if (f.status === 'konsumen' && !u.konsumen) return false;
    if (f.status === 'siap' && !kpSiap(u)) return false;
    if (f.status === 'belum' && (!u.kp || kpSiap(u))) return false;
    if (f.status === 'putus' && u.kp) return false;
    if (q && (u.blok + '-' + u.nomor + ' ' + (u.konsumen ? u.konsumen.nama : '') + ' ' + (nmProyek[u.idProyek] || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) {
    return String(nmProyek[a.idProyek] || '').localeCompare(String(nmProyek[b.idProyek] || '')) ||
      String(a.blok).localeCompare(String(b.blok), 'id', { numeric: true }) || String(a.nomor).localeCompare(String(b.nomor), 'id', { numeric: true });
  });
  if (!list.length) { tb.innerHTML = '<tr><td colspan="7" class="text-center text-muted-2 py-4">Tidak ada unit.</td></tr>'; return; }
  tb.innerHTML = list.map(function (u) {
    const k = u.konsumen;
    return '<tr><td><b>Blok ' + esc(u.blok) + '-' + esc(u.nomor) + '</b><div class="text-muted-2" style="font-size:.76rem">' + esc(nmProyek[u.idProyek] || '') + (u.tipe ? ' · Tipe ' + esc(u.tipe) : '') + '</div></td>' +
      '<td>' + (k ? '<b style="font-size:.86rem">' + esc(k.nama) + '</b><div class="text-muted-2" style="font-size:.74rem">' + esc(k.metode) + (k.statusBerkas ? ' · ' + esc(k.statusBerkas) : '') + (k.tanggalAkad ? ' · akad ' + esc(tglIndo(k.tanggalAkad)) : '') + '</div>'
        : '<span class="text-muted-2" style="font-size:.8rem">' + esc(u.statusKavling || '-') + '</span>') + '</td>' +
      '<td>' + (u.kp ? '<b class="tabular">' + u.kp.progres + '%</b> <span class="text-muted-2" style="font-size:.74rem">' + esc(u.kp.status || '') + '</span>' + htmlBarProgres(u.kp.progres)
        : '<span class="text-muted-2" style="font-size:.8rem">' + (u.proyekTerhubung ? 'Belum terhubung' : 'Proyek belum dipetakan') + '</span>') + '</td>' +
      '<td style="font-size:.82rem">' + (u.kp ? esc(u.kp.tahap || '-') : '-') + '</td>' +
      '<td style="font-size:.8rem">' + (u.kp && u.kp.update ? esc(String(u.kp.update).substring(0, 16)) : '-') + (u.kp && u.kp.target ? '<div class="text-muted-2">target ' + esc(String(u.kp.target).substring(0, 10)) + '</div>' : '') + '</td>' +
      '<td>' + (!u.kp ? '<span class="chip">-</span>' : kpSiap(u) ? '<span class="chip chip-ok">Siap akad</span>' : '<span class="chip chip-warn">Belum ' + App.kp.ambang + '%</span>') + '</td>' +
      '<td class="text-end">' + (u.kp ? '<button class="btn btn-sm btn-ghost" onclick="detailProgres(\'' + escJs(u.idKavling) + '\')"><i class="bi bi-eye"></i></button>' : '') + '</td></tr>';
  }).join('');
}

function segarkanProgres() {
  const btn = document.getElementById('btnKpSegar');
  tombolLoading(btn, true);
  call('getProgresRumah', App.token, true).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-arrow-repeat"></i> Ambil Data Terbaru');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    res.data._t = Date.now(); App.kp = res.data;
    showToast(res.data.terhubung ? 'Diperbarui' : 'Belum Terhubung', res.data.terhubung ? 'Data progres terbaru dari aplikasi Kontraktor.' : (res.data.pesan || ''), res.data.terhubung ? 'success' : 'warning');
    if (App.appPage === 'progresRumah') renderProgresRumah(); else if (App.appPage === 'jadwalAkad') renderJadwalAkad();
  }).catch(function (err) { tombolLoading(btn, false, '<i class="bi bi-arrow-repeat"></i> Ambil Data Terbaru'); showToast('Error', err.message, 'danger'); });
}

function detailProgres(idKavling) {
  const u = kpUnit(idKavling);
  if (!u || !u.kp) return;
  const nm = ((App.kp.proyek || []).find(function (p) { return p.id === u.idProyek; }) || {}).nama || '';
  const th = (App.kp.tahapan || {})[u.idProyek] || [];
  openModal('Progres Rumah — Blok ' + u.blok + '-' + u.nomor,
    '<div class="d-flex flex-wrap gap-3 align-items-center mb-3">' +
      '<div style="font-size:2rem;font-weight:700;color:' + warnaProgres(u.kp.progres) + '" class="tabular">' + u.kp.progres + '%</div>' +
      '<div style="flex:1;min-width:200px"><b>' + esc(nm) + '</b> · ' + esc(u.kp.kode || ('Blok ' + u.blok + '-' + u.nomor)) +
        '<div class="text-muted-2" style="font-size:.82rem">' + esc(u.kp.status || '') + ' · tahap berjalan: ' + esc(u.kp.tahap || '-') +
        (u.kp.update ? ' · update lapangan ' + esc(String(u.kp.update).substring(0, 16)) : '') + (u.kp.target ? ' · target selesai ' + esc(String(u.kp.target).substring(0, 10)) : '') + '</div>' +
        htmlBarProgres(u.kp.progres) + '</div>' +
      (kpSiap(u) ? '<span class="chip chip-ok">Siap akad</span>' : '<span class="chip chip-warn">Belum ' + App.kp.ambang + '%</span>') +
    '</div>' +
    (u.konsumen ? '<div class="card-flat p-2 mb-3" style="font-size:.84rem"><b>' + esc(u.konsumen.nama) + '</b> · ' + esc(u.konsumen.metode) +
      (u.konsumen.statusBerkas ? ' · berkas ' + esc(u.konsumen.statusBerkas) : '') + (u.konsumen.tanggalAkad ? ' · akad ' + esc(tglIndo(u.konsumen.tanggalAkad)) : '') + '</div>' : '') +
    '<div class="row g-3"><div class="col-md-7"><h6 class="font-head">Progres per Tahapan</h6>' +
      (th.length ? th.map(function (t, i) {
        const r = Number((u.kp.r || [])[i]) || 0;
        return '<div class="mb-2"><div class="d-flex justify-content-between" style="font-size:.82rem"><span>' + esc(t.nama) + (t.bobot ? ' <span class="text-muted-2">(bobot ' + esc(String(t.bobot)) + ')</span>' : '') + '</span><b class="tabular">' + r + '%</b></div>' + htmlBarProgres(r) + '</div>';
      }).join('') : '<div class="text-muted-2" style="font-size:.84rem">Tahapan belum diatur di aplikasi Kontraktor.</div>') +
    '</div><div class="col-md-5"><h6 class="font-head">Foto Lapangan Terakhir</h6><div id="kpFoto">' +
      (u.kp.adaFoto ? skeleton(160, 1) : '<div class="text-muted-2" style="font-size:.84rem">Belum ada foto.</div>') + '</div></div></div>',
    '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>', 'modal-lg');
  if (u.kp.adaFoto) {
    call('getFotoProgres', App.token, idKavling).then(function (res) {
      const box = document.getElementById('kpFoto'); if (!box) return;
      if (!res.success) { box.innerHTML = '<div class="text-muted-2" style="font-size:.84rem">' + esc(res.message) + '</div>'; return; }
      box.innerHTML = (res.data.dataUrl ? '<img src="' + res.data.dataUrl + '" alt="Foto lapangan" style="width:100%;border-radius:12px;border:1px solid var(--border)">' :
        '<div class="text-muted-2 mb-2" style="font-size:.84rem">' + esc(res.data.pesan || '') + '</div>') +
        '<div class="d-flex justify-content-between mt-1" style="font-size:.78rem"><span class="text-muted-2">' + esc(res.data.tgl || '') + '</span>' +
        '<a href="' + esc(res.data.tautan) + '" target="_blank" rel="noopener">Buka di Drive <i class="bi bi-box-arrow-up-right"></i></a></div>';
    }).catch(function () { /* abaikan */ });
  }
}

// ── Panel progres di form Jadwalkan Akad ──
function panelProgresAkad(t) {
  const box = document.getElementById('akProgres');
  if (!box) return;
  const gambar = function () {
    const b = document.getElementById('akProgres'), btn = document.getElementById('btnAkad');
    if (!b || !App.kp || !App.kp.aktif) { if (b) b.innerHTML = ''; return; }
    if (!App.kp.terhubung) {
      b.innerHTML = '<div class="alert alert-warning py-2 mt-3 mb-0" style="font-size:.82rem"><i class="bi bi-plug"></i> Progres rumah tidak bisa diperiksa: ' + esc(App.kp.pesan || '') + '</div>';
      return;
    }
    const u = kpUnit(t.idKavling), sudah = !!t.berkas.tanggalAkad;
    const ok = kpSiap(u) || !App.kp.wajib || sudah;
    const owner = App.sesi && App.sesi.role === 'Owner';
    b.innerHTML = '<div class="card-flat p-3 mt-3" style="border-left:4px solid ' + (ok ? 'var(--success)' : 'var(--danger)') + '">' +
      '<div class="d-flex justify-content-between align-items-center" style="font-size:.86rem"><b><i class="bi bi-bricks"></i> Progres Rumah</b>' +
        (u && u.kp ? '<b class="tabular" style="color:' + warnaProgres(u.kp.progres) + '">' + u.kp.progres + '%</b>' : '<span class="text-muted-2">belum terhubung</span>') + '</div>' +
      (u && u.kp ? htmlBarProgres(u.kp.progres) + '<div class="text-muted-2 mt-1" style="font-size:.76rem">Tahap: ' + esc(u.kp.tahap || '-') + (u.kp.update ? ' · update ' + esc(String(u.kp.update).substring(0, 16)) : '') + '</div>' : '') +
      '<div class="mt-2" style="font-size:.8rem;color:' + (ok ? 'var(--success)' : 'var(--danger)') + '">' +
        (kpSiap(u) ? '✓ Memenuhi syarat progres minimal ' + App.kp.ambang + '%.' :
          sudah ? 'Jadwal ulang akad diizinkan.' :
          !App.kp.wajib ? 'Syarat progres tidak diwajibkan — hanya informasi.' :
          '✕ Akad belum bisa dijadwalkan: progres minimal ' + App.kp.ambang + '%' + (u && u.kp ? '' : ' (unit belum terhubung dengan aplikasi Kontraktor)') + '.') + '</div>' +
      (!ok && owner ? '<div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="akAbaikan" onchange="kunciTombolAkad()">' +
        '<label class="form-check-label" for="akAbaikan" style="font-size:.82rem">Abaikan syarat progres (pengecualian Owner — tercatat)</label></div>' +
        '<input class="form-control form-control-sm mt-1" id="akAlasan" placeholder="Alasan pengecualian (wajib)" oninput="kunciTombolAkad()">' : '') +
    '</div>';
    App._akSyaratOk = ok;
    kunciTombolAkad();
  };
  App._akSyaratOk = true;
  gambar();
  kpPastikan(gambar, true);
}

function kunciTombolAkad() {
  const btn = document.getElementById('btnAkad'); if (!btn) return;
  const ab = document.getElementById('akAbaikan'), al = document.getElementById('akAlasan');
  const boleh = App._akSyaratOk !== false || (ab && ab.checked && al && al.value.trim().length >= 3);
  btn.disabled = !boleh;
  btn.title = boleh ? '' : 'Progres rumah belum memenuhi syarat minimal';
}

// ── Konfigurasi Sistem → Integrasi Aplikasi Kontraktor (Owner) ──
function muatKonfigKontraktor() {
  const box = document.getElementById('kpKonfig');
  if (!box || !App.sesi || App.sesi.role !== 'Owner') return;
  if (App.kpKonfig) { renderKonfigKontraktor(); return; }
  box.innerHTML = skeleton(60, 1);
  call('getKontraktorConfig', App.token).then(function (res) {
    if (!res.success) { box.innerHTML = '<div class="text-muted-2">' + esc(res.message) + '</div>'; return; }
    App.kpKonfig = res.data; renderKonfigKontraktor();
  }).catch(function (err) { box.innerHTML = '<div class="text-muted-2">' + esc(err.message) + '</div>'; });
}

function renderKonfigKontraktor() {
  const box = document.getElementById('kpKonfig'), c = App.kpKonfig;
  if (!box || !c) return;
  const uji = App.kpUji;
  box.innerHTML = '<div class="card-lux p-3 p-md-4">' +
    '<h5 class="mb-1"><i class="bi bi-bricks"></i> Integrasi Aplikasi Kontraktor</h5>' +
    '<p class="text-muted-2" style="font-size:.84rem">Menampilkan progres fisik setiap unit rumah dari aplikasi Kontraktor (menu <b>Progres Rumah</b>), dan mengunci penjadwalan akad sampai progres minimal tercapai. Ambil URL &amp; kunci di aplikasi Kontraktor → <b>Pengaturan → Integrasi E-Catalog</b>.</p>' +
    '<div class="row g-3">' +
      '<div class="col-md-7"><label class="form-label">URL Web App aplikasi Kontraktor (/exec)</label>' +
        '<input class="form-control" id="kpUrl" value="' + esc(c.url || '') + '" placeholder="https://script.google.com/macros/s/…/exec"></div>' +
      '<div class="col-md-5"><label class="form-label">Kunci Integrasi' + (c.punyaKunci ? ' <span class="chip chip-ok">tersimpan …' + esc(c.kunciHint) + '</span>' : '') + '</label>' +
        '<input type="password" class="form-control" id="kpKunci" autocomplete="off" placeholder="' + (c.punyaKunci ? 'Kosongkan bila tidak diubah' : 'Tempel kunci 64 karakter') + '"></div>' +
      '<div class="col-md-4"><div class="form-check form-switch mt-md-4"><input class="form-check-input" type="checkbox" id="kpAktif"' + (c.aktif ? ' checked' : '') + '>' +
        '<label class="form-check-label" for="kpAktif"><b>Aktifkan integrasi</b></label></div></div>' +
      '<div class="col-md-5"><div class="form-check form-switch mt-md-4"><input class="form-check-input" type="checkbox" id="kpWajib"' + (c.wajib ? ' checked' : '') + '>' +
        '<label class="form-check-label" for="kpWajib">Wajibkan progres minimal untuk akad</label></div></div>' +
      '<div class="col-md-3"><label class="form-label">Progres minimal (%)</label><input type="number" min="1" max="100" class="form-control" id="kpAmbang" value="' + esc(String(c.ambang || 80)) + '"></div>' +
    '</div>' +
    '<div class="d-flex flex-wrap gap-2 mt-3">' +
      '<button class="btn btn-outline-brand" id="btnKpUji" onclick="ujiKontraktorUi()"><i class="bi bi-plug"></i> Uji Koneksi &amp; Muat Proyek</button>' +
      '<button class="btn btn-brand" id="btnKpSimpan" onclick="simpanKontraktorUi()"><i class="bi bi-save"></i> Simpan Integrasi</button>' +
    '</div>' +
    (c.terakhir ? '<div class="text-muted-2 mt-2" style="font-size:.76rem">Koneksi terakhir: ' + esc(c.terakhir.at || '') + ' — ' + (c.terakhir.ok ? '<span style="color:var(--success)">berhasil</span>' : '<span style="color:var(--danger)">' + esc(c.terakhir.pesan || 'gagal') + '</span>') + '</div>' : '') +
    '<div id="kpUjiHasil" class="mt-3">' + (uji ? htmlPemetaanKontraktor() : '') + '</div>' +
  '</div>';
}

function htmlPemetaanKontraktor() {
  const u = App.kpUji, c = App.kpKonfig;
  if (!u) return '';
  return '<div class="alert py-2" style="background:var(--success-bg);border:none;color:var(--success);font-size:.84rem"><i class="bi bi-check-circle"></i> ' + esc(u.pesan) + '</div>' +
    '<h6 class="font-head">Pemetaan Proyek</h6>' +
    '<div class="table-wrap"><table class="table-lux"><thead><tr><th>Proyek E-Catalog</th><th>Proyek di aplikasi Kontraktor</th><th class="text-end">Unit cocok</th></tr></thead><tbody>' +
    u.ringkas.map(function (r) {
      const pilih = (c.peta || {})[r.id] || '';
      return '<tr><td><b>' + esc(r.nama) + '</b></td><td><select class="form-select form-select-sm kp-peta" data-id="' + esc(r.id) + '">' +
        '<option value=""' + (!pilih ? ' selected' : '') + '>Otomatis (nama sama)' + (!pilih && r.kontraktor ? ' → ' + esc(r.kontraktor) : '') + '</option>' +
        u.proyekK.map(function (k) { return '<option value="' + esc(k.id) + '"' + (pilih === k.id ? ' selected' : '') + '>' + esc(k.nama) + (k.lokasi ? ' — ' + esc(k.lokasi) : '') + '</option>'; }).join('') +
        '<option value="-"' + (pilih === '-' ? ' selected' : '') + '>— Tidak dihubungkan —</option></select></td>' +
        '<td class="text-end tabular">' + (r.kontraktor ? r.cocok + ' / ' + r.kavling : '<span class="text-muted-2">belum dipetakan</span>') +
        (r.kontraktor && r.cocok < r.kavling ? '<div class="text-muted-2" style="font-size:.72rem">' + (r.kavling - r.cocok) + ' belum terhubung</div>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<div class="text-muted-2 mt-1" style="font-size:.76rem">Unit dicocokkan berdasarkan <b>Blok + Nomor</b> (mis. Blok A No. 01 = kode A-01 = A1). Setelah mengubah pasangan, klik <b>Uji Koneksi</b> lagi untuk melihat jumlah unit cocok, lalu <b>Simpan Integrasi</b>.</div>';
}

function bacaPetaKontraktor() {
  const peta = {};
  document.querySelectorAll('#kpKonfig .kp-peta').forEach(function (s) { if (s.value) peta[s.dataset.id] = s.value; });
  return document.querySelectorAll('#kpKonfig .kp-peta').length ? peta : (App.kpKonfig.peta || {});
}

function ujiKontraktorUi() {
  const btn = document.getElementById('btnKpUji');
  tombolLoading(btn, true);
  const p = { url: document.getElementById('kpUrl').value.trim(), kunci: document.getElementById('kpKunci').value.trim(), peta: bacaPetaKontraktor() };
  App.kpKonfig.peta = p.peta; App.kpKonfig.url = p.url;
  call('ujiKontraktor', App.token, p).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-plug"></i> Uji Koneksi &amp; Muat Proyek');
    const box = document.getElementById('kpUjiHasil');
    if (!res.success) { App.kpUji = null; if (box) box.innerHTML = '<div class="alert alert-danger py-2" style="font-size:.84rem">' + esc(res.message) + '</div>'; return; }
    App.kpUji = Object.assign(res.data, { pesan: res.message });
    if (box) box.innerHTML = htmlPemetaanKontraktor();
  }).catch(function (err) { tombolLoading(btn, false, '<i class="bi bi-plug"></i> Uji Koneksi &amp; Muat Proyek'); showToast('Error', err.message, 'danger'); });
}

function simpanKontraktorUi() {
  const btn = document.getElementById('btnKpSimpan');
  const p = {
    url: document.getElementById('kpUrl').value.trim(), kunci: document.getElementById('kpKunci').value.trim(),
    aktif: document.getElementById('kpAktif').checked, wajib: document.getElementById('kpWajib').checked,
    ambang: Number(document.getElementById('kpAmbang').value) || 80, peta: bacaPetaKontraktor()
  };
  tombolLoading(btn, true);
  call('simpanKontraktorConfig', App.token, p).then(function (res) {
    tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Integrasi');
    if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
    App.kpKonfig = res.data; App.kp = null;
    renderKonfigKontraktor();
    showToast('Berhasil', res.message + (res.data.aktif ? ' Menu Progres Rumah siap dipakai.' : ''), 'success');
  }).catch(function (err) { tombolLoading(btn, false, '<i class="bi bi-save"></i> Simpan Integrasi'); showToast('Error', err.message, 'danger'); });
}
