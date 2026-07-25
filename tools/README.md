# tools/ — data pipeline & daily update playbook

> 프로젝트 개요는 루트 [`README.md`](../README.md), 점수 이론은
> [`docs/SCORING.md`](../docs/SCORING.md), 데이터셋 상세는
> [`docs/DATA.md`](../docs/DATA.md) 를 참고하세요.

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

### 밴드 분류 (band classification) — `tools/bands.json`
앱의 **‘🎸 밴드만’ 필터**는 `tools/bands.json`(밴드 그룹명 배열)을 씁니다. build.js가 이 목록을
`index.html`의 `const BAND_GROUPS = new Set([...])` 에 주입합니다.
- **추가하는 그룹이 밴드(멤버가 악기를 직접 연주하는 록/팝록 밴드)면** 그룹명을 `bands.json`에
  **정확히 idols.json의 `group`과 똑같이** 넣는다(예: `"DAY6"`, `"Xdinary Heroes"`, `"QWER"`, `"Dragon Pony"`).
- **판단 기준(엄격):** 무대에서 악기를 연주하는 밴드만. **댄스·보컬 아이돌 그룹은 제외.**
  자작곡을 하는 싱어송라이터 듀오(예: AKMU)도 ‘밴드’ 아님 → 제외. **애매하면 넣지 않는다.**
- `build.js`가 `bands.notInData`(bands.json엔 있으나 idols.json엔 없는 그룹)를 리포트한다 —
  오타·미수록을 잡는 용도. 비어 있어야 정상.

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
      `"C-actor"`(중국 배우) · `"US-actor"`(미국 배우) · `"Etc"`(기타, 위 어디에도
      안 맞는 실존 인물의 임시 수집 버킷).
      새 카테고리가 필요하면 `index.html`의 `CAT_NAMES`/`CAT_ORDER`에 `{ko,en}` 추가.
    - **`Etc`(기타) 승격 규칙:** 어느 카테고리에도 딱 맞지 않는 제보·데이터는
      일단 `Etc`로 모은다. `Etc` 안에서 **일관된 하위 유형이 충분히(≈CAT_MIN=30 근처)
      쌓이면** 그 유형을 **독립 카테고리로 승격**한다(예: 태국 배우가 30명 → `"TH-actor"`
      신설). 이는 소속사 `기타`를 세분화하는 방식(Task A)을 카테고리 층에서 똑같이
      적용하는 것이다. 승격 시 해당 항목들의 `cat`을 새 값으로 바꾸고 `CAT_NAMES`/
      `CAT_ORDER`에 추가한다.
    - 비(非)한국 카테고리는 `agency`가 5대 소속사일 필요 없이 **자유 하위 라벨**
      (예: 소속 그룹명·"미국 배우" 같은 버킷)이면 된다. `group`은 그룹명 또는
      개인명으로 둔다.
    - **노출 임계값(중요):** 각 카테고리는 데이터가 **30개 이상** 쌓여야 UI에
      노출된다(`CAT_MIN=30`). 그 전까지 해당 카테고리는 숨겨지고 검색에도 안
      잡히므로, **목표는 한 카테고리를 30개 이상까지 채우는 것**이다. 애매하게
      여러 카테고리를 조금씩 늘리지 말고 한 카테고리를 30 문턱까지 밀어붙인다.
    - **캐릭터(가상 인물)는 제외한다.** 사주는 '연도 포함 생일'이 필요한데
      애니/게임 캐릭터는 대개 월·일만 있고 출생 연도가 없어 일주를 계산할 수
      없다. 실존 인물만 추가한다.
    - 배우 등 연령대가 넓을 수 있으니 확실한 **양력 생일**만 넣는다(범위 1940~2015).
- **2 → Task C · 다국어 (i18n).** 해외 팬덤 지원, **영어 먼저**.
  **진행은 반드시 [`tools/i18n-plan.md`](./i18n-plan.md)를 따른다** — 그 파일의 체크리스트에서
  미완료(`[ ]`) 청크 맨 위 1개를 이번 실행에 처리하고 `[x]`로 표시·커밋한다.
  - **중요(우선 모드):** `i18n-plan.md`의 **P1이 아직 안 끝났으면**(P1에 `[ ]`가 남아 있으면),
    제보/오류 처리 다음으로 **요일 순환(A/B/C)보다 i18n을 우선**해 매일 i18n 청크를 수행한다.
    P1·P2가 모두 끝나면 우선 모드를 풀고 요일 순환으로 복귀한다(자세한 규칙은 그 파일 참고).
  - **줄바꿈·가독성 유의(중요).** 번역할 때 문장이 어색하게 끊기지 않게 한다.
    - 언어별 자연스러운 줄바꿈 규칙을 쓴다: **CJK(한·중·일)는 `word-break:keep-all`**
      (어절 단위 줄바꿈), 라틴 계열은 단어 단위 기본값. 지금 상단 소개문(`.sub`)이
      이 방식으로 되어 있으니 참고.
    - **고유어구·수치·따옴표 구절**(예: 그룹 수·인원, 'OO' 같은 강조구)은 줄 사이에서
      쪼개지지 않게 `.nowrap`(`white-space:nowrap`)으로 묶는다. 번역문에서도 대응 어구를
      똑같이 묶는다.
    - **하드코딩된 `<br>` 남용 금지.** 특정 언어·화면 폭에서 어색해진다. 꼭 필요한 곳만
      쓰고 나머지는 CSS 줄바꿈에 맡긴다. 기존 `<br>` 위치가 번역 언어에서 어색하면 조정한다.
    - 번역문이 길어져 **버튼·배지·카드가 넘치거나 잘리지 않는지** 헤드리스로 확인한다
      (특히 CTA·성별 버튼·소속사 버튼).

### 제보 우선 반영 (suggestion priority) — 매일 Task B 전에 확인

> **제보의 소스 = 저장소 파일(로컬).** 워커가 접수한 제보를 GitHub에 미러링해 두므로
> **루틴은 워커에 접속하지 않는다.** `git pull` 후 아래 파일을 **로컬로 읽는다**(egress 불필요):
> - `tools/inbox.json` — 추가 제보(add) 목록. 각 항목 `{key, name, group, cat, gender, dob, note, count, status, …}`
> - `tools/error-inbox.json` — 오류 제보(error) 목록. 각 항목 `{key, name, group, fields:{필드:표수}, suggests:[…], notes:[…], count, status, …}`
> - `tools/inbox-done.json` — **루틴이 처리 완료한 key 목록**(이 파일만 루틴이 쓴다). 여기 든 key는 건너뛴다.
>
> **웹 조사·검증은 `WebSearch` 툴을 쓴다**(이 환경에서 `WebFetch`/`curl`로 임의 사이트 접속은
> 차단될 수 있으나 `WebSearch`(호스티드)는 동작). 생일·멤버·오류 교차검증은 WebSearch로 한다.
> egress를 우회하려 하지 말 것(정책 위반).

처리 우선순위: **오류 제보(error-inbox) → 추가 제보(inbox) → 그날의 요일 태스크(A/B/C)**.
`inbox-done.json`에 이미 있는 key는 처리 완료로 보고 건너뛴다. 처리한 key는 `inbox-done.json`에
추가하고(루틴 커밋에 포함), 데이터·stats 변경과 함께 push 한다. 두 inbox 파일은 **워커가 쓰므로
루틴은 읽기만** 한다(경쟁 방지). 파일이 없거나 비었으면(`[]`) 제보 없음으로 보고 요일 태스크 수행.

#### 오류 제보 처리 (error queue) — 가장 먼저
`tools/error-inbox.json`을 로컬로 읽는다(`inbox-done.json`에 있는 key는 제외).
각 레코드는 `{key, name, group, fields:{필드:표수}, suggests:[제안값…], notes:[근거…], count}`.
1. **표수(count·fields) 높은 순**으로 트리아지한다(동일 오류를 여러 명이 신고 = 신빙성↑).
2. 신고 대상(`name|group`)을 `tools/idols.json`에서 찾아 **원본 값과 대조**한다.
3. **반드시 웹으로 교차검증**한다. 신고자의 `suggests`(제안값)는 **참고일 뿐 그대로 신뢰하지
   않는다**(악의적/장난 신고 가능). 공식 프로필 등 **독립 출처로 올바른 값을 확인**한 경우에만 수정.
   - 확인 결과 **원본이 맞으면**(오신고) 수정하지 말고, 그 `key`를 `inbox-done.json`에 넣어 정리한다.
   - 확인 못 하면 **수정하지 말고 `inbox-done`에 넣지 않는다**(다음 날 재시도).
4. 검증된 수정만 `idols.json`에 반영(생일/활동명/그룹/성별 정정, 비실존·중복이면 삭제)
   → `node tools/build.js` → 헤드리스 스모크. **자동 수정 금지: 사람 판단 없이 값을 바꾸지 않는다.**
   - 참고: **범위·중복·계산 오류는 헬스체크 루틴**이 잡는다. 오류 제보는 **사실 오류**(잘못된
     생일·이름·소속 등 웹 확인이 필요한 것)를 담당한다.
5. 반영/오신고 정리한 항목의 `key`를 **`tools/inbox-done.json`에 추가**한다(루틴 커밋에 포함).
6. 데이터가 바뀌었으면 `tools/stats.json`을 갱신한다(total은 실제 수와 일치). 정정은 총원이
   그대로일 수 있으니 total은 항상 `idols.json` 길이로 재계산한다.

#### 추가 제보 처리 (add queue)

1. `tools/inbox.json`을 로컬로 읽는다(`inbox-done.json`에 있는 key는 제외). **요청 횟수(count)
   많은 순**으로 처리한다. 비었으면(`[]`) 이 단계를 건너뛰고 평소 태스크를 수행한다.
2. 각 제보에 대해 — **제보된 개인만이 아니라 그 사람이 속한 그룹 전체를 추가한다:**
   - 제보 대상의 **소속 그룹을 식별**하고, 웹으로 **그룹 멤버 전원**(현재 활동 라인업)을
     조사한다. **확실한 양력 생일이 확인되는 멤버를 모두** `idols.json`에 추가한다
     (제보된 그 한 명만 넣지 않는다).
   - **솔로 가수·배우·비그룹**(group이 개인명이거나 그룹 개념이 없으면) 그 사람만 추가한다.
   - `idols.json` 에 **이미 있는 멤버는 건너뛰고**(이름|그룹 중복), **빠진 멤버만** 채운다.
     그룹의 모든 멤버가 이미 있으면 추가 없이 그 제보 key를 `inbox-done.json`에 넣어 정리만 한다.
   - 각 멤버의 생일은 **개별로 교차 확인**한다. 제보의 `dob` 는 참고용일 뿐 **그대로 신뢰하지
     않는다**(오타·장난 가능). 확인 안 되는 멤버는 건너뛰고 다음 기회에(대형·프로젝트 그룹도
     **확실한 멤버만**). 제보 대상 본인조차 확인 못 하면 반영하지 않고 `pending` 유지.
   - 캐릭터(가상 인물)·연도 없는 생일은 제외.
   - 카테고리 배정: K/J/C/US 어디에도 안 맞으면 `cat:"Etc"`(기타)로 넣는다.
     `Etc`에 같은 유형이 30명 가까이 쌓이면 위의 *승격 규칙*대로 독립 카테고리로 뺀다.
3. 확인된 항목만 `tools/idols.json` 에 추가 → `node tools/build.js` → 헤드리스
   스모크 테스트. **자동 커밋 금지**: 빌드·테스트 통과가 반영의 전제.
4. **`tools/stats.json` 갱신**(배너 숫자 + 게임 시작 팝업 공지의 소스):
   ```json
   {
     "total": <idols.json 총 인원 수>,
     "addedRecent": [
       { "date": "YYYY-MM-DD", "text": "<그룹/인물> 추가", "count": <이번에 추가한 수> }
     ],
     "updatedAt": "YYYY-MM-DD"
   }
   ```
   - `total` 은 실제 `idols.json` 길이와 **정확히 일치**시킨다(과장 금지).
   - `addedRecent` 앞쪽에 오늘 항목을 **prepend**한다. 앱 팝업은 **최근 3일치만**
     노출하므로 4일보다 오래된 항목은 정리해도 된다(선택).
   - `text` 는 팝업에 그대로 뜬다(토스 기획자 톤, 담백하게). 예: `"엑스디너리히어로즈 추가"`.
   - 날짜(UTC 실행 기준)를 코드로 만들지 말고, 세션에서 실제 오늘 날짜를 확인해 넣는다.
5. 반영(또는 이미 존재)한 제보 `key`를 **`tools/inbox-done.json`에 추가**한다(루틴 커밋에 포함).
   `inbox-done.json`에 든 key는 다음 실행부터 건너뛴다(재처리 방지). 워커 `/mark` 호출은 불필요
   (egress 차단 환경). idols.json 중복 검사와 inbox-done로 재추가는 원천 차단된다.

> 워커 URL/토큰이 아직 설정되지 않았다면(사용자가 배포 전) 제보 단계는 전부
> 건너뛰고 `addedRecent` 만 평소 추가분으로 채운다. 인테이크 배포는
> [`worker/README.md`](../worker/README.md) 참고.

### Rules every run must follow
1. Work on branch `claude/idol-saju-matching-app-752fy3`. `git fetch` + `pull`
   first. If its PR was already merged, restart from the default branch.
2. Only include data you can confidently source. No fabricated birthdates.
3. `node tools/build.js` must pass; then run the headless smoke test.
4. **Commit & push only if both pass.** On any failure, do NOT push — stop and
   report what broke.
5. One small increment per day. Never duplicate existing groups/members.
6. 제보(`tools/inbox.json`·`tools/error-inbox.json`, 로컬 파일)가 있으면 일반 후보보다
   **먼저** 처리하고, 반영분은 `stats.json` 과 `tools/inbox-done.json` 에 반드시
   기록한다(위 *제보 우선 반영*). 워커에는 접속하지 않는다(egress 차단).
