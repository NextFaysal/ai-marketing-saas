export interface PolicyFinding {
  rule: string;
  severity: "high" | "medium" | "low";
  snippet: string;
  explanation: string;
  suggestion: string;
}

/**
 * Deterministic Meta ad-policy pre-flight checks (Phase L).
 * Rule-based on purpose: the same text always gets the same answer,
 * every finding quotes the offending snippet, and each carries a
 * plain-language explanation + a safer direction. This does NOT
 * guarantee Meta approval — it catches the preventable rejections
 * that most often hurt BD advertisers.
 */
const RULES: { rule: string; severity: PolicyFinding["severity"]; patterns: RegExp[]; explanation: string; suggestion: string }[] = [
  {
    rule: "personal_attributes", severity: "high",
    patterns: [/\bare you\b/i, /\bdo you (have|suffer from|struggle)\b/i, /\byour (age|weight|skin|hair)\b/i, /আপনি কি/, /তুমি কি/, /আপনার (বয়স|ওজন|ত্বক)/],
    explanation: "Meta নিষেধ করে এমন বিজ্ঞাপন যা ব্যবহারকারীর ব্যক্তিগত বৈশিষ্ট্য (বয়স, ওজন, ত্বক, স্বাস্থ্য) নির্দেশ করে বা প্রশ্ন করে — এমন লেখা থাকলে বিজ্ঞাপন প্রায়ই Reject হয়।",
    suggestion: "বৈশিষ্ট্যের বদলে পণ্যের সুবিধা লিখুন: \"আপনি কি মোটা?\" এর বদলে \"আরামদায়ক ফিট, সব সাইজে পাওয়া যায়\"।",
  },
  {
    rule: "before_after_weight", severity: "high",
    patterns: [/before\s*(and|&)\s*after/i, /আগে\s*(ও|এবং)\s*পরে/, /(ওজন|weight).{0,28}(কমে|কমবে|কমান|loss|lose|reduce)/i, /(কমে|কমবে).{0,20}(কেজি|kg)/i, /(কেজি|kg).{0,16}(কমে|কমবে|কমাতে)/i, /[\d০-৯]+\s*(kg|কেজি)\s*(কম|loss)/i],
    explanation: "Before/After ধারণা ও নির্দিষ্ট ওজন কমার দাবি Meta-র স্বাস্থ্য নীতিতে উচ্চ-ঝুঁকির — অ্যাকাউন্ট সীমাবদ্ধ হওয়ার সাধারণ কারণ।",
    suggestion: "সংখ্যা/তুলনা বাদ দিয়ে জীবনধারা-কেন্দ্রিক লেখা ব্যবহার করুন, ফলাফলের প্রতিশ্রুতি ছাড়া।",
  },
  {
    rule: "guaranteed_results", severity: "medium",
    patterns: [/100\s*%\s*(guaranteed|কার্যকর|ফল)/i, /গ্যারান্টিসহ|গ্যারান্টি/, /guaranteed (results|income|profit)/i, /একদিনেই|এক রাতেই/, /overnight (results|success)/i, /miracle|অলৌকিক/i],
    explanation: "নিশ্চিত ফলাফলের প্রতিশ্রুতি বিভ্রান্তিকর দাবি হিসেবে ধরা হয় এবং বিজ্ঞাপন নামিয়ে দেওয়ার পাশাপাশি পেজের মানও কমায়।",
    suggestion: "\"অনেক ক্রেতা পছন্দ করেছেন\" জাতীয় যাচাইযোগ্য সামাজিক প্রমাণ ব্যবহার করুন, নিশ্চয়তা নয়।",
  },
  {
    rule: "health_claims", severity: "medium",
    patterns: [/\b(cure|cures|treats|heals)\b/i, /সারিয়ে (তুল|দে)/, /ডায়াবেটিস|diabetes/i, /ক্যান্সার|cancer/i, /রোগ\s*(ভালো|সারে)/],
    explanation: "রোগ সারানোর দাবি বিশেষ ক্যাটাগরির নীতিমালার আওতায় পড়ে; প্রমাণ ছাড়া এমন দাবি Reject ও অ্যাকাউন্ট সতর্কতার কারণ হয়।",
    suggestion: "পণ্যের উপাদান/ব্যবহারবিধি বলুন, চিকিৎসাগত ফলাফলের দাবি নয়।",
  },
  {
    rule: "prohibited_content", severity: "high",
    patterns: [/gambling|casino|জুয়া|ক্যাসিনো/i, /bitcoin|বিটকয়েন|crypto investment/i, /quick loan|সহজ ঋণ/i],
    explanation: "এই বিষয়গুলো Meta তে নিষিদ্ধ বা বিশেষ অনুমতি সাপেক্ষ — বিজ্ঞাপন চলবে না, অ্যাকাউন্ট ঝুঁকিতে পড়তে পারে।",
    suggestion: "এই সেবা Meta তে প্রচার করা যাবে না; অনুমোদিত চ্যানেল বিবেচনা করুন।",
  },
];

export function policyFindingsForText(text: string): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  const clean = String(text ?? "");
  if (!clean.trim()) return findings;
  for (const r of RULES) {
    for (const pattern of r.patterns) {
      const m = clean.match(pattern);
      if (m) {
        findings.push({ rule: r.rule, severity: r.severity, snippet: m[0], explanation: r.explanation, suggestion: r.suggestion });
        break; // one finding per rule per text
      }
    }
  }
  const letters = clean.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12) {
    const upper = letters.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length > 0.4) {
      findings.push({
        rule: "excessive_caps", severity: "low", snippet: clean.slice(0, 40),
        explanation: "অতিরিক্ত বড় হাতের লেখা Meta-র কাছে নিম্নমানের বিজ্ঞাপনের সংকেত।",
        suggestion: "স্বাভাবিক বাক্যে লিখুন, জোর দিতে সর্বোচ্চ একটি শব্দ বড় হাতে রাখুন।",
      });
    }
  }
  const emojiCount = (clean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
  if (emojiCount > 5) {
    findings.push({
      rule: "emoji_overload", severity: "low", snippet: `${emojiCount} emojis`,
      explanation: "মাত্রাতিরিক্ত ইমোজি বিজ্ঞাপনের মানের স্কোর কমায়।",
      suggestion: "সর্বোচ্চ ২-৩টি প্রাসঙ্গিক ইমোজি রাখুন।",
    });
  }
  if (/!{3,}|\?{3,}/.test(clean)) {
    findings.push({
      rule: "hype_punctuation", severity: "low", snippet: clean.match(/!{3,}|\?{3,}/)?.[0] ?? "!!!",
      explanation: "পরপর একাধিক বিস্ময় চিহ্ন স্প্যাম-ধাঁচের লেখা হিসেবে ধরা হয়।",
      suggestion: "একটি বিস্ময় চিহ্নই যথেষ্ট।",
    });
  }
  return findings;
}
