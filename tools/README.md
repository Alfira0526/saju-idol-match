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
  - **한국 아이돌을 우선 소진**한다. 더 추가할 한국 아이돌 그룹이 없으면(=미수록
    유명 그룹이 남지 않으면) **카테고리를 확장**한다: 일본 아이돌 → 중국 배우 →
    미국 배우 등. 카테고리 확장 시 각 항목에 `"cat"` 필드를 넣는다:
    - `cat`: `"K-idol"`(기본, 한국 아이돌) · `"J-idol"`(일본 아이돌) ·
      `"C-actor"`(중국 배우) · `"US-actor"`(미국 배우) · `"Character"`(캐릭터).
      새 카테고리가 필요하면 `index.html`의 `CAT_NAMES`/`CAT_ORDER`에 `{ko,en}` 추가.
    - 비(非)한국 카테고리는 `agency`가 5대 소속사일 필요 없이 **자유 하위 라벨**
      (예: 소속 그룹명·"미국 배우" 같은 버킷)이면 된다. `group`은 그룹명 또는
      개인명으로 둔다.
    - **노출 임계값(중요):** 각 카테고리는 데이터가 **30개 이상** 쌓여야 UI에
      노출된다(`CAT_MIN=30`). 그 전까지 해당 카테고리는 숨겨지고 검색에도 안
      잡히므로, **목표는 한 카테고리를 30개 이상까지 채우는 것**이다. 애매하게
      여러 카테고리를 조금씩 늘리지 말고 한 카테고리를 30 문턱까지 밀어붙인다.
    - **캐릭터(Character)**: 사주는 '연도 포함 생일'이 필요하다. 애니/게임 캐릭터는
      월·일만 있고 연도가 없는 경우가 많으니, **연도까지 확정된** 캐릭터(예:
      보컬로이드 릴리스일)만 넣고 나머지는 건너뛴다.
    - 배우 등 연령대가 넓을 수 있으니 확실한 **양력 생일**만 넣는다(범위 1940~2015).
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
