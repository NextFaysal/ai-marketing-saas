/**
 * Vision + speech extraction over chat media, using the SAME provider
 * configuration as the LLM layer (LLM_PROVIDER / LLM_API_KEY /
 * LLM_MODEL). Without a real provider configured these functions
 * throw an honest configuration error - they never invent a
 * transcription or a payment reading.
 */
export class MediaIntelligenceError extends Error {}

function configuredProvider(): { name: string; key: string; model?: string } {
  const name = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  const key = process.env.LLM_API_KEY ?? "";
  if (!["openai", "anthropic", "gemini"].includes(name) || !key) {
    throw new MediaIntelligenceError(
      "এই ফিচারের জন্য একটি আসল AI provider দরকার (LLM_PROVIDER=openai|anthropic|gemini এবং LLM_API_KEY সেট করুন)। Dev template দিয়ে ছবি/অডিও বিশ্লেষণ সম্ভব নয়।",
    );
  }
  return { name, key, model: process.env.LLM_MODEL || undefined };
}

function parseJsonLoose(text: string): any {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new MediaIntelligenceError("AI provider did not return parseable JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const PAYMENT_PROMPT = `You are verifying a mobile-payment screenshot (Bangladesh: bKash, Nagad, Rocket, or bank transfer). Extract ONLY what is visibly in the image. Respond with strict JSON:
{"provider":"bkash|nagad|rocket|bank|unknown","trxId":string|null,"amount":number|null,"senderNumber":string|null,"receiverNumber":string|null,"datetimeText":string|null,"suspicious":[string]}
- amount is the main-unit number shown (e.g. 1500.00), or null if not readable.
- trxId is the transaction id exactly as shown, or null.
- suspicious lists visible concerns (edited-looking digits, mismatched fonts, cropped edges, blur over the amount) - empty array if none.
If the image is not a payment screenshot, return provider "unknown", trxId null, amount null, and suspicious ["not_a_payment_screenshot"].`;

export interface PaymentExtraction {
  provider: string; trxId: string | null; amount: number | null;
  senderNumber: string | null; receiverNumber: string | null;
  datetimeText: string | null; suspicious: string[];
}

export async function extractPaymentScreenshot(bytes: Buffer, contentType: string, fetchFn: typeof fetch = fetch): Promise<{ extraction: PaymentExtraction; modelProvider: string }> {
  const { name, key, model } = configuredProvider();
  const mediaType = contentType.split(";")[0] || "image/jpeg";
  const base64 = bytes.toString("base64");
  let text = "";
  if (name === "openai") {
    const res = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model ?? "gpt-4o-mini",
        messages: [{ role: "user", content: [
          { type: "text", text: PAYMENT_PROMPT },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
        ] }],
        response_format: { type: "json_object" },
        max_tokens: 500,
      }),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) throw new MediaIntelligenceError(`Vision request failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
    text = body?.choices?.[0]?.message?.content ?? "";
  } else if (name === "anthropic") {
    const res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model ?? "claude-sonnet-4-5",
        max_tokens: 500,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: PAYMENT_PROMPT },
        ] }],
      }),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) throw new MediaIntelligenceError(`Vision request failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
    text = (body?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  } else {
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model ?? "gemini-2.0-flash"}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PAYMENT_PROMPT }, { inline_data: { mime_type: mediaType, data: base64 } }] }],
      }),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) throw new MediaIntelligenceError(`Vision request failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
    text = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  }
  const raw = parseJsonLoose(text);
  return {
    modelProvider: name,
    extraction: {
      provider: String(raw.provider ?? "unknown"),
      trxId: raw.trxId ? String(raw.trxId) : null,
      amount: raw.amount != null && !Number.isNaN(Number(raw.amount)) ? Number(raw.amount) : null,
      senderNumber: raw.senderNumber ? String(raw.senderNumber) : null,
      receiverNumber: raw.receiverNumber ? String(raw.receiverNumber) : null,
      datetimeText: raw.datetimeText ? String(raw.datetimeText) : null,
      suspicious: Array.isArray(raw.suspicious) ? raw.suspicious.map(String) : [],
    },
  };
}

export async function transcribeAudio(bytes: Buffer, contentType: string, fetchFn: typeof fetch = fetch): Promise<{ text: string; modelProvider: string }> {
  const { name, key, model } = configuredProvider();
  if (name === "anthropic") {
    throw new MediaIntelligenceError("Anthropic দিয়ে অডিও ট্রান্সক্রিপশন হয় না। LLM_PROVIDER=openai বা gemini সেট করুন।");
  }
  if (name === "openai") {
    const form = new FormData();
    const ext = contentType.includes("ogg") ? "ogg" : contentType.includes("mpeg") ? "mp3" : contentType.includes("mp4") ? "m4a" : "ogg";
    form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType || "audio/ogg" }), `voice.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", "bn");
    const res = await fetchFn("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) throw new MediaIntelligenceError(`Transcription failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
    if (!body?.text) throw new MediaIntelligenceError("Transcription returned no text");
    return { text: String(body.text), modelProvider: "openai-whisper" };
  }
  // gemini
  const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model ?? "gemini-2.0-flash"}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: "Transcribe this audio exactly as spoken (Bengali or English). Return ONLY the transcript text." },
        { inline_data: { mime_type: contentType.split(";")[0] || "audio/ogg", data: bytes.toString("base64") } },
      ] }],
    }),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok) throw new MediaIntelligenceError(`Transcription failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
  const text = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new MediaIntelligenceError("Transcription returned no text");
  return { text: text.trim(), modelProvider: "gemini" };
}
