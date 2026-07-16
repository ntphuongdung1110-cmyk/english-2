/* enrich.js — làm giàu dữ liệu ôn tập:
   - Lấy phiên âm IPA (ip) + định nghĩa tiếng Anh dễ hiểu (d) + ví dụ (x) từ Free Dictionary API
     (https://dictionaryapi.dev — nguồn Wiktionary). KHÔNG bịa: chỉ gắn khi API trả về.
   - Gắn ảnh chủ đề (img) và đoạn văn shadowing (shadow) từ enrich-content.js.
   Chạy: node enrich.js         (dùng cache nếu có)
         node enrich.js --fresh (bỏ cache, tải lại)
*/
const fs = require("fs");
const path = require("path");
const { IMG_KEYWORDS, SHADOW } = require("./enrich-content.js");
const OVERRIDE = require("./enrich-overrides.js");

const DATA_FILE  = path.join(__dirname, "ontap-kiemtra-data.js");
const CACHE_FILE = path.join(__dirname, ".dict-cache.json");
const FRESH = process.argv.includes("--fresh");

// ---- load ONTAP ----
global.window = {};
require("./ontap-kiemtra-data.js");
const ONTAP = global.window.ONTAP;

// ---- cache ----
let cache = {};
if (!FRESH && fs.existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { cache = {}; }
}

// ---- headword extraction ----
// Trả về danh sách "ứng viên" để tra API, ưu tiên chính xác trước.
function candidates(raw) {
  let s = raw.trim();
  // bỏ phần "..." (I'm interested in... -> I'm interested in)
  s = s.replace(/\.\.\.+$/,"").trim();
  // các nhánh khi có "a / b" (thử nhánh đầu trước, rồi các nhánh sau)
  const alts = s.split(/\s*\/\s*/).map(x => x.trim()).filter(Boolean);
  const firstAlt = alts[0] || s;
  const list = [];
  const push = v => { v = v.trim(); if (v && !list.includes(v)) list.push(v); };

  const clean = v => v
    .replace(/\([^)]*\)/g, " ")     // bỏ (with), (up)...
    .replace(/[.,!?"“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const a = clean(firstAlt);
  push(a);
  // biến thể "I'm interested in" -> "interested"
  const stripped = a.replace(/^(i'?m|i am|i'?ve|to)\s+/i, "").trim();
  push(stripped);
  // cụm nhiều từ: thử từ CUỐI (danh từ đầu) và từ ĐẦU (động từ cụm)
  const words = a.split(" ").filter(Boolean);
  if (words.length > 1) {
    push(words[words.length - 1]);
    push(words[0]);
  }
  // thử các nhánh còn lại của "a / b / c"
  for (let i = 1; i < alts.length; i++) {
    const c = clean(alts[i]);
    push(c);
    const cw = c.split(" ").filter(Boolean);
    if (cw.length > 1) { push(cw[cw.length - 1]); push(cw[0]); }
  }
  return list.filter(w => /^[a-zA-Z][a-zA-Z'\- ]*$/.test(w));
}

// ---- chọn định nghĩa ĐÚNG NGHĨA THÔNG DỤNG, dễ hiểu ----
// Wiktionary xếp POS không nhất quán và có nhiều nghĩa cổ/hiếm.
// Chấm điểm để ưu tiên nghĩa phổ thông (có ví dụ, không cổ, gọn), ưu tiên tính từ.
const ARCHAIC = /\b(obsolete|archaic|dated|rare|dialect|heraldr|poetic|law|nonstandard)\b/i;
const POS_BONUS = { adjective: 3, verb: 1, noun: 1, adverb: 0 };

function scoreDef(o, idx) {
  let s = 0;
  const t = o.def.toLowerCase();
  if (o.ex) s += 4;
  if (ARCHAIC.test(t)) s -= 7;
  s += (POS_BONUS[o.pos] || 0);
  const len = o.def.length;
  if (len < 15) s -= 3;
  else if (len <= 170) s += 2;
  // nghĩa "gốc" của từ điển thường đứng đầu trong mỗi POS
  s -= idx * 0.15;
  return s;
}

function pickDefAndExample(entries) {
  const defs = [];
  for (const e of entries) {
    for (const m of (e.meanings || [])) {
      (m.definitions || []).forEach((d, i) => {
        if (d.definition) defs.push({ def: d.definition.trim(), ex: (d.example || "").trim(), pos: m.partOfSpeech, i });
      });
    }
  }
  if (!defs.length) return { d: "", x: "" };
  defs.forEach(o => { o.score = scoreDef(o, o.i); });
  defs.sort((a, b) => b.score - a.score);
  const chosen = defs[0];
  let ex = chosen.ex;
  if (!ex) {
    const withEx = defs.filter(o => o.ex && o.ex.length <= 120).sort((a, b) => b.score - a.score);
    if (withEx.length) ex = withEx[0].ex;
  }
  return { d: chosen.def, x: ex };
}

function pickIPA(entries) {
  for (const e of entries) {
    if (e.phonetic && /[\/\[]/.test(e.phonetic)) return e.phonetic.trim();
  }
  for (const e of entries) {
    for (const p of (e.phonetics || [])) {
      if (p.text && p.text.trim()) return p.text.trim();
    }
  }
  return "";
}

// cache lưu RAW entries (mảng JSON) hoặc null → đổi cách chọn nghĩa không cần tải lại
async function fetchRaw(word) {
  const key = word.toLowerCase();
  if (key in cache) return cache[key];
  const url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(key);
  let raw = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "accept": "application/json" } });
      if (res.status === 404) { raw = null; break; }
      if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
      if (!res.ok) { await sleep(600); continue; }
      const json = await res.json();
      raw = (Array.isArray(json) && json.length) ? json : null;
      break;
    } catch (err) { await sleep(700); }
  }
  cache[key] = raw;
  return raw;
}

async function lookup(word) {
  const raw = await fetchRaw(word);
  if (!raw) return null;
  return { ip: pickIPA(raw), ...pickDefAndExample(raw) };
}

// IPA cho cụm/câu: ghép IPA THẬT của từng từ (nguồn API). Bỏ dấu câu.
// Nếu có 1 từ không tra được IPA → trả "" (không ghép nửa vời).
const MAX_IPA_WORDS = 12;
function ipaWords(e) {
  let s = /\s\/\s/.test(e) ? e.split(/\s\/\s/)[0] : e.replace(/\//g, " ");
  s = s.replace(/\([^)]*\)/g, " ").replace(/(\.\.\.+|…)+/g, " ");
  s = s.replace(/[^A-Za-z' -]/g, " ").replace(/\s+/g, " ").trim();
  return s.split(" ").filter(Boolean);
}
async function buildPhraseIPA(e) {
  const words = ipaWords(e);
  if (!words.length || words.length > MAX_IPA_WORDS) return "";
  const parts = [];
  for (const w of words) {
    const raw = await fetchRaw(w.toLowerCase());
    const ip = raw ? pickIPA(raw) : "";
    if (!ip) return "";
    parts.push(ip.replace(/^[\/\[]+/, "").replace(/[\/\]]+$/, "").trim());
  }
  return "/" + parts.join(" ") + "/";
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function enrichVocabItem(it) {
  const cands = candidates(it.e);
  let hit = null, hitWord = null, isExact = false;
  for (let i = 0; i < cands.length; i++) {
    const r = await lookup(cands[i]);
    if (r) { hit = r; hitWord = cands[i]; isExact = (i === 0); break; }
  }
  const ov = OVERRIDE[it.e];
  if (!hit && !ov) return { it, status: "miss" };
  const out = { ...it };
  // IPA: chỉ gắn khi MỌI nhánh "a / b" đều là từ đơn (vd "shy / introverted").
  // Câu/cụm như "He/She is full of energy." KHÔNG gắn IPA (tránh dùng IPA của 1 thành phần).
  const altTokens = it.e.replace(/(\.\.\.+|…)+\s*$/, "").split(/\s*\/\s*/).map(a => a.replace(/\([^)]*\)/g, "").trim());
  const singleWordEligible = altTokens.length > 0 && altTokens.every(a => a && !/\s/.test(a));
  if (hit && hit.ip && singleWordEligible) out.ip = hit.ip;
  // cụm/câu: ghép IPA từng từ (nguồn API)
  if (!out.ip) {
    const phraseIp = await buildPhraseIPA(it.e);
    if (phraseIp) out.ip = phraseIp;
  }
  // định nghĩa + ví dụ: OVERRIDE (người soạn) thắng; hỗ trợ override chỉ-ví-dụ (không có d)
  if (ov) {
    if (ov.d) out.d = ov.d; else if (hit && hit.d) out.d = hit.d;
    if (ov.x) out.x = ov.x; else if (!out.x && hit && hit.x) out.x = hit.x;
  } else {
    if (hit.d) out.d = hit.d;
    if (!out.x && hit.x) out.x = hit.x;   // giữ ví dụ có sẵn, chỉ điền khi trống
  }
  return { it: out, status: out.ip ? "full" : "partial", hitWord };
}

(async () => {
  // validate: mọi key OVERRIDE phải khớp một mục vocab.e thực tế
  const allE = new Set();
  ONTAP.forEach(t => (t.vocab || []).forEach(v => allE.add(v.e)));
  const badKeys = Object.keys(OVERRIDE).filter(k => !allE.has(k));
  if (badKeys.length) {
    console.error("⚠️  OVERRIDE keys KHÔNG khớp vocab.e (sẽ bị bỏ qua):\n  " + badKeys.join("\n  "));
  } else {
    console.log("✓ Tất cả " + Object.keys(OVERRIDE).length + " OVERRIDE keys khớp vocab.e");
  }

  let stats = { total: 0, full: 0, partial: 0, miss: 0, ip: 0, def: 0, ex: 0, override: 0 };
  const misses = [];

  for (let ti = 0; ti < ONTAP.length; ti++) {
    const t = ONTAP[ti];
    // shadowing (ảnh đã bỏ cho nhẹ)
    if (SHADOW[ti]) t.shadow = SHADOW[ti];

    if (Array.isArray(t.vocab) && t.vocab.length) {
      const newVocab = [];
      for (const it of t.vocab) {
        stats.total++;
        const { it: enriched, status, hitWord } = await enrichVocabItem(it);
        newVocab.push(enriched);
        if (status === "full") stats.full++;
        else if (status === "partial") stats.partial++;
        else { stats.miss++; misses.push(it.e); }
        if (enriched.ip) stats.ip++;
        if (enriched.d) stats.def++;
        if (enriched.x) stats.ex++;
      }
      t.vocab = newVocab;
    }
    process.stdout.write("."); // progress
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  }
  console.log("\n--- Enrichment stats ---");
  console.log(stats);
  console.log("Vocab thiếu IPA/định nghĩa (giữ nguyên):", misses.length ? misses.join(" | ") : "(none)");

  // ---- serialize back ----
  const header = "/* Dữ liệu ôn tập Nghe Nói — tự động làm giàu bởi enrich.js.\n" +
    "   Trường: s(⭐) e(English) v(Việt) ip(IPA) d(nghĩa EN) x(ví dụ). Topic: img, shadow{en,vi}.\n" +
    "   Nguồn IPA/định nghĩa/ví dụ: Free Dictionary API (dictionaryapi.dev / Wiktionary). */\n";
  const body = "window.ONTAP = " + JSON.stringify(ONTAP, null, 1) + ";\n";
  fs.writeFileSync(DATA_FILE, header + body, "utf8");
  console.log("Wrote", DATA_FILE, "(" + (header + body).length + " bytes)");
})();
