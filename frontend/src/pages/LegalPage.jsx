import { Link } from 'react-router-dom'
import SeoHead from '../components/SeoHead'
import { DISCORD_ENABLED, GOOGLE_ENABLED } from '../features'

/**
 * LegalPage — Gizlilik Politikası / Kullanım Koşulları / KVKK Aydınlatma Metni.
 *
 * Tek bileşen, üç doküman (`doc` prop'u ile). İçerik platformun GERÇEKTEN
 * topladığı verilere göre yazılmıştır: profiles, follows, news_likes,
 * news_comments, news_comment_votes, news_feedback, match_mvp_votes,
 * scout_waitlist, avatars + cihazda localStorage tercihleri (tema, favoriler,
 * takip edilen oyuncular, panel tercihleri, oy kayıtları).
 *
 * ⚠️ Yayına almadan önce: CONTACT_EMAIL Cloudflare Email Routing'de tanımlı
 * olmalı. Şahıs şirketi kurulduğunda OPERATOR unvanla güncellenmeli.
 */

const OPERATOR = 'feXt Platform Yönetimi (fextesports.com)'

/**
 * Sosyal giriş sağlayıcıları metni features.js bayraklarından TÜRETİLİR.
 * Discord açılıp kapandığında yasal metin otomatik doğru kalır — "kodda kapalı
 * ama politikada yazıyor" tutarsızlığı oluşamaz.
 */
const OAUTH_NAMES = [GOOGLE_ENABLED && 'Google', DISCORD_ENABLED && 'Discord'].filter(Boolean)
const OAUTH_LABEL = OAUTH_NAMES.join(' veya ')
const CONTACT_EMAIL = 'iletisim@fextesports.com'
const UPDATED = '20 Ağustos 2026'

const DOCS = {
  privacy: {
    path: '/gizlilik',
    title: 'Gizlilik Politikası',
    desc: 'feXt hangi verileri topluyor, neden topluyor, kimlerle paylaşıyor ve nasıl siliyor.',
  },
  terms: {
    path: '/kullanim-kosullari',
    title: 'Kullanım Koşulları',
    desc: 'feXt platformunu kullanmanın kuralları, içerik kuralları ve sorumluluk sınırları.',
  },
  kvkk: {
    path: '/kvkk',
    title: 'KVKK Aydınlatma Metni',
    desc: '6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında aydınlatma metni.',
  },
}

/* ── Tipografi yardımcıları ─────────────────────────────────────────────── */
const H2 = ({ children }) => (
  <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-1)', margin: '32px 0 10px', lineHeight: 1.35 }}>{children}</h2>
)
const P = ({ children }) => (
  <p style={{ fontSize: 14.5, lineHeight: 1.75, color: 'var(--text-3)', margin: '0 0 12px' }}>{children}</p>
)
const UL = ({ children }) => (
  <ul style={{ margin: '0 0 12px', paddingLeft: 20, display: 'grid', gap: 7 }}>{children}</ul>
)
const LI = ({ children }) => (
  <li style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--text-3)' }}>{children}</li>
)
const B = ({ children }) => <strong style={{ color: 'var(--text-2)', fontWeight: 700 }}>{children}</strong>
const Mail = () => <a href={'mailto:' + CONTACT_EMAIL} style={{ color: '#c98bd6' }}>{CONTACT_EMAIL}</a>
const Ext = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#c98bd6' }}>{children}</a>
)

/* ── Gizlilik Politikası ────────────────────────────────────────────────── */
function PrivacyBody() {
  return (
    <>
      <P>
        Bu politika, <B>{OPERATOR}</B> tarafından işletilen feXt platformunda hangi kişisel
        verilerin toplandığını, hangi amaçla işlendiğini ve haklarını açıklar. feXt'i kullanarak
        bu politikayı kabul etmiş olursun.
      </P>

      <H2>1. Hangi verileri topluyoruz?</H2>
      <P><B>Hesap oluşturduğunda:</B></P>
      <UL>
        <LI>E-posta adresin ve şifren — şifren bize <B>hiçbir zaman düz metin olarak ulaşmaz</B>, kimlik doğrulama sağlayıcımız tarafından şifrelenmiş biçimde saklanır</LI>
        <LI>Kullanıcı adın, varsa ad-soyadın ve profil görselin</LI>
        <LI>Favori takımın</LI>
        {OAUTH_NAMES.length > 0 && (
          <LI>"{OAUTH_LABEL} ile giriş" kullanırsan: ilgili platformun paylaştığı kullanıcı adı, e-posta ve profil görseli</LI>
        )}
      </UL>
      <P><B>Platformu kullandığında:</B></P>
      <UL>
        <LI>Takip ettiğin takımlar, oyuncular ve oyunlar</LI>
        <LI>Beğendiğin haberler, yazdığın yorumlar ve yorum oyların</LI>
        <LI>Maç MVP oyların ve haberlere verdiğin geri bildirimler</LI>
        <LI>Scout bekleme listesine kaydolursan: e-posta, kurum adı ve rolün</LI>
      </UL>
      <P><B>Teknik olarak:</B></P>
      <UL>
        <LI>IP adresin ve tarayıcı bilgin — güvenlik, bot koruması ve sunucu kayıtları amacıyla hizmet sağlayıcılarımız tarafından işlenir</LI>
        <LI>Anonim ziyaret istatistikleri (hangi sayfa kaç kez görüntülendi) — <B>kişi bazında değil ve çerez kullanılmadan</B> toplanır</LI>
      </UL>

      <H2>2. Tarayıcında sakladıklarımız</H2>
      <P>
        feXt <B>reklam veya takip çerezi kullanmaz</B>. Tarayıcının yerel deposunda yalnızca
        deneyimini iyileştiren tercihler tutulur:
      </P>
      <UL>
        <LI>Açık/koyu tema tercihin</LI>
        <LI>Favorilerin, takip ettiğin oyuncular ve ana sayfa tercihlerin</LI>
        <LI>Verdiğin oyların tekrarlanmaması için yerel kayıtlar</LI>
        <LI>Giriş yaptıysan oturum bilgin — çıkış yaptığında silinir</LI>
      </UL>
      <P>
        Bunları tarayıcı ayarlarından dilediğin zaman temizleyebilirsin; site çalışmaya devam
        eder, yalnızca tercihlerin sıfırlanır.
      </P>

      <H2>3. Verileri neden işliyoruz?</H2>
      <UL>
        <LI>Hesabını oluşturmak, girişini sağlamak ve güvenliğini korumak</LI>
        <LI>Takip ettiğin takımlara göre kişiselleştirilmiş maç ve haber akışı sunmak</LI>
        <LI>Doğrulama ve şifre sıfırlama e-postalarını göndermek</LI>
        <LI>Sahte hesap, spam ve kötüye kullanımı engellemek</LI>
        <LI>Platformun hangi bölümlerinin kullanıldığını anlayıp geliştirmek</LI>
      </UL>
      <P><B>Kişisel verilerini satmıyoruz</B> ve reklam amacıyla üçüncü taraflara pazarlamıyoruz.</P>

      <H2>4. Kimlerle paylaşılıyor?</H2>
      <P>Verilerin yalnızca hizmeti çalıştırmak için gerekli sağlayıcılarla paylaşılır:</P>
      <UL>
        <LI><B>Supabase</B> — kimlik doğrulama ve veritabanı</LI>
        <LI><B>Vercel</B> — site barındırma ve anonim ziyaret istatistikleri</LI>
        <LI><B>Cloudflare</B> — alan adı yönetimi ve bot koruması</LI>
        <LI><B>Resend / Amazon SES</B> — doğrulama ve şifre sıfırlama e-postaları</LI>
        {GOOGLE_ENABLED && <LI><B>Google</B> — yalnızca "Google ile giriş"i tercih edersen</LI>}
        {DISCORD_ENABLED && <LI><B>Discord Inc.</B> — yalnızca "Discord ile giriş"i tercih edersen</LI>}
      </UL>
      <P>
        Bu sağlayıcıların sunucuları <B>yurt dışında</B> (Avrupa Birliği ve Amerika Birleşik
        Devletleri) bulunur; hesap oluşturarak verilerinin bu sunucularda işlenmesine onay vermiş
        olursun. Ayrıca yasal zorunluluk hâlinde yetkili makamlarla paylaşım yapılabilir.
      </P>

      <H2>5. Ne kadar süre saklıyoruz?</H2>
      <P>
        Hesap verilerin, hesabın açık kaldığı sürece saklanır. Hesabını sildirdiğinde kişisel
        verilerin makul bir süre içinde silinir. Yorumların, kimliğinden arındırılmış biçimde
        tartışma bütünlüğü için kalabilir. Yasal saklama yükümlülüğü bulunan kayıtlar ilgili süre
        boyunca tutulur.
      </P>

      <H2>6. Haklarını nasıl kullanırsın?</H2>
      <P>
        Verilerine erişmek, düzeltmek, silmek veya hesabını kapatmak için <Mail /> adresine
        yazman yeterlidir. Yasal haklarının ayrıntılı listesi için{' '}
        <Link to="/kvkk" style={{ color: '#c98bd6' }}>KVKK Aydınlatma Metni</Link> sayfamıza bakabilirsin.
      </P>

      <H2>7. Yaş sınırı</H2>
      <P>
        feXt 13 yaşından küçükler için tasarlanmamıştır. 18 yaşından küçüksen platformu ebeveyn
        veya vasinin bilgisi dâhilinde kullanmalısın.
      </P>

      <H2>8. Güvenlik</H2>
      <P>
        Şifreler şifrelenmiş olarak saklanır, tüm trafik HTTPS ile şifrelenir ve veritabanı
        satır-seviyesi güvenlik kurallarıyla korunur. Buna rağmen internet üzerinden hiçbir
        aktarımın %100 güvenli olmadığını hatırlatırız.
      </P>

      <H2>9. Değişiklikler</H2>
      <P>
        Bu politika güncellenebilir. Bir değişiklik olduğunda sayfanın üstündeki güncelleme tarihi
        değişir; kapsamlı değişikliklerde kayıtlı kullanıcılar e-posta ile bilgilendirilir.
      </P>
    </>
  )
}

/* ── Kullanım Koşulları ─────────────────────────────────────────────────── */
function TermsBody() {
  return (
    <>
      <P>
        feXt'i kullanarak bu koşulları kabul etmiş olursun. Kabul etmiyorsan lütfen platformu
        kullanma.
      </P>

      <H2>1. Hizmetin tanımı</H2>
      <P>
        feXt; Valorant, CS2 ve League of Legends espor maçlarına ait program, canlı skor,
        istatistik, turnuva bilgisi ve yapay zekâ destekli haber/analiz içeriği sunan bir bilgi
        platformudur. Hizmet <B>"olduğu gibi"</B> sunulur.
      </P>

      <H2>2. Tahminler bahis tavsiyesi değildir</H2>
      <P>
        Platformdaki <B>Fextopus</B> tahminleri, geçmiş maç verilerinden hesaplanan istatistiksel
        olasılıklardır ve yalnızca <B>bilgilendirme ve eğlence</B> amaçlıdır.
      </P>
      <UL>
        <LI>Hiçbir tahmin garanti değildir ve yanılabilir.</LI>
        <LI>Bu içerikler <B>bahis, yatırım veya finansal tavsiye niteliği taşımaz</B>.</LI>
        <LI>Bu bilgilere dayanarak aldığın kararların sonuçlarından yalnızca sen sorumlusun.</LI>
      </UL>

      <H2>3. Hesabın</H2>
      <UL>
        <LI>Kayıt olurken doğru bilgi vermelisin.</LI>
        <LI>Şifrenin gizliliğinden ve hesabında gerçekleşen işlemlerden sen sorumlusun.</LI>
        <LI>Başkasının kimliğine bürünen veya yanıltıcı kullanıcı adları kullanılamaz.</LI>
        <LI>Hesabını dilediğin zaman kapatabilirsin.</LI>
      </UL>

      <H2>4. İçerik ve davranış kuralları</H2>
      <P>Yorum ve katkılarında aşağıdakiler yasaktır:</P>
      <UL>
        <LI>Hakaret, taciz, nefret söylemi, ayrımcılık ve tehdit</LI>
        <LI>Spam, reklam, dolandırıcılık ve zararlı bağlantılar</LI>
        <LI>Bahis sitesi tanıtımı ve yönlendirmesi</LI>
        <LI>Telif hakkı ihlali oluşturan paylaşımlar</LI>
        <LI>Platformun teknik işleyişini bozmaya yönelik girişimler</LI>
        <LI>Otomatik araçlarla (bot, scraper, örümcek) toplu veri çekme</LI>
      </UL>
      <P>
        Bu kurallara aykırı içerikleri bildirim yapmaksızın kaldırma ve hesabı askıya alma hakkımız
        saklıdır. Paylaştığın içeriğin sorumluluğu sana aittir; paylaşarak bu içeriğin platformda
        yayımlanmasına izin vermiş olursun.
      </P>

      <H2>5. Veri kaynakları ve fikri mülkiyet</H2>
      <P>
        Maç, takım ve oyuncu verileri <Ext href="https://pandascore.co">PandaScore</Ext> ve{' '}
        <Ext href="https://liquipedia.net">Liquipedia</Ext> kaynaklarından alınır ve ilgili kullanım
        şartlarına tabidir. Platformda sunulan bazı turnuva, kadro ve maç verileri Liquipedia
        kaynaklı olup <B>Creative Commons Atıf-AynıLisanslaPaylaş 3.0 (CC BY-SA 3.0)</B> lisansına
        tabidir. Takım logoları, oyun isimleri ve turnuva markaları <B>ilgili hak sahiplerine
        aittir</B>; feXt bunlar üzerinde hak iddia etmez ve bu kuruluşlarla resmî bir bağlantısı
        yoktur.
      </P>
      <P>
        feXt adı, logosu, tasarımı, derlediği veri tabanı ve ürettiği özgün analiz içerikleri
        feXt'e aittir; izinsiz kopyalanamaz veya ticari olarak kullanılamaz.
      </P>
      <P>
        Platform içeriğinin, veri tabanının ve analiz algoritmalarının <B>otomatik araçlarla
        (bot, scraper, örümcek vb.) taranması, kopyalanması, tersine mühendislik yapılması veya
        arayüzlerinin izinsiz sorgulanması kesinlikle yasaktır</B>. Bu tür kullanımlar tespit
        edildiğinde erişim engellenir ve hukuki yollara başvurulabilir.
      </P>

      <H2>6. Sorumluluğun sınırı</H2>
      <P>
        Verilerin doğru ve güncel olması için çaba gösteririz; ancak üçüncü taraf kaynaklardan
        gelen bilgilerde hata, eksiklik veya gecikme olabilir. feXt; hizmetin kesintisiz veya
        hatasız olacağını garanti etmez ve platformdaki bilgilere dayanarak alınan kararlardan
        doğan doğrudan veya dolaylı zararlardan sorumlu tutulamaz.
      </P>

      <H2>7. Değişiklik ve sona erdirme</H2>
      <P>
        Hizmeti, özellikleri veya bu koşulları değiştirme; kural ihlâli hâlinde erişimi
        sonlandırma hakkımız saklıdır. Güncel koşullar her zaman bu sayfada yayımlanır.
      </P>

      <H2>8. Uygulanacak hukuk</H2>
      <P>
        Bu koşullar Türkiye Cumhuriyeti hukukuna tabidir. Uyuşmazlıklarda Türkiye Cumhuriyeti
        mahkemeleri ve icra daireleri yetkilidir. Sorularını <Mail /> adresine iletebilirsin.
      </P>
    </>
  )
}

/* ── KVKK Aydınlatma Metni ──────────────────────────────────────────────── */
function KvkkBody() {
  return (
    <>
      <P>
        6698 sayılı <B>Kişisel Verilerin Korunması Kanunu</B> ("KVKK") m.10 uyarınca, veri
        sorumlusu sıfatıyla <B>{OPERATOR}</B> tarafından hazırlanmıştır.
      </P>

      <H2>1. Veri sorumlusu</H2>
      <P>
        Veri sorumlusu: <B>{OPERATOR}</B><br />
        İletişim: <Mail />
      </P>

      <H2>2. İşlenen kişisel veriler</H2>
      <UL>
        <LI><B>Kimlik verisi:</B> kullanıcı adı, varsa ad-soyad</LI>
        <LI><B>İletişim verisi:</B> e-posta adresi</LI>
        <LI><B>İşlem güvenliği verisi:</B> şifrelenmiş parola, IP adresi, tarayıcı bilgisi, oturum kayıtları</LI>
        <LI><B>Kullanım verisi:</B> takip edilen takım/oyuncular, beğeniler, yorumlar, oylar, geri bildirimler</LI>
        <LI><B>Görsel veri:</B> yüklediğin veya Google hesabından gelen profil görseli</LI>
        <LI><B>Talep verisi:</B> Scout bekleme listesine kaydolduysan kurum adı ve rol bilgisi</LI>
      </UL>

      <H2>3. İşleme amaçları</H2>
      <UL>
        <LI>Üyelik kaydının oluşturulması ve yönetilmesi</LI>
        <LI>Kimlik doğrulama, oturum yönetimi ve hesap güvenliğinin sağlanması</LI>
        <LI>Takip ettiğin takımlara göre içeriğin kişiselleştirilmesi</LI>
        <LI>İşlem e-postalarının (doğrulama, şifre sıfırlama) iletilmesi</LI>
        <LI>Sahte hesap, spam ve kötüye kullanımın önlenmesi</LI>
        <LI>Hizmetin iyileştirilmesi ve anonim istatistiksel analiz</LI>
        <LI>Hukuki yükümlülüklerin yerine getirilmesi</LI>
      </UL>

      <H2>4. Hukuki sebepler (KVKK m.5)</H2>
      <UL>
        <LI><B>Sözleşmenin kurulması ve ifası</B> — üyelik hizmetinin sağlanabilmesi için zorunlu veriler</LI>
        <LI><B>Meşru menfaat</B> — güvenlik, kötüye kullanımın önlenmesi ve hizmet iyileştirme</LI>
        <LI><B>Hukuki yükümlülük</B> — mevzuatın gerektirdiği kayıtların tutulması</LI>
        <LI><B>Açık rıza</B> — isteğe bağlı bildirimler ve yurt dışına aktarım</LI>
      </UL>

      <H2>5. Toplama yöntemi</H2>
      <P>
        Kişisel verilerin; kayıt formu, profil ayarları, "Google ile giriş" akışı, platform içi
        etkileşimler (takip, beğeni, yorum, oy) ve teknik sunucu kayıtları aracılığıyla{' '}
        <B>elektronik ortamda otomatik yollarla</B> toplanır.
      </P>

      <H2>6. Aktarım ve yurt dışına aktarım</H2>
      <P>
        Verilerin; barındırma, kimlik doğrulama, e-posta iletimi ve bot koruması hizmeti aldığımız
        tedarikçilere (Supabase, Vercel, Cloudflare, Resend/Amazon SES{OAUTH_NAMES.length > 0 ? ', ' + OAUTH_LABEL.replace(' veya ', ', ') : ''}) hizmetin
        gerektirdiği ölçüde aktarılır. Bu tedarikçilerin sunucuları <B>yurt dışında</B>
        bulunduğundan, aktarım KVKK m.9 kapsamında açık rızana dayanılarak gerçekleştirilir.
        Ayrıca yasal talep hâlinde yetkili kamu kurum ve kuruluşlarıyla paylaşım yapılabilir.
      </P>

      <H2>7. Saklama süresi</H2>
      <P>
        Kişisel verilerin, üyeliğin devam ettiği sürece; üyelik sona erdiğinde ise mevzuatın
        öngördüğü zamanaşımı süreleri boyunca saklanır ve sürenin sonunda silinir, yok edilir veya
        anonim hâle getirilir.
      </P>

      <H2>8. KVKK m.11 kapsamındaki haklarınız</H2>
      <P>Veri sahibi olarak:</P>
      <UL>
        <LI>Kişisel verinin işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme</LI>
        <LI>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme</LI>
        <LI>Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme</LI>
        <LI>Eksik veya yanlış işlenmişse düzeltilmesini isteme</LI>
        <LI>Şartları oluştuğunda silinmesini veya yok edilmesini isteme</LI>
        <LI>Düzeltme, silme ve yok edilme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme</LI>
        <LI>Münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhine bir sonuç doğmasına itiraz etme</LI>
        <LI>Kanuna aykırı işlenmesi sebebiyle zarara uğraman hâlinde zararın giderilmesini talep etme</LI>
      </UL>
      <P>
        haklarına sahipsin. Bu hakları kullanmak için <Mail /> adresine kimliğini tespit edici
        bilgilerle başvurabilirsin. Talebin en geç <B>30 gün</B> içinde sonuçlandırılır.
      </P>
    </>
  )
}

const BODIES = { privacy: PrivacyBody, terms: TermsBody, kvkk: KvkkBody }

/* ── Sayfa ──────────────────────────────────────────────────────────────── */
export default function LegalPage({ doc = 'privacy' }) {
  const meta = DOCS[doc] || DOCS.privacy
  const Body = BODIES[doc] || PrivacyBody

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <SeoHead title={meta.title} description={meta.desc} type="website" />

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '36px 16px 64px' }}>
        <h1 style={{ fontSize: 27, fontWeight: 800, color: 'var(--text-1)', margin: '0 0 8px', lineHeight: 1.25 }}>
          {meta.title}
        </h1>
        <p style={{ fontSize: 12.5, color: 'var(--text-5)', margin: '0 0 22px' }}>
          Son güncelleme: {UPDATED}
        </p>

        {/* Belgeler arası gezinme */}
        <nav aria-label="Yasal belgeler" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
          {Object.entries(DOCS).map(([key, d]) => {
            const active = key === doc
            return (
              <Link
                key={key}
                to={d.path}
                style={{
                  fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
                  padding: '7px 13px', borderRadius: 9,
                  border: '1px solid ' + (active ? 'rgba(223,72,136,.45)' : 'var(--line)'),
                  background: active ? 'rgba(223,72,136,.10)' : 'var(--surface)',
                  color: active ? '#DF4888' : 'var(--text-3)',
                }}
              >
                {d.title}
              </Link>
            )
          })}
        </nav>

        <article style={{
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 16, padding: '8px 24px 28px',
        }}>
          <Body />
        </article>

        <p style={{ fontSize: 12.5, color: 'var(--text-5)', margin: '20px 0 0', lineHeight: 1.7 }}>
          Sorularını <Mail /> adresine iletebilirsin.
        </p>
      </div>
    </div>
  )
}
