/* ipa-cmudict.js — nguồn IPA dự phòng: CMU Pronouncing Dictionary (giọng Mỹ).
   Dùng cho các từ mà Wiktionary chưa có mục phát âm (teamwork, freckles, backpacking…).
   Dữ liệu THẬT từ cmusphinx/cmudict; ARPAbet → IPA là chuyển đổi 1-1 chuẩn,
   dấu nhấn lấy từ chỉ số stress của chính từ điển. KHÔNG tự đặt phiên âm.
   File dữ liệu được tải một lần về .cmudict.dict (đã gitignore). */
const fs = require("fs");
const path = require("path");

const DICT_FILE = path.join(__dirname, ".cmudict.dict");
const DICT_URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict";

const MAP = { AA:"ɑ", AE:"æ", AH:"ʌ", AO:"ɔ", AW:"aʊ", AY:"aɪ", B:"b", CH:"t͡ʃ", D:"d", DH:"ð",
  EH:"ɛ", ER:"ɝ", EY:"eɪ", F:"f", G:"ɡ", HH:"h", IH:"ɪ", IY:"i", JH:"d͡ʒ", K:"k", L:"l", M:"m",
  N:"n", NG:"ŋ", OW:"oʊ", OY:"ɔɪ", P:"p", R:"ɹ", S:"s", SH:"ʃ", T:"t", TH:"θ", UH:"ʊ", UW:"u",
  V:"v", W:"w", Y:"j", Z:"z", ZH:"ʒ" };
const VOWELS = new Set(["AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW"]);
const ONSET2 = new Set(["B L","B R","D R","F L","F R","G L","G R","K L","K R","K W","P L","P R",
  "S K","S L","S M","S N","S P","S T","S W","T R","T W","TH R","SH R","HH Y","K Y","P Y","B Y",
  "F Y","M Y","V Y","G W"]);
const ONSET3 = new Set(["S K R","S P L","S P R","S T R","S K W"]);

let dict = null;
let variants = null;

async function ensureDict() {
  if (dict) return dict;
  if (!fs.existsSync(DICT_FILE)) {
    const res = await fetch(DICT_URL, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error("Không tải được CMUdict: HTTP " + res.status);
    fs.writeFileSync(DICT_FILE, await res.text(), "utf8");
  }
  dict = new Map();
  variants = new Map();
  for (const line of fs.readFileSync(DICT_FILE, "utf8").split("\n")) {
    const m = line.match(/^([^ (]+)(\([0-9]+\))? (.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const phones = m[3].trim().split(/\s+/);
    if (!m[2] && !dict.has(key)) dict.set(key, phones);   // cách đọc chính
    if (!variants.has(key)) variants.set(key, []);
    variants.get(key).push(phones);
  }
  return dict;
}

function phonesToIPA(phones) {
  const base = phones.map(p => ({ ph: p.replace(/[0-2]$/, ""), stress: (p.match(/[0-2]$/) || ["0"])[0] }));
  const out = [];
  for (let i = 0; i < base.length; i++) {
    const { ph, stress } = base[i];
    if (VOWELS.has(ph) && stress !== "0") {
      let start = i;
      while (start > 0 && !VOWELS.has(base[start - 1].ph)) start--;
      const cluster = base.slice(start, i).map(x => x.ph);
      let onset;
      if (start === 0) onset = cluster.length;                                   // đầu từ: cả cụm
      else if (cluster.length >= 3 && ONSET3.has(cluster.slice(-3).join(" "))) onset = 3;
      else if (cluster.length >= 2 && ONSET2.has(cluster.slice(-2).join(" "))) onset = 2;
      else onset = Math.min(1, cluster.length);
      out.splice(out.length - onset, 0, stress === "1" ? "ˈ" : "ˌ");
    }
    let sym = MAP[ph];
    if (ph === "AH" && stress === "0") sym = "ə";
    if (ph === "ER" && stress === "0") sym = "ɚ";
    if (!sym) return "";
    out.push(sym);
  }
  return out.join("");
}

/* IPA của một từ (không dấu cách). "" nếu CMUdict không có. */
async function cmuIPA(word) {
  const d = await ensureDict();
  const key = word.toLowerCase().trim();
  const phones = d.get(key);
  if (!phones) return "";
  const body = phonesToIPA(phones);
  return body ? "/" + body + "/" : "";
}

/* Từ ghép có gạch nối/dấu cách: tra từng thành phần rồi ghép (giữ ranh giới từ). */
async function cmuCompoundIPA(term) {
  const parts = term.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return "";
  const ips = [];
  for (const p of parts) {
    const ip = await cmuIPA(p);
    if (!ip) return "";
    ips.push(ip.slice(1, -1));
  }
  return "/" + ips.join(" ") + "/";
}

/* Từ ghép viết liền (soulmate, goosebumps, godparents): tách thành 2 từ CÓ THẬT trong
   CMUdict rồi ghép phiên âm. Chỉ dùng khi mọi nguồn khác đã thất bại; ưu tiên phần đầu dài nhất. */
async function cmuSplitIPA(word) {
  const w = word.toLowerCase().trim();
  if (w.length < 8 || /[^a-z]/.test(w)) return "";
  const d = await ensureDict();
  const SUFFIXES = new Set(["ing","ed","er","ers","est","ly","s","es","en","y","al","ic","ion","ions"]);
  for (let i = w.length - 3; i >= 3; i--) {
    const a = w.slice(0, i), b = w.slice(i);
    if (SUFFIXES.has(b)) continue;                 // hậu tố, không phải từ ghép
    if (d.has(a) && d.has(b)) {
      const ipA = await cmuIPA(a), ipB = await cmuIPA(b);
      if (ipA && ipB) return "/" + ipA.slice(1, -1) + " " + ipB.slice(1, -1) + "/";
    }
  }
  return "";
}

/* Từ chức năng trong cụm được đọc NHẸ (a → /ə/, to → /tə/, of → /əv/). CMUdict có sẵn các
   cách đọc này; chọn biến thể ít trọng âm nhất thay vì dạng nhấn mạnh. */
const FUNCTION_WORDS = new Set(["a","an","the","of","to","and","or","but","in","on","at","for",
  "from","with","as","is","are","was","were","be","been","am","do","does","did","has","had",
  "will","would","can","could","shall","should","that","than","them","us","your","his","her","he","she"]);

async function cmuIPAInPhrase(word) {
  const key = word.toLowerCase().trim();
  await ensureDict();
  if (!FUNCTION_WORDS.has(key) || !variants.has(key)) return cmuIPA(key);
  const score = ph => ph.reduce((a, p) => a + (p.endsWith("1") ? 2 : p.endsWith("2") ? 1 : 0), 0);
  const schwas = ph => ph.filter(p => p === "AH0").length;
  const best = [...variants.get(key)].sort((a, b) => score(a) - score(b) || schwas(b) - schwas(a))[0];
  const body = phonesToIPA(best);
  if (!body) return "";
  // trong cụm, từ chức năng không mang trọng âm → bỏ dấu nhấn (không đổi âm)
  return "/" + body.replace(/[ˈˌ]/g, "") + "/";
}

module.exports = { cmuIPA, cmuIPAInPhrase, cmuCompoundIPA, cmuSplitIPA };
