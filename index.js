import http from 'http';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay, downloadMediaMessage } from '@whiskeysockets/baileys';

// --- AYARLAR ---
const TELEFON_NUMARANIZ = '905468429287'; 

// Hedef yönetim grubunun tam adı
const HEDEF_GRUP_ADI = "Güvenlik Bildirim Takip";

// SADECE DİNLENECEK KAYNAK GRUPLAR (Tam grup adları)
const KAYNAK_GRUPLAR = [
  "AYEDAŞ BÖLGE GÜVENLİK",
  "AYEDAŞ GM GÜVENLİK"
];

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
  'ariz', 'bozuk', 'bozul', 'calism', 'acilmiy', 'kapanmiy', 'tutmiy', 'devre disi', 'kesinti',
  'bariyer', 'turnike', 'asansor', 'klima', 'jenerator', 'lamba', 'aydinlatm', 'projektor',
  'kamera', 'dvr', 'nvr', 'xray', 'x-ray', 'detektor', 'telsiz', 'plaka tani', 'manyetik',
  'kart okuyuc', 'buton', 'moba',
  'elektrik', 'sigorta', 'kacak', 'kacag', 'su basm', 'boru patla', 'vana', 'iski',
  'kirik', 'kiril', 'hasar', 'carpma', 'carpt', 'zorlanm', 'delinm', 'kesilm', 'tel cit',
  'yangin', 'duman', 'alarm cal', 'sabotaj'
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
  const dinlenenGruplar = new Map();

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

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid || '';

      // 🛑 KURAL 1: KESİNLİKLE ÖZEL MESAJLARI (DM) ENGELLE
      // Mesaj bir grup mesajı değilse (@g.us ile bitmiyorsa) ANINDA ATLA
      if (!remoteJid.endsWith('@g.us')) {
        continue;
      }

      // 🛑 KURAL 2: HEDEF GRUBUN KENDİSİNİ ENGELLE
      if (hedefGrupJid && remoteJid === hedefGrupJid) {
        continue;
      }

      // 🛑 KURAL 3: SADECE BELİRLENEN KAYNAK GRUPLAR İŞLENSİN
      // Eğer gelen grup dinlenen listede yoksa ATLA
      if (!dinlenenGruplar.has(remoteJid)) {
        continue;
      }

      // Mesaj kabuklarını aç (düzenlenmiş, iletilmiş, süreli vb.)
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
      
      const metin = m.conversation || 
                    m.extendedTextMessage?.text || 
                    m.imageMessage?.caption || 
                    m.videoMessage?.caption || 
                    m.documentMessage?.caption ||
                    '';

      if (!metin && !resimVar) continue;

      // Türkçe karakter sadeleştirme
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
        const kaynakGrupAdi = dinlenenGruplar.get(remoteJid) || 'Bölge Grubu';
        
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

        const bildirimMetni = `⚠️ *[GÜVENLİK AKSAKLIK BİLDİRİMİ]*\n📅 *Tarih:* ${tarih}\n⏰ *Saat:* ${saat}\n📍 *Grup:* ${kaynakGrupAdi}\n👤 *Bildiren:* ${gonderen}\n💬 *Açıklama:* ${metin || '(Resimli Bildirim)'}`;

        try {
          if (resimVar) {
            console.log(`[MEDYA] Resimli bildirim iletiliyor -> ${kaynakGrupAdi}`);
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
          } else {
            await sock.sendMessage(hedefGrupJid, { text: bildirimMetni });
          }
          console.log(`✅ Bildirim iletildi: [${kaynakGrupAdi}] ${gonderen}`);
        } catch (sendErr) {
          console.error('Mesaj veya resim iletilirken hata:', sendErr);
        }
      }
    }
  });
}

baslat();
