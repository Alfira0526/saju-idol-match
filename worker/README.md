# worker/ — 제보 인테이크 (Cloudflare Worker + KV)

정적 GitHub Pages 앱에는 서버가 없어서 IP 기준 레이트리밋·비공개 저장이 불가능합니다.
이 작은 워커가 그 최소 백엔드 역할을 합니다. **무료 플랜 한도로 충분**합니다
(제보 트래픽은 하루 수십~수백 건 수준).

```
POST /submit               제보 접수 (IP 해시로 1시간 1회 제한 + 이름·그룹 중복 병합)
GET  /suggestions?token=…  루틴이 후보 큐를 읽음 (요청 횟수 많은 순)
POST /mark?token=…         루틴이 반영 완료 상태 기록
```

## 개인정보 원칙
- 원본 IP는 **저장하지 않습니다.** `IP + 솔트`의 SHA-256 해시만 레이트리밋 키에 쓰고,
  그 키는 **1시간 뒤 자동 소멸**합니다.
- 제보 레코드에는 제보자 정보를 담지 않습니다(대상 인물의 이름·그룹·생일만).

---

## 처음 배포하기 — 브라우저만으로 (설치 0, 약 15분)

> **Node.js·터미널·명령어 전혀 필요 없습니다.** 전부 Cloudflare 웹사이트에서
> 마우스 클릭 + 복사·붙여넣기로 합니다. 아래 순서를 그대로만 따라오세요.
> Cloudflare 화면 문구는 가끔 조금씩 바뀌므로, **글자가 100% 똑같지 않아도**
> "비슷한 버튼"을 누르면 됩니다.

### 0. 준비물 — 비밀 값 2개 미리 정해두기
나중에 붙여넣을 **긴 무작위 문자열 2개**가 필요합니다. 지금 메모장에 적어두세요.
- `ADMIN_TOKEN` : 관리용 비밀번호. **남에게 절대 알려주면 안 됨.**
- `IP_SALT` : IP를 뒤섞는 소금값.

만드는 법(아무거나): 키보드를 마구 눌러 **영문+숫자 32자 이상**을 두 줄 만들면 됩니다.
예) `k9Xp2mQ7... (대충 길게)`. 떠오르지 않으면 <https://1password.com/password-generator/>
같은 무료 생성기에서 32자짜리 두 개를 만들어 복사해 두세요.

### 1. Cloudflare 무료 가입
1. <https://dash.cloudflare.com/sign-up> 접속 → 이메일·비밀번호로 가입(무료, 카드 필요 없음).
2. 메일함에서 인증 메일의 링크를 눌러 이메일 인증.
3. 로그인하면 "대시보드(Dashboard)" 화면이 나옵니다.

### 2. 데이터 저장소(KV) 먼저 만들기
1. 왼쪽 메뉴에서 **Storage & databases**(스토리지) 를 펼친 뒤 **Workers KV** 를 클릭.
   (메뉴에 따라 그냥 **KV** 로 보일 수도 있어요 — 둘 다 같은 것)
2. **Create a namespace**(네임스페이스 만들기) 버튼 클릭.
3. 이름칸에 정확히 **`SUGGEST_KV`** 입력 → **Add**(추가) 클릭.
4. 목록에 `SUGGEST_KV` 가 생기면 끝. (여기 화면은 그냥 닫아도 됩니다.)

### 3. 워커(Worker) 만들기
1. 왼쪽 메뉴 **Workers & Pages**(또는 **Compute**) 클릭.
2. **Create application** → **Create Worker** 클릭.
   (요즘 화면은 **Create** → **Start with Hello World** 일 수도 있음 — 그거 누르면 됩니다.)
3. 이름(Name)칸에 **`saju-suggest`** 입력 → **Deploy**(배포) 클릭.
   → "성공적으로 배포됨" 같은 문구와 함께 `https://saju-suggest.○○○.workers.dev`
   주소가 보입니다. **이 주소를 메모장에 복사**해 두세요(나중에 앱에 넣습니다).

### 4. 워커 코드 붙여넣기
1. 방금 만든 워커 화면에서 **Edit code**(코드 편집) 버튼 클릭 → 온라인 편집기가 열립니다.
2. 편집기 안에 이미 적혀 있는 예제 코드를 **전부 지웁니다**
   (편집기 안 클릭 → `Ctrl/Cmd + A` 로 전체선택 → `Delete`).
3. 이 저장소의 **[`suggest-worker.js`](./suggest-worker.js) 파일 내용을 전부 복사**해서
   빈 편집기에 붙여넣습니다.
   (GitHub에서 그 파일 열고 → 오른쪽 위 복사 아이콘 → 편집기에 붙여넣기)
4. 오른쪽 위 **Deploy**(배포) 클릭 → "배포됨" 뜨면 코드 업로드 완료.

### 5. 저장소·비밀값을 워커에 연결 (바인딩)
워커가 방금 만든 KV와 비밀값을 쓸 수 있게 연결합니다.
1. 워커 화면 상단 탭에서 **Settings**(설정) 클릭.
2. **Bindings**(또는 **Variables and Secrets** / **변수**) 섹션을 찾습니다.
3. **KV 네임스페이스 연결**:
   - **Add binding**(바인딩 추가) → 종류에서 **KV namespace** 선택.
   - **Variable name**(변수 이름)칸에 정확히 **`SUGGEST_KV`** 입력.
   - **KV namespace**칸에서 아까 만든 **`SUGGEST_KV`** 선택 → 저장(**Deploy/Save**).
4. **비밀값 2개 등록**(같은 Settings 화면의 **Secret**/비밀 항목):
   - **Add**(추가) → 종류 **Secret** → 이름 **`ADMIN_TOKEN`**, 값에는 0번에서 정한
     ADMIN_TOKEN 문자열 붙여넣기 → 저장.
   - 한 번 더 **Add** → **Secret** → 이름 **`IP_SALT`**, 값에는 IP_SALT 문자열 붙여넣기 → 저장.
   - (Secret으로 넣으면 값이 가려져 다시 볼 수 없습니다. 메모장 사본을 꼭 보관하세요.)
5. 변경 후 화면에 **재배포(Deploy)** 하라고 하면 눌러줍니다.

### 6. 잘 됐는지 확인 (브라우저로)
1. **주소창 테스트**: 브라우저 새 탭에 아래를 붙여넣고 이동(`<...>` 부분만 본인 값으로):
   ```
   https://saju-suggest.○○○.workers.dev/suggestions?token=<ADMIN_TOKEN>
   ```
   → 화면에 `{"ok":true,"count":0,"items":[]}` 비슷하게 뜨면 **성공**입니다.
   `unauthorized` 가 뜨면 토큰을 잘못 넣은 것, 그 외 에러면 5번 연결을 다시 확인.
2. **진짜 제보 테스트**는 7번까지 하고 앱에서 직접 제보해 보면 됩니다.

### 7. 앱에 워커 주소 연결
`index.html` 파일에서 아래 줄을 찾아(현재는 따옴표 안이 비어 있음):
```js
const SUGGEST_ENDPOINT = "";
```
3번에서 복사해 둔 워커 주소 뒤에 **`/submit`** 을 붙여 넣습니다:
```js
const SUGGEST_ENDPOINT = "https://saju-suggest.○○○.workers.dev/submit";
```
> 이 한 줄만 바꿔서 깃허브에 올리면(커밋·푸시) 실제 제보 수집이 켜집니다.
> **원하시면 이 줄 수정·커밋은 제가 대신 해드립니다** — 배포하고 나온 워커 주소만
> 알려주세요. 비워두면(`""`) 폼은 감사 메시지까지만 뜨고 서버로 안 보냅니다(안전장치).

### 8. 매일 밤 루틴에 값 전달
매일 데이터 취합 Routine이 제보 큐를 읽으려면 **워커 주소 + `ADMIN_TOKEN`** 이 필요합니다.
이 두 값을 저에게(또는 루틴 세션에) 알려주시면 루틴이 자동으로 제보를 우선 반영합니다
(흐름: [`tools/README.md`](../tools/README.md) 의 *제보 우선 반영*).

---

## (선택) 명령어에 익숙하다면 — Wrangler CLI
Node.js가 있는 분은 브라우저 대신 CLI로도 배포할 수 있습니다.
```bash
npm install -g wrangler
wrangler login
cd worker
wrangler kv namespace create SUGGEST_KV   # 출력된 id를 wrangler.toml에 붙여넣기
wrangler secret put ADMIN_TOKEN
wrangler secret put IP_SALT
wrangler deploy
```
(`wrangler.toml` 은 이 CLI 방식에서만 씁니다. 위 브라우저 방식에서는 필요 없습니다.)

## 동작 확인 (명령어로, 선택)
```bash
curl -X POST https://<worker-url>/submit -H 'Content-Type: application/json' \
  -d '{"name":"테스트","group":"테스트그룹","cat":"K-idol"}'   # → {"ok":true,"count":1}
curl "https://<worker-url>/suggestions?token=<ADMIN_TOKEN>"      # 큐 읽기
curl -X POST "https://<worker-url>/mark?token=<ADMIN_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"name":"테스트","group":"테스트그룹","status":"added"}'  # 반영 완료 표기
```

## KV 스키마
| 키 | 값 | 비고 |
|---|---|---|
| `rl:{ipHash}:{YYYYMMDDHH}` | `"1"` | 레이트리밋 마커, TTL 1h |
| `sg:{name}|{group}` | JSON 레코드 | 제보 병합(count 누적) |

제보 레코드 JSON:
```json
{
  "name": "하츠네", "group": "NewJeans", "cat": "K-idol",
  "gender": "F", "dob": "20040507", "note": "...",
  "count": 3, "firstAt": "2026-07-22T...", "lastAt": "2026-07-22T...",
  "status": "pending"
}
```
`status`: `pending`(대기) → `added`(반영 완료). 반영된 항목은 재제보해도 다시 큐에 오르지 않습니다.

## 비용
Cloudflare 무료 플랜: 워커 하루 100,000 요청, KV 하루 읽기 100,000 / 쓰기 1,000.
개인 오락용 제보 트래픽은 이 한도에 한참 못 미칩니다.
