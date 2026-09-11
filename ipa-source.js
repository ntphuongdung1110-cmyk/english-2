/* ipa-source.js — lấy IPA THẬT của một từ tiếng Anh từ Wiktionary (en.wiktionary.org).
   Dùng khi dictionaryapi.dev không phản hồi, và để phủ các từ dictionaryapi.dev không có IPA.
   KHÔNG bịa: không tìm được → trả "".
   Ưu tiên giọng Mỹ (GA) cho khớp với giọng đọc en-US của nút 🔊 trong app. */
const fs = require("fs");
const path = require("path");

const CACHE_FILE = path.join(__dirname, ".ipa-cache.json");
const API = "https://en.wiktionary.org/w/api.php";
const UA = "english-study-app/1.0 (personal English learning app; contact: dung.nguyen@gotit.vn)";
const TIMEOUT_MS = 10000;
const DELAY_MS = 150;           // lịch sự với Wikimedia
const MAX_CONSECUTIVE_FAILS = 5;

let cache = {};
if (fs.existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { cache = {}; }
}
let consecutiveFails = 0;
let sourceDown = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function saveCache() { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); }

/* Cắt lấy phần ==English== của wikitext (tránh lấy nhầm IPA tiếng khác). */
function englishSection(wikitext) {
  const start = wikitext.search(/^==\s*English\s*==\s*$/m);
  if (start < 0) return "";
  const rest = wikitext.slice(start + 1);
  const next = rest.search(/^==[^=]+==\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

/* Lấy IPA chuẩn: ưu tiên GA/US (khớp giọng đọc en-US của app), rồi RP/UK, rồi dòng không nhãn.
   Bỏ qua giọng địa phương (Scotland, Ireland, Úc…) và dạng đọc nhẹ/nhấn — chúng gây sai
   khi ghép cụm (vd "sale" giọng Scotland cho /seːl/ thay vì /seɪl/). */
const ACCENT_US = /\{\{a\|(GA|GenAm|US|America)/i;
const ACCENT_UK = /\{\{a\|(RP|UK|British|Received Pronunciation)/i;
const ACCENT_ANY = /\{\{a\|/;
function pickIPA(wikitext) {
  const en = englishSection(wikitext);
  if (!en) return "";
  const lines = en.split("\n").filter(l => l.includes("{{IPA|en|"));
  if (!lines.length) return "";
  const line = lines.find(l => ACCENT_US.test(l))
            || lines.find(l => ACCENT_UK.test(l))
            || lines.find(l => !ACCENT_ANY.test(l))
            || lines[0];
  const m = line.match(/\{\{IPA\|en\|([^}|]+)/);
  if (!m) return "";
  const ip = m[1].trim();
  if (!/^[\/\[]/.test(ip)) return "";            // chỉ nhận /.../ hoặc [...]
  if (/\{\{|\}\}/.test(ip)) return "";
  return ip.replace(/<[^>]*>/g, "").trim();
}

/* IPA của MỘT từ/cụm có trang riêng trên Wiktionary. "" nếu không có. */
async function ipaOf(word) {
  const key = word.toLowerCase().trim();
  if (!key) return "";
  if (key in cache) return cache[key];
  if (sourceDown) return "";

  const url = API + "?action=parse&prop=wikitext&format=json&formatversion=2&page=" + encodeURIComponent(key);
  let text = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "accept": "application/json", "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 404) { text = ""; break; }
      if (!res.ok) { await sleep(600); continue; }
      const json = await res.json();
      if (json.error) { text = ""; break; }        // trang không tồn tại
      text = (json.parse && json.parse.wikitext) || "";
      break;
    } catch { await sleep(700); }
  }
  if (text === null) {
    if (++consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
      sourceDown = true;
      console.warn("\n⚠️  en.wiktionary.org không phản hồi — dừng tra IPA, giữ nguyên dữ liệu đã có.");
    }
    return "";
  }
  consecutiveFails = 0;
  const ip = text ? pickIPA(text) : "";
  cache[key] = ip;
  await sleep(DELAY_MS);
  return ip;
}

const strip = ip => ip.replace(/^[\/\[]+/, "").replace(/[\/\]]+$/, "").trim();

/* IPA cho cụm nhiều từ: ghép IPA THẬT của từng từ. Thiếu 1 từ → "" (không ghép nửa vời). */
async function phraseIPA(phrase, maxWords = 12) {
  const words = phrase
    .replace(/\([^)]*\)/g, " ")
    .replace(/(\.\.\.+|…)+/g, " ")
    .replace(/[^A-Za-z' -]/g, " ")
    .replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || words.length > maxWords) return "";
  const parts = [];
  for (const w of words) {
    const ip = await ipaOf(w);
    if (!ip) return "";
    parts.push(strip(ip));
  }
  return "/" + parts.join(" ") + "/";
}

module.exports = { ipaOf, phraseIPA, strip, saveCache, isDown: () => sourceDown };
