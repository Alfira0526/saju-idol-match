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

## 처음 배포하기 (10분, GitHub 계정만 있으면 됩니다)

### 1. Cloudflare 계정 + Wrangler
1. <https://dash.cloudflare.com> 에서 무료 가입.
2. 로컬에 Node.js가 있으면:
   ```bash
   npm install -g wrangler
   wrangler login          # 브라우저로 계정 인증
   ```

### 2. KV 네임스페이스 생성
```bash
cd worker
wrangler kv namespace create SUGGEST_KV
```
출력된 `id = "..."` 값을 `wrangler.toml` 의 `REPLACE_WITH_YOUR_KV_ID` 자리에 붙여넣습니다.

### 3. 시크릿 등록
```bash
wrangler secret put ADMIN_TOKEN   # 루틴이 큐를 읽을 때 쓰는 관리 토큰(길고 무작위로)
wrangler secret put IP_SALT       # IP 해시용 솔트(아무 긴 무작위 문자열)
```
> `ADMIN_TOKEN` 은 남에게 노출되면 안 됩니다. 무작위 32자 이상 추천.

### 4. 배포
```bash
wrangler deploy
```
배포되면 `https://saju-suggest.<your-subdomain>.workers.dev` 형태의 URL이 나옵니다.

### 5. 앱에 연결
`index.html` 의 다음 줄에 `/submit` 을 붙인 주소를 넣습니다:
```js
const SUGGEST_ENDPOINT = "https://saju-suggest.<your-subdomain>.workers.dev/submit";
```
비워두면(`""`) 제보 폼은 **로컬에서 감사 메시지만** 보여주고 서버로 보내지 않습니다
(백엔드 없이도 UI가 깨지지 않도록 한 안전장치).

### 6. 루틴에 토큰 전달
매일 밤 데이터 취합 Routine이 큐를 읽으려면 `ADMIN_TOKEN` 과 워커 URL이 필요합니다.
값을 안전하게 보관했다가 루틴 세션에 전달하세요(자세한 흐름은
[`tools/README.md`](../tools/README.md) 의 *제보 우선 반영* 항목).

---

## 동작 확인 (배포 후)
```bash
# 제보 넣기
curl -X POST https://<worker-url>/submit \
  -H 'Content-Type: application/json' \
  -d '{"name":"테스트","group":"테스트그룹","cat":"K-idol"}'
# → {"ok":true,"count":1}

# 같은 IP로 1분 내 재요청 → 429 rate_limited

# 큐 읽기(관리 토큰 필요)
curl "https://<worker-url>/suggestions?token=<ADMIN_TOKEN>"
# → {"ok":true,"count":1,"items":[{ "key":"sg:테스트|테스트그룹","name":...,"count":1,"status":"pending" }]}

# 반영 완료 표기
curl -X POST "https://<worker-url>/mark?token=<ADMIN_TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"테스트","group":"테스트그룹","status":"added"}'
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
