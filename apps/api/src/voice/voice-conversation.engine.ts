import type { VoiceConversationFacts } from "./voice-conversation.types";

/**
 * NF3 (FB2): pure deterministic conversation state machine.
 *
 * Deliberately NOT an LLM free-chat: a keyword intent matcher
 * over Bengali + English phrases, and every agent line is a
 * TEMPLATE filled only from the facts object (real order +
 * OrgBrain PUBLIC facts). No free generation anywhere.
 */

export type ConversationState =
  | "greeting"
  | "awaiting_decision"
  | "collecting_address"
  | "collecting_time"
  | "confirming_cancel"
  | "done";

export type ConversationIntent =
  | "confirm"
  | "cancel"
  | "change_address"
  | "change_time"
  | "human"
  | "unknown";

export type ConversationAction =
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "address"; address: string }
  | { type: "time"; timeText: string }
  | { type: "human"; reason: string };

export interface ClassifiedIntent {
  intent: ConversationIntent;
  confidence: number;
}

export interface EngineStep {
  nextState: ConversationState;
  intent: ConversationIntent;
  confidence: number;
  agentLine: string;
  unknownCount: number;
  action?: ConversationAction;
}

const KEYWORDS: Record<Exclude<ConversationIntent, "unknown">, string[]> = {
  confirm: ["হ্যাঁ", "ঠিক আছে", "নিশ্চিত", "কনফার্ম", "confirm", "yes"],
  cancel: ["বাতিল", "cancel", "লাগবে না", "চাই না", "নেব না"],
  change_address: ["ঠিকানা", "address"],
  change_time: ["সময়", "পরে", "কালকে", "delivery time", "reschedule"],
  human: ["মানুষ", "এজেন্ট", "কর্মী", "human", "agent"],
};

// "ok" / "ওকে" count as confirmation ONLY while awaiting the
// decision (spec) — elsewhere they are too ambiguous to act on.
const CONFIRM_OK = ["ok", "ওকে"];

export function classify(
  text: string,
  state?: ConversationState,
): ClassifiedIntent {
  const t = String(text ?? "").toLowerCase();
  const matched: ConversationIntent[] = [];
  for (const [intent, words] of Object.entries(KEYWORDS) as [
    Exclude<ConversationIntent, "unknown">,
    string[],
  ][]) {
    if (words.some((w) => t.includes(w.toLowerCase()))) matched.push(intent);
  }
  if (
    (!state || state === "awaiting_decision" || state === "greeting") &&
    CONFIRM_OK.some((w) => t.includes(w.toLowerCase())) &&
    !matched.includes("confirm")
  ) {
    matched.push("confirm");
  }
  if (matched.length === 1) return { intent: matched[0], confidence: 0.9 };
  // Ambiguous (>=2 intents) is treated as unknown by callers.
  if (matched.length >= 2) return { intent: "unknown", confidence: 0.3 };
  return { intent: "unknown", confidence: 0 };
}

export function buildGreeting(facts: VoiceConversationFacts): string {
  const customerPart = facts.customerName ? `${facts.customerName}, ` : "";
  const deliveryPart = facts.deliveryFactLines?.length
    ? ` ${facts.deliveryFactLines.join(" ")}`
    : "";
  return (
    `আসসালামু আলাইকুম। ${customerPart}${facts.brandName} থেকে বলছি। ` +
    `আপনার অর্ডার: ${facts.itemsSummary}, মোট ${facts.totalFormatted} টাকার ক্যাশ অন ডেলিভারি অর্ডার।${deliveryPart} ` +
    `আপনি কি অর্ডারটি নিশ্চিত করছেন? নিশ্চিত করতে বলুন হ্যাঁ, বাতিল করতে বলুন বাতিল, ` +
    `ঠিকানা বদলাতে বলুন ঠিকানা, ডেলিভারির সময় বদলাতে বলুন সময়, আর কর্মীর সঙ্গে কথা বলতে বলুন এজেন্ট।`
  );
}

function repromptLine(facts: VoiceConversationFacts): string {
  return (
    `দুঃখিত, ঠিক বুঝতে পারিনি। আপনার অর্ডারটি (${facts.itemsSummary}, মোট ${facts.totalFormatted}) ` +
    `নিশ্চিত করতে বলুন হ্যাঁ, বাতিল করতে বলুন বাতিল, ঠিকানা বদলাতে বলুন ঠিকানা, সময় বদলাতে বলুন সময়, কর্মীর জন্য বলুন এজেন্ট।`
  );
}

export function step(input: {
  state: ConversationState;
  text: string;
  facts: VoiceConversationFacts;
  unknownCount?: number;
}): EngineStep {
  const { state, facts } = input;
  const text = String(input.text ?? "").trim();
  const unknowns = input.unknownCount ?? 0;

  // --- Collection states: the next utterance IS the value. ---
  if (state === "collecting_address") {
    if (text.length >= 8) {
      return {
        nextState: "done",
        intent: "change_address",
        confidence: 0.9,
        agentLine: `ধন্যবাদ। আপনার নতুন ঠিকানা নোট করা হয়েছে: ${text}। আমাদের টিম এই ঠিকানাতেই ডেলিভারি দেবে।`,
        unknownCount: 0,
        action: { type: "address", address: text },
      };
    }
    return {
      nextState: "collecting_address",
      intent: "change_address",
      confidence: 0.3,
      agentLine: "ঠিকানাটি আরেকটু বিস্তারিত বলুন — বাসা/হোল্ডিং, রোড, এলাকা ও শহরসহ পুরো ঠিকানাটি বলুন।",
      unknownCount: unknowns,
    };
  }

  if (state === "collecting_time") {
    if (text.length > 0) {
      return {
        nextState: "done",
        intent: "change_time",
        confidence: 0.9,
        agentLine: `ধন্যবাদ। আপনার অনুরোধের ডেলিভারি সময় নোট করা হয়েছে: ${text}। আমাদের টিম এটি যাচাই করে ব্যবস্থা নেবে।`,
        unknownCount: 0,
        action: { type: "time", timeText: text },
      };
    }
    return {
      nextState: "collecting_time",
      intent: "change_time",
      confidence: 0.3,
      agentLine: "কোন সময়ে ডেলিভারি চান, সেটি বলুন — যেমন কালকে সকালে বা বিকেল ৫টায়।",
      unknownCount: unknowns,
    };
  }

  const { intent, confidence } = classify(text, state);

  // Human wins from any decision state.
  if (intent === "human") {
    return {
      nextState: "done",
      intent,
      confidence,
      agentLine: "ঠিক আছে, আমি আমাদের একজন কর্মীকে জানিয়ে দিচ্ছি — তিনি আপনাকে কল করবেন। ধন্যবাদ।",
      unknownCount: 0,
      action: { type: "human", reason: "customer_requested" },
    };
  }

  // --- Cancel confirmation state: only a second cancel acts. ---
  if (state === "confirming_cancel") {
    if (intent === "cancel") {
      return {
        nextState: "done",
        intent,
        confidence,
        agentLine: "আপনার অর্ডারটি বাতিল করা হয়েছে। ধন্যবাদ।",
        unknownCount: 0,
        action: { type: "cancel" },
      };
    }
    if (intent === "confirm") {
      return {
        nextState: "awaiting_decision",
        intent,
        confidence,
        agentLine: "ঠিক আছে, অর্ডারটি বাতিল হচ্ছে না। আপনি কি অর্ডারটি নিশ্চিত করছেন? বলুন হ্যাঁ।",
        unknownCount: 0,
      };
    }
    return {
      nextState: "confirming_cancel",
      intent,
      confidence,
      agentLine: "বাতিল নিশ্চিত করতে আবার বলুন বাতিল। অর্ডারটি রাখতে চাইলে বলুন হ্যাঁ।",
      unknownCount: unknowns,
    };
  }

  // --- awaiting_decision / greeting ---
  switch (intent) {
    case "confirm":
      return {
        nextState: "done",
        intent,
        confidence,
        agentLine: "ধন্যবাদ! আপনার অর্ডারটি নিশ্চিত করা হয়েছে। আমরা দ্রুত ডেলিভারির ব্যবস্থা করছি।",
        unknownCount: 0,
        action: { type: "confirm" },
      };
    case "cancel":
      return {
        nextState: "confirming_cancel",
        intent,
        confidence,
        agentLine: "আপনি অর্ডারটি বাতিল করতে চাইছেন। বাতিল নিশ্চিত করতে আবার বলুন বাতিল।",
        unknownCount: 0,
      };
    case "change_address":
      return {
        nextState: "collecting_address",
        intent,
        confidence,
        agentLine: facts.address
          ? `আপনার বর্তমান ঠিকানা: ${facts.address}। নতুন পুরো ঠিকানাটি বলুন।`
          : "নতুন পুরো ঠিকানাটি বলুন — বাসা/হোল্ডিং, রোড, এলাকা ও শহরসহ।",
        unknownCount: 0,
      };
    case "change_time":
      return {
        nextState: "collecting_time",
        intent,
        confidence,
        agentLine: "কোন সময়ে ডেলিভারি চান, সেটি বলুন — যেমন কালকে সকালে বা বিকেল ৫টায়।",
        unknownCount: 0,
      };
    default: {
      const nextUnknowns = unknowns + 1;
      if (nextUnknowns >= 2) {
        return {
          nextState: "done",
          intent: "unknown",
          confidence,
          agentLine: "দুঃখিত, আমি ঠিক বুঝতে পারছি না। আমি আমাদের একজন কর্মীকে জানিয়ে দিচ্ছি — তিনি আপনাকে কল করবেন। ধন্যবাদ।",
          unknownCount: nextUnknowns,
          action: { type: "human", reason: "two_unknown_intents" },
        };
      }
      return {
        nextState: "awaiting_decision",
        intent: "unknown",
        confidence,
        agentLine: repromptLine(facts),
        unknownCount: nextUnknowns,
      };
    }
  }
}

export const VoiceConversationEngine = { classify, buildGreeting, step };
