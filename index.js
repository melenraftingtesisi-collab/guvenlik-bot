import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

// Filtrelenecek kelimeler
const KELIMELER = ['arıza', 'bozuldu', 'çalışmıyor', 'bariyer', 'asansör', 'klima', 'elektrik', 'su kaçağı', 'jeneratör', 'lamba'];
// Hedef yönetim grubunuzun adı
const HEDEF_GRUP_ADI = "Güvenlik Bildirim Takip";

async function baslat() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session');
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  let hedefGrupJid = null;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\n--- AŞAĞIDAKİ QR KODU WHATSAPP ILE OKUTUN ---\n');
      qrcode.generate(qr, { small: true });
    }
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

      // Eşleştiyse ve mesaj hedef grubun kendisinden gelmediyse ilet
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
