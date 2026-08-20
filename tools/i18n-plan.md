# i18n(다국어) 작업 계획

## 목표 & 순서 (2026-07-30 재우선순위)
**① 영어 정적 UI(P1) → ② 일본어(JA)로 우선순위 상향 → ③ 영어 동적(P2) → ④ 중국어(ZH)**.
> **변경 사유(사용자 요청 2026-07-30):** 일본어 수요가 높아 **P3의 일본어를 앞으로 당김**.
> EN 정적 UI(P1-2~P1-6 대부분)가 끝났으므로, **다음은 EN 동적(P2)보다 JA 정적 UI(P1의 ja 키
> 채우기 + 스위처에 JA 추가)를 먼저** 진행한다. 각 언어 미번역 문자열은 **KO 폴백**.

## 진행 규칙 — 루틴이 매 실행 시
> **일정 방침(팀장 판정 2026-07-25):** i18n은 **'매일 최우선'이 아니라 요일 순환의 Task C**로
> 진행한다(강등). 안정화·QA 안전망을 먼저 깔고, **각 청크는 KO 폴백을 보장해 중간 상태에서도
> 화면이 안 깨지도록**(완결 단위) 만든다.

1. **제보/오류 처리(최우선)** 를 먼저 한다.
2. i18n은 **요일 태스크가 Task C(=`date -u +%j` mod 3 == 2)일 때** 수행한다. 아래 체크리스트에서
   **`[ ]` 미완료 청크 중 맨 위 1개**만 처리한다(1청크/회).
3. **KO 폴백 필수:** `t(key)`는 해당 언어 문자열이 없으면 **KO로 폴백**한다. 그래서 번역이 덜 돼도
   기본(KO) 화면은 항상 정상이고, EN 전환 시 미번역만 KO로 보인다(빈 문자열/`undefined` 금지).
4. 완료하면 그 줄을 `[x]`로 바꾸고 커밋한다. **push 전 [`qa-checklist.md`](./qa-checklist.md)의
   해당 항목(코어 플로우·모바일 오버플로·KO 무결성·i18n)을 통과**해야 한다.
5. **P1·P2가 모두 `[x]`** 가 되면 추가 언어(P3)로. 진행 상태의 단일 소스는 이 파일이다.

## 기술 방식 (P1-0에서 확정)
- `TR` 사전: `TR[key] = { ko, en, ... }`. 요소에 `data-i18n="key"`(텍스트)·`data-i18n-ph="key"`(placeholder).
- JS 동적 문자열은 `t(key)`로 조회. `lang` 상태는 `localStorage.lang`, 없으면 `navigator.language`로
  감지(영어권이면 `en`, 그 외 `ko`). 상단에 **언어 스위처(KO/EN)** 버튼.
- `applyLang()`이 `[data-i18n]`/`[data-i18n-ph]`를 순회해 현재 언어로 교체. 언어 변경 시 재렌더 필요한
  동적 영역(순위 카드 등)은 다시 그린다.
- 하드코딩 `<br>` 최소화. 명리 용어는 한자+로마자 병기.

## P1 — 영어 정적 UI (청크 단위, 하루 1개)
- [x] **P1-0 뼈대**: `TR` 사전 + `t()`/`applyLang()` + 언어 스위처(KO/EN) + 자동감지. 우선 헤더
  1~2개 문자열만 연결해 전환 동작을 검증(스모크로 en 전환 확인). (2026-07-30: eyebrow·title
  2개 문자열 연결, localStorage.lang 저장, navigator.language 자동감지, KO 폴백 확인 완료)
- [x] **P1-1 헤더·소개**: eyebrow, 소개문(`.sub`), 제보 배너 문구. (2026-07-30: `.sub`는
  groupCount/idolCount 동적 스팬이 있어 일반 `data-i18n`(textContent 치환) 대신
  `TR.sub_html`(언어별 HTML 템플릿 + `{gc}`/`{ic}` 치환)을 쓰는 `renderSub()`로 별도 처리—
  `applyLang()`에서 호출. 제보 배너 텍스트·버튼은 표준 `data-i18n`. KO 폴백·모바일 오버플로 확인 완료.)
- [x] **P1-2 입력영역**: 라벨(생년월일·태어난 시각·내 성별), 시각 드롭다운(모름/N시), 성별 버튼
  (미선택/여성/남성), CTA 버튼(내 최애 찾기), toggle-note. (2026-07-30: 폼 전 요소에 data-i18n/
  data-i18n-ph 부여 + toggle-note는 `<b>` 보존 위해 `data-i18n-html`(innerHTML) 핸들러 신설,
  #bhour는 `buildHourSelect()`로 언어별 라벨·applyLang에서 선택값 보존 재빌드. EN/KO 전환·계산·
  KO 복귀 헤드리스 확인.)
- [x] **P1-3 결과 상단·컨트롤**: tier-note, 필터 라벨(카테고리·검색·소속사·그룹·유형), 성별 탭,
  밴드 토글, 더보기·공유 버튼, footer, section-title. (2026-07-30: data-i18n(-html/-ph) 부여 +
  catLabel/agencyAll("전체")/moreLabel/moreClose lang-aware, applyLang에서 결과 있으면 필터·순위
  재렌더. daymaster 라벨·오행 legend(한자)·shareHint(동적)은 P2로.)
- [x] **P1-4 면책(disclaimer)** 전체 목록. (2026-07-30: 6개 항목 en, `<b>` 항목은 data-i18n-html.)
- [x] **P1-5 제보 모달**: 제목·안내문·라벨·placeholder·카테고리/성별 옵션·버튼·완료 메시지. (2026-07-30 완료)
- [x] **P1-6 오류 모달 + 최애 리포트/토스트**: 오류 모달(제목·필드 옵션·라벨·버튼·intro는
  openError에서 t()로 target 합성)·최애 리포트 shell(eyebrow/title/버튼) **en 완료**. 최애 리포트
  본문(favLead/favReason/favFoot)·업데이트 토스트 본문은 **P2로 이관해 완료**(하단 "최애 리포트
  본문·업데이트 토스트" 항목 참고). (2026-08-03: 정리 — 남은 조각이 P2에서 완료된 것을 확인해 체크.)

## JA — 일본어 (우선순위 상향, 2026-07-30 정적 UI 완료)
- [x] **JA 정적 UI**: 스위처에 `JA` 추가, `navigator.language` ja 자동감지, `buildHourSelect` ja
  포맷(`N時`), `CAT_NAMES`에 ja. **`TR_JA` 오버레이**로 P1-1~P1-6 정적 문자열 전체 ja 부여
  (기존 en 항목 미수정·병합 방식). KO/EN/JA 3언어 토글·계산·헤드리스 확인 완료.

## P2 — 동적 결과 텍스트 (EN·JA 공통) — 2026-07-30 완료
`disp(r)`/`renderDayMaster(dm)`가 저장된 의미 키(godName·hap·brKey·hourKey·yjKey·sexRole·
sexReasonKey)로 **현재 언어의 표시 문자열을 생성**한다. 언어 전환 시 `applyLang`이 일간·순위·이유를 재렌더.
- [x] **P2-1** 십신 role/reason(`GOD_L`에 en/ja).
- [x] **P2-2** 지지 관계(`BR_L` tag/short/reason en/ja)·천간합·시지·년지(띠) 연결 문구(`DYN`).
- [x] **P2-3** 카테고리 라벨(`catLabel` lang-aware)·성별 D-1 리프레이즈(`sexReasonKey`→`DYN`).
- [x] **P2-4** 명리 용어(日干/日柱/身強·身弱 등) `DYN`·`renderDayMaster`로 en/ja. 한자는 공통 유지.
- [x] **P1-7 공유 캡션·이미지** (2026-07-30): 캡션(`shareCaption` 언어별 훅·해시태그) + 공유 이미지
  canvas 텍스트(eyebrow/title/일간·일주/순위 제목/`currentLabel`/푸터)를 `t()`/`dt()`로 언어화.
- [x] **최애 리포트 본문·업데이트 토스트** (2026-07-30): favLead/favFoot·토스트 문구를 `DYN`
  템플릿({total}/{cnt}/{pct}/{names}/{n}) + en/ja로. `currentLabel` 성별/접미도 언어화.
  (그룹명 자체는 데이터가 한국어라 고유명사로 유지 — 정상.)

> **i18n 상태(2026-07-30): 앱 전 화면 KO/EN/JA 완료.** 남은 확장은 P3(중국어 zh) 뿐.

## P3 — 중국어(ZH, 간체) — 2026-08-03 사용자 승인·완료
> **결정(2026-08-03, 주간 리뷰 §P5 사용자 응답):** "중국어권 사용자 다수 있음. 진행 요청" —
> 보류 권고 대신 즉시 착수 승인. JA와 동일한 오버레이 병합 패턴(`TR_ZH`)으로 구현.
- [x] **ZH 전체(정적+동적)**: 스위처에 `ZH` 추가, `navigator.language` zh 자동감지
  (`detectLang`). **`TR_ZH` 오버레이**(간체)로 TR 전 정적 키(P1-1~P1-7·제보/오류 모달·최애
  리포트 shell) 병합. `GOD_L.role`/`GOD_L.reason`·`BR_L.tag/short/reason`·`DYN`(십성 관계·
  명리 용어·최애 리포트 본문·업데이트 토스트·공유 캡션) 전체에 `zh` 키 추가 — `dl()`/`dt()`가
  이미 언어 키를 제네릭하게 조회해 자동 반영. `CAT_NAMES`에 zh 추가.
  하드코딩 `lang==='ja'` 분기 4곳(십신 한자 표시·오행 한자 표시·시각 드롭다운 포맷·공유
  이미지 캔버스 오행 표시)에 zh 분기 추가 — 십신 한자는 간체 변환 필드 `GOD_L[k].hz`(예: 正財→
  正财) 신설, 오행/천간 한자(木火土金水·干支 등)는 간체·정체 동형이라 ja와 동일 처리.
  `buildHourSelect`는 zh 전용 포맷(`N点`) 적용. KO/EN/JA/ZH 4언어 토글·계산·성별·시각 옵션·
  공유 이미지(`drawShareCard`) 헤드리스 확인 완료(JS 에러 0), 모바일 390px 오버플로 없음.

## P4 — QA
- [x] **P4 다국어 회귀 스윕** (2026-08-20): [`tools/i18n-qa.js`](./i18n-qa.js) 신설 —
  KO/EN/JA/ZH × 모바일 390px·데스크톱 1280px **8조합**을 헤드리스로 순회하며
  ① JS 에러 ② `data-i18n(-html/-ph)` 미번역 누출(빈 문자열·`undefined`·`[object`)
  ③ 문서 가로 오버플로 ④ 버튼·배지·카드 화면 밖 이탈/내용 잘림 ⑤ 제보·오류 모달
  열림·오버플로 ⑥ 공유 캡션(`dt('shareCaption')`) ⑦ 업데이트 토스트 문구·오버플로를
  검사한다. **8/8 통과(문제 0건).**
  - `stats.json` fetch가 `file://`에선 CORS로 막혀 토스트 경로가 안 돌아간다 →
    로컬 HTTP로 띄운 뒤 실행한다(`python3 -m http.server 8777 --bind 127.0.0.1 &`).
    `QA_URL` 환경변수로 대상 URL 교체 가능.

> **i18n 상태(2026-08-20): P1~P4 전 단계 완료.** 4개 언어(KO/EN/JA/ZH) 전 화면 + 회귀
> 스윕 자동화까지 끝. 추가 언어 계획 없음(수요 재확인 시 재검토).

> **i18n 상태(2026-08-03): 앱 전 화면 KO/EN/JA/ZH 완료.** 남은 확장 계획 없음(수요 재확인 시
> 재검토).
