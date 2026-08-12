#!/usr/bin/env node
// Weekly ops metrics generator for saju-idol-match.
// Repo-derived metrics (this is a static app — no usage/analytics backend),
// so the "주간 운영 리뷰" reads data health, backlog and coverage instead of
// usage/정답률. Writes docs/ops/metrics-latest.json.
//
//   node tools/ops-metrics.js                 # write metrics-latest.json (system date)
//   node tools/ops-metrics.js --date=2026-07-27
//   node tools/ops-metrics.js --check         # print to stdout, do not write
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const AGENCY_MIN = 30; // 기타 하위 소속사가 이 이상이면 P2 Phase 2에서 상단 버튼 승격 후보(2026-08-03 사용자 결정: 30)
const T = (p) => path.join(ROOT, 'tools', p);
const readJSON = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
};

const CAT_MIN = 30; // categories below this stay hidden in the UI

const idols = readJSON(T('idols.json'), []);
const stats = readJSON(T('stats.json'), { total: 0, addedRecent: [] });
const inbox = readJSON(T('inbox.json'), []);
const errInbox = readJSON(T('error-inbox.json'), []);
const done = readJSON(T('inbox-done.json'), []);
const usage = readJSON(T('usage.json'), null); // 익명 콘텐츠 사용 비콘(워커 미러링). 없으면 미측정.
const doneSet = new Set((Array.isArray(done) ? done : []).map(x => (typeof x === 'string' ? x : x && x.key)));

// ---- dataset coverage ----
const groups = new Set(), byCat = {}, byAgency = {}, byGender = {};
const subTally = {}; let etcTotal = 0, etcAssigned = 0; // P2: 기타 세분화 진척
for (const it of idols) {
  const cat = it.cat || 'K-idol';
  const agency = it.agency || '기타';
  byCat[cat] = (byCat[cat] || 0) + 1;
  byAgency[agency] = (byAgency[agency] || 0) + 1;
  byGender[it.gender || '?'] = (byGender[it.gender || '?'] || 0) + 1;
  groups.add(`${it.group}`);
  if (cat === 'K-idol' && agency === '기타') {
    etcTotal++;
    const s = (it.subAgency || '').trim();
    if (s) { subTally[s] = (subTally[s] || 0) + 1; etcAssigned++; }
  }
}
const subAgency = {
  etcTotal, assigned: etcAssigned, unassigned: etcTotal - etcAssigned,
  coveragePct: etcTotal ? Math.round((etcAssigned / etcTotal) * 100) : 0,
  byLabel: Object.fromEntries(Object.entries(subTally).sort((a, b) => b[1] - a[1])),
  promotable: Object.entries(subTally).filter(([, n]) => n >= AGENCY_MIN).map(([k]) => k),
};
const categories = Object.fromEntries(
  Object.entries(byCat).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => [c, { count: n, visible: n >= CAT_MIN }])
);

// ---- integrity ----
const seen = new Map(), dups = [];
for (const it of idols) {
  const k = `${it.name}|${it.group}`;
  if (seen.has(k)) dups.push(k); else seen.set(k, 1);
}

// ---- backlog (pending = key not in inbox-done) ----
const pendAdd = inbox.filter(x => !doneSet.has(x.key));
const pendErr = errInbox.filter(x => !doneSet.has(x.key));
const byCountDesc = (a, b) => (b.count || 0) - (a.count || 0);
const minFirstAt = (arr) => arr.reduce((m, x) => (x.firstAt && (!m || x.firstAt < m) ? x.firstAt : m), null);

// 진짜 작업 단위는 '고유 그룹'이다(루틴은 그룹 단위로 처리). 개인 제보 수(addPending)는
// 로마자⇄한글 변형·오타로 부풀려져 오해를 준다. 아래로 그룹 단위 실질 백로그를 본다.
const nrm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, '');
const presentPerson = new Set(idols.map(it => `${nrm(it.name)}|${nrm(it.group)}`));
const presentGroup = new Set(idols.map(it => nrm(it.group)));
const pendGroups = new Set(), pendGroupsNew = new Set();
let alreadyPresentPersons = 0;
for (const x of pendAdd) {
  if (presentPerson.has(`${nrm(x.name)}|${nrm(x.group)}`)) { alreadyPresentPersons++; continue; }
  const g = nrm(x.group);
  pendGroups.add(g);
  if (!presentGroup.has(g)) pendGroupsNew.add(g);
}
const backlogGroups = {
  distinctGroups: pendGroups.size,          // 정리해야 할 고유 그룹 수(실질 작업량 근사)
  newGroups: pendGroupsNew.size,            // 미수록 그룹(신규 add 후보 — 단, 변형·오타 포함해 과대)
  knownGroups: pendGroups.size - pendGroupsNew.size, // 그룹은 존재(신규 멤버 or 로마자 중복)
  alreadyPresentPersons,                    // 인물까지 이미 존재 → 즉시 inbox-done 정리 가능
  note: '개인 제보 수는 로마자/한글 변형·오타로 과대. 실질 작업 단위는 distinctGroups. newGroups도 변형·오타 포함해 실제 신규는 더 적음.',
};

// ---- i18n progress (checkbox tally in i18n-plan.md) ----
// 줄 시작 "- [ ]/[x]/[~]" 리스트 항목만 집계(본문 설명 중 인용된 `[x]` 오탐 방지).
// [~](부분완료)는 분모엔 포함하되 완료로는 세지 않는다.
let i18nDone = 0, i18nTotal = 0;
try {
  const plan = fs.readFileSync(T('i18n-plan.md'), 'utf8');
  const items = plan.match(/^-\s*\[([ x~])\]/gim) || [];
  i18nTotal = items.length;
  i18nDone = items.filter(s => /\[x\]/i.test(s)).length;
} catch {}

// ---- P3(3A): flush 배치 급증/공백 원인 구분 (git log 분석, 인프라 변경 0) ----
// Cron은 10분 주기. 빈 큐면 커밋 없음 → 커밋 간격은 '제보 유입 밀도'에 좌우된다.
// 분류(배치 크기로 quiet vs 진짜 지연 구분):
//   inflow-surge : gap≈10분인데 batch 큼(>15)            → 제보 유입 폭주(무해)
//   cron-delay   : gap>20분 AND batch 누적(≥10)          → Cron이 틱을 놓쳐 밀림(점검 대상)
//   quiet        : gap>20분 이나 batch 작음(<10)          → 조용한 시간대(제보 적음, 정상)
// 즉 '큰 gap + 작은 batch'는 Cron 이상이 아니라 저트래픽. 반복되는 '큰 gap + 큰 batch'만 경보.
const CRON_DELAY_BATCH = 10; // 이 이상 누적되면 틱 누락 의심
function flushCadence(days = 7) {
  try {
    const out = execSync(`git log --since="${days} days ago" --pretty=format:%cI%x09%s`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const flushes = [];
    for (const ln of out.split('\n')) {
      const tab = ln.indexOf('\t'); if (tab < 0) continue;
      const iso = ln.slice(0, tab), subj = ln.slice(tab + 1);
      const m = /chore\(inbox\): flush (\d+) (add|err)/.exec(subj);
      if (m) flushes.push({ at: iso, n: +m[1], type: m[2] });
    }
    flushes.reverse(); // git log는 최신순 → 시간순으로
    const classify = (gapMin, n) => {
      if (gapMin <= 15 && n > 15) return 'inflow-surge';
      if (gapMin > 20 && n >= CRON_DELAY_BATCH) return 'cron-delay';
      if (gapMin > 20) return 'quiet';
      return 'normal';
    };
    const gaps = [];
    for (let i = 1; i < flushes.length; i++) {
      const dt = Math.round((new Date(flushes[i].at) - new Date(flushes[i - 1].at)) / 60000);
      gaps.push({ at: flushes[i].at, gapMin: dt, n: flushes[i].n, likely: classify(dt, flushes[i].n) });
    }
    const batches = flushes.map(f => f.n);
    const sortedGaps = gaps.map(g => g.gapMin).sort((a, b) => a - b);
    const cronDelays = gaps.filter(g => g.likely === 'cron-delay');
    const lastAt = flushes.length ? flushes[flushes.length - 1].at : null;
    const nowMs = Date.now();
    const sinceMin = lastAt ? Math.round((nowMs - new Date(lastAt)) / 60000) : null;
    // 경보는 '최근 48h' 누적-지연 반복에만. 과거(초기 세팅기) 이벤트는 참고만.
    const recentCutoff = nowMs - 48 * 3600 * 1000;
    const recentCronDelays = cronDelays.filter(g => new Date(g.at).getTime() >= recentCutoff);
    const concern = recentCronDelays.length >= 2;
    return {
      windowDays: days,
      flushCount: flushes.length,
      maxBatch: batches.length ? Math.max(...batches) : 0,
      avgBatch: batches.length ? Math.round((batches.reduce((a, b) => a + b, 0) / batches.length) * 10) / 10 : 0,
      medianGapMin: sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : null,
      lastFlushAt: lastAt,
      timeSinceLastFlushMin: sinceMin,
      cronDelayEvents: cronDelays.length,            // 7일 전체(초기 세팅기 포함)
      recentCronDelayEvents: recentCronDelays.length, // 최근 48h — 경보 기준
      quietGaps: gaps.filter(g => g.likely === 'quiet').length,
      inflowSurges: gaps.filter(g => g.likely === 'inflow-surge').length,
      surges: cronDelays.concat(gaps.filter(g => g.likely === 'inflow-surge')).slice(-10),
      assessment: concern
        ? '[주의] 최근 48h 누적-지연 반복 — 워커 Cron flush 점검 권장'
        : '정상(최근 48h 누적-지연 없음. 큰 gap은 대부분 조용한 시간대·제보 적음)',
      note: 'cron-delay=gap>20m AND batch≥10(누적). 경보는 최근 48h 반복시만. 큰 gap+작은 batch는 quiet(정상).',
    };
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

// ---- 콘텐츠 항목별 접속(사용) 정도 ----
// usage.json(워커 미러링, 하루 1인 1이벤트 순사용자수)에서 항목별 전체/최근7일 집계·점유율·순위.
// 파일이 없거나 데이터가 없으면 available:false (측정 수단 미도입/무데이터).
const USAGE_LABELS = {
  match: '사주궁합', pair: '최애끼리 궁합', profile: '최애 프로필',
  tri: '지옥의 삼각관계', share: '결과 공유', suggest: '제보 열기',
};
function contentUsage(genDate) {
  if (!usage || typeof usage !== 'object') {
    return { available: false, reason: 'usage.json 없음 — 워커 배포 후 수집 시작' };
  }
  const daily = usage.daily || {};
  const totals = usage.totals || {};
  const dates = Object.keys(daily).sort();
  const hasData = dates.length > 0 && Object.keys(totals).length > 0;
  if (!hasData) {
    return { available: false, reason: '집계 데이터 아직 없음(수집 대기)', updatedAt: usage.updatedAt || null };
  }
  // 최근 7일(genDate 기준) 순사용자수 합
  const end = new Date((genDate || dates[dates.length - 1]) + 'T00:00:00Z');
  const start = new Date(end.getTime() - 6 * 86400000);
  const inWin = (d) => { const t = new Date(d + 'T00:00:00Z'); return t >= start && t <= end; };
  const recent = {};
  for (const d of dates) { if (!inWin(d)) continue; for (const [ev, n] of Object.entries(daily[d])) recent[ev] = (recent[ev] || 0) + n; }
  const recentTotal = Object.values(recent).reduce((s, n) => s + n, 0);
  const allTotal = Object.values(totals).reduce((s, n) => s + n, 0);
  const rank = Object.keys(USAGE_LABELS)
    .map(ev => ({
      event: ev,
      label: USAGE_LABELS[ev],
      recent7d: recent[ev] || 0,
      total: totals[ev] || 0,
      recentSharePct: recentTotal ? Math.round((recent[ev] || 0) / recentTotal * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.recent7d - a.recent7d || b.total - a.total);
  return {
    available: true,
    metric: usage.metric || 'unique-users-per-day (UTC)',
    updatedAt: usage.updatedAt || null,
    daysCovered: dates.length,
    windowDays: 7,
    recentTotal,
    allTotal,
    ranking: rank,
    topContent: rank[0] ? rank[0].label : null,
  };
}

const argDate = (process.argv.find(a => a.startsWith('--date=')) || '').slice(7);
const generatedAt = argDate || new Date().toISOString().slice(0, 10);

const metrics = {
  generatedAt,
  dataset: {
    totalIdols: idols.length,
    totalGroups: groups.size,
    statsTotal: stats.total,
    byCategory: categories,
    byAgency,
    subAgency,
    byGender,
    recentAddsListed: (stats.addedRecent || []).reduce((s, x) => s + (x.count || 0), 0),
  },
  integrity: {
    statsTotalMatches: stats.total === idols.length,
    duplicateCount: dups.length,
    duplicateSamples: dups.slice(0, 5),
  },
  backlog: {
    handled: doneSet.size,
    addPending: pendAdd.length,
    addPendingGroups: backlogGroups,
    errorPending: pendErr.length,
    oldestAddPending: minFirstAt(pendAdd),
    oldestErrorPending: minFirstAt(pendErr),
    topAddPending: [...pendAdd].sort(byCountDesc).slice(0, 5)
      .map(x => ({ name: x.name, group: x.group, count: x.count || 0 })),
    topErrorPending: [...pendErr].sort(byCountDesc).slice(0, 5)
      .map(x => ({ name: x.name, group: x.group, count: x.count || 0, fields: x.fields || {} })),
  },
  i18n: {
    chunksDone: i18nDone,
    chunksTotal: i18nTotal,
    percent: i18nTotal ? Math.round((i18nDone / i18nTotal) * 100) : 0,
  },
  flushCadence: flushCadence(7),
  contentUsage: contentUsage(generatedAt),
};

if (process.argv.includes('--check')) {
  console.log(JSON.stringify(metrics, null, 2));
} else {
  const outDir = path.join(ROOT, 'docs', 'ops');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'metrics-latest.json'), JSON.stringify(metrics, null, 2) + '\n');
  const cu = metrics.contentUsage;
  const cuStr = cu.available ? `top=${cu.topContent}(${cu.recentTotal}/7d)` : 'usage=n/a';
  console.log(`metrics-latest.json written · idols=${metrics.dataset.totalIdols} · addPending=${metrics.backlog.addPending} · errPending=${metrics.backlog.errorPending} · i18n=${metrics.i18n.percent}% · ${cuStr}`);
}
