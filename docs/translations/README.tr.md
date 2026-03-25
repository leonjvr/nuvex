[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

---

> *Bu sayfa [İngilizce orijinalden](../../README.md) otomatik olarak çevrilmiştir. Bir hata buldunuz mu? [Bildirin](https://github.com/GoetzKohlberg/sidjua/issues).*

# SIDJUA — AI Ajan Yönetişim Platformu

> Yönetişimin mimari tarafından zorunlu kılındığı, modelin iyi davranacağını umarak değil, tek ajan platformu.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## Kurulum

### Ön Koşullar

| Araç | Gerekli | Notlar |
|------|---------|--------|
| **Node.js** | >= 22.0.0 | ES modülleri, `fetch()`, `crypto.subtle`. [İndir](https://nodejs.org) |
| **C/C++ Araç Zinciri** | Yalnızca kaynak derlemeleri | `better-sqlite3` ve `argon2` yerel eklentiler derler |
| **Docker** | >= 24 (isteğe bağlı) | Yalnızca Docker dağıtımı için |

Node.js 22 kurulumu: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

C/C++ araçları kurulumu: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Seçenek A — Docker (Önerilen)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Otomatik oluşturulan API anahtarını görüntüle
docker compose exec sidjua cat /app/.system/api-key

# Yönetişimi başlat
docker compose exec sidjua sidjua apply --verbose

# Sistem sağlık kontrolü
docker compose exec sidjua sidjua selftest
```

**linux/amd64** ve **linux/arm64** (Raspberry Pi, Apple Silicon) destekler.

### Seçenek B — npm Global Kurulum

```bash
npm install -g sidjua
sidjua init          # 3 adımlı etkileşimli kurulum
sidjua chat guide    # Sıfır yapılandırmalı AI kılavuzu (API anahtarı gerekmez)
```

### Seçenek C — Kaynak Derleme

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Platform Notları

| Özellik | Linux | macOS | Windows (WSL2) | Windows (yerel) |
|---------|-------|-------|----------------|-----------------|
| CLI + REST API | ✅ Tam | ✅ Tam | ✅ Tam | ✅ Tam |
| Docker | ✅ Tam | ✅ Tam (Desktop) | ✅ Tam (Desktop) | ✅ Tam (Desktop) |
| Sandboxlama (bubblewrap) | ✅ Tam | ❌ `none`'a geri döner | ✅ Tam (WSL2 içinde) | ❌ `none`'a geri döner |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Harici veritabanı gerekmez. SIDJUA SQLite kullanır. Qdrant isteğe bağlıdır (yalnızca anlamsal arama).

Tam kılavuz, dizin düzeni, ortam değişkenleri, işletim sistemine göre sorun giderme ve Docker birim referansı için [docs/INSTALLATION.md](docs/INSTALLATION.md) dosyasına bakın.

---

## Neden SIDJUA?

Bugün her AI ajan çerçevesi aynı yanlış varsayıma dayanır: AI'nın kendi
kurallarına uyacağına güvenebileceğinizi.

**Prompt tabanlı yönetişimin sorunu:**

Bir ajana "müşteri PII'sine asla erişme" diyen bir sistem promptu verirsiniz. Ajan
talimatı okur. Ajan ayrıca Ahmet Yılmaz'ın ödeme geçmişini çekmesini isteyen
kullanıcının mesajını da okur. Ajan — kendi başına — uyup uymayacağına karar verir.
Bu yönetişim değil. Bu güçlü bir şekilde ifade edilmiş bir öneridir.

**SIDJUA farklıdır.**

Yönetişim ajanın **dışında** yer alır. Her eylem, çalıştırılmadan **önce** 5 aşamalı
uygulama boru hattından geçer. Kuralları YAML'de tanımlarsınız. Sistem onları uygular.
Ajan, kurallara uyup uymayacağına hiçbir zaman karar veremez çünkü kontrol,
ajan harekete geçmeden önce gerçekleşir.

Bu mimari yönetişimdir — prompt ile değil, ince ayar ile değil,
umarak değil.

---

## Nasıl Çalışır

SIDJUA ajanlarınızı harici bir yönetişim katmanıyla sarar. Ajanın LLM çağrısı,
önerilen eylem 5 aşamalı uygulama boru hattını geçene kadar gerçekleşmez:

**Aşama 1 — Yasak:** Engellenen eylemler anında reddedilir. LLM çağrısı yok,
"izin verildi" olarak işaretlenmiş günlük girişi yok, ikinci şans yok. Eylem
yasaklar listesindeyse burada durur.

**Aşama 2 — Onay:** İnsan imzası gerektiren eylemler, yürütülmeden önce
onay için beklemeye alınır. Ajan bekler. İnsan karar verir.

**Aşama 3 — Bütçe:** Her görev gerçek zamanlı maliyet sınırlarına karşı çalışır. Görev
başına ve ajan başına bütçeler uygulanır. Sınıra ulaşıldığında görev iptal
edilir — işaretlenmez, gözden geçirilmek üzere kaydedilmez, *iptal edilir*.

**Aşama 4 — Sınıflandırma:** Bölüm sınırlarını geçen veriler sınıflandırma
kurallarına göre kontrol edilir. Tier-2 ajan SECRET verilere erişemez. A Bölümündeki
ajan B Bölümünün sırlarını okuyamaz.

**Aşama 5 — Politika:** Yapısal olarak uygulanan özel organizasyonel kurallar. API
çağrı frekans sınırları, çıktı token sınırları, zaman penceresi kısıtlamaları.

Tüm boru hattı herhangi bir eylem yürütülmeden önce çalışır. Yönetişim açısından kritik
operasyonlar için "kaydet ve sonra gözden geçir" modu yoktur.

### Tek Yapılandırma Dosyası

Tüm ajan organizasyonunuz tek bir `divisions.yaml`'da bulunur:

```yaml
divisions:
  - name: engineering
    agents:
      - name: research-agent
        provider: anthropic
        model: claude-haiku-4-5-20251001
        tier: 2
        budget:
          per_task_usd: 0.50
          per_month_usd: 50.00
    governance:
      rules:
        - no_external_api_calls: true
        - max_tokens_per_response: 4096
        - require_human_approval: [delete, send_email]
```

`sidjua apply` bu dosyayı okur ve eksiksiz ajan altyapısını hazırlar:
ajanlar, bölümler, RBAC, yönlendirme, denetim tabloları, sır yolları ve yönetişim
kuralları — 10 tekrarlanabilir adımda.

### Ajan Mimarisi

Ajanlar **bölümlere** (işlevsel gruplar) ve **katmanlara**
(güven seviyeleri) göre düzenlenir. Tier 1 ajanlar yönetişim zarfı içinde tam
özerkliğe sahiptir. Tier 2 ajanlar hassas operasyonlar için onay gerektirir. Tier 3
ajanlar tam olarak denetlenir. Katman sistemi yapısal olarak uygulanır — bir
ajan kendini terfi ettiremez.

```
┌─────────────────────────────────────────────────┐
│                 SIDJUA Platform                 │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │           Governance Layer              │   │
│  │  Forbidden → Approval → Budget →        │   │
│  │  Classification → Policy (Stage 0)      │   │
│  └────────────────────┬────────────────────┘   │
│                       │ ✅ cleared              │
│            ┌──────────▼──────────┐             │
│            │   Agent Runtime     │             │
│            │  (any LLM provider) │             │
│            └──────────┬──────────┘             │
│                       │                        │
│  ┌────────────────────▼────────────────────┐   │
│  │            Audit Trail                  │   │
│  │  (WAL-integrity-verified, append-only)  │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Mimari Kısıtlamalar

SIDJUA bu kısıtlamaları mimari düzeyinde uygular — ajanlar tarafından
devre dışı bırakılamaz, atlatılamaz veya geçersiz kılınamaz:

1. **Yönetişim dışsaldır**: Yönetişim katmanı ajanı sarar. Ajanın yönetişim
   koduna erişimi yoktur, kuralları değiştiremez ve yönetişimin mevcut olup
   olmadığını tespit edemez.

2. **Eylemden önce, eylemden sonra değil**: Her eylem YÜRÜTÜLMEDEN ÖNCE kontrol edilir.
   Yönetişim açısından kritik operasyonlar için "kaydet ve sonra gözden geçir" modu yoktur.

3. **Yapısal uygulama**: Kurallar kod yolları tarafından uygulanır, prompt'lar veya
   model talimatları tarafından değil. Bir ajan yönetişimden "jailbreak" yapamaz çünkü
   yönetişim modele talimat olarak uygulanmaz.

4. **Denetim değişmezliği**: Write-Ahead Log (WAL) bütünlük doğrulamasıyla
   yalnızca ekleme yapılabilir. Değiştirilmiş girişler tespit edilir ve hariç tutulur.

5. **Bölüm yalıtımı**: Farklı bölümlerdeki ajanlar birbirinin verilerine,
   sırlarına veya iletişim kanallarına erişemez.

---

## Karşılaştırma

| Özellik | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|---------|--------|--------|---------|-----------|----------|
| Harici Yönetişim | ✅ Mimari | ❌ | ❌ | ❌ | ❌ |
| Eylem Öncesi Uygulama | ✅ 5 Aşamalı Boru Hattı | ❌ | ❌ | ❌ | ❌ |
| EU AI Act Hazır | ✅ | ❌ | ❌ | ❌ | ❌ |
| Kendi Kendine Barındırma | ✅ | ❌ Bulut | ❌ Bulut | ❌ Bulut | ✅ Eklenti |
| Hava Boşluğu Kapasiteli | ✅ | ❌ | ❌ | ❌ | ❌ |
| Model Bağımsız | ✅ Her LLM | Kısmi | Kısmi | Kısmi | ✅ |
| Çift Yönlü E-posta | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord Gateway | ✅ | ❌ | ❌ | ❌ | ❌ |
| Hiyerarşik Ajanlar | ✅ Bölümler + Katmanlar | Temel | Temel | Graf | ❌ |
| Bütçe Uygulaması | ✅ Ajan Başına Sınırlar | ❌ | ❌ | ❌ | ❌ |
| Sandbox Yalıtımı | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Denetim Değişmezliği | ✅ WAL + bütünlük | ❌ | ❌ | ❌ | ❌ |
| Lisans | AGPL-3.0 | MIT | MIT | MIT | Karma |
| Bağımsız Denetimler | ✅ 2 Harici | ❌ | ❌ | ❌ | ❌ |

---

## Özellikler

### Yönetişim ve Uyumluluk

**Eylem Öncesi Boru Hattı (Aşama 0)** her ajan eyleminden önce çalışır: Yasak
kontrolü → İnsan Onayı → Bütçe uygulaması → Veri Sınıflandırma → Özel
Politika. Beş aşamanın tümü yapısaldır — kodda çalışır, ajanın
promptunda değil.

**Zorunlu Temel Kurallar** her kurulumla gelir: 10 yönetişim kuralı
(`SYS-SEC-001`'den `SYS-GOV-002`'ye kadar) kullanıcı yapılandırması tarafından kaldırılamaz
veya zayıflatılamaz. Özel kurallar temeli genişletir; onu geçersiz kılamazlar.

**EU AI Act Uyumluluğu** — denetim izi, sınıflandırma çerçevesi ve onay
iş akışları doğrudan Madde 9, 12 ve 17 gereksinimlerine eşlenir. Ağustos 2026
uyumluluk son tarihi ürün yol haritasına dahil edilmiştir.

**Uyumluluk Raporlaması** `sidjua audit report/violations/agents/export` aracılığıyla:
uyumluluk puanı, ajan başına güven puanları, ihlal geçmişi, harici denetçiler veya
SIEM entegrasyonu için CSV/JSON dışa aktarma.

**Write-Ahead Log (WAL)** bütünlük doğrulamasıyla: her yönetişim kararı
yürütülmeden önce yalnızca ekleme yapılabilen bir günlüğe yazılır. Değiştirilmiş girişler
okumada tespit edilir. `sidjua memory recover` yeniden doğrular ve onarır.

### İletişim

Ajanlar yalnızca API çağrılarına yanıt vermez — gerçek iletişim kanallarına katılırlar.

**Çift Yönlü E-posta** (`sidjua email status/test/threads`): ajanlar IMAP sorgulaması
yoluyla e-posta alır ve SMTP aracılığıyla yanıt verir. In-Reply-To başlıkları aracılığıyla iş
parçacığı eşleme konuşmaları tutarlı tutar. Gönderici beyaz listesi, gövde boyutu sınırları
ve HTML kaldırma, ajan boru hattını kötü amaçlı girdiden korur.

**Discord Gateway Botu**: `sidjua module install discord` aracılığıyla tam slash
komut arayüzü. Ajanlar Discord mesajlarına yanıt verir, konuşma iş parçacıklarını
yönetir ve proaktif bildirimler gönderir.

**Telegram Entegrasyonu**: Telegram botu aracılığıyla ajan uyarıları ve bildirimleri.
Çok kanallı adaptör modeli Telegram, Discord, ntfy ve E-postayı
paralel olarak destekler.

### Operasyonlar

**Tek Docker komutu** üretim için:

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

API anahtarı ilk başlatmada otomatik olarak oluşturulur ve kapsayıcı günlüklerine yazdırılır.
Ortam değişkeni gerekmez. Yapılandırma gerekmez. Veritabanı sunucusu
gerekmez — SIDJUA SQLite kullanır, ajan başına bir veritabanı dosyası.

**CLI Yönetimi** — tek ikili dosyadan eksiksiz yaşam döngüsü:

```bash
sidjua init                      # Etkileşimli çalışma alanı kurulumu (3 adım)
sidjua apply                     # divisions.yaml'dan hazırlama
sidjua agent create/list/stop    # Ajan yaşam döngüsü
sidjua run "task..." --wait      # Yönetişim uygulamasıyla görev gönder
sidjua audit report              # Uyumluluk raporu
sidjua costs                     # Bölüm/ajan bazında maliyet dökümü
sidjua backup create/restore     # HMAC imzalı yedekleme yönetimi
sidjua update                    # Otomatik ön yedeklemeyle sürüm güncellemesi
sidjua rollback                  # Önceki sürüme 1 tıkla geri yükleme
sidjua email status/test         # E-posta kanalı yönetimi
sidjua secret set/get/rotate     # Şifreli sır yönetimi
sidjua memory import/search      # Anlamsal bilgi boru hattı
sidjua selftest                  # Sistem sağlık kontrolü (7 kategori, 0-100 puan)
```

**Anlamsal Bellek** — konuşmaları ve belgeleri içe aktarın (`sidjua memory import
~/exports/claude-chats.zip`), vektör + BM25 hibrit sıralamasıyla arayın. Cloudflare
Workers AI yerleştirmelerini (ücretsiz, sıfır yapılandırma) ve büyük OpenAI yerleştirmelerini
(büyük bilgi tabanları için daha yüksek kalite) destekler.

**Uyarlanabilir Parçalama** — bellek boru hattı, her yerleştirme modelinin token sınırı
dahilinde kalmak için parça boyutlarını otomatik olarak ayarlar.

**Sıfır Yapılandırma Kılavuzu** — `sidjua chat guide`, SIDJUA proxy'si aracılığıyla
Cloudflare Workers AI tarafından desteklenen, herhangi bir API anahtarı olmadan etkileşimli
bir AI asistanı başlatır. Ajanları nasıl kuracağınızı, yönetişimi nasıl yapılandıracağınızı
veya denetim günlüğünde neler olduğunu anlamak için sorun.

**Hava Boşluğu Dağıtımı** — Ollama veya herhangi bir OpenAI uyumlu endpoint aracılığıyla
yerel LLM'ler kullanarak internetten tamamen bağlantısız çalıştırın. Varsayılan olarak telemetri yok.
Tam PII redaksiyonuyla isteğe bağlı hata raporlama.

### Güvenlik

**Sandbox Yalıtımı** — ajan becerileri bubblewrap (Linux kullanıcı ad alanları) aracılığıyla
OS düzeyinde süreç yalıtımı içinde çalışır. Sıfır ek RAM yükü. Takılabilir
`SandboxProvider` arayüzü: geliştirme için `none`, üretim için `bubblewrap`.

**Sır Yönetimi** — RBAC ile şifreli sır deposu (`sidjua secret
set/get/list/delete/rotate/namespaces`). Harici kasa gerekmez.

**Güvenlik Öncelikli Yapı** — kapsamlı dahili test paketi artı 2 harici kod
denetçisi tarafından bağımsız doğrulama (DeepSeek V3 ve xAI Grok). Güvenlik
başlıkları, CSRF koruması, hız sınırlama ve her API yüzeyinde girdi temizleme.
Her yerde parametreli sorgularla SQL enjeksiyon önleme.

**Yedek Bütünlüğü** — zip-slip koruması, zip bomba önleme ve geri yüklemede
manifest sağlama toplamı doğrulamasıyla HMAC imzalı yedek arşivler.

---

## Diğer Çerçevelerden İçe Aktarma

```bash
# İçe aktarılacakları önizleyin — değişiklik yapılmaz
sidjua import openclaw --dry-run

# Yapılandırma + beceri dosyalarını içe aktar
sidjua import openclaw --skills
```

Mevcut ajanlarınız kimliklerini, modellerini ve becerilerini korur. SIDJUA otomatik olarak
yönetişim, denetim izleri ve bütçe kontrolleri ekler.

---

## Yapılandırma Referansı

Başlamak için minimal bir `divisions.yaml`:

```yaml
organization:
  name: "my-org"
  tier: 1

divisions:
  - name: operations
    tier: 2
    agents:
      - name: ops-agent
        provider: anthropic
        model: claude-haiku-4-5-20251001
        division: operations
        budget:
          per_task_usd: 0.25
          per_month_usd: 25.00

governance:
  stage0:
    enabled: true
    forbidden_actions:
      - delete_database
      - exfiltrate_data
    classification:
      default_level: INTERNAL
      max_agent_level: CONFIDENTIAL
```

`sidjua apply` bu dosyadan eksiksiz altyapıyı hazırlar. Değişikliklerden sonra
tekrar çalıştırın — idempotent'tir.

Tüm 10 hazırlama adımının tam özelliksi için [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
dosyasına bakın.

---

## REST API

SIDJUA REST API, gösterge paneliyle aynı portta çalışır:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Temel endpoint'ler:

```
GET  /api/v1/health          # Genel sağlık kontrolü (kimlik doğrulama yok)
GET  /api/v1/info            # Sistem meta verileri (kimlik doğrulandı)
POST /api/v1/execute/run     # Görev gönder
GET  /api/v1/execute/:id/status  # Görev durumu
GET  /api/v1/execute/:id/result  # Görev sonucu
GET  /api/v1/events          # SSE olay akışı
GET  /api/v1/audit/report    # Uyumluluk raporu
```

`/health` dışındaki tüm endpoint'ler Bearer kimlik doğrulaması gerektirir. Anahtar oluştur:

```bash
sidjua api-key generate
```

---

## Docker Compose

```yaml
services:
  sidjua:
    image: sidjua/sidjua:latest
    ports:
      - "4200:4200"
    volumes:
      - sidjua-data:/data
    restart: unless-stopped

volumes:
  sidjua-data:
```

Ya da yapılandırma, günlükler ve ajan çalışma alanı için adlandırılmış birimler ekleyen
ve anlamsal arama için isteğe bağlı bir Qdrant hizmeti içeren `docker-compose.yml` kullanın:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Sağlayıcılar

SIDJUA, bağımlılık olmadan herhangi bir LLM sağlayıcısına bağlanır:

| Sağlayıcı | Modeller | API Anahtarı |
|-----------|---------|--------------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (ücretsiz katman) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Herhangi bir yerel model | Anahtar yok (yerel) |
| OpenAI uyumlu | Herhangi bir endpoint | Özel URL + anahtar |

```bash
# Sağlayıcı anahtarı ekle
sidjua key set groq gsk_...

# Mevcut sağlayıcıları ve modelleri listele
sidjua provider list
```

---

## Yol Haritası

Tam yol haritası: [sidjua.com/roadmap](https://sidjua.com/roadmap).

Kısa vadeli:
- Çok ajanlı orkestrasyon kalıpları (V1.1)
- Webhook gelen tetikleyiciler (V1.1)
- Ajan-ajan iletişimi (V1.2)
- Enterprise SSO entegrasyonu (V1.x)
- Bulut barındırmalı yönetişim doğrulama hizmeti (V1.x)

---

## Topluluk

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Sorunları**: [github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **E-posta**: contact@sidjua.com
- **Belgeler**: [sidjua.com/docs](https://sidjua.com/docs)

Bir hata bulursanız, sorun açın — hızlı hareket ediyoruz.

---

## Çeviriler

SIDJUA 26 dilde mevcuttur. İngilizce ve Almanca çekirdek ekip tarafından sürdürülür. Diğer tüm çeviriler AI tarafından oluşturulur ve topluluk tarafından sürdürülür.

**Belgeler:** Bu README ve [Kurulum Kılavuzu](docs/INSTALLATION.md) tüm 26 dilde mevcuttur. Bu sayfanın üstündeki dil seçiciye bakın.

| Bölge | Diller |
|-------|--------|
| Amerika | İngilizce, İspanyolca, Portekizce (Brezilya) |
| Avrupa | Almanca, Fransızca, İtalyanca, Hollandaca, Lehçe, Çekçe, Rumence, Rusça, Ukraynaca, İsveççe, Türkçe |
| Orta Doğu | Arapça |
| Asya | Hintçe, Bengalce, Filipince, Endonezce, Malayca, Tayca, Vietnamca, Japonca, Korece, Çince (Basitleştirilmiş), Çince (Geleneksel) |

Bir çeviri hatası buldunuz mu? Şunlarla bir GitHub Sorunu açın:
- Dil ve yerel ayar kodu (ör. `fil`)
- Yanlış metin veya yerel ayar dosyasındaki anahtar (ör. `gui.nav.dashboard`)
- Doğru çeviri

Bir dili sürdürmek ister misiniz? [CONTRIBUTING.md](CONTRIBUTING.md#translations) dosyasına bakın — dil başına sürdürücü modeli kullanıyoruz.

---

## Lisans

**AGPL-3.0** — değişiklikleri aynı lisans altında paylaştığınız sürece SIDJUA'yı
özgürce kullanabilir, değiştirebilir ve dağıtabilirsiniz. Kaynak kodu, barındırılan
bir dağıtımın kullanıcıları için her zaman erişilebilirdir.

AGPL yükümlülükleri olmadan özel dağıtım gerektiren kuruluşlar için
Enterprise lisansı mevcuttur.
[contact@sidjua.com](mailto:contact@sidjua.com)
