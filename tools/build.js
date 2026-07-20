#!/usr/bin/env node
// Canonical dataset builder for saju-idol-match.
// Source of truth: tools/idols.json  →  writes the IDOLS array in index.html.
// Computes each idol's day pillar from the birthdate two independent ways
// and cross-checks them, so a bad date can never silently ship.
//
//   node tools/build.js          # rebuild index.html from idols.json
//   node tools/build.js --check  # validate only, do not write
const fs = require('fs');
const path = require('path');

const STEMS = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCHES = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
const EN = ["木","火","土","金","水"], SEI = [0,0,1,1,2,2,3,3,4,4];
const AGENCIES = new Set(["HYBE","SM","YG","JYP","기타"]);

const mod = (n,m)=>((n%m)+m)%m;
// Method 1: Julian Day Number (Fliegel–Van Flandern)
function jdn(y,m,d){const a=Math.floor((14-m)/12),y2=y+4800-a,m2=m+12*a-3;return d+Math.floor((153*m2+2)/5)+365*y2+Math.floor(y2/4)-Math.floor(y2/100)+Math.floor(y2/400)-32045;}
function pillarJDN(y,m,d){const j=jdn(y,m,d),s=mod(j+9,10),b=mod(j+1,12);return{p:STEMS[s]+BRANCHES[b],e:EN[SEI[s]]};}
// Method 2: day-count from a known anchor (1995-07-19 = 辛亥 = gapja #47)
function pillarDATE(y,m,d){const diff=Math.round((Date.UTC(y,m-1,d)-Date.UTC(1995,6,19))/86400000);const idx=mod(47+diff,60);return STEMS[idx%10]+BRANCHES[idx%12];}

const ROOT = path.resolve(__dirname, '..');
const idxPath = path.join(ROOT, 'index.html');
const CHECK = process.argv.includes('--check');

const idols = JSON.parse(fs.readFileSync(path.join(__dirname,'idols.json'),'utf8'));

const rows=[], seen=new Set();
const errors=[], mismatch=[], dupes=[];
for(const it of idols){
  const {name,group,agency,gender,dob}=it||{};
  const cat = (it&&it.cat) || "K-idol"; // 카테고리(기본 한국 아이돌)
  if(!name||!group){ errors.push('missing name/group: '+JSON.stringify(it)); continue; }
  // 한국 아이돌만 5대 소속사 버킷을 강제. 그 외 카테고리는 agency가 하위 분류 라벨(자유 문자열).
  if(cat==="K-idol"){ if(!AGENCIES.has(agency)){ errors.push(`${name}/${group}: bad agency ${agency}`); continue; } }
  else if(!agency){ errors.push(`${name}/${group}: missing agency label`); continue; }
  if(gender!=='M'&&gender!=='F'){ errors.push(`${name}/${group}: bad gender ${gender}`); continue; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dob||'')){ errors.push(`${name}/${group}: bad dob ${dob}`); continue; }
  const [y,m,d]=dob.split('-').map(Number);
  if(y<1940||y>2015||m<1||m>12||d<1||d>31){ errors.push(`${name}/${group}: dob out of range ${dob}`); continue; }
  const a=pillarJDN(y,m,d);
  if(a.p!==pillarDATE(y,m,d)){ mismatch.push(`${name}/${group} ${dob}: JDN=${a.p} DATE=${pillarDATE(y,m,d)}`); continue; }
  const key=name+'|'+group;
  if(seen.has(key)){ dupes.push(key); continue; }
  seen.add(key);
  rows.push([name,group,a.p,a.e,gender,agency,dob.replace(/-/g,''),cat]);
}

// anchor re-check
const anchors=[["1993-05-16","丁酉"],["1997-09-01","丙午"],["1995-01-03","甲午"],["1994-09-12","辛丑"],["2004-08-31","壬午"],["1995-07-19","辛亥"]];
const anchorFails=anchors.filter(([dob,exp])=>{const [y,m,d]=dob.split('-').map(Number);return pillarJDN(y,m,d).p!==exp;});

const agency={}, gender={}, category={};
rows.forEach(r=>{agency[r[5]]=(agency[r[5]]||0)+1; gender[r[4]]=(gender[r[4]]||0)+1; category[r[7]]=(category[r[7]]||0)+1;});

const report={total:rows.length, errors, computeMismatch:mismatch, duplicates:dupes, anchorFails:anchorFails.map(a=>a.join('->')), category, agency, gender};
console.log(JSON.stringify(report,null,2));

const fatal = errors.length || mismatch.length || anchorFails.length;
if(fatal){ console.error('\nBUILD ABORTED: fix the issues above.'); process.exit(1); }
if(CHECK){ console.log('\n--check OK (no write).'); process.exit(0); }

let html=fs.readFileSync(idxPath,'utf8');
const open='const IDOLS = [', close='\n];';
const i=html.indexOf(open); if(i<0){ console.error('IDOLS array not found'); process.exit(1); }
const j=html.indexOf(close, i);
const lines=rows.map(r=>`  ["${r[0]}","${r[1]}","${r[2]}","${r[3]}","${r[4]}","${r[5]}","${r[6]}","${r[7]}"]`).join(',\n');
html=html.slice(0,i+open.length)+"\n"+lines+"\n"+html.slice(j+1); // +1 drops the leading \n of close
fs.writeFileSync(idxPath,html);
console.log(`\nWrote ${rows.length} idols into index.html`);
