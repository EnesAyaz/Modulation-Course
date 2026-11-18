# Atlas stili: tek HTML'lik etkileşimli sayfa talimatı

Bu talimat, PWM Explorer'ın Atlas görünümlü sürümünün (`PWM_Explorer.html`) nasıl kurulduğunu anlatır. Aynı
görünümü başka bir sayfada elde etmek için yeter. Bir yapay zekâya da olduğu gibi verilebilir.

---

## 0. Kesin kural: TEK BİR HTML DOSYASI

**Teslim edilen şey tek bir `.html` dosyasıdır.** Yanında klasör, `.css`, `.js` ya da resim dosyası olmaz.
Dosya WhatsApp'tan, e-postayla ya da USB'yle gönderilip **çift tıklayınca** (`file://`) çalışmalıdır.

- Bütün CSS tek bir `<style>` bloğunda, bütün JS `<script>` bloklarında, dosyanın içinde durur.
- Resimler (logo, favicon) **base64 `data:` URI** olarak gömülür: `<img src="data:image/png;base64,...">`.
- **Dış kaynak yoktur:** CDN, Google Fonts, `import` edilen kütüphane ya da `fetch` ile okunan veri olmaz.
  Sayfa internetsiz çalışmalıdır.
- **ES modülü yoktur:** `<script type="module">` ve `import` kullanılmaz, çünkü `file://`'da çalışmazlar.
  Düz `<script>` ve IIFE (`(function(){ 'use strict'; ... })();`) kullanılır.
- Yazı tipi indirilmez; sistem yazı tipleri kullanılır (aşağıda).
- Geliştirirken birden çok dosyayla çalışılabilir. Teslimden önce hepsi tek dosyada birleştirilir: `<link>` ve
  `<script src>` satırları, dosyaların içeriğiyle değiştirilir. Gömülen JS'deki `</script` dizisi
  `<\/script` olarak yazılır. Birleştirdikten sonra dosyada `src="` ya da `href="` ile başlayan yerel bir yol
  kalmadığı kontrol edilir.

---

## 1. İlkeler

1. **Bileşende ham renk yazılmaz.** Bütün renkler, gölgeler, yarıçaplar ve eğriler `:root`'taki CSS
   değişkenlerinden (token) okunur. Böylece açık ve koyu tema kendiliğinden çalışır.
2. **Az yazı.** Ekranda yalnız kısa başlık ve etiket kalır. Açıklama, formül, kaynak ve uyarı ayrıntısı
   **(i) düğmesinin** içine gider (bkz. §5).
3. **Cam yalnız yüzen öğelerde** kullanılır: üst çubuk ve ipucu balonu. İçerik kartları opaktır.
4. **Üç tema:** Sistem (varsayılan), Açık, Koyu. Seçim `localStorage`'da saklanır ve ilk boyamadan önce
   uygulanır, böylece sayfa açılırken yanlış temada parlamaz.
5. **Zayıf cihazlar:** "Hareketi azalt" açıksa animasyon durur. "Şeffaflığı azalt" açıksa cam opak olur ve
   aura gizlenir.

---

## 2. Token'lar (`<style>`'ın en başına konur)

Renkler OKLCH'dir. Açık tema `:root`'tadır. Koyu tema **iki kez** yazılır: biri sistem koyuyken (kullanıcı
açık seçmediyse), biri de kullanıcı açıkça koyu seçtiğinde.

```css
:root {
  --atlas-cyan: #04deef; --atlas-teal: #02a2d0; --atlas-blue: #0051d4; --atlas-deep: #001a3a; /* logo, sabit */
  --accent-h: 248; --accent-c: .135; --aura-h: 248; --aura-k: 1;
  --glass-blur-2: 18px; --glass-blur-3: 28px; --glass-saturation: 1.8;
  --ease: cubic-bezier(.22,.61,.36,1); --ease-out: cubic-bezier(.16,1,.3,1); --spring: cubic-bezier(.34,1.56,.64,1);
  --r-1: 8px; --r-2: 12px; --r-3: 16px; --r-4: 22px; --r-pill: 999px;   /* her ölçü 4px'in katı */
  --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  color-scheme: light;
  --bg: oklch(98.6% .004 240);
  --surface: oklch(100% 0 0); --surface-2: oklch(98% .004 240); --surface-3: oklch(96% .006 240);
  --glass-2: oklch(100% 0 0 / .68); --glass-3: oklch(100% 0 0 / .82);
  --glass-edge-top: oklch(100% 0 0 / .90); --glass-edge-bottom: oklch(100% 0 0 / .25);
  --glass-inner-light: oklch(100% 0 0 / .60); --glass-body-shadow: oklch(25% .03 255 / .10);
  --border: oklch(92% .006 250 / .9); --border-2: oklch(89% .008 250); --border-strong: oklch(84% .01 250);
  --text: oklch(22% .02 255); --text-2: oklch(46% .014 255); --text-3: oklch(62% .012 255); --text-faint: oklch(74% .01 255);
  --accent: oklch(58% var(--accent-c) var(--accent-h)); --accent-soft: oklch(95% .04 var(--accent-h));
  --accent-text: oklch(45% var(--accent-c) var(--accent-h)); --ring: oklch(58% var(--accent-c) var(--accent-h) / .35);
  --warn-soft: oklch(95% .06 75); --warn-ink: oklch(48% .12 70);
  /* grafik serileri: kimlik, durum değil; sabit sıra, en fazla 8 */
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; --series-4: #eda100;
  --series-5: #e87ba4; --series-6: #008300; --series-7: #4a3aa7; --series-8: #e34948;
  --sh-1: 0 1px 2px oklch(25% .03 255 / .06), 0 1px 1px oklch(25% .03 255 / .04);
  --sh-2: 0 4px 16px oklch(25% .03 255 / .08), 0 1px 3px oklch(25% .03 255 / .05);
  --aura-opacity: .62;
  --aura-1: oklch(95% calc(.09 * var(--aura-k)) var(--aura-h));
  --aura-2: oklch(96% calc(.075 * var(--aura-k)) calc(var(--aura-h) - 32));
  --aura-3: oklch(96% calc(.08 * var(--aura-k)) calc(var(--aura-h) + 30));
}
/* Koyu: aynı bloğu iki seçicide tekrarla */
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* KOYU DEĞERLER */ } }
:root[data-theme="dark"] { /* KOYU DEĞERLER (yukarıdakinin aynısı) */ }
```

Koyu değerler:

```css
color-scheme: dark;
--bg: oklch(15% .012 260);
--surface: oklch(20% .016 260); --surface-2: oklch(23% .016 260); --surface-3: oklch(26% .018 260);
--glass-2: oklch(23% .016 260 / .62); --glass-3: oklch(22% .016 260 / .78);
--glass-edge-top: oklch(100% .02 255 / .28); --glass-edge-bottom: oklch(100% .02 255 / .06);
--glass-inner-light: oklch(100% .02 255 / .12); --glass-body-shadow: oklch(0% 0 0 / .50);
--border: oklch(100% 0 0 / .08); --border-2: oklch(100% 0 0 / .12); --border-strong: oklch(100% 0 0 / .18);
--text: oklch(95% .008 250); --text-2: oklch(74% .012 255); --text-3: oklch(60% .012 255); --text-faint: oklch(48% .012 255);
--accent: oklch(72% calc(var(--accent-c) * 1.05) var(--accent-h)); --accent-soft: oklch(30% .05 var(--accent-h) / .5);
--accent-text: oklch(80% var(--accent-c) var(--accent-h)); --ring: oklch(72% var(--accent-c) var(--accent-h) / .4);
--warn-soft: oklch(34% .06 75 / .5); --warn-ink: oklch(86% .11 75);
--series-1: #6fa8f0; --series-2: #ff9163; --series-3: #4fd3a0; --series-4: #f5c451;
--series-5: #f5a3c1; --series-6: #5cc45c; --series-7: #9b8ce8; --series-8: #ff7f7e;
--sh-1: 0 1px 2px oklch(0% 0 0 / .30); --sh-2: 0 4px 16px oklch(0% 0 0 / .40), 0 1px 3px oklch(0% 0 0 / .30);
--aura-opacity: .5;
--aura-1: oklch(38% calc(.11 * var(--aura-k)) var(--aura-h));
--aura-2: oklch(34% calc(.09 * var(--aura-k)) calc(var(--aura-h) - 32));
--aura-3: oklch(36% calc(.10 * var(--aura-k)) calc(var(--aura-h) + 30));
```

**Tema, ilk boyamadan önce:** `<head>`'in en başına, CSS'ten önce şu betik konur:

```html
<script>
(function () {
  var t = null; try { t = localStorage.getItem('atlas-theme'); } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
</script>
```

Tema düğmesi `data-theme`'i değiştirir (Sistem seçilirse özniteliği kaldırır) ve `localStorage`'a yazar.

---

## 3. Yerleşim

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [logo] Başlık (i)                    [Örnek seç ▾] (i)  [▭ ☀ ☾]           │ ← cam üst çubuk, sticky
├───────────────┬───────────────────────────────────────────────────────────┤
│ KART: Kontrol │ KART: Devre / ana görsel                                  │
│ KART: Kontrol │ KART: Grafik 1                                            │
│ KART: Çıkış   │ KART: Grafik 2                                            │
│ (300px,sticky)│ (esnek)                                                   │
└───────────────┴───────────────────────────────────────────────────────────┘
                          Conventions (i)                                     ← alt bilgi tek satır
```

- `body`: `background: var(--bg)`, yazı `14px/1.5 var(--font-sans)`.
- **Arka planda aura:** `position: fixed` bir katmanda üç büyük `radial-gradient` leke (`--aura-1/2/3`)
  26, 33 ve 29 saniyede yavaşça kayar (`animation: … ease-in-out infinite alternate`, `translate3d` + `scale`).
  Katmanın `opacity` değeri `var(--aura-opacity)`, `pointer-events: none`.
- **Üst çubuk:** `position: sticky; top: 8px`, kenarlardan 16px içeride, `border-radius: var(--r-3)`,
  en az 52px yükseklik, cam (§4). İçinde 28px logo, 15.5px/620 başlık, boşluk, sağda seçim kutusu ve tema düğmeleri.
- **Gövde:** `grid-template-columns: 300px minmax(0,1fr); gap: 14px; max-width: 1280px; padding: 14px 16px`.
- **Sol sütun:** `position: sticky; top: 72px; max-height: calc(100vh - 80px); overflow-y: auto`.
- **880px altında** tek sütun olur ve sol sütun sticky olmaktan çıkar. Telefonda yatay kaydırma olmaz.

---

## 4. Bileşenler

**Kart** (içerik katmanı, cam değil):
```css
.card { padding: 14px 16px; border-radius: var(--r-3); background: var(--surface);
  border: 1px solid var(--border); box-shadow: var(--sh-1); }
```
Kart başlığı: `11px`, `font-weight: 640`, `letter-spacing: .07em`, `text-transform: uppercase`, `color: var(--text-3)`.
Başlığın yanında gerekirse (i) durur, sağında küçük düğmeler.

**Cam** (yalnız üst çubuk ve ipucu):
```css
.glass {
  background-image: linear-gradient(var(--glass-2), var(--glass-2)),
    linear-gradient(160deg, var(--glass-edge-top), var(--glass-edge-bottom) 55%, var(--glass-edge-top));
  background-origin: border-box; background-clip: padding-box, border-box; border: 1px solid transparent;
  backdrop-filter: blur(var(--glass-blur-2)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur-2)) saturate(var(--glass-saturation));
  box-shadow: inset 0 1px 0 0 var(--glass-inner-light), 0 8px 32px -8px var(--glass-body-shadow);
}
```

**Etiket satırı:** Solda etiket (12.5px, 560, `--text-2`), sağda değer (`<output>`, mono, `--accent-text`).
Altında tam genişlikte `input[type=range]` (`accent-color: var(--accent)`).

**Seçim kutusu (`select`):** 36px yükseklik, `--r-2`, `1px solid var(--border-2)`, `background: var(--surface)`.
Odakta `border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring)`. Yalnız uzun listelerde kullanılır.

**Segmentli seçici:** 2–5 seçenekli her seçimde açılır liste yerine kullanılır.
```css
.seg { display: flex; gap: 2px; padding: 3px; border-radius: var(--r-2); background: var(--surface-3); }
.seg > button { flex: 1; height: 28px; padding: 0 10px; border: 0; border-radius: var(--r-1);
  background: transparent; color: var(--text-2); font-size: 13px; font-weight: 560; }
.seg > button.on { background: var(--surface); color: var(--text); box-shadow: var(--sh-1); }
```
Pratik yol: Gizli bir `<select hidden>` durumu tutar. JS onun seçeneklerinden düğmeleri üretir. Tıklanan
düğme `select.value`'yu ayarlar ve `input` olayını tetikler. Böylece hesap kodu yine `select.value` okur.
Bir düğmenin içinde `<sub>` varsa içerik `<span>`'a sarılır, yoksa flex alt indisi bozar.

**Düğme:** 30px yükseklik, `--r-1`, `1px solid var(--border-2)`, `background: var(--surface-2)`, 13px/560.
Basılıyken `transform: scale(.975)`. Açık/kapalı düğmede `aria-pressed="true"` olunca
`background: var(--accent-soft); color: var(--accent-text)`. İkon + kısa fiil kullanılır ("▶ Animate").

**Uyarı rozeti:** hap biçiminde, `background: var(--warn-soft); color: var(--warn-ink)`, ikon + kısa cümle.

**Ölçüm listesi:** `--surface-2` zeminli tek bir kutu. Satırlar arasında `1px` çizgi var. Solda etiket
(12.5px, `--text-2`), sağda değer (mono 13px, tabular-nums). Uzun değerler (açı listesi gibi) alt satıra geçer.

**İkonlar:** Lucide ikonları satır içi SVG olarak gömülür: `viewBox="0 0 24 24"`, `fill="none"`,
`stroke="currentColor"`, `stroke-width="1.75"`, yuvarlak uçlar. Boyut 14–16px.

---

## 5. (i) bilgi düğmesi: yazıyı ekrandan buraya taşı

- 18px yuvarlak, şeffaf bir düğmedir; içinde Lucide `info` ikonu, rengi `--text-3`. Üzerine gelince
  `--accent-soft` zemin ve `--accent-text` renk alır.
- Metin `data-tip` özniteliğinde durur (basit HTML olur: `<b>`, `<br>`, `<sub>`).
- Tek bir ortak ipucu balonu vardır: `position: fixed`, cam, en fazla `min(440px, 100vw - 24px)` genişlik,
  12.5px yazı, `--r-2`, `--sh-2`. Düğmenin altında açılır; altta yer yoksa üstte açılır; ekrandan taşmaz.
- **Davranış:** Fareyle üzerine gelince ya da klavyeyle odaklanınca açılır. Tıklanınca sabitlenir; bu
  dokunmatik ekran için gereklidir. Dışarı tıklayınca, Esc'ye basınca ya da sayfa kayınca kapanır.
- **Ne buraya girer:** formüller, yöntem açıklamaları, birim kuralları, örneğin hikâyesi, kaynak ve atıf.
  **Ne ekranda kalır:** başlık, etiket, değer ve kısa uyarı.

---

## 6. Grafikler (canvas)

- Renkler token'dan okunur. `getPropertyValue` `var()`/`calc()` içeren bir değeri çözmeyebilir; onun yerine
  bir **sonda öğesi** kullanılır:
  ```js
  function tokenColor(name) {
    const i = document.createElement('i'); i.style.display = 'none'; i.style.color = `var(${name})`;
    document.body.appendChild(i); const c = getComputedStyle(i).color; i.remove(); return c;
  }
  ```
- Eşleme: ana sinyal `--series-1` (mavi), referans/temel bileşen `--series-2` (turuncu), diğer fazlar
  `--series-3` ve `--series-7`, taşıyıcı `--text-faint`, ızgara `--border`, eksen yazısı `--text-3`,
  çerçeve `--border-2`.
- Yazı tipi `11px` + `--font-sans`. Çizimde `devicePixelRatio` hesaba katılır.
- Tema değişince (`MutationObserver` ile `data-theme`, ayrıca `prefers-color-scheme` değişimi) renkler yeniden
  okunur ve yeniden çizilir.
- Lejant, grafiğin sol üstünde yarı saydam `--surface` bir kutudadır. Üzerine gelince ipucu kutusu çıkar.

SVG şemalarda da ham renk yazılmaz: tel `--text-3`, iletken anahtar `--series-1`, açık anahtar `--text-faint`,
gerilim etiketi `--series-2`, düğüm adı `--text`.

---

## 7. Erişilebilirlik ve tercihler

```css
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) { .aura b { animation: none; } }
@media (prefers-reduced-transparency: reduce) {
  .aura { display: none; }
  .glass { background: var(--surface); background-image: none; border: 1px solid var(--border); backdrop-filter: none; }
}
```
İkon-only düğmelerin her birinde `aria-label` bulunur. Canvas'larda `role="img"` ve `aria-label` bulunur.

---

## 8. Teslim kontrol listesi

- [ ] **Tek `.html` dosyası.** Yanında başka dosya yok.
- [ ] Çift tıklayınca (`file://`) ve internet kapalıyken açılıyor.
- [ ] `src="`/`href="` ile yerel yol ya da `http` kaynağı kalmadı. Logo `data:` URI olarak gömülü.
- [ ] `type="module"` ve `import` yok.
- [ ] Bileşen CSS'inde ham renk yok; her şey token'dan geliyor.
- [ ] Sistem, açık ve koyu temanın üçü de doğru; grafikler temayla birlikte değişiyor.
- [ ] Ekranda uzun paragraf yok; açıklamalar (i)'de.
- [ ] 880px altında tek sütun, telefonda yatay kaydırma yok.
- [ ] Konsolda hata yok.
