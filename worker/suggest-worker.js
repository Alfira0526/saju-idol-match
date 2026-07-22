/**
 * 사주 아이돌 매칭 — 제보 인테이크 (Cloudflare Worker + KV)
 *
 * 정적 GitHub Pages 앱에는 서버가 없어서 IP 기반 레이트리밋·비공개 저장을 할 수 없다.
 * 이 워커가 그 최소한의 백엔드 역할을 한다.
 *
 *   POST /submit            제보 저장 (IP 해시로 1시간 1회 제한 + 이름·그룹 중복 병합)
 *   GET  /suggestions?token=…   루틴이 후보 큐를 읽어감 (요청 횟수 순 정렬)
 *   POST /mark?token=…      루틴이 반영 완료 상태를 기록
 *
 * KV 네임스페이스 바인딩 이름: SUGGEST_KV
 * 시크릿(wrangler secret put): ADMIN_TOKEN (관리용), IP_SALT (IP 해시 솔트)
 *
 * KV 스키마
 *   rl:{ipHash}:{YYYYMMDDHH}   "1"           TTL 1h   레이트리밋 마커
 *   sg:{name}|{group}          JSON          제보 레코드(중복 병합, count 누적)
 *
 * 개인정보: 원본 IP는 저장하지 않는다. IP+솔트의 SHA-256 해시만 레이트리밋 키에 쓰고
 * 1시간 뒤 자동 소멸한다. 제보 레코드에는 제보자 정보를 담지 않는다.
 */

const COOLDOWN_SECONDS = 60 * 60; // 1시간

// CORS: GitHub Pages 도메인에서의 cross-origin 요청 허용.
// 배포 후 ALLOW_ORIGIN 을 본인 Pages 주소로 좁히는 것을 권장(예: "https://<user>.github.io").
const ALLOW_ORIGIN = "*";

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

// UTC 시각 → "YYYYMMDDHH" (레이트리밋 버킷). 최소 단위가 1시간이면 충분.
function hourBucket(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}

function normKey(name, group) {
  const n = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, "");
  return `sg:${n(name)}|${n(group)}`;
}

const CATS = ["K-idol", "J-idol", "C-actor", "US-actor", "Etc"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    // ---- POST /submit : 제보 접수 ----
    if (url.pathname === "/submit" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "bad_json" }, 400);
      }

      // 허니팟(봇 필드)이 채워져 있으면 성공한 척 조용히 버린다.
      if (body.hp) return json({ ok: true });

      const name = (body.name || "").toString().trim().slice(0, 40);
      const group = (body.group || "").toString().trim().slice(0, 40);
      if (!name || !group) return json({ ok: false, error: "missing_fields" }, 400);

      // 레이트리밋: IP 해시 + 현재 UTC 시(hour) 버킷
      const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
      const ipHash = (await sha256Hex(ip + "|" + (env.IP_SALT || "salt"))).slice(0, 24);
      const rlKey = `rl:${ipHash}:${hourBucket(new Date())}`;
      if (await env.SUGGEST_KV.get(rlKey)) {
        return json({ ok: false, error: "rate_limited" }, 429);
      }

      // 정규화된 필드
      const cat = CATS.includes(body.cat) ? body.cat : "K-idol";
      const gender = ["M", "F"].includes(body.gender) ? body.gender : "";
      const dob = (body.dob || "").toString().replace(/\D/g, "").slice(0, 8);
      const note = (body.note || "").toString().trim().slice(0, 80);

      // 중복 병합: 같은 이름|그룹이면 count++, 아니면 신규
      const key = normKey(name, group);
      const nowIso = new Date().toISOString();
      let rec = await env.SUGGEST_KV.get(key, "json");
      if (rec && rec.status !== "added") {
        rec.count = (rec.count || 1) + 1;
        rec.lastAt = nowIso;
        if (dob && !rec.dob) rec.dob = dob;
        if (gender && !rec.gender) rec.gender = gender;
        if (note) rec.note = note;
      } else if (!rec) {
        rec = { name, group, cat, gender, dob, note, count: 1, firstAt: nowIso, lastAt: nowIso, status: "pending" };
      } else {
        // 이미 반영된(added) 항목에 재제보: count만 참고로 올리되 상태 유지
        rec.count = (rec.count || 1) + 1;
        rec.lastAt = nowIso;
      }
      await env.SUGGEST_KV.put(key, JSON.stringify(rec));
      await env.SUGGEST_KV.put(rlKey, "1", { expirationTtl: COOLDOWN_SECONDS });

      return json({ ok: true, count: rec.count });
    }

    // ---- GET /suggestions?token=… : 루틴이 후보 큐를 읽음 ----
    if (url.pathname === "/suggestions" && request.method === "GET") {
      if (url.searchParams.get("token") !== env.ADMIN_TOKEN) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const status = url.searchParams.get("status") || "pending"; // pending|added|all
      const list = await env.SUGGEST_KV.list({ prefix: "sg:" });
      const items = [];
      for (const k of list.keys) {
        const rec = await env.SUGGEST_KV.get(k.name, "json");
        if (!rec) continue;
        if (status !== "all" && rec.status !== status) continue;
        items.push({ key: k.name, ...rec });
      }
      // 요청 횟수 많은 순 → 오래된 순
      items.sort((a, b) => (b.count || 0) - (a.count || 0) || (a.firstAt || "").localeCompare(b.firstAt || ""));
      return json({ ok: true, count: items.length, items });
    }

    // ---- POST /mark?token=… : 반영 완료 상태 기록 ----
    if (url.pathname === "/mark" && request.method === "POST") {
      if (url.searchParams.get("token") !== env.ADMIN_TOKEN) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "bad_json" }, 400);
      }
      const key = body.key || normKey(body.name, body.group);
      const rec = await env.SUGGEST_KV.get(key, "json");
      if (!rec) return json({ ok: false, error: "not_found" }, 404);
      rec.status = body.status || "added";
      rec.markedAt = new Date().toISOString();
      await env.SUGGEST_KV.put(key, JSON.stringify(rec));
      return json({ ok: true, key, status: rec.status });
    }

    // 헬스체크
    if (url.pathname === "/" ) return json({ ok: true, service: "saju-suggest" });

    return json({ ok: false, error: "not_found" }, 404);
  },
};
