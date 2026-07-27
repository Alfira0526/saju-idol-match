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

const ROOT = path.resolve(__dirname, '..');
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
const doneSet = new Set((Array.isArray(done) ? done : []).map(x => (typeof x === 'string' ? x : x && x.key)));

// ---- dataset coverage ----
const groups = new Set(), byCat = {}, byAgency = {}, byGender = {};
for (const it of idols) {
  const cat = it.cat || 'K-idol';
  byCat[cat] = (byCat[cat] || 0) + 1;
  byAgency[it.agency || '기타'] = (byAgency[it.agency || '기타'] || 0) + 1;
  byGender[it.gender || '?'] = (byGender[it.gender || '?'] || 0) + 1;
  groups.add(`${it.group}`);
}
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

// ---- i18n progress (checkbox tally in i18n-plan.md) ----
let i18nDone = 0, i18nTotal = 0;
try {
  const plan = fs.readFileSync(T('i18n-plan.md'), 'utf8');
  i18nDone = (plan.match(/\[x\]/gi) || []).length;
  i18nTotal = (plan.match(/\[[ x]\]/gi) || []).length;
} catch {}

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
};

if (process.argv.includes('--check')) {
  console.log(JSON.stringify(metrics, null, 2));
} else {
  const outDir = path.join(ROOT, 'docs', 'ops');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'metrics-latest.json'), JSON.stringify(metrics, null, 2) + '\n');
  console.log(`metrics-latest.json written · idols=${metrics.dataset.totalIdols} · addPending=${metrics.backlog.addPending} · errPending=${metrics.backlog.errorPending} · i18n=${metrics.i18n.percent}%`);
}
