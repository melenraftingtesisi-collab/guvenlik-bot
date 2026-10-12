import http from 'http';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';

// --- AYARLAR ---
// Botu bağlayacağınız telefon numarası (Başında 90 ile, boşluksuz: örn: '905321234567')
const TELEFON_NUMARANIZ = '905468429287'; 

// Filtrelenecek kelimeler
const KELIMELER = ['arıza', 'bozuldu', 'çalışmıyor', 'bariyer', 'asansör', 'klima', 'elektrik', 'su kaçağı', 'jeneratör', 'lamba'];
// Hedef yönetim grubunuzun adı
const HEDEF_GRUP_ADI = "Güvenlik Bildirim Takip";

// 1. RENDER PORT DİNLİYİCİSİ (Zaman aşımını önleyen kısım)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot aktif ve calisiyor!');
}).listen(PORT, () => {
  console.log(`Port dinleniyor: ${PORT}`);
});

// 2. WHATSAPP BOTU
async function baslat() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session');
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  // Eğer oturum yoksa ve telefon numarası girilmişse pairing code iste
  if (!sock.authState.creds.registered && TELEFON_NUMARANIZ !== '905468429287') {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(TELEFON_NUMARANIZ);
        console.log('\n====================================');
        console.log(`🔑 EŞLEŞTİRME KODUNUZ: ${code}`);
        console.log('====================================\n');
      } catch (err) {
        console.error('Kod alınamadı:', err);
      }
    }, 4000);
  }

  sock.ev.on('creds.update', saveCreds);

  let hedefGrupJid = null;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === 'open') {
      console.log('✅ WhatsApp Bağlandı!');
      const groups = await sock.groupFetchAllParticipating();
      for (const jid in groups) {
        if (groups[jid].subject.trim() === HEDEF_GRUP_ADI.trim()) {
          hedefGrupJid = jid;
          console.log(`✅ Hedef Grup Bulundu: ${groups[jid].subject}`);
        }
      }
    }
    
    if (connection === 'close') {
      const yenidenBaglan = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (yenidenBaglan) baslat();
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

      if (eslesti && hedefGrupJid && msg.key.remoteJid !== hedefGrupJid) {
        const gonderen = msg.pushName || 'Görevli';
        const saat = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        const iletilecek = `⚠️ *[GÜVENLİK AKSAKLIK BİLDİRİMİ]*\n⏰ *Saat:* ${saat}\n👤 *Bildiren:* ${gonderen}\n💬 *Mesaj:* ${metin}`;
        await sock.sendMessage(hedefGrupJid, { text: iletilecek });
        console.log(`[Yönlendirildi] ${metin}`);
      }
    }
  });
}

baslat();
