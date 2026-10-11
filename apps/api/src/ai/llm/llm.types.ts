export interface LlmMessage { role: "system" | "user" | "assistant"; content: string }
export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  tokensEstimated: boolean;
}

/** One chunk of a streaming completion: zero or more `delta` chunks
 *  followed by exactly one final `result` chunk. */
export interface LlmStreamChunk {
  delta?: string;
  result?: LlmResult;
}

export interface LlmProvider {
  readonly name: string; // openai | anthropic | gemini | dev-template
  readonly isRealLlm: boolean;
  complete(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<LlmResult>;
  /** Optional real streaming. Providers without it are served by the
   *  caller through a single complete() + one delta — never by
   *  simulated typing. */
  completeStream?(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): AsyncIterable<LlmStreamChunk>;
}

export class LlmConfigError extends Error {}

type FetchFn = typeof fetch;

export function estimateTokens(text: string): number {
  // Rough heuristic used ONLY for the dev adapter and labeled as estimated.
  return Math.max(1, Math.ceil(text.length / 4));
}
export { type FetchFn };

/** Split text into word-sized chunks (whitespace kept with the word it
 *  follows) so streaming the dev-template answer — and only that
 *  labelled path — can reuse exactly the same chunking everywhere. */
export function chunkTextByWords(text: string, wordsPerChunk = 8): string[] {
  if (!text) return [];
  const words = text.match(/\S+\s*/g) ?? [text];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(""));
  }
  return chunks;
}

/**
 * Iterate the JSON payloads of an SSE response body (`data:` lines).
 * Handles every body shape the runtime and the unit-test fakes use:
 * web ReadableStream (getReader), async-iterable bodies (Node fetch /
 * fakes yielding string or byte chunks), plain strings, and a text()
 * fallback. A `data: [DONE]` line ends the stream.
 */
export async function* iterateSseJson(body: any): AsyncGenerator<any> {
  if (body == null) return;
  let buffer = "";
  const decoder = new TextDecoder();

  function* drain(final: boolean): Generator<any> {
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { yield JSON.parse(payload); } catch { /* partial/keep-alive lines are not data */ }
    }
    if (final && buffer.trim().startsWith("data:")) {
      const payload = buffer.trim().slice(5).trim();
      buffer = "";
      if (payload && payload !== "[DONE]") {
        try { yield JSON.parse(payload); } catch { /* ignore */ }
      }
    }
  }

  const feed = (chunk: any): string => {
    if (typeof chunk === "string") return chunk;
    if (chunk instanceof Uint8Array) return decoder.decode(chunk, { stream: true });
    return String(chunk ?? "");
  };

  if (typeof body === "string") {
    buffer += body;
    yield* drain(true);
    return;
  }
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += feed(value);
      yield* drain(false);
    }
    buffer += decoder.decode();
    yield* drain(true);
    return;
  }
  if (typeof body[Symbol.asyncIterator] === "function") {
    for await (const chunk of body) {
      buffer += feed(chunk);
      yield* drain(false);
    }
    buffer += decoder.decode();
    yield* drain(true);
    return;
  }
  if (typeof body.text === "function") {
    buffer += await body.text();
    yield* drain(true);
  }
}

/** Shared non-OK handling for streaming calls: the HTTP error body is
 *  plain JSON (never SSE), read exactly like complete() reads it so the
 *  thrown message stays verbatim-identical between the two paths. */
export async function throwStreamHttpError(res: any, label: string): Promise<never> {
  let body: any = {};
  if (typeof res?.json === "function") body = await res.json().catch(() => ({}));
  else if (typeof res?.text === "function") { try { body = JSON.parse(await res.text()); } catch { body = {}; } }
  throw new Error(`${label} request failed (${res?.status ?? 0}): ${body?.error?.message ?? "unknown"}`);
}
