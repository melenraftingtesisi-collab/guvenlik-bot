import http from 'http';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay, downloadMediaMessage } from '@whiskeysockets/baileys';

// --- HATA KALKANI (Baileys içi 'Invalid buffer' ve bildirim hatalarının botu düşürmesini engeller) ---
process.on('uncaughtException', (err) => {
  if (err?.message?.includes('Invalid buffer')) return;
  console.error('[Hata Yakalandı - Uncaught]:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  if (reason?.message?.includes('Invalid buffer')) return;
  console.error('[Hata Yakalandı - Rejection]:', reason?.message || reason);
});

// --- AYARLAR ---
const TELEFON_NUMARANIZ = '905468429287'; 

// Hedef yönetim grubunun tam adı
const HEDEF_GRUP_ADI = "Güvenlik Bildirim Takip";

// SADECE DİNLENECEK KAYNAK GRUPLAR (Tam grup adları)
const KAYNAK_GRUPLAR = [
  "AYEDAŞ BÖLGE GÜVENLİK",
  "AYEDAŞ GM GÜVENLİK"
];

// 1. Port Dinleyici (Render Web Service kapanmasın diye)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Guvenlik Botu Aktif ve Dinlemede!');
}).listen(PORT, () => {
  console.log(`Web portu dinleniyor: ${PORT}`);
});

// 2. KAPSAMLI FİLTRE LİSTESİ (Hatalı eşleşmeler temizlenmiş hal)
const TEMEL_KOKLER = [
  // Arıza / Çalışma Durumu
  'arız', 'ariz', 'bozuk', 'bozul', 'çalışm', 'calism', 'açılmıy', 'acilmiy', 'kapanmıy', 'kapanmiy', 'tutmuy', 'tutmiy', 'devre dışı', 'devre disi', 'kesinti',

  // Donanım, Cihaz ve Tesis Ekipmanları
  'bariyer', 'turnike', 'asansör', 'asansor', 'klima', 'jeneratör', 'jenerator', 'lamba', 'aydınlatm', 'aydinlatm', 'projektör', 'projektor',
  'kamera', 'dvr', 'nvr', 'xray', 'x-ray', 'detektör', 'detektor', 'telsiz', 'plaka tanı', 'plaka tani', 'manyetik',
  'kart okuyuc', 'buton', 'moba',

  // Altyapı, Tesisat ve Sıhhi Sorunlar (Yalın 'taş'/'tas' kaldırıldı, fiil türevleri eklendi)
  'elektrik', 'sigorta', 'kaçak', 'kacak', 'su basm', 'boru patla', 'vana', 'iski',
  'tıkan', 'tikan',
  'taşma', 'tasma', 'taştı', 'tasti', 'taşıyor', 'tasiyor', 'su taş', 'su tas',
  'akıt', 'akit', 'akıntı', 'akinti', 'damlat', 'sızıntı', 'sizinti',

  // Fiziki Güvenlik, Hat ve Hasar (Yalın 'kop' ve 'sark' kaldırıldı)
  'kırık', 'kirik', 'kırıl', 'kiril', 'hasar', 'çarpma', 'carpma', 'çarpt', 'carpt', 'zorlanm', 'delinm', 'kesilm', 'tel çit', 'tel cit',
  'koptu', 'kopma', 'kopan', 'kopmuş',
  'devril', 'devrildi', 'devrilme',
  'sarktı', 'sarkma', 'sarkıyor',
  'yıkıl', 'yikil', 'yıkıldı',

  // Acil Durum ve Yangın
  'yangın', 'yangin', 'duman', 'alarm çal', 'alarm cal', 'sabotaj'
];

async function baslat() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    defaultQueryTimeoutMs: undefined,
    connectTimeoutMs: 60000,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    shouldIgnoreJid: (jid) => jid.includes('broadcast') || jid.includes('newsletter')
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    console.log(`[BİLGİ] Oturum yok, ${TELEFON_NUMARANIZ} için eşleştirme kodu isteniyor...`);
    setTimeout(async () => {
      try {
        const kod = await sock.requestPairingCode(TELEFON_NUMARANIZ);
        console.log('\n========================================');
        console.log(`🔑 EŞLEŞTİRME KODUNUZ: ${kod}`);
        console.log('========================================\n');
      } catch (hata) {
        console.error('Eşleştirme kodu üretilirken hata oluştu:', hata);
      }
    }, 5000);
  }

  let hedefGrupJid = null;
  const dinlenenGruplar = new Map();

  // Çoklu fotoğraf/video toplama havuzu (Albüm birleştirici)
  const medyaKuyrugu = new Map();

  async function gruplariGuncelle() {
    try {
      const groups = await sock.groupFetchAllParticipating();
      dinlenenGruplar.clear();

      for (const jid in groups) {
        const grupAdi = groups[jid].subject.trim();

        if (grupAdi.toLowerCase() === HEDEF_GRUP_ADI.trim().toLowerCase()) {
          hedefGrupJid = jid;
          console.log(`✅ Hedef Bildirim Grubu Bağlandı: ${grupAdi}`);
        }

        const eslesenKaynak = KAYNAK_GRUPLAR.find(ad => ad.trim().toLowerCase() === grupAdi.toLowerCase());
        if (eslesenKaynak) {
          dinlenenGruplar.set(jid, grupAdi);
          console.log(`📡 Dinlemeye Alınan Grup: ${grupAdi} (${jid})`);
        }
      }
    } catch (e) {
      console.error('Grup listesi güncellenirken hata:', e?.message || e);
    }
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('✅ WhatsApp Bağlantısı Başarılı!');
      await delay(3000);
      await gruplariGuncelle();
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const yenidenBaglan = statusCode !== DisconnectReason.loggedOut;
      console.log(`Bağlantı koptu (Kod: ${statusCode}). Yeniden başlatılıyor...`);
      if (yenidenBaglan) {
        setTimeout(() => baslat(), 5000);
      }
    }
  });

  async function medyaPaketiniGonder(anahtar) {
    const paket = medyaKuyrugu.get(anahtar);
    if (!paket || !hedefGrupJid) return;
    medyaKuyrugu.delete(anahtar);

    const { metin, gonderen, kaynakGrupAdi, medyalar } = paket;

    const simdi = new Date();
    const tarih = simdi.toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const saat = simdi.toLocaleTimeString('tr-TR', { 
      timeZone: 'Europe/Istanbul', 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const bildirimMetni = `⚠️ *[GÜVENLİK AKSAKLIK BİLDİRİMİ]*\n📅 *Tarih:* ${
