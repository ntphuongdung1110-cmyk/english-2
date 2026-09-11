/* enrich-ipa.js — bổ sung & chuẩn hoá phiên âm IPA cho mọi mục từ vựng.
   Nguồn: en.wiktionary.org (qua ipa-source.js). KHÔNG bịa: không tra được → để trống.

   Quy tắc:
   - Mục 1 nhánh ("gardening", "household chores"): ip = IPA của chính nó.
   - Mục nhiều nhánh ("tight / loose"): tra TỪNG nhánh, gắn nhãn để biết IPA nào của từ nào
     → "tight /taɪt/ · loose /luːs/". (Trước đây chỉ hiện IPA của một nhánh → dễ hiểu nhầm.)
   Chạy: node enrich-ipa.js          (chỉ điền chỗ còn thiếu + sửa mục nhiều nhánh)
         node enrich-ipa.js --all    (tra lại toàn bộ)
*/
const fs = require("fs");
const path = require("path");
const { ipaOf, phraseIPA, strip, saveCache, isDown } = require("./ipa-source.js");
const { cmuIPA, cmuIPAInPhrase, cmuCompoundIPA, cmuSplitIPA } = require("./ipa-cmudict.js");

const DATA_FILE = path.join(__dirname, "ontap-kiemtra-data.js");
const ALL = process.argv.includes("--all");

global.window = {};
require("./ontap-kiemtra-data.js");
const ONTAP = global.window.ONTAP;

const HEADER =
  "/* Dữ liệu ôn tập Nghe Nói — tự động làm giàu bởi enrich.js.\n" +
  "   Trường: s(⭐) e(English) v(Việt) ip(IPA) d(nghĩa EN) x(ví dụ). Topic: img, shadow{en,vi}.\n" +
  "   Nguồn IPA/định nghĩa/ví dụ: Free Dictionary API (dictionaryapi.dev / Wiktionary). */\n";

/* Tách các nhánh "a / b / c". Chỉ tách khi có dấu cách quanh "/" (giữ "breakfast/lunch/dinner"). */
function branches(e) {
  return e.split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean);
}

function cleanTerm(s) {
  return s.replace(/\([^)]*\)/g, " ").replace(/(\.\.\.+|…)+/g, " ").replace(/\s+/g, " ").trim();
}

/* Các biến thể chính tả đáng thử trên Wiktionary (vd easy-going → easygoing). */
function spellingVariants(term) {
  const out = [term];
  if (term.includes("-")) { out.push(term.replace(/-/g, ""), term.replace(/-/g, " ")); }
  if (/is(e|ed|ing|es)\b/.test(term)) out.push(term.replace(/is(e|ed|ing|es)\b/, "iz$1"));   // organised → organized
  if (term.endsWith(".")) out.push(term.slice(0, -1));
  return [...new Set(out.map(t => t.trim()).filter(Boolean))];
}

/* Ghép IPA từng từ cho cụm/câu. Ưu tiên CMUdict để cả cụm cùng một giọng và để các từ
   chức năng (a, in, of…) ra dạng đọc thường, không phải dạng nhấn mạnh của Wiktionary. */
const MAX_PHRASE_WORDS = 12;
async function joinWordIPA(phrase) {
  const words = phrase
    .replace(/\([^)]*\)/g, " ").replace(/(\.\.\.+|…)+/g, " ")
    .replace(/[^A-Za-z' -]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || words.length > MAX_PHRASE_WORDS) return "";
  const parts = [];
  for (const w of words) {
    const ip = (await cmuIPAInPhrase(w)) || (await ipaOf(w));
    if (!ip) return "";
    parts.push(strip(ip));
  }
  return "/" + parts.join(" ") + "/";
}

/* IPA của một nhánh: thử nguyên cụm trước (Wiktionary có trang cho "role model", "bucket list"),
   rồi các biến thể chính tả, cuối cùng mới ghép IPA từng từ. */
async function ipaOfTerm(rawTerm) {
  const term = cleanTerm(rawTerm);
  if (!term) return "";
  // Từ ghép có gạch nối: tách theo gạch nối trước, vì tra nguyên từ hay đặt sai chỗ ngắt
  // âm tiết (cross-country → /ˈkɹɔˌskʌntɹi/ thay vì /ˈkɹɔs ˈkʌntɹi/).
  if (term.includes("-")) {
    const hyphen = await cmuCompoundIPA(term);
    if (hyphen) return hyphen;
  }
  // CMUdict trước: nhất quán một giọng (Mỹ), khớp với giọng đọc en-US của nút 🔊
  for (const v of spellingVariants(term)) {
    if (/[\s/]/.test(v)) continue;
    const cmu = await cmuIPA(v);
    if (cmu) return cmu;
  }
  for (const v of spellingVariants(term)) {
    const direct = await ipaOf(v);
    if (direct) return direct;
  }
  if (/[\s/]/.test(term)) {
    const phrase = await joinWordIPA(term.replace(/\//g, " "));
    if (phrase) return phrase;
  }
  const compound = await cmuCompoundIPA(term.replace(/\//g, " "));
  if (compound) return compound;
  const split = await cmuSplitIPA(term);
  if (split) return split;
  return "";
}

(async () => {
  let filled = 0, relabelled = 0, stillMissing = [], total = 0;

  for (const t of ONTAP) {
    for (const it of t.vocab || []) {
      total++;
      const alts = branches(it.e);
      const isMulti = alts.length > 1;
      // bỏ qua mục 1 nhánh đã có IPA (trừ khi --all); mục nhiều nhánh luôn chuẩn hoá lại
      if (!ALL && it.ip && !isMulti) continue;
      if (!ALL && isMulti && / \/[^ ]| · /.test(it.ip || "")) continue;   // đã gắn nhãn rồi

      const parts = [];
      for (const alt of alts) {
        const ip = await ipaOfTerm(alt);
        if (ip) parts.push(isMulti ? cleanTerm(alt) + " /" + strip(ip) + "/" : ip);
      }
      if (!parts.length) { if (!it.ip) stillMissing.push(it.e); continue; }

      const next = parts.join(" · ");
      if (next === it.ip) continue;
      if (it.ip) relabelled++; else filled++;
      it.ip = next;
    }
    process.stdout.write(".");
    saveCache();
  }

  fs.writeFileSync(DATA_FILE, HEADER + "window.ONTAP = " + JSON.stringify(ONTAP, null, 1) + ";\n", "utf8");
  saveCache();

  const withIp = ONTAP.reduce((a, t) => a + (t.vocab || []).filter(v => v.ip).length, 0);
  console.log("\n--- IPA ---");
  console.log({ total, withIp, filled, relabelled, missing: total - withIp });
  console.log("Còn thiếu IPA:", stillMissing.length ? stillMissing.join(" | ") : "(none)");
  if (isDown()) console.log("⚠️  Nguồn Wiktionary đã ngắt giữa chừng — chạy lại để tra tiếp.");
})();
