// Headless test for the /search vector search.
// Uses puppeteer-core driving the system-installed Chrome.

import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:3000/search';
const READY_TIMEOUT = 90000;

const log = (...args) => console.log('[test]', ...args);

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning' || msg.text().includes('vector-search')) {
      console.log(`[browser:${t}]`, msg.text());
    }
  });
  page.on('pageerror', (err) => console.log('[browser:pageerror]', err.message));
  page.on('requestfailed', (req) =>
    console.log('[browser:requestfailed]', req.url(), req.failure()?.errorText)
  );

  log('navigating to', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  log('navigation done; waiting for the body-level bar...');

  // Wait for the bar to be appended to body.
  await page.waitForSelector('#vsearch-host', { timeout: READY_TIMEOUT });
  const exists = await page.$('#vsearch-host');
  log('#vsearch-host present:', !!exists);

  // Read the bar's bounding rect.
  const rect = await page.evaluate(() => {
    const el = document.getElementById('vsearch-host');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
  log('bar rect:', rect);

  // Confirm bar is in viewport.
  const viewport = await page.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
    scrollY: window.scrollY,
  }));
  log('viewport:', viewport);

  const inViewport =
    rect && rect.top >= 0 && rect.left >= 0 && rect.right <= viewport.w && rect.bottom <= viewport.h;
  log('bar fully in viewport (initial):', inViewport);

  // Wait until the input is enabled (model + index loaded).
  log('waiting for input to become enabled (status: chunks indexed)...');
  await page.waitForFunction(
    () => {
      const i = document.querySelector('#vsearch-host input');
      return i && !i.disabled;
    },
    { timeout: READY_TIMEOUT }
  );
  log('input is enabled');

  // Read status text.
  const statusBefore = await page.evaluate(() => {
    const s = document.querySelector('#vsearch-host .vs-status');
    return s ? s.textContent : null;
  });
  log('status before query:', statusBefore);

  // Type a query.
  const query = 'wave bump checklist';
  log('typing query:', query);
  await page.focus('#vsearch-host input');
  await page.keyboard.type(query, { delay: 30 });

  // Wait for results to render — look for the result list <ol> or 'results' status.
  log('waiting for results to render...');
  await page.waitForFunction(
    () => {
      const s = document.querySelector('#vsearch-host .vs-status');
      const txt = s ? s.textContent : '';
      return /\d+ result/.test(txt);
    },
    { timeout: 30000 }
  );

  const statusAfter = await page.evaluate(() => {
    const s = document.querySelector('#vsearch-host .vs-status');
    return s ? s.textContent : null;
  });
  log('status after query:', statusAfter);

  // Re-check bar visibility AFTER results rendered.
  const rectAfter = await page.evaluate(() => {
    const el = document.getElementById('vsearch-host');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
  const valueAfter = await page.evaluate(() => {
    const i = document.querySelector('#vsearch-host input');
    return i ? i.value : null;
  });
  log('bar rect AFTER results:', rectAfter);
  log('input value AFTER results:', valueAfter);

  const visibleAfter = !!(rectAfter && rectAfter.width > 0 && rectAfter.height > 0 && rectAfter.top + rectAfter.height > 0 && rectAfter.top < viewport.h);
  log('bar visible AFTER results:', visibleAfter);

  // Check computed style — is anything hiding it?
  const styles = await page.evaluate(() => {
    const el = document.getElementById('vsearch-host');
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      position: s.position,
      top: s.top,
      left: s.left,
      zIndex: s.zIndex,
      transform: s.transform,
    };
  });
  log('bar computed styles:', styles);

  // Count result cards (now rendered into body-level #vsearch-results, no <ol>).
  const resultsCount = await page.evaluate(() => {
    const host = document.getElementById('vsearch-results');
    return host ? host.querySelectorAll('a').length : 0;
  });
  log('results list count:', resultsCount);

  // Sanity check: results host is also fully visible.
  const resultsRect = await page.evaluate(() => {
    const el = document.getElementById('vsearch-results');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  });
  log('results host rect:', resultsRect);

  // Type a second query and verify the results refresh and bar still visible.
  log('clearing query and typing second one...');
  await page.evaluate(() => {
    const i = document.querySelector('#vsearch-host input');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 250));
  await page.focus('#vsearch-host input');
  await page.keyboard.type('design tokens linear', { delay: 25 });
  await page.waitForFunction(() => {
    const s = document.querySelector('#vsearch-host .vs-status');
    return s && /\d+ result/.test(s.textContent);
  }, { timeout: 30000 });
  const second = await page.evaluate(() => {
    const host = document.getElementById('vsearch-results');
    const cards = host ? Array.from(host.querySelectorAll('a')) : [];
    return cards.slice(0, 3).map((a) => a.getAttribute('href'));
  });
  log('top 3 second-query result hrefs:', second);
  const barStillVisible = await page.evaluate(() => {
    const el = document.getElementById('vsearch-host');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight;
  });
  log('bar visible after second query:', barStillVisible);

  // Overlay should be visible while results are showing.
  const overlayVisible = await page.evaluate(() => {
    const el = document.getElementById('vsearch-overlay');
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.opacity !== '0' && cs.pointerEvents !== 'none';
  });
  log('focus-mode overlay visible during search:', overlayVisible);

  // Click overlay should dismiss + clear query.
  log('clicking overlay to dismiss...');
  await page.evaluate(() => {
    const el = document.getElementById('vsearch-overlay');
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 250));
  const afterDismiss = await page.evaluate(() => {
    const el = document.getElementById('vsearch-overlay');
    const i = document.querySelector('#vsearch-host input');
    return {
      overlayHidden: el ? getComputedStyle(el).opacity === '0' : true,
      inputCleared: i ? i.value === '' : false,
    };
  });
  log('after overlay dismiss:', afterDismiss);

  // Take a screenshot for visual confirmation.
  const shotPath = 'C:/Users/Admin/AppData/Local/Temp/vsearch-after.png';
  await page.screenshot({ path: shotPath, fullPage: false });
  log('screenshot:', shotPath);

  await browser.close();

  // Final verdict.
  const checks = {
    barExists: !!exists,
    barInitialVisible: rect && rect.height > 0,
    barVisibleAfterFirstQuery: visibleAfter,
    inputValuePersisted: valueAfter === query,
    resultsRendered: resultsCount > 0,
    barVisibleAfterSecondQuery: barStillVisible,
    secondQueryHasResults: second.length > 0,
    overlayVisibleDuringSearch: overlayVisible,
    overlayHiddenAfterDismiss: afterDismiss.overlayHidden,
    inputClearedAfterDismiss: afterDismiss.inputCleared,
  };
  log('checks:', checks);
  const ok = Object.values(checks).every(Boolean);
  log('VERDICT:', ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[test] FAILED');
  console.error(err);
  process.exit(2);
});
