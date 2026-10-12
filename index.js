import http from 'http';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay } from '@whiskeysockets/baileys';

// --- AYARLAR ---
const TELEFON_NUMARANIZ = '905468429287'; 

// Filtrelenecek kritik kelimeler
const KELIMELER = ['arıza', 'bozuldu', 'çalışmıyor', 'bariyer', 'asansör', 'klima', 'elektrik', 'su kaçağı', 'jeneratör', 'lamba'];

// Hedef yönetim grubunun tam adı
const HEDEF_GRUP_ADI = "Güvenlik Bildirim Takip";

// 1. Port Dinleyici (Render Web Service kapanmasın diye)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Guvenlik Botu Aktif ve Dinlemede!');
}).listen(PORT, () => {
  console.log(`Web portu dinleniyor: ${PORT}`);
});

// 2. WhatsApp Bot Başlatıcı
async function baslat() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    defaultQueryTimeoutMs: 60000, // Zaman aşımı süresini 60 saniyeye çıkardık (408 hatasını engeller)
    syncFullHistory: false,       // Geçmiş sohbetleri indirmeye çalışıp sunucuyu tıkamaz
    markOnlineOnConnect: false
  });

  sock.ev.on('creds.update', saveCreds);

  // Oturum yoksa eşleştirme kodu talep et
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
      
      // Grupları çekmeden önce 3 saniye bekle
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
          console.log(`⚠️ Dikkat: "${HEDEF_GRUP_ADI}" adında bir grup bulunamadı. Lütfen grup adını kontrol edin.`);
        }
      } catch (e) {
        console.error('Grup listesi çekilirken hata:', e?.message || e);
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const yenidenBaglan = statusCode !== DisconnectReason.loggedOut;
      console.log(`Bağlantı koptu (Kod: ${statusCode}). Yeniden bağlanılıyor...`);
      if (yenidenBaglan) {
        setTimeout(() => baslat(), 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const metin = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      if (!metin) continue;

      const kucuk = metin.toLowerCase();
      const eslesti = KELIMELER.some(k => kucuk.includes(k));

      // Kritik kelime varsa ve mesaj hedef grubun kendisinden gelmediyse ilet
      if (eslesti && hedefGrupJid && msg.key.remoteJid !== hedefGrupJid) {
        const gonderen = msg.pushName || 'Görevli';
        const saat = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

        const bildirim = `⚠️ *[GÜVENLİK AKSAKLIK BİLDİRİMİ]*\n⏰ *Saat:* ${saat}\n👤 *Bildiren:* ${gonderen}\n💬 *Mesaj:* ${metin}`;
        
        try {
          await sock.sendMessage(hedefGrupJid, { text: bildirim });
          console.log(`[İletildi -> ${HEDEF_GRUP_ADI}] ${metin}`);
        } catch (sendErr) {
          console.error('Mesaj iletilirken hata:', sendErr);
        }
      }
    }
  });
}

baslat();
