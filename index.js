import http from 'http';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay, downloadMediaMessage } from '@whiskeysockets/baileys';

// --- AYARLAR ---
const TELEFON_NUMARANIZ = '905468429287'; 

// Hedef yönetim grubunun tam adı
const HEDEF_GRUP_ADI = "Güvenlik Bildirim Takip";

// 1. Port Dinleyici
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
  'ariz', 'bozuk', 'bozul', 'calism', 'acilmiy', 'kapanmiy', 'tutmiy', 'devre disi', 'kesinti',

  // Donanım, Cihaz ve Tesis Ekipmanları
  'bariyer', 'turnike', 'asansor', 'klima', 'jenerator', 'lamba', 'aydinlatm', 'projektor',
  'kamera', 'dvr', 'nvr', 'xray', 'x-ray', 'detektor', 'telsiz', 'plaka tani', 'manyetik',
  'kart okuyuc', 'buton', 'moba',

  // Altyapı ve Tesisat
  'elektrik', 'sigorta', 'kacak', 'kacag', 'su basm', 'boru patla', 'vana', 'iski',

  // Fiziki Güvenlik ve Hasar
  'kirik', 'kiril', 'hasar', 'carpma', 'carpt', 'zorlanm', 'delinm', 'kesilm', 'tel cit',

  // Acil Durum ve Yangın
  'yangin', 'duman', 'alarm cal', 'sabotaj'
];

// 3. WhatsApp Bot Başlatıcı
async function baslat() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    defaultQueryTimeoutMs: undefined,
    connectTimeoutMs: 60000,
    syncFullHistory: false,
    markOnlineOnConnect: false
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

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('✅ WhatsApp Bağlantısı Başarılı!');
      await delay(3000);
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const jid in groups) {
          if (groups[jid].subject.trim() === HEDEF_GRUP_ADI.trim()) {
            hedefGrupJid = jid;
            console.log(`✅ Hedef Grup Eşleşti: ${groups[jid].subject}`);
          }
        }
        if (!hedefGrupJid) {
          console.log(`⚠️ Dikkat: "${HEDEF_GRUP_ADI}" adında bir grup bulunamadı.`);
        }
      } catch (e) {
        console.error('Grup listesi çekilirken hata:', e?.message || e);
      }
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

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid || '';

      // Sadece gruplardan gelenler işlensin
      if (!remoteJid.endsWith('@g.us')) continue;
      if (hedefGrupJid && remoteJid === hedefGrupJid) continue;

      // 1. Düzenlenmiş (Editlenmiş) veya Sarmalanmış mesajları aç
      let m = msg.message;

      // Düzenlenmiş mesaj kontrolü
      if (m.editedMessage?.message) {
        m = m.editedMessage.message;
      }
      if (m.protocolMessage?.editedMessage) {
        m = m.protocolMessage.editedMessage;
      }

      // Sarmalayıcıları (viewOnce, ephemeral vb.) soy
      while (
        m.ephemeralMessage ||
        m.viewOnceMessage ||
        m.viewOnceMessageV2 ||
        m.documentWithCaptionMessage
      ) {
        m = (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage).message;
      }

      const resimVar = Boolean(m.imageMessage);
      
      // Metni tüm olası alanlardan topla
      const metin = m.conversation || 
                    m.extendedTextMessage?.text || 
                    m.imageMessage?.caption || 
                    m.videoMessage?.caption || 
                    m.documentMessage?.caption ||
                    '';

      if (!metin && !resimVar) continue;

      // Türkçe harf sadeleştirme
      const kucuk = metin
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c');

      const eslesti = TEMEL_KOKLER.some(kok => kucuk.includes(kok));

      if (eslesti && hedefGrupJid) {
        const gonderen = msg.pushName || 'Görevli';
        
        // Türkiye yerel saati
        const saat = new Date().toLocaleTimeString('tr-TR', { 
          timeZone: 'Europe/Istanbul', 
          hour: '2-digit', 
          minute: '2-digit' 
        });

        const bildirimMetni = `⚠️ *[GÜVENLİK AKSAKLIK BİLDİRİMİ]*\n⏰ *Saat:* ${saat}\n👤 *Bildiren:* ${gonderen}\n💬 *Açıklama:* ${metin || '(Resimli Bildirim)'}`;

        try {
          if (resimVar) {
            console.log('[MEDYA] Resimli/Düzenlenmiş bildirim indiriliyor...');
            const buffer = await downloadMediaMessage(
              { key: msg.key, message: m },
              'buffer',
              {},
              { reuploadRequest: sock.updateMediaMessage }
            );

            await sock.sendMessage(hedefGrupJid, {
              image: buffer,
              caption: bildirimMetni
            });
            console.log(`[Resimli Bildirim İletildi -> ${HEDEF_GRUP_ADI}]`);
          } else {
            await sock.sendMessage(hedefGrupJid, { text: bildirimMetni });
            console.log(`[Metin İletildi -> ${HEDEF_GRUP_ADI}] ${metin}`);
          }
        } catch (sendErr) {
          console.error('Mesaj veya resim iletilirken hata oluştu:', sendErr);
        }
      }
    }
  });
}

baslat();
