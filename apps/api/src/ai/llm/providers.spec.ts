import { OpenAiProvider } from "./openai.provider";
import { AnthropicProvider } from "./anthropic.provider";
import { DevTemplateProvider } from "./dev.provider";
import { LlmConfigError } from "./llm.types";

describe("LLM providers", () => {
  it("OpenAI provider maps chat completion + usage", async () => {
    const fetchFn = async () => ({
      ok: true, status: 200,
      json: async () => ({ model: "gpt-4o-mini", choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    }) as any;
    const p = new OpenAiProvider("sk-test", undefined, fetchFn);
    const r = await p.complete([{ role: "user", content: "hi" }]);
    expect(r).toMatchObject({ text: "hello", inputTokens: 10, outputTokens: 5, tokensEstimated: false });
    expect(p.isRealLlm).toBe(true);
  });
  it("Anthropic provider separates the system prompt and joins text blocks", async () => {
    let sentBody: any = null;
    const fetchFn = async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ model: "claude-x", content: [{ type: "text", text: "ans" }], usage: { input_tokens: 7, output_tokens: 3 } }) } as any;
    };
    const p = new AnthropicProvider("key", undefined, fetchFn as any);
    const r = await p.complete([{ role: "system", content: "be good" }, { role: "user", content: "q" }]);
    expect(r.text).toBe("ans");
    expect(sentBody.system).toBe("be good");
    expect(sentBody.messages).toEqual([{ role: "user", content: "q" }]);
  });
  it("missing keys are configuration errors, never silent", () => {
    expect(() => new OpenAiProvider("")).toThrow(LlmConfigError);
    expect(() => new AnthropicProvider("")).toThrow(LlmConfigError);
  });
  it("dev adapter is honestly labeled as not a real LLM", async () => {
    const p = new DevTemplateProvider();
    expect(p.isRealLlm).toBe(false);
    expect(p.name).toBe("dev-template");
    const r = await p.complete([{ role: "user", content: "anything" }]);
    expect(r.text).toContain("DEV TEMPLATE");
    expect(r.tokensEstimated).toBe(true);
  });
});
