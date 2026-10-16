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

// 2. KAPSAMLI FİLTRE LİSTESİ
const TEMEL_KOKLER = [
  // Arıza / Çalışma Durumu
  'arız', 'ariz', 'bozuk', 'bozul', 'çalışm', 'calism', 'açılmıy', 'acilmiy', 'kapanmıy', 'kapanmiy', 'tutmuy', 'tutmiy', 'devre dışı', 'devre disi', 'kesinti',

  // Donanım, Cihaz ve Tesis Ekipmanları
  'bariyer', 'turnike', 'asansör', 'asansor', 'klima', 'jeneratör', 'jenerator', 'lamba', 'aydınlatm', 'aydinlatm', 'projektör', 'projektor',
  'kamera', 'dvr', 'nvr', 'xray', 'x-ray', 'detektör', 'detektor', 'telsiz', 'plaka tanı', 'plaka tani', 'manyetik',
  'kart okuyuc', 'buton', 'moba',

  // Altyapı, Tesisat ve Sıhhi Sorunlar (Yalın 'elektrik' ve 'taş'/'tas' kaldırıldı)
  'elektrik kesint', 'elektrik yok', 'elektrik gitti', 'elektrik arız', 'elektrik ariz',
  'sigorta', 'kaçak', 'kacak', 'su basm', 'boru patla', 'vana', 'iski',
  'tıkan', 'tikan',
  'taşma', 'tasma', 'taştı', 'tasti', 'taşıyor', 'tasiyor', 'su taş', 'su tas',
  'akıt', 'akit', 'akıntı', 'akinti', 'damlat', 'sızıntı', 'sizinti',

  // Fiziki Güvenlik, Hat ve Hasar
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

    const bildirimMetni = `⚠️ *[GÜVENLİK AKSAKLIK BİLDİRİMİ]*\n📅 *Tarih:* ${tarih}\n⏰ *Saat:* ${saat}\n📍 *Grup:* ${kaynakGrupAdi}\n👤 *Bildiren:* ${gonderen}\n💬 *Açıklama:* ${metin || '(Görsel Bildirim)'}`;

    try {
      if (medyalar.length === 0) {
        await sock.sendMessage(hedefGrupJid, { text: bildirimMetni });
      } else {
        for (let i = 0; i < medyalar.length; i++) {
          const item = medyalar[i];
          const aciklama = (i === 0) ? bildirimMetni : undefined;

          if (item.tip === 'resim') {
            await sock.sendMessage(hedefGrupJid, {
              image: item.buffer,
              caption: aciklama
            });
          } else if (item.tip === 'video') {
            await sock.sendMessage(hedefGrupJid, {
              video: item.buffer,
              caption: aciklama,
              mimetype: item.mimetype || 'video/mp4'
            });
          }
          await delay(800);
        }
      }
      console.log(`✅ Bildirim iletildi: [${kaynakGrupAdi}] ${gonderen} (${medyalar.length} medya)`);
    } catch (sendErr) {
      console.error('Mesaj/medya gönderilirken hata:', sendErr);
    }
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid || '';

      if (!remoteJid.endsWith('@g.us')) continue;
      if (hedefGrupJid && remoteJid === hedefGrupJid) continue;
      if (!dinlenenGruplar.has(remoteJid)) continue;

      let m = msg.message;
      if (m.editedMessage?.message) m = m.editedMessage.message;
      if (m.protocolMessage?.editedMessage) m = m.protocolMessage.editedMessage;

      while (
        m.ephemeralMessage ||
        m.viewOnceMessage ||
        m.viewOnceMessageV2 ||
        m.documentWithCaptionMessage
      ) {
        m = (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage).message;
      }

      const resimVar = Boolean(m.imageMessage);
      const videoVar = Boolean(m.videoMessage);
      const medyaVar = resimVar || videoVar;
      
      const metin = m.conversation || 
                    m.extendedTextMessage?.text || 
                    m.imageMessage?.caption || 
                    m.videoMessage?.caption || 
                    m.documentMessage?.caption ||
                    '';

      if (!metin && !medyaVar) continue;

      const orijinalMetin = metin.toLocaleLowerCase('tr-TR');
      const sadelestirilmisMetin = orijinalMetin
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c');

      // Rutin nöbet defteri, taşeron ve ziyaretçi giriş-çıkış kayıtlarını ele (İçinde açık bir hasar/arıza/kırık yoksa)
      const girisCikisKaydiMi = (
        orijinalMetin.includes('giriş') || orijinalMetin.includes('giris') || 
        orijinalMetin.includes('çıkış') || orijinalMetin.includes('cikis')
      ) && (
        !orijinalMetin.includes('kırık') && 
        !orijinalMetin.includes('kirik') && 
        !orijinalMetin.includes('hasar') && 
        !orijinalMetin.includes('arız') && 
        !orijinalMetin.includes('ariz') && 
        !orijinalMetin.includes('kaza') &&
        !orijinalMetin.includes('çalışm') &&
        !orijinalMetin.includes('calism')
      );

      if (girisCikisKaydiMi) continue;

      const kelimeEslesti = TEMEL_KOKLER.some(kok => 
        orijinalMetin.includes(kok) || sadelestirilmisMetin.includes(kok)
      );

      const gonderenId = msg.key.participant || msg.key.remoteJid;
      const takipAnahtari = `${remoteJid}_${gonderenId}`;
      const kuyruktakiPaket = medyaKuyrugu.get(takipAnahtari);

      if (kelimeEslesti || kuyruktakiPaket) {
        const gonderen = msg.pushName || 'Görevli';
        const kaynakGrupAdi = dinlenenGruplar.get(remoteJid) || 'Bölge Grubu';

        let medyaBuffer = null;
        if (medyaVar) {
          try {
            medyaBuffer = await downloadMediaMessage(
              { key: msg.key, message: m },
              'buffer',
              {},
              { reuploadRequest: sock.updateMediaMessage }
            );
          } catch (e) {
            console.error('Medya indirilemedi:', e);
          }
        }

        if (!kuyruktakiPaket) {
          medyaKuyrugu.set(takipAnahtari, {
            metin: metin,
            gonderen: gonderen,
            kaynakGrupAdi: kaynakGrupAdi,
            medyalar: medyaBuffer ? [{
              tip: resimVar ? 'resim' : 'video',
              buffer: medyaBuffer,
              mimetype: m.videoMessage?.mimetype
            }] : [],
            timer: setTimeout(() => medyaPaketiniGonder(takipAnahtari), 3000)
          });
        } else {
          clearTimeout(kuyruktakiPaket.timer);
          if (metin && !kuyruktakiPaket.metin) {
            kuyruktakiPaket.metin = metin;
          }
          if (medyaBuffer) {
            kuyruktakiPaket.medyalar.push({
              tip: resimVar ? 'resim' : 'video',
              buffer: medyaBuffer,
              mimetype: m.videoMessage?.mimetype
            });
          }
          kuyruktakiPaket.timer = setTimeout(() => medyaPaketiniGonder(takipAnahtari), 3000);
        }
      }
    }
  });
}

baslat();
