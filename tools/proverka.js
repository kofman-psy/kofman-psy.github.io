// Заготовка проверки теста в браузере (Playwright, Chromium из облачной сессии).
//
// Общие проверки одной командой:
//   NODE_PATH=$(npm root -g) node tools/proverka.js <папка>        # главная: node tools/proverka.js .
// Прохождение теста пишется под конкретный тест отдельным скриптом ВНЕ репозитория:
//   const P = require('/home/user/kofman-psy.github.io/tools/proverka.js');
//   const srv = await P.serve(REPO); const browser = await P.launch();
//   const {page, errors, external} = await P.phone(browser, {share: 'ok'});
//   await page.goto(srv.url + '/otnosheniya/');  ...  await P.settle(page); await P.inView(page, '#next');
//   console.log(await page.evaluate(() => window.__shared));
//
// Режимы «Поделиться» (opts.share): 'ok' — системное окно, аргументы в window.__shared;
// 'abort' — человек закрыл окно (AbortError); 'error' — окно упало другой ошибкой;
// 'none' — navigator.share нет. opts.clipboard: true — копирование работает (текст в window.__copied),
// false — копирование запрещено. Без share и буфера тест должен показать поле с текстом.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SITE = 'https://kofman-psy.github.io';
const REPO = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };

// Локальный сервер на свободном порту. Открывать через него, не file:// — там location.origin пустой
// и ссылка в «Поделиться» выходит битой.
function serve(root = REPO) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(root, p);
      if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
        if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }); return res.end(); }
        f = path.join(f, 'index.html');
      }
      fs.readFile(f, (e, data) => {
        if (e) { res.writeHead(404); return res.end('404'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
  });
}

const launch = () => chromium.launch();

// Телефон как встроенный браузер Инстаграма на iPhone: 390×664.
async function phone(browser, opts = {}) {
  const { share = 'none', clipboard = false } = opts;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await ctx.addInitScript(([share, clipboard]) => {
    const def = (k, v) => Object.defineProperty(Navigator.prototype, k, { configurable: true, get: () => v });
    if (share === 'none') def('share', undefined);
    else def('share', async d => {
      window.__shared = d;
      if (share === 'abort') throw new DOMException('closed', 'AbortError');
      if (share === 'error') throw new DOMException('failed', 'NotAllowedError');
    });
    def('clipboard', { writeText: async t => { if (!clipboard) throw new DOMException('denied', 'NotAllowedError'); window.__copied = t; } });
  }, [share, clipboard]);
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // Всё, что не с локального сервера, обрываем: тест обязан работать без внешних подключений.
  await page.route(u => !/^(https?:\/\/127\.0\.0\.1[:/]|data:|blob:|about:)/.test(u.href), r => { external.push(r.request().url()); r.abort(); });
  return { ctx, page, errors, external };
}

// Дождаться конца плавной прокрутки: три одинаковых замера scrollY подряд.
async function settle(page, maxMs = 1500) {
  await page.waitForTimeout(200);
  let last = -1, same = 0;
  for (let t = 0; t < maxMs && same < 3; t += 100) {
    const y = await page.evaluate(() => window.scrollY);
    same = y === last ? same + 1 : 0; last = y;
    await page.waitForTimeout(100);
  }
}

// Элемент целиком в кадре, с допуском 1 px (координаты дробные, прокрутка целочисленная).
function inView(page, selector) {
  return page.$eval(selector, e => { const r = e.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1 && r.height > 0; });
}

// Общие проверки страницы теста: ошибки, внешние запросы, og-теги, картинки, ширина.
async function basics(folder) {
  const dir = path.join(REPO, folder);
  const slug = path.relative(REPO, dir).split(path.sep).join('/');
  const expected = SITE + '/' + (slug ? slug + '/' : '');
  const srv = await serve(REPO), browser = await launch();
  const { page, errors, external } = await phone(browser);
  const res = await page.goto(srv.url + '/' + (slug ? slug + '/' : ''));
  await page.waitForLoadState('networkidle');
  const out = [];
  const ok = (name, pass, detail = '') => out.push({ name, pass, detail });
  ok('страница отдаётся', res && res.status() === 200, String(res && res.status()));
  const meta = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property],meta[name]')]
    .map(m => [m.getAttribute('property') || m.getAttribute('name'), m.content])));
  ok('og:url = адрес папки', meta['og:url'] === expected, meta['og:url'] || 'нет');
  const img = meta['og:image'] || '';
  ok('og:image — полный адрес в этой папке', img.startsWith(expected), img || 'нет');
  for (const k of ['og:title', 'og:description', 'og:type', 'twitter:card', 'description'])
    ok(k, !!meta[k], meta[k] || 'нет');
  ok('og:image:width/height = 1200/630', meta['og:image:width'] === '1200' && meta['og:image:height'] === '630');
  if (img.startsWith(SITE)) {
    const local = path.join(REPO, img.slice(SITE.length).split('?')[0]);
    if (fs.existsSync(local)) {
      const kb = fs.statSync(local).size / 1024;
      const dims = await page.evaluate(async u => { const i = new Image(); i.src = u; await i.decode(); return [i.naturalWidth, i.naturalHeight]; },
        srv.url + img.slice(SITE.length));
      ok('картинка превью 1200×630', dims[0] === 1200 && dims[1] === 630, dims.join('×'));
      ok('картинка превью < 300 КБ (WhatsApp)', kb < 300, kb.toFixed(0) + ' КБ');
    } else ok('файл картинки превью есть', false, local);
  }
  const icon = await page.$eval('link[rel~=icon]', l => l.getAttribute('href')).catch(() => null);
  ok('иконка вкладки', !!icon, icon || 'нет');
  if (slug) {
    const up = await page.evaluate(() => [...document.querySelectorAll('[src],[href]')].map(e => e.getAttribute('src') || e.getAttribute('href')).filter(u => u && u.startsWith('../')));
    ok('нет ссылок на файлы вне папки (../)', up.length === 0, up.join(', '));
  }
  const broken = await page.$$eval('img', a => a.filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute('src')));
  ok('все картинки загрузились', broken.length === 0, broken.join(', '));
  const b64 = (fs.readFileSync(path.join(dir, 'index.html'), 'utf8').match(/data:image\/[a-z+]+;base64,/g) || []).length;
  ok('нет вшитых base64-картинок', b64 === 0, b64 ? b64 + ' шт.' : '');
  ok('нет горизонтальной прокрутки', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok('нет внешних подключений', external.length === 0, external.join(', '));
  ok('нет ошибок в консоли', errors.length === 0, errors.join(' | '));
  const shot = path.join(require('os').tmpdir(), `proverka-${(slug || 'root').replace(/\W/g, '_')}-first.png`);
  await page.screenshot({ path: shot });
  await browser.close(); srv.close();
  for (const r of out) console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  console.log('Скриншот первого экрана: ' + shot);
  return out.every(r => r.pass);
}

module.exports = { SITE, REPO, serve, launch, phone, settle, inView, basics };

if (require.main === module) {
  const folder = process.argv[2];
  if (!folder) { console.error('Укажи папку теста: node tools/proverka.js otnosheniya  (главная: .)'); process.exit(2); }
  basics(folder).then(okAll => process.exit(okAll ? 0 : 1), e => { console.error(e); process.exit(1); });
}
