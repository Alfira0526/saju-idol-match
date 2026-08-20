// i18n P4 QA — KO/EN/JA/ZH × 모바일/데스크톱 회귀 스윕.
// stats.json fetch가 file://에선 CORS로 막히므로 로컬 HTTP로 띄운 뒤 실행한다:
//   python3 -m http.server 8777 --bind 127.0.0.1 &
//   node tools/i18n-qa.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright/index.js');

const BASE = process.env.QA_URL || 'http://127.0.0.1:8777/index.html';
const LANGS = ['ko', 'en', 'ja', 'zh'];
const VIEWPORTS = [
  { name: 'mobile390', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const problems = [];
  let checks = 0;

  for (const vp of VIEWPORTS) {
    for (const lang of LANGS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const vpWidth = vp.width;
      const errs = [];
      page.on('pageerror', e => errs.push(`${vp.name}/${lang}: ${e.message}`));
      page.on('console', m => { const x = m.text();
        if (m.type() === 'error' && !/net::ERR_|Failed to load resource|CORS policy/.test(x)) errs.push(`${vp.name}/${lang} console: ${x}`); });

      await page.goto(BASE);
      await page.waitForTimeout(600);   // stats.json 토스트 로드 대기
      await page.evaluate(l => setLang(l), lang);

      // 계산 실행
      await page.fill('#bdate', '19950719');
      await page.click('button.calc');
      await page.waitForSelector('#result:not(.hidden)', { timeout: 5000 });
      // 전체 펼치기
      try { await page.click('#moreBtn', { timeout: 1500 }); } catch (e) {}

      // 1) 미번역 누출: 빈 문자열 / undefined / null 텍스트
      const leaks = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-ph]').forEach(el => {
          const key = el.getAttribute('data-i18n') || el.getAttribute('data-i18n-html');
          const txt = el.getAttribute('data-i18n-ph') ? el.getAttribute('placeholder') : el.textContent;
          if (txt == null || !String(txt).trim() || /undefined|null|\[object/.test(String(txt))) {
            bad.push((key || el.getAttribute('data-i18n-ph')) + ' => ' + JSON.stringify(txt));
          }
        });
        return bad;
      });
      leaks.forEach(l => problems.push(`${vp.name}/${lang} i18n-leak: ${l}`));

      // 2) 가로 오버플로: 문서 전체
      const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (docOverflow > 1) problems.push(`${vp.name}/${lang} page overflows by ${docOverflow}px`);

      // 3) 버튼·배지·카드 잘림/넘침
      const clipped = await page.evaluate(() => {
        const sel = 'button, .badge, .tab, .chip, .card, .agency-btn, .cat-btn, .lang-switch button';
        const out = [];
        document.querySelectorAll(sel).forEach(el => {
          if (!el.offsetParent && el.offsetWidth === 0) return;      // 숨김
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.right > window.innerWidth + 1 || r.left < -1) {
            out.push(`offscreen ${el.tagName}.${el.className} "${(el.textContent || '').trim().slice(0, 24)}"`);
          }
          // 내용이 박스보다 큰 경우(잘림)
          if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'auto' && getComputedStyle(el).overflowX !== 'scroll') {
            out.push(`clipped ${el.tagName}.${el.className} "${(el.textContent || '').trim().slice(0, 24)}" ${el.scrollWidth}>${el.clientWidth}`);
          }
        });
        return [...new Set(out)];
      });
      clipped.forEach(c => problems.push(`${vp.name}/${lang} ${c}`));

      // 4) 모달 열림/닫힘 + 각 언어 렌더
      const target = await page.evaluate(() =>
        `openError('${encodeURIComponent(IDOLS[0][0])}','${encodeURIComponent(IDOLS[0][1])}')`);
      for (const [openFn, modalId] of [['openSuggest()', 'suggestModal'], [target, 'errorModal']]) {
        try { await page.evaluate(fn => eval(fn), openFn); } catch (e) { problems.push(`${vp.name}/${lang} ${modalId} open threw: ${e.message}`); continue; }
        const vis = await page.evaluate(id => { const m = document.getElementById(id); return m && !m.classList.contains('hidden'); }, modalId);
        if (!vis) problems.push(`${vp.name}/${lang} modal ${modalId} did not open`);
        const mo = await page.evaluate(id => {
          const m = document.getElementById(id);
          if (!m) return 0;
          return m.scrollWidth - m.clientWidth;
        }, modalId);
        if (mo > 1) problems.push(`${vp.name}/${lang} modal ${modalId} overflows by ${mo}px`);
        await page.keyboard.press('Escape');
        await page.evaluate(id => { const m = document.getElementById(id); if (m) m.classList.add('hidden'); }, modalId);
      }

      // 5) 공유 캡션 문자열
      const cap = await page.evaluate(() => {
        try { return typeof dt === 'function' ? dt('shareCaption') : null; } catch (e) { return 'ERR:' + e.message; }
      });
      if (cap && (/undefined|\[object/.test(cap) || cap.startsWith('ERR:'))) {
        problems.push(`${vp.name}/${lang} shareCaption: ${cap.slice(0, 120)}`);
      }

      // 6) 업데이트 토스트(stats.json) 문구·오버플로
      const toast = await page.evaluate(() => {
        const el = document.querySelector('#updateToast');
        if (!el) return null;
        return { txt: (el.textContent || '').trim(), ov: el.scrollWidth - el.clientWidth, w: el.getBoundingClientRect().right };
      });
      if (toast) {
        if (/undefined|\[object|NaN/.test(toast.txt)) problems.push(`${vp.name}/${lang} toast text: ${toast.txt.slice(0, 100)}`);
        if (toast.ov > 1) problems.push(`${vp.name}/${lang} toast overflows by ${toast.ov}px`);
        if (toast.w > vpWidth + 1) problems.push(`${vp.name}/${lang} toast offscreen right ${toast.w}`);
      }

      const idolCount = await page.evaluate(() => IDOLS.length);
      if (!idolCount) problems.push(`${vp.name}/${lang} IDOLS empty`);
      errs.forEach(e => problems.push(e));
      checks++;
      await ctx.close();
    }
  }

  await browser.close();
  console.log(`ran ${checks} lang x viewport combos`);
  if (problems.length) {
    console.log('PROBLEMS (' + problems.length + '):');
    problems.forEach(p => console.log(' - ' + p));
    process.exit(1);
  }
  console.log('i18n P4 QA: OK (no JS errors, no overflow, no untranslated leaks)');
})();
