# tools/ — data pipeline & daily update playbook

## Source of truth
`tools/idols.json` is the canonical idol dataset. Each entry:

```json
{ "name": "정연", "group": "TWICE", "agency": "JYP", "gender": "F", "dob": "1996-11-01" }
```

- `agency` must be one of: `HYBE`, `SM`, `YG`, `JYP`, `기타`
- `gender`: `M` or `F`
- `dob`: **solar (양력)** birthdate `YYYY-MM-DD`

## Build
```
node tools/build.js          # regenerate the IDOLS array in index.html
node tools/build.js --check  # validate only, never write
```
`build.js` computes each idol's day pillar from the birthdate **two independent
ways** (JDN formula + day-count from a known anchor) and **aborts on any
mismatch**, re-checks 6 anchor dates, rejects bad agency/gender/date, and skips
duplicate `name|group`. So a wrong birthdate can never silently ship.

## Add idols
1. Append objects to `tools/idols.json` (solar birthdates you can confidently source).
2. `node tools/build.js` — must print `errors: [] / computeMismatch: [] / anchorFails: []`.
3. Headless smoke test (see below), then commit.

## Headless smoke test
```
node - <<'EOF'
const { chromium } = require('/opt/node22/lib/node_modules/playwright/index.js');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p=await b.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+require('path').resolve('index.html'));
  await p.fill('#bdate','19950719'); await p.click('button.calc');
  await p.waitForSelector('#result:not(.hidden)',{timeout:5000});
  console.log('idols', await p.evaluate(()=>IDOLS.length), '| errors', errs.length?errs.join('|'):'none');
  await b.close(); if(errs.length) process.exit(1);
})();
EOF
```

---

## Daily automation playbook
A scheduled Routine runs once a day and performs **one** task, chosen by
`(UTC day-of-year) mod 3`:

- **0 → Task A · 소속사 세분화 (agency refinement).** Research (web) the real
  agency of groups currently in `기타` and add mid-size labels (스타쉽/Starship,
  큐브/Cube, RBW, KQ, IST, WM, Woollim, Fantagio, WakeOne …). Implement as a
  *sub-agency* layer so the existing HYBE/SM/YG/JYP/기타 buttons keep working —
  do NOT break the 5-bucket model; add finer grouping additively.
- **1 → Task B · 데이터 추가 (add idols).** Research 1–2 new groups, append to
  `tools/idols.json`, rebuild. Safest task; prefer this when unsure.
- **2 → Task C · 다국어 (i18n).** Overseas fandom support, **English first**,
  then other regions. If no i18n scaffolding exists yet, add a minimal, safe
  language switcher + English strings this run; otherwise extend translations
  incrementally. Geo/browser-language detection may pick the default language.

### Rules every run must follow
1. Work on branch `claude/idol-saju-matching-app-752fy3`. `git fetch` + `pull`
   first. If its PR was already merged, restart from the default branch.
2. Only include data you can confidently source. No fabricated birthdates.
3. `node tools/build.js` must pass; then run the headless smoke test.
4. **Commit & push only if both pass.** On any failure, do NOT push — stop and
   report what broke.
5. One small increment per day. Never duplicate existing groups/members.
