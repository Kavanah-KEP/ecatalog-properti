/**
 * ============================================================
 * E-CATALOG PROPERTI — js/api.js  (v6.0, edisi GitHub Pages)
 * Pengganti google.script.run → fetch(POST) ke Web App Apps Script.
 *
 * Seluruh kode aplikasi (js/app.js) TIDAK berubah: ia tetap memanggil
 * google.script.run.withSuccessHandler(..).namaFungsi(..) seperti biasa,
 * dan berkas ini meneruskannya ke server sebagai REST API (JSON).
 *
 *  • Timeout + coba ulang otomatis saat sinyal HP putus-sambung
 *  • Penyimpanan membawa reqId unik → aman diulang, tidak pernah tersimpan dua kali
 *  • Menunggu online bila perangkat offline
 *  • "Ping" pembangun server saat aplikasi dibuka / kembali dari latar belakang
 *  • Pengukur kecepatan: ketik Perf.table() di Console browser
 * ============================================================
 */
(function () {
  'use strict';
  var CFG = window.ECP_CONFIG || {};
  var GAS_URL = String(CFG.GAS_URL || '').trim();
  var URL_SIAP = /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(GAS_URL) && GAS_URL.indexOf('TEMPEL') < 0;
  window.ECP_API = true;                       // penanda: aplikasi berjalan di luar Apps Script

  // ── Pengukur (Prinsip 0) ──
  var Perf = window.Perf = {
    rows: [],
    add: function (fn, total, server, coba) {
      this.rows.push({ fungsi: fn, total_ms: total, server_ms: server == null ? null : server,
        jaringan_ms: server == null ? null : total - server, percobaan: coba, jam: new Date().toLocaleTimeString('id-ID') });
      if (this.rows.length > 200) this.rows.shift();
    },
    table: function () { console.table(this.rows.slice(-40)); }
  };

  // Fungsi BACA: boleh diulang bebas. Fungsi lain = SIMPAN → diulang dengan reqId yang sama.
  var POLA_BACA = /^(get|cek|ambil|lihat|ping|muat|hitung|cari|dorong)/;
  function fungsiBaca(nama) {
    try { if (typeof BATAS_WAKTU_BACA !== 'undefined' && BATAS_WAKTU_BACA[nama]) return true; } catch (e) { /* abaikan */ }
    return POLA_BACA.test(nama) || nama === 'loginUser';
  }

  function buatReqId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* abaikan */ }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function jeda(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tungguOnline(ms) {
    return new Promise(function (r) {
      if (navigator.onLine !== false) return r();
      var t = setTimeout(selesai, ms);
      function selesai() { clearTimeout(t); window.removeEventListener('online', selesai); r(); }
      window.addEventListener('online', selesai);
    });
  }

  function kirimSekali(nama, args, reqId, batas) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var pewaktu = setTimeout(function () { if (ctrl) ctrl.abort(); }, batas);
    var t0 = Date.now();
    return fetch(GAS_URL, {
      method: 'POST', redirect: 'follow', cache: 'no-store', credentials: 'omit',
      signal: ctrl ? ctrl.signal : undefined,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },      // tanpa CORS preflight
      body: JSON.stringify({ fn: nama, args: args, reqId: reqId })
    }).then(function (res) {
      return res.text().then(function (teks) {
        var j;
        try { j = JSON.parse(teks); } catch (e) {
          return { gagalJaringan: true, bisaUlang: res.status >= 500 || res.status === 429 || res.status === 0,
            pesan: res.status === 200 ? 'Server membalas halaman, bukan data. Periksa GAS_URL di js/config.js & deploy (Who has access: Anyone).'
              : 'Server membalas HTTP ' + res.status + '.' };
        }
        j._total = Date.now() - t0;
        return j;
      });
    }).catch(function (err) {
      return { gagalJaringan: true, bisaUlang: true,
        pesan: err && err.name === 'AbortError' ? 'Server terlalu lama merespons.' : 'Koneksi ke server terputus.' };
    }).then(function (h) { clearTimeout(pewaktu); return h; });
  }

  function panggil(nama, args) {
    if (!URL_SIAP) {
      return Promise.reject(new Error('Alamat server belum diatur. Isi GAS_URL di berkas js/config.js dengan URL /exec Apps Script.'));
    }
    var baca = fungsiBaca(nama);
    var reqId = baca ? '' : buatReqId();
    var maksCoba = baca ? 3 : 3;
    var i = 0;
    function coba() {
      i++;
      var batas = baca ? (i === 1 ? 30000 : 45000) : 300000;          // simpan + unggah berkas: s/d 5 menit
      return kirimSekali(nama, args, reqId, batas).then(function (h) {
        if (h && h.ok === true) { Perf.add(nama, h._total, h.ms, i); return h.r; }
        if (h && h.ok === false) { Perf.add(nama, h._total, h.ms, i); throw new Error(h.error || 'Terjadi kesalahan di server.'); }
        if (h && h.gagalJaringan && h.bisaUlang && i < maksCoba) {
          return jeda(1200 * i).then(function () { return tungguOnline(15000); }).then(coba);
        }
        Perf.add(nama, null, null, i);
        throw new Error((h && h.pesan) || 'Koneksi ke server terputus.');
      });
    }
    return coba();
  }

  // ── Tiruan google.script.run (semua fungsi server otomatis tersedia) ──
  function buatRunner(sukses, gagal, objek) {
    var dasar = {
      withSuccessHandler: function (f) { return buatRunner(f, gagal, objek); },
      withFailureHandler: function (f) { return buatRunner(sukses, f, objek); },
      withUserObject: function (o) { return buatRunner(sukses, gagal, o); }
    };
    return new Proxy(dasar, {
      get: function (t, k) {
        if (k in t) return t[k];
        if (typeof k !== 'string' || k === 'then' || /_$/.test(k)) return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments).map(function (a) { return a === undefined ? null : a; });
          panggil(k, args).then(function (r) { if (sukses) sukses(r, objek); },
            function (err) { if (gagal) gagal(err, objek); else console.error('[API]', k, err); });
        };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', { configurable: true, get: function () { return buatRunner(null, null, undefined); } });

  // ── Bangunkan server (cold start) saat dibuka & saat kembali dari latar belakang ──
  function bangunkan() {
    if (!URL_SIAP) return;
    try { fetch(GAS_URL + '?ping=' + Date.now(), { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }).catch(function () {}); } catch (e) { /* abaikan */ }
  }
  var tersembunyiSejak = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') tersembunyiSejak = Date.now();
    else if (tersembunyiSejak && Date.now() - tersembunyiSejak > 120000) bangunkan();
  });
  bangunkan();

  if (!URL_SIAP) {
    document.addEventListener('DOMContentLoaded', function () {
      var d = document.createElement('div');
      d.setAttribute('role', 'alert');
      d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#BA1A1A;color:#fff;padding:12px 16px;border-radius:12px;font:500 14px/1.45 Inter,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)';
      d.textContent = '⚠️ Alamat server belum diatur. Buka berkas js/config.js lalu isi GAS_URL dengan URL /exec dari Apps Script (Deploy → Manage deployments).';
      document.body.appendChild(d);
    });
  }
})();
