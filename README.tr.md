# PathBlender

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文（香港）](README.zh-Hant.md) | [Español](README.es.md) | [Français](README.fr.md) | **Türkçe** | [Português (Brasil)](README.pt-BR.md) | [עברית](README.he.md)

**İttifakınızın otonom yollarını birlikte görün. Çakışmaları maçtan önce bulun.**

[**Tarayıcınızda deneyin**](https://pathblender.pages.dev) ·
[Masaüstü uygulamasını indirin](https://github.com/LYT259/pathblender/releases) ·
[İlk yol denetimi](docs/user-guide.en.md#try-it-without-files) ·
[GitHub’da Star verin](https://github.com/LYT259/pathblender)

PathBlender, Choreo ve PathPlanner yollarını FRC ittifak stratejisi için tek bir sahada ve tek bir saatte bir araya getirir. Robotları birlikte oynatın, bir çakışma bulun ve planı kesinleştirmeden önce farklı bir başlangıç zamanını karşılaştırın.

![Sentetik bir antrenman oturumu: bir örtüşmeyi bulun, B’yi geciktirin ve değişen planı yeniden oynatın](docs/screenshots/first-check.gif)

*Antrenman sahasındaki özgün eğitim yolları; gerçek bir maç değil. Kendi denetiminizi giriş ekranından yapın — dosya, kurulum veya hesap gerekmez.*

- **Farklı araçları bir araya getirir:** Choreo, PathPlanner ve Collaborative `.ghostauto` dosyalarını içe aktarın.
- **Zamanlamayı görünür kılar:** ortak oynatma, çarpışma denetimleri ve oturum düzeyinde başlangıç zamanı karşılaştırması.
- **Yolları makinenizde tutar:** çözümleme ve denetim yerel olarak yapılır.

Bunu yararlı ya da ilginç bulursanız, PathBlender’ı desteklemek ve sonra yeniden bulmak için **depoya Star vermeyi** düşünün.

## Neden

FRC eleme ve play-off maçlarında bir ittifakın üç robotu aynı anda aynı sahada otonom programlarını çalıştırır. Takımlar yollarını farklı araçlarda planlar (Choreo, PathPlanner) ve ayrı dışa aktarımları karşılaştırmak, örtüşmeleri maçtan önce görmeyi zorlaştırır.

PathBlender bu boşluğu doldurur:

- **Çok araçlı içe aktarma** — Choreo `.traj`, 103. takım Collaborative fork'u `.ghostauto` ve yerel PathPlanner `.path` / `.auto` (yörünge üretimi TypeScript'e taşındı);
- **Birleşik zaman çizelgesinde oynatma** — tüm robotlar tek bir otonom saatinde (15 sn; 2026 sezonunda 20 sn), oynat / duraklat / sürükle / hız kontrolü (0,25×–1×);
- **Çakışma ve girişim denetimi** — tüm zaman çizelgesi boyunca tampon dikdörtgeni (OBB) örtüşme kontrolü; çakışma raporu (kimler, ne zaman, nerede) ve saha dışı işaretleriyle;
- **3B saha görünümü** — FRC 2022–2026 resmî saha modelleri (yapılar farklıysa kaynak ve AndyMark varyantları), serbest yörünge ve tek tıkla sığdırma; içe aktarılan özel sahalar 2B kalır. 2B görünüm sezon başına şematik ve gerçekçi iki stil sunar, resmî AprilTag yerleşimi üstte gösterilir;
- **Rota kütüphanesi** — bir takımın tamam deploy klasörünü içe aktarın: alâkasız dosyalar atlanır, her yol kütüphaneye girer; her robotun yanındaki seçici etkin otonomunu canlı değiştirir. PathPlanner `settings.json` dosyaları gerçek tampon boyutlarını uygular;

- **Sıfır kurulum, sıfır yükleme (web)** — statik bir web uygulaması: yol dosyaları tarayıcınızda yerel olarak çözümlenir ve denetlenir;
- **Ayrıca masaüstü uygulaması** — macOS, Windows ve Linux için hafif bir Tauri kabuğunda aynı arayüz; oturum kaydetme/açma, GIF tekrar oynatma ve çözüm paketi dışa aktarma ile uygulama içi güncellemeler (kararlı veya beta kanalı) ekler. Masaüstünün güncelleme denetimleri GitHub Releases'e bağlanır.

## Hızlı başlangıç

1. Uygulamayı edinin (aşağıya bakın) — ya da giriş ekranındaki **İlk yol denetiminizi deneyin** düğmesiyle üç sentetik yolla yönlendirilmiş bir alıştırma yapın. **Bir örnek deneyin** ise ayrı olarak yerleşik çok robotlu oturumu açar.
2. İttifak ortağı her takımın yol dosyalarını içe aktarın — `.traj`, `.ghostauto`, `.path`, `.auto` serbestçe karıştırılabilir (tek dosya ya da bütün klasör; web'de de masaüstünde de; bir `.auto`'nun referans verdiği her `.path` aynı grupta gelmelidir). Bozuk dosyalar tek tek, nedenleriyle bildirilir; diğerlerini durdurmaz.
3. **Oynat**'a basın. Çakışmalar sahada kırmızı halkalar, zaman çizelgesinde kırmızı bölümler ve çakışma panelinde kayıtlar (kimler, ne zaman, nerede) olarak görünür — birine tıklayın, saat o ana atlayasın.
4. İnceleyin: kütüphaneden robotun rotasını değiştirin, ittifak görünümünü çevirin veya saati ilerletin. Ne değişmesi gerektiğini anladığınızda, yolu sahibi olan takımın aracında değişikliği yapın, yeniden dışa aktarın ve yeni dosyayı bırakın — oturum yerinde güncellenir.
5. Sonucu **paylaşın**: bir oturum dosyası kaydedin ya da 2B görünümün GIF tekrarını dışa aktarın — ortağın ihtiyacı olan her şeyi içeren çözüm paketiyle birlikte — ittifak sohbetine (masaüstü uygulaması).

![Çakışma raporu](docs/screenshots/collision-report.png)

## Desteklenen biçimler

| Biçim | Kaynak | Notlar |
|---|---|---|
| `.traj` | Choreo (SleipnirGroup, BSD-3) | Bilinen tüm şema sürümleri; zamana göre örneklenmiş durumlar |
| `.ghostauto` | PathPlanner Collaborative fork (FRC 103, MIT) | Tampon geometrisini ve takım adını içerir |
| `.path` | PathPlanner (MIT) | Yörünge yerel olarak üretilir — taşınmış PathPlannerLib algoritması |
| `.auto` | PathPlanner (MIT) | Bekleme/komut anlamlarıyla yol dizileri |
| `settings.json` | PathPlanner (MIT) | O projedeki robotların tampon boyutları |
| `.pb` | Bu proje | Oturum dosyası: tüm robotlar + ayarlar + saha (yeniden adlandırmadan önceki `.ghpb.json` de açılır) |

Sahalar: FRC 2022–2026 yerleşik; ayrıca kalibrasyonlu özel saha içe aktarma ve bir WPILib/PhotonVision AprilTag yerleşim JSON'u (başka her sezon veya bir antrenman sahaları için kullanın).

## Nereden edinilir

- **macOS** (macOS 13+; Apple Silicon ve Intel için tek Universal indirme) — [GitHub Releases](https://github.com/LYT259/pathblender/releases) sayfasından `PathBlender_<sürüm>_universal.dmg`: açın ve PathBlender'ı Uygulamalar'a sürükleyin.
- **Windows** (x86_64) — aynı sürüm sayfasındaki `*_x64-setup.exe` kurulumu.
- **Linux** (x86_64) — aynı sayfadaki DEB, AppImage ve RPM paketleri. Uygulama içi güncellemeler AppImage'ı kullanır; DEB/RPM kullanıcıları yeni paketi eskisinin üzerine kurarak günceller.
- Güncellemeler: menü **PathBlender → Güncellemeleri Denetle…** (beta sürümlerde önce **Tercihler → Güncellemeler**'den beta kanalını açın). Sürüm sayfasındaki diğer dosyalar (`.tar.gz`, `.sig`, `.json`) güncelleyiciye aittir — onlara ihtiyacınız yok.
- **Web uygulaması** (görüntüleyici yapımı: uygulama ile aynı içe aktarmalar — dosyalar ve bütün klasörler — artı oynatma ve denetim; oturum kaydetme / GIF ve çözüm paketi dışa aktarma yok) — [pathblender.pages.dev](https://pathblender.pages.dev).

## Gizlilik

Yol dosyaları **tamamen sizin makinenizde** çözümlenir. Arka uç yok, hesap yok, telemetri yok, analitik yok. Tarayıcı uygulamayı ve varlıklarını indirir; masaüstünün güncelleme denetimleri GitHub Releases'e bağlanır. Yol dosyaları yüklenmez. Dış bağlantılar, siz seçtiğinizde adı geçen hedeflerini açar.

Ayrıca: oturum düzeyinde kırmızı/mavi ittifak görünümü, robot başına takım numarası etiketleri, resmî AprilTag üst katmanlarıyla yukarıdaki sezon sahaları ve **43 dilde** arayüz — tam liste dil menüsünde — açık ve koyu temalarla (sistemi izler).

Araçlara göre tam kılavuz ve SSS (İngilizce ve Çince):
[English](docs/user-guide.en.md) ·
[简体中文](docs/user-guide.zh.md).

## Geri bildirim

Hatalar, biçim kayması raporları ve sezon sahası sorunları tam da ihtiyacımız olan geri bildirimdir.
[github.com/LYT259/pathblender/issues](https://github.com/LYT259/pathblender/issues)
adresinde bir konu açın — [geri bildirim şablonu](docs/community/feedback-template.md) nelerin dahil edileceğini gösterir (yol dosyalarınızı paylaşmanız asla istenmez). Topluluk tartışması projenin Chief Delphi duyuru başlığında yürür.

## Durum

Yukarıda anlatılan görüntüleyici kapsamı uygulanmış ve regresyon testleriyle örtülüdür. Masaüstü yapıları [GitHub Releases](https://github.com/LYT259/pathblender/releases) üzerinden yayımlanır.

## Lisans ve atıf

**Apache-2.0** — bkz. [LICENSE](./LICENSE) ve [NOTICE.md](./NOTICE.md).
PathPlanner (MIT), Choreo (BSD-3), AdvantageScope varlıkları (BSD-3) ve WPILib (BSD-3) kendi lisansları altında kalır ve NOTICE'te ayrı ayrı anılır.

Saha görselleri ve oyun adları FIRST'e aittir; FIRST'in marka ve telifli materyal politikası uyarınca, ticari olmayan takım stratejisi amaçlarıyla kullanılır ve her genel sürümden önce yeniden denetlenir:

> FIRST®, FIRST® Robotics Competition ve FIRST® Tech Challenge, FIRST®'in (www.firstinspires.org) tescilli markalarıdır; FIRST® bu etkinliği, ürünü veya hizmeti denetlememekte, katılımamakta ve ondan sorumlu değildir.
