> Bu belge [İngilizce orijinalden](../INSTALLATION.md) yapay zeka tarafından çevrilmiştir. Bir hata buldunuz mu? [Bildirin](https://github.com/GoetzKohlberg/sidjua/issues).

# SIDJUA Kurulum Kılavuzu

SIDJUA sürümü: 1.0.0 | Lisans: AGPL-3.0-only | Güncelleme: 2026-03-25

## İçindekiler

1. [Platform Destek Matrisi](#1-platform-destek-matrisi)
2. [Ön Koşullar](#2-ön-koşullar)
3. [Kurulum Yöntemleri](#3-kurulum-yöntemleri)
4. [Dizin Yapısı](#4-dizin-yapısı)
5. [Ortam Değişkenleri](#5-ortam-değişkenleri)
6. [Sağlayıcı Yapılandırması](#6-sağlayıcı-yapılandırması)
7. [Masaüstü Arayüzü (İsteğe Bağlı)](#7-masaüstü-arayüzü-i̇steğe-bağlı)
8. [Ajan İzolasyonu](#8-ajan-i̇zolasyonu)
9. [Anlamsal Arama (İsteğe Bağlı)](#9-anlamsal-arama-i̇steğe-bağlı)
10. [Sorun Giderme](#10-sorun-giderme)
11. [Docker Birim Referansı](#11-docker-birim-referansı)
12. [Yükseltme](#12-yükseltme)
13. [Sonraki Adımlar](#13-sonraki-adımlar)

---

## 1. Platform Destek Matrisi

| Özellik | Linux | macOS | Windows WSL2 | Windows (yerel) |
|---------|-------|-------|--------------|----------------|
| CLI + REST API | ✅ Tam | ✅ Tam | ✅ Tam | ✅ Tam |
| Docker | ✅ Tam | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| İzolasyon (bubblewrap) | ✅ Tam | ❌ `none` moduna geçer | ✅ Tam (WSL2 içinde) | ❌ `none` moduna geçer |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Anlamsal Arama (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**bubblewrap hakkında not:** Linux kullanıcı-ad alanı izolasyonu. macOS ve Windows (yerel) otomatik olarak `none` izolasyon moduna geçer — yapılandırma gerekmez.

---

## 2. Ön Koşullar

### Node.js >= 22.0.0

**Neden:** SIDJUA, ES modülleri, yerel `fetch()` ve `crypto.subtle` kullanır — hepsi Node.js 22+ gerektirir.

**Ubuntu / Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora / RHEL / CentOS:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
```

**Arch Linux:**
```bash
sudo pacman -S nodejs npm
```

**macOS (Homebrew):**
```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**macOS (.pkg yükleyicisi):** [nodejs.org/en/download](https://nodejs.org/en/download) adresinden indirin.

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** [nodejs.org/en/download](https://nodejs.org/en/download) adresinden indirin.

**WSL2:** WSL2 terminalinizde yukarıdaki Ubuntu/Debian talimatlarını kullanın.

Doğrulama:
```bash
node --version   # >= 22.0.0 olmalıdır
npm --version    # >= 10.0.0 olmalıdır
```

---

### C/C++ Araç Zinciri (yalnızca kaynak derlemeleri için)

**Neden:** `better-sqlite3` ve `argon2`, `npm ci` sırasında yerel Node.js eklentilerini derler. Docker kullanıcıları bunu atlayabilir.

**Ubuntu / Debian:**
```bash
sudo apt-get install -y python3 make g++ build-essential linux-headers-$(uname -r)
```

**Fedora / RHEL:**
```bash
sudo dnf groupinstall "Development Tools"
sudo dnf install python3
```

**Arch Linux:**
```bash
sudo pacman -S base-devel python
```

**macOS:**
```bash
xcode-select --install
```

**Windows:** **C++ ile masaüstü geliştirme** iş yükü ile [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) yükleyin, ardından:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (isteğe bağlı)

Yalnızca Docker kurulum yöntemi için gereklidir. Docker Compose V2 eklentisi (`docker compose`) mevcut olmalıdır.

**Linux:** [docs.docker.com/engine/install](https://docs.docker.com/engine/install/) adresindeki talimatları izleyin.
Docker Compose V2, Docker Engine >= 24 ile birlikte gelir.

**macOS / Windows:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) yükleyin (Docker Compose V2 içerir).

Doğrulama:
```bash
docker --version          # >= 24.0.0 olmalıdır
docker compose version    # v2.x.x göstermelidir
```

---

### Git

Herhangi bir güncel sürüm. İşletim sisteminizin paket yöneticisi aracılığıyla veya [git-scm.com](https://git-scm.com) adresinden yükleyin.

---

## 3. Kurulum Yöntemleri

### Yöntem A — Docker (Önerilen)

Çalışan bir SIDJUA kurulumuna ulaşmanın en hızlı yolu. Tüm bağımlılıklar görüntüye dahildir.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Servislerin sağlıklı hale gelmesini bekleyin (ilk derlemede ~60 saniyeye kadar):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Otomatik oluşturulan API anahtarını alın:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

`divisions.yaml` dosyanızdan yönetişimi önyükleyin:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Sistem sağlık kontrolünü çalıştırın:

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64 notu:** Docker görüntüsü, `linux/amd64` ve `linux/arm64` destekleyen `node:22-alpine` üzerine inşa edilmiştir. Raspberry Pi (64-bit) ve Apple Silicon Mac'ler (Docker Desktop aracılığıyla) kutudan çıktığı gibi desteklenir.

**Docker'da Bubblewrap:** Konteyner içinde ajan izolasyonunu etkinleştirmek için Docker run komutunuza `--cap-add=SYS_ADMIN` ekleyin veya `docker-compose.yml` dosyasında ayarlayın:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Yöntem B — npm Global Kurulum

```bash
npm install -g sidjua
```

Etkileşimli kurulum sihirbazını çalıştırın (3 adım: çalışma alanı konumu, sağlayıcı, ilk ajan):
```bash
sidjua init
```

Etkileşimsiz CI veya konteyner ortamları için:
```bash
sidjua init --yes
```

Yapılandırma gerektirmeyen AI kılavuzunu başlatın (API anahtarı gerekmez):
```bash
sidjua chat guide
```

---

### Yöntem C — Kaynak Derlemesi

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Derleme süreci `src/index.ts` dosyasını şunlara derlemek için `tsup` kullanır:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Derleme sonrası adımlar i18n yerel dosyalarını, varsayılan rolleri, bölümleri ve bilgi tabanı şablonlarını `dist/` klasörüne kopyalar.

Kaynaktan çalıştırma:
```bash
node dist/index.js --help
```

Test paketini çalıştırma:
```bash
npm test                    # tüm testler
npm run test:coverage       # kapsam raporu ile
npx tsc --noEmit            # yalnızca tür kontrolü
```

---

## 4. Dizin Yapısı

### Docker Dağıtım Yolları

| Yol | Docker Birimi | Amaç | Yönetim |
|-----|--------------|-------|---------|
| `/app/dist/` | Görüntü katmanı | Derlenmiş uygulama | SIDJUA |
| `/app/node_modules/` | Görüntü katmanı | Node.js bağımlılıkları | SIDJUA |
| `/app/system/` | Görüntü katmanı | Yerleşik varsayılanlar ve şablonlar | SIDJUA |
| `/app/defaults/` | Görüntü katmanı | Varsayılan yapılandırma dosyaları | SIDJUA |
| `/app/docs/` | Görüntü katmanı | Paketlenmiş belgeler | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLite veritabanları, yedekler, bilgi koleksiyonları | Kullanıcı |
| `/app/config/` | `sidjua-config` | `divisions.yaml` ve özel yapılandırma | Kullanıcı |
| `/app/logs/` | `sidjua-logs` | Yapılandırılmış günlük dosyaları | Kullanıcı |
| `/app/.system/` | `sidjua-system` | API anahtarı, güncelleme durumu, işlem kilidi | SIDJUA yönetimli |
| `/app/agents/` | `sidjua-workspace` | Ajan tanımları, beceriler, şablonlar | Kullanıcı |
| `/app/governance/` | `sidjua-governance` | Denetim izi, yönetişim anlık görüntüleri | Kullanıcı |

---

### Manuel / npm Kurulum Yolları

`sidjua init` sonrasında çalışma alanınız şu şekilde organize edilir:

```
~/sidjua-workspace/           # veya SIDJUA_CONFIG_DIR
├── divisions.yaml            # Yönetişim yapılandırmanız
├── .sidjua/                  # İç durum (WAL, telemetri tamponu)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Ana veritabanı (ajanlar, görevler, denetim, maliyetler)
│   ├── knowledge/            # Ajan başına bilgi veritabanları
│   │   └── <agent-id>.db
│   └── backups/              # HMAC imzalı yedek arşivleri
├── agents/                   # Ajan beceri dizinleri
├── governance/               # Denetim izi (yalnızca ekleme)
├── logs/                     # Uygulama günlükleri
└── system/                   # Çalışma zamanı durumu
```

---

### SQLite Veritabanları

| Veritabanı | Yol | İçerik |
|-----------|-----|--------|
| Ana | `data/sidjua.db` | Ajanlar, görevler, maliyetler, yönetişim anlık görüntüleri, API anahtarları, denetim günlüğü |
| Telemetri | `.sidjua/telemetry.db` | İsteğe bağlı hata raporları (PII gizlenmiş) |
| Bilgi | `data/knowledge/<agent-id>.db` | Ajan başına vektör gömmeleri ve BM25 dizini |

SQLite veritabanları tek dosyalı, çapraz platform ve taşınabilirdir. `sidjua backup create` ile yedekleyin.

---

## 5. Ortam Değişkenleri

`.env.example` dosyasını `.env` olarak kopyalayın ve özelleştirin. Belirtilmediği sürece tüm değişkenler isteğe bağlıdır.

### Sunucu

| Değişken | Varsayılan | Açıklama |
|---------|-----------|----------|
| `SIDJUA_PORT` | `3000` | REST API dinleme portu |
| `SIDJUA_HOST` | `127.0.0.1` | REST API bağlama adresi. Uzak erişim için `0.0.0.0` kullanın |
| `NODE_ENV` | `production` | Çalışma zamanı modu (`production` veya `development`) |
| `SIDJUA_API_KEY` | Otomatik oluşturulur | REST API taşıyıcı token. Yoksa ilk başlatmada otomatik oluşturulur |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Gelen istek gövdesinin bayt cinsinden maksimum boyutu |

### Dizin Geçersiz Kılmaları

| Değişken | Varsayılan | Açıklama |
|---------|-----------|----------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Veri dizini konumunu geçersiz kıl |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Yapılandırma dizini konumunu geçersiz kıl |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Günlük dizini konumunu geçersiz kıl |

### Anlamsal Arama

| Değişken | Varsayılan | Açıklama |
|---------|-----------|----------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrant vektör veritabanı uç noktası. Docker varsayılanı: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | OpenAI `text-embedding-3-large` gömmeleri için gerekli |
| `SIDJUA_CF_ACCOUNT_ID` | — | Ücretsiz gömmeler için Cloudflare hesap kimliği |
| `SIDJUA_CF_TOKEN` | — | Ücretsiz gömmeler için Cloudflare API token'ı |

### LLM Sağlayıcıları

| Değişken | Sağlayıcı |
|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, gömmeler) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (ücretsiz katman) |
| `GROQ_API_KEY` | Groq (hızlı çıkarım, ücretsiz katman mevcut) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Sağlayıcı Yapılandırması

### Yapılandırmasız Seçenek

`sidjua chat guide`, herhangi bir API anahtarı olmadan çalışır. SIDJUA proxy'si üzerinden Cloudflare Workers AI'ya bağlanır. Hız sınırlıdır ancak değerlendirme ve katılım için uygundur.

### İlk Sağlayıcınızı Ekleme

**Groq (ücretsiz katman, kredi kartı gerekmez):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
[console.groq.com](https://console.groq.com) adresinden ücretsiz anahtar alın.

**Anthropic (üretim için önerilir):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (hava boşluğu / yerel dağıtım):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Yapılandırılmış tüm sağlayıcıları doğrulayın:
```bash
sidjua setup --validate
```

---

## 7. Web Management Console (Optional)

The SIDJUA Web Management Console is a React/TypeScript application served via the Hono REST API. It is optional — the CLI and REST API work without it.

No additional installation steps are required. The web console is served automatically when the SIDJUA API server is running.

### Accessing the Console

Once the API server is started, open a browser at:

```
http://localhost:PORT
```

Where `PORT` is the API server port (default: `4000`). The console requires authentication using your API key or a scoped token.

---

## 8. Ajan İzolasyonu

SIDJUA, takılabilir bir `SandboxProvider` arayüzü kullanır. Korumalı alan, ajan beceri yürütmesini işletim sistemi düzeyinde işlem izolasyonuyla sarar.

### Platforma Göre İzolasyon Desteği

| Platform | İzolasyon Sağlayıcısı | Notlar |
|---------|----------------------|--------|
| Linux (yerel) | `bubblewrap` | Tam kullanıcı-ad alanı izolasyonu |
| Docker (Linux konteyneri) | `bubblewrap` | `--cap-add=SYS_ADMIN` gerektirir |
| macOS | `none` (otomatik geri dönüş) | macOS, Linux kullanıcı ad alanlarını desteklemez |
| Windows WSL2 | `bubblewrap` | WSL2 içinde Linux gibi yükleyin |
| Windows (yerel) | `none` (otomatik geri dönüş) | |

### bubblewrap Kurulumu (Linux)

**Ubuntu / Debian:**
```bash
sudo apt-get install -y bubblewrap socat
```

**Fedora / RHEL:**
```bash
sudo dnf install -y bubblewrap socat
```

**Arch Linux:**
```bash
sudo pacman -S bubblewrap socat
```

### Yapılandırma

`divisions.yaml` dosyasında:
```yaml
governance:
  sandbox: bubblewrap    # veya: none
```

Korumalı alan kullanılabilirliğini doğrulayın:
```bash
sidjua sandbox check
```

---

## 9. Anlamsal Arama (İsteğe Bağlı)

Anlamsal arama, `sidjua memory search` ve ajan bilgi erişimini destekler. Bir Qdrant vektör veritabanı ve bir gömme sağlayıcısı gerektirir.

### Docker Compose Profili

Dahil edilen `docker-compose.yml`, bir `semantic-search` profiline sahiptir:
```bash
docker compose --profile semantic-search up -d
```
Bu, SIDJUA'nın yanında bir Qdrant konteyneri başlatır.

### Bağımsız Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Uç noktayı ayarlayın:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Qdrant Olmadan

Qdrant mevcut değilse, `sidjua memory import` ve `sidjua memory search` devre dışı bırakılır. Diğer tüm SIDJUA özellikleri (CLI, REST API, ajan yürütme, yönetişim, denetim) normal şekilde çalışır. Sistem, herhangi bir bilgi sorgusu için BM25 anahtar kelime aramasına geri döner.

---

## 10. Sorun Giderme

### Tüm Platformlar

**`npm ci`, `node-pre-gyp` veya `node-gyp` hataları ile başarısız olur:**
```
gyp ERR! build error
```
C/C++ araç zincirini yükleyin (Ön Koşullar bölümüne bakın). Ubuntu'da: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
`SIDJUA_CONFIG_DIR` değerini kontrol edin. Dosya `$SIDJUA_CONFIG_DIR/divisions.yaml` konumunda olmalıdır. Çalışma alanı yapısını oluşturmak için `sidjua init` komutunu çalıştırın.

**REST API 401 Unauthorized döndürür:**
`Authorization: Bearer <key>` başlığını doğrulayın. Otomatik oluşturulan anahtarı şunlarla alın:
```bash
cat ~/.sidjua/.system/api-key          # manuel kurulum
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Port 3000 zaten kullanımda:**
```bash
SIDJUA_PORT=3001 sidjua server start
# veya .env dosyasında ayarlayın: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3`, `futex.h` bulunamadı hatasıyla derlenemiyor:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux, Docker birim bağlamalarını engelliyor:**
```yaml
# SELinux bağlamı için :Z etiketi ekleyin
volumes:
  - ./my-config:/app/config:Z
```
Veya SELinux bağlamını manuel olarak ayarlayın:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.js sürümü çok eski:**
Node.js 22'yi yüklemek için `nvm` kullanın:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22
```

---

### macOS

**`xcrun: error: invalid active developer path`:**
```bash
xcode-select --install
```

**Docker Desktop belleği tüketiyor:**
Docker Desktop → Ayarlar → Kaynaklar → Bellek'i açın. En az 4 GB'a artırın.

**Apple Silicon — mimari uyumsuzluğu:**
Node.js kurulumunuzun yerel ARM64 olduğunu doğrulayın (Rosetta değil):
```bash
node -e "console.log(process.arch)"
# beklenen: arm64
```
`x64` yazdırırsa, Node.js'i nodejs.org'dan ARM64 yükleyicisini kullanarak yeniden yükleyin.

---

### Windows (yerel)

**`MSBuild` veya `cl.exe` bulunamadı:**
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) yükleyin ve **C++ ile masaüstü geliştirme** iş yükünü seçin. Ardından çalıştırın:
```powershell
npm install --global windows-build-tools
```

**Uzun yol hataları (`ENAMETOOLONG`):**
Windows kayıt defterinde uzun yol desteğini etkinleştirin:
```powershell
# Yönetici olarak çalıştırın
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**`npm install -g` sonrasında `sidjua` komutu bulunamadı:**
npm global bin dizinini PATH'inize ekleyin:
```powershell
npm config get prefix  # örn. C:\Users\you\AppData\Roaming\npm gösterir
# Bu yolu Sistem Ortam Değişkenleri → Path'e ekleyin
```

---

### Windows WSL2

**Docker, WSL2 içinde başlatılamıyor:**
Docker Desktop → Ayarlar → Genel'i açın → **Use the WSL 2 based engine** seçeneğini etkinleştirin.
Ardından Docker Desktop'ı ve WSL2 terminalinizi yeniden başlatın.

**`/mnt/c/` altındaki dosyalarda izin hataları:**
WSL2'de bağlanan Windows NTFS birimlerinin kısıtlı izinleri vardır. Çalışma alanınızı yerel bir Linux yoluna taşıyın:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` çok yavaş (5-10 dakika):**
Bu normaldir. ARM64'te yerel eklenti derlemesi daha uzun sürer. Bunun yerine Docker görüntüsünü kullanmayı düşünün:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Derleme sırasında bellek yetersizliği:**
Takas alanı ekleyin:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Docker Birim Referansı

### Adlandırılmış Birimler

| Birim Adı | Konteyner Yolu | Amaç |
|----------|---------------|------|
| `sidjua-data` | `/app/data` | SQLite veritabanları, yedek arşivler, bilgi koleksiyonları |
| `sidjua-config` | `/app/config` | `divisions.yaml`, özel yapılandırma |
| `sidjua-logs` | `/app/logs` | Yapılandırılmış uygulama günlükleri |
| `sidjua-system` | `/app/.system` | API anahtarı, güncelleme durumu, işlem kilit dosyası |
| `sidjua-workspace` | `/app/agents` | Ajan beceri dizinleri, tanımlar, şablonlar |
| `sidjua-governance` | `/app/governance` | Değiştirilemez denetim izi, yönetişim anlık görüntüleri |
| `qdrant-storage` | `/qdrant/storage` | Qdrant vektör dizini (yalnızca anlamsal arama profili) |

### Bir Ana Bilgisayar Dizini Kullanma

Konteyner içinde düzenlemek yerine kendi `divisions.yaml` dosyanızı bağlamak için:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # sidjua-config adlandırılmış biriminin yerini alır
```

### Yedekleme

```bash
sidjua backup create                    # konteyner içinden
# veya
docker compose exec sidjua sidjua backup create
```

Yedekler, `/app/data/backups/` klasöründe saklanan HMAC imzalı arşivlerdir.

---

## 12. Yükseltme

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # şema geçişlerini çalıştır
```

`sidjua apply` idempotent'tir — yükseltme sonrasında yeniden çalıştırmak her zaman güvenlidir.

### npm Global Kurulum

```bash
npm update -g sidjua
sidjua apply    # şema geçişlerini çalıştır
```

### Kaynak Derlemesi

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # şema geçişlerini çalıştır
```

### Geri Alma

SIDJUA, her `sidjua apply` öncesinde bir yönetişim anlık görüntüsü oluşturur. Geri almak için:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Sonraki Adımlar

| Kaynak | Komut / Bağlantı |
|--------|-----------------|
| Hızlı Başlangıç | [docs/QUICK-START.md](QUICK-START.md) |
| CLI Referansı | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Yönetişim Örnekleri | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Ücretsiz LLM Sağlayıcı Kılavuzu | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Sorun Giderme | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Kurulumdan sonra çalıştırılacak ilk komutlar:

```bash
sidjua chat guide    # yapılandırmasız AI kılavuzu — API anahtarı gerekmez
sidjua selftest      # sistem sağlık kontrolü (7 kategori, 0-100 puan)
sidjua apply         # divisions.yaml dosyasından ajanları sağla
```
