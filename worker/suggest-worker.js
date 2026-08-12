/**
 * 사주 아이돌 매칭 — 제보 인테이크 (Cloudflare Worker + KV, 배치 미러링)
 *
 * 리소스 절약 설계: 정적 GitHub Pages 앱에는 서버가 없고, 루틴 실행 환경은 워커에 직접
 * 접속하지 못한다(egress). 그래서 워커가 제보를 GitHub 저장소 파일에 미러링해 두고 루틴이
 * 로컬로 읽는다. 단, 제보마다 GitHub에 커밋하면 워커 서브요청/CPU 부담과 커밋 폭증이 생긴다.
 *   → POST /submit 은 KV 큐에 적재만 하고(GitHub 호출 없음),
 *     Cron 스케줄러(scheduled)가 주기적으로 큐를 모아 한 번에 inbox.json/error-inbox.json에 커밋.
 *
 *   POST /submit          제보 접수 (IP 해시 1시간 1회 제한 + KV 큐 적재만)
 *   (cron) scheduled()    KV 큐 → GitHub 배치 flush (type별 1커밋)
 *   GET  /                헬스체크
 *
 * KV
 *   rl:{ipHash}:{YYYYMMDDHH}   레이트리밋 마커, TTL 1h
 *   q:add:{id} / q:err:{id}    큐 항목(JSON). flush가 소비 후 삭제.
 * 설정: 바인딩 SUGGEST_KV · 시크릿 IP_SALT·GH_TOKEN · 변수 GH_REPO·GH_BRANCH
 * Cron: wrangler.toml [triggers] crons(대시보드에선 Settings→Triggers→Cron Triggers).
 *
 * 개인정보: 원본 IP 미저장(해시만, TTL 1h). 제보 레코드에 제보자 정보 없음.
 */

const COOLDOWN_SECONDS = 60 * 60; // 1시간
const ALLOW_ORIGIN = "*";
const CATS = ["K-idol", "J-idol", "C-actor", "US-actor", "Etc"];
// 익명 사용 비콘 허용 이벤트(콘텐츠 항목). 이 목록 밖은 무시.
const USAGE_EVENTS = ["match", "pair", "profile", "tri", "share", "suggest"];
const USAGE_TTL_SECONDS = 60 * 60 * 40; // 40h: cron이 오늘/어제 버킷을 확정 집계할 때까지 생존
const dayStr = (d) => d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: cors({ "Content-Type": "application/json; charset=utf-8" }),
  });
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hourBucket(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}
const normPart = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, "");
function normKey(name, group) { return `sg:${normPart(name)}|${normPart(group)}`; } // 추가 제보
function errKey(name, group) { return `er:${normPart(name)}|${normPart(group)}`; }  // 오류 제보

// ---- base64 (UTF-8 안전) ----
function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decodeUtf8(b64) {
  const bin = atob((b64 || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---- GitHub Contents API ----
function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "saju-suggest-worker",
  };
}
function ghRepo(env) { return env.GH_REPO || "Alfira0526/saju-idol-match"; }
function ghBranch(env) { return env.GH_BRANCH || "claude/idol-saju-matching-app-752fy3"; }
async function ghGet(env, filePath) {
  const url = `https://api.github.com/repos/${ghRepo(env)}/contents/${filePath}?ref=${encodeURIComponent(ghBranch(env))}`;
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (r.status === 200) {
    const j = await r.json();
    let arr = [];
    try { arr = JSON.parse(b64decodeUtf8(j.content)) || []; } catch { arr = []; }
    return { sha: j.sha, arr };
  }
  if (r.status === 404) return { sha: null, arr: [] };
  throw new Error("gh get " + r.status);
}
async function ghPut(env, filePath, arr, sha, message) {
  const url = `https://api.github.com/repos/${ghRepo(env)}/contents/${filePath}`;
  const body = { message, content: b64encodeUtf8(JSON.stringify(arr, null, 2) + "\n"), branch: ghBranch(env) };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: "PUT", headers: { ...ghHeaders(env), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok && r.status !== 409) throw new Error("gh put " + r.status);
  return r.status;
}

// ---- GitHub Contents API (object 파일용 — usage.json) ----
async function ghGetObj(env, filePath) {
  const url = `https://api.github.com/repos/${ghRepo(env)}/contents/${filePath}?ref=${encodeURIComponent(ghBranch(env))}`;
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (r.status === 200) {
    const j = await r.json();
    let obj = {};
    try { obj = JSON.parse(b64decodeUtf8(j.content)) || {}; } catch { obj = {}; }
    return { sha: j.sha, obj };
  }
  if (r.status === 404) return { sha: null, obj: {} };
  throw new Error("gh get " + r.status);
}
async function ghPutObj(env, filePath, obj, sha, message) {
  const url = `https://api.github.com/repos/${ghRepo(env)}/contents/${filePath}`;
  const body = { message, content: b64encodeUtf8(JSON.stringify(obj, null, 2) + "\n"), branch: ghBranch(env) };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: "PUT", headers: { ...ghHeaders(env), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok && r.status !== 409) throw new Error("gh put " + r.status);
  return r.status;
}

// ---- Cron flush: KV 큐 → GitHub 파일 배치 병합 ----
async function flush(env) {
  if (!env.GH_TOKEN) return; // 토큰 없으면 미러링 스킵(큐는 KV에 남음)
  await flushType(env, "add", "tools/inbox.json");
  await flushType(env, "err", "tools/error-inbox.json");
  await flushUsage(env);
}

// ---- 사용 비콘 집계: KV(u:{date}:{event}:{ipHash}) → tools/usage.json ----
// 각 키는 '하루 1인 1이벤트'(멱등 put). 오늘/어제 버킷만 다시 세어 병합하므로 저비용.
async function flushUsage(env) {
  if (!env.GH_TOKEN) return;
  // 유휴 cron 비용 절감: 사용 키가 하나도 없으면 GitHub 호출 없이 종료
  const probe = await env.SUGGEST_KV.list({ prefix: "u:", limit: 1 });
  if (!probe.keys.length) return;

  const today = new Date();
  const dates = [dayStr(today), dayStr(new Date(today.getTime() - 86400000))];
  const counted = {};
  for (const d of dates) {
    const c = {};
    let cursor;
    do {
      const res = await env.SUGGEST_KV.list({ prefix: `u:${d}:`, cursor });
      for (const k of res.keys) {
        const ev = k.name.split(":")[2]; // u:{date}:{event}:{ipHash}
        if (USAGE_EVENTS.includes(ev)) c[ev] = (c[ev] || 0) + 1;
      }
      cursor = res.list_complete ? null : res.cursor;
    } while (cursor);
    counted[d] = c;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, obj } = await ghGetObj(env, "tools/usage.json");
    const daily = (obj && obj.daily) || {};
    // 실제로 센 날만 갱신(0으로 덮어써 과거 확정값을 지우지 않도록)
    for (const d of dates) { if (Object.keys(counted[d]).length) daily[d] = counted[d]; }
    const totals = {};
    for (const d of Object.keys(daily)) {
      for (const [ev, n] of Object.entries(daily[d])) totals[ev] = (totals[ev] || 0) + n;
    }
    const out = { updatedAt: new Date().toISOString(), metric: "unique-users-per-day (UTC)", events: USAGE_EVENTS, daily, totals };
    const st = await ghPutObj(env, "tools/usage.json", out, sha, `chore(usage): update ${Object.keys(totals).length} events`);
    if (st !== 409) break;
  }
}
async function flushType(env, type, filePath) {
  const list = await env.SUGGEST_KV.list({ prefix: `q:${type}:` });
  if (!list.keys.length) return; // 큐 비었으면 GitHub 호출 없이 종료(유휴 cron은 저비용)
  const items = [];
  for (const k of list.keys) {
    const v = await env.SUGGEST_KV.get(k.name);
    if (v) { try { items.push({ kvKey: k.name, sub: JSON.parse(v) }); } catch {} }
  }
  if (!items.length) return;

  // sha 충돌(409) 시 재시도하며 현재 파일에 병합
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, arr } = await ghGet(env, filePath);
    const map = new Map(arr.map((x) => [x.key, x]));
    const now = new Date().toISOString();
    for (const { sub } of items) {
      const key = type === "add" ? normKey(sub.name, sub.group) : errKey(sub.name, sub.group);
      let rec = map.get(key);
      if (!rec) {
        rec = type === "add"
          ? { key, name: sub.name, group: sub.group, cat: sub.cat, gender: sub.gender, dob: sub.dob, note: sub.note, count: 0, firstAt: sub.at || now, lastAt: sub.at || now, status: "pending" }
          : { key, name: sub.name, group: sub.group, fields: {}, suggests: [], notes: [], count: 0, firstAt: sub.at || now, lastAt: sub.at || now, status: "pending" };
        map.set(key, rec);
      }
      rec.count = (rec.count || 0) + 1;
      rec.lastAt = sub.at || now;
      if (type === "add") {
        if (sub.dob && !rec.dob) rec.dob = sub.dob;
        if (sub.gender && !rec.gender) rec.gender = sub.gender;
        if (sub.note) rec.note = sub.note;
      } else {
        if (sub.field) rec.fields[sub.field] = (rec.fields[sub.field] || 0) + 1;
        if (sub.suggest && rec.suggests.length < 20 && !rec.suggests.includes(sub.suggest)) rec.suggests.push(sub.suggest);
        if (sub.note && rec.notes.length < 20) rec.notes.push(sub.note);
      }
    }
    const st = await ghPut(env, filePath, [...map.values()], sha, `chore(inbox): flush ${items.length} ${type}`);
    if (st !== 409) break; // 성공
  }
  // 반영한 큐 삭제
  for (const { kvKey } of items) await env.SUGGEST_KV.delete(kvKey);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    // ---- POST /submit : 접수(큐 적재만, GitHub 호출 없음) ----
    if (url.pathname === "/submit" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
      if (body.hp) return json({ ok: true }); // 허니팟

      const name = (body.name || "").toString().trim().slice(0, 40);
      const group = (body.group || "").toString().trim().slice(0, 40);
      if (!name || !group) return json({ ok: false, error: "missing_fields" }, 400);
      const type = body.type === "error" ? "err" : "add";

      // 레이트리밋
      const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
      const ipHash = (await sha256Hex(ip + "|" + (env.IP_SALT || "salt"))).slice(0, 24);
      const rlKey = `rl:${ipHash}:${hourBucket(new Date())}`;
      if (await env.SUGGEST_KV.get(rlKey)) return json({ ok: false, error: "rate_limited" }, 429);

      const at = new Date().toISOString();
      const note = (body.note || "").toString().trim().slice(0, 120);
      let sub;
      if (type === "err") {
        sub = { name, group,
          field: (body.field || "").toString().trim().slice(0, 24),
          suggest: (body.suggest || "").toString().trim().slice(0, 60), note, at };
      } else {
        sub = { name, group,
          cat: CATS.includes(body.cat) ? body.cat : "K-idol",
          gender: ["M", "F"].includes(body.gender) ? body.gender : "",
          dob: (body.dob || "").toString().replace(/\D/g, "").slice(0, 8), note, at };
      }
      // 큐 적재(고유 id) + 레이트리밋 마커
      const id = Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 8);
      await env.SUGGEST_KV.put(`q:${type}:${id}`, JSON.stringify(sub));
      await env.SUGGEST_KV.put(rlKey, "1", { expirationTtl: COOLDOWN_SECONDS });
      return json({ ok: true });
    }

    // ---- POST /beacon : 익명 사용 집계(개인정보 없음, '기능 이름'만) ----
    // 하루 1인 1이벤트로 KV에 멱등 기록. cron이 usage.json으로 미러링.
    if (url.pathname === "/beacon" && request.method === "POST") {
      let ev = "";
      try { const b = await request.json(); ev = (b && b.e || "").toString(); } catch { ev = ""; }
      if (!USAGE_EVENTS.includes(ev)) return new Response(null, { status: 204, headers: cors() });
      const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
      const ipHash = (await sha256Hex(ip + "|" + (env.IP_SALT || "salt"))).slice(0, 24);
      await env.SUGGEST_KV.put(`u:${dayStr(new Date())}:${ev}:${ipHash}`, "1", { expirationTtl: USAGE_TTL_SECONDS });
      return new Response(null, { status: 204, headers: cors() });
    }

    // ---- (선택) 관리자용 수동 flush: GET /flush?token=ADMIN_TOKEN ----
    if (url.pathname === "/flush" && request.method === "GET") {
      if (url.searchParams.get("token") !== env.ADMIN_TOKEN) return json({ ok: false, error: "unauthorized" }, 401);
      await flush(env);
      return json({ ok: true, flushed: true });
    }

    if (url.pathname === "/") return json({ ok: true, service: "saju-suggest" });
    return json({ ok: false, error: "not_found" }, 404);
  },

  // Cron: 주기적으로 큐를 GitHub에 배치 반영
  async scheduled(event, env, ctx) {
    ctx.waitUntil(flush(env));
  },
};
