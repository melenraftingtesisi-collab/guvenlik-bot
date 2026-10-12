import http from 'http';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay, downloadMediaMessage } from '@whiskeysockets/baileys';

// --- AYARLAR ---
const TELEFON_NUMARANIZ = '905468429287'; 

// Hedef yönetim grubunun tam adı
const HEDEF_GRUP_ADI = "Güvenlik Bildirim Takip";

// 1. Port Dinleyici (Render Web Service zaman aşımını engeller)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Guvenlik Botu Aktif ve Dinlemede!');
}).listen(PORT, () => {
  console.log(`Web portu dinleniyor: ${PORT}`);
});

// 2. KAPSAMLI FİLTRE LİSTESİ (Kök Bazlı ve Ek Duyarsız)
const TEMEL_KOKLER = [
  // Arıza / Çalışma Durumu
  'ariz',          // arıza, arızalı, arızalandı, arızası
  'bozuk',         // bozuk, bozuktur
  'bozul',         // bozuldu, bozulmuş, bozuluyor
  'calism',        // çalışmıyor, çalışmamaktadır, çalışmadı
  'acilmiy',       // açılmıyor, açılmamakta
  'kapanmiy',      // kapanmıyor, kapanmamakta
  'tutmiy',        // tutmuyor (kilit vb.)
  'devre disi',    // devre dışı, devre dışıdır

  // Donanım, Cihaz ve Tesis Ekipmanları
  'bariyer',       // bariyer arızası, bariyer kolu
  'turnike',       // turnike kilitlendi
  'asansor',       // asansör kaldı, arızalı
  'klima',         // klima su akıtıyor, soğutmuyor
  'jenerator',     // jeneratör devreye girmedi
  'lamba',         // lamba yanmıyor, patlak
  'aydinlatm',     // aydınlatma yetersiz, çalışmıyor
  'projektor',     // projektör söndü
  'kamera',        // kamera görüntüsü gitti, siyah ekran
  'dvr', 'nvr',    // kayıt cihazı arızası
  'xray', 'x-ray', // x-ray cihazı
  'detektor',      // el detektörü, kapı detektörü
  'telsiz',        // telsiz çekmiyor, şarj olmuyor
  'plaka tani',    // plaka tanıma sistemi
  'manyetik',      // manyetik kilit
  'kart okuyuc',   // kart okuyucu okumuyor
  'buton',         // yangın / acil çıkış butonu

  // Altyapı ve Tesisat
  'elektrik',      // elektrikler gitti, kesildi
  'sigorta att',   // sigorta attı
  'kacak', 'kacag',// su kaçağı, gaz kaçağı
  'su basm',       // su basması, su bastı
  'boru patla',    // boru patladı
  'vana',          // vana arızası

  // Fiziki Güvenlik ve Hasar
  'kirik',         // cam kırık, kilit kırık
  'kiril',         // kırıldı, kırılmış
  'hasar',         // bariyer hasarlı, kapı hasar gördü
  'carpma', 'carpt',// araç çarptı, bariyere çarptı
  'zorlanm',       // kilit zorlanmış, kapı zorlandı
  'delinm', 'kesilm',// tel çit kesilmiş, delinmiş
  'tel cit',       // tel çit

  // Acil Durum ve Yangın
  'yangin',        // yangın ihbarı, alarmı
  'duman',         // duman çıkıyor
  'alarm cal',     // alarm çalıyor
  'sabotaj'        // sabotaj uyarısı
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

      // 1. ÖZEL MESAJLARI ENGELLE: Mesaj grup sohbeti değilse (@g.us ile bitmiyorsa) dikkate alma
      if (!remoteJid.endsWith('@g.us')) continue;

      // 2. Mesaj hedef yönetim grubunun kendisinden geldiyse döngüye girmemesi için atla
      if (hedefGrupJid && remoteJid === hedefGrupJid) continue;

      // WhatsApp mesaj sarmalayıcılarını (ephemeral, viewOnce vb.) aç
      let m = msg.message;
      if (m.ephemeralMessage) m = m.ephemeralMessage.message;
      if (m.viewOnceMessage) m = m.viewOnceMessage.message;
      if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
      if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;

      const resimVar = Boolean(m.imageMessage);
      
      const metin = m.conversation || 
                    m.extendedTextMessage?.text || 
                    m.imageMessage?.caption || 
                    '';

      if (!metin && !resimVar) continue;

      // Türkçe karakterleri arama için sadeleştir
      const kucuk = metin
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c');

      const eslesti = TEMEL_KOKLER.some(kok => kucuk.includes(kok));

      // Filtre eşleştiğinde hedef yönetim grubuna yönlendir
      if (eslesti && hedefGrupJid) {
        const gonderen = msg.pushName || 'Görevli';
        
        // Türkiye yerel saati (UTC+3)
        const saat = new Date().toLocaleTimeString('tr-TR', { 
          timeZone: 'Europe/Istanbul', 
          hour: '2-digit', 
          minute: '2-digit' 
        });

        const bildirimMetni = `⚠️ *[GÜVENLİK AKSAKLIK BİLDİRİMİ]*\n⏰ *Saat:* ${saat}\n👤 *Bildiren:* ${gonderen}\n💬 *Açıklama:* ${metin || '(Resimli Bildirim)'}`;

        try {
          if (resimVar) {
            console.log('[MEDYA] Resim indiriliyor...');
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
          console.error('Mesaj veya resim iletilirken hata:', sendErr);
        }
      }
    }
  });
}

baslat();
