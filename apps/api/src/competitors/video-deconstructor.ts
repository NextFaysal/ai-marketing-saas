import { Injectable } from "@nestjs/common";
import { LlmFactory } from "../ai/llm/llm.factory";

export interface ScriptScene {
  timeRange: string; // e.g. "0:00 - 0:03"
  phase: "Scroll-Stopping Hook" | "Problem & Agitation" | "Product Reveal & Demo" | "Social Proof & Urgency" | "Offer & CTA";
  visualCue: string; // B-roll / camera angle
  audioVoiceover: string; // Spoken Bengali & English dialogue
  onScreenText: string; // Headline overlay
  directorNotes: string; // Emotion, pacing, camera movement
}

export interface DeconstructedVideoScript {
  competitorAdId: string;
  /** HF5: how this draft was produced — "ai" = a real LLM generated it
   *  from the ad's text; "template" = the built-in template draft. The
   *  UI badges it ("AI খসড়া" / "টেমপ্লেট খসড়া"); neither is an analysis
   *  of the competitor's actual video, which is never fetched. */
  origin: "ai" | "template";
  format: "TikTok & Reels (9:16)" | "Feed Video (1:1)";
  totalDurationSeconds: number;
  hookCategory: "Shock Value" | "Curiosity Gap" | "Visual Transformation" | "Before & After" | "Pattern Interrupt";
  competitorHookBreakdown: {
    firstThreeSecondsHook: string;
    whyItRetainsViewers: string;
    coreEmotionalTrigger: string;
  };
  adaptedScript: {
    conceptTitle: string;
    targetProductName: string;
    scenes: ScriptScene[];
    fullVoiceoverBangla: string;
    creatorShootingChecklist: string[];
    suggestedAudioTrack: string;
  };
}

export class VideoScriptDeconstructor {
  constructor(private readonly llm: LlmFactory) {}

  async deconstruct(params: {
    competitorName: string;
    adText: string;
    platforms: string[];
    adId: string;
    targetProductName?: string;
    videoStyle?: string;
  }): Promise<DeconstructedVideoScript> {
    const { competitorName, adText, adId, targetProductName, videoStyle = "ugc" } = params;
    const productName = targetProductName || "Premium Quality Product";

    const isFashionOrApparel = /panjabi|shirt|dress|clothing|saree|watch|shoes|bag/i.test(adText + " " + productName);

    const fallbackScenes: ScriptScene[] = [
      {
        timeRange: "0:00 - 0:03",
        phase: "Scroll-Stopping Hook",
        visualCue: "Close-up macro shot of product, rapid hands-on unboxing or dramatic gesture stopping the camera scroll.",
        audioVoiceover: "আপনার কি এখনো অনলাইন থেকে অর্ডার করতে ভয় লাগে?",
        onScreenText: "অনলাইন অর্ডারে প্রতারণা বন্ধ! ❌",
        directorNotes: "High-energy, direct eye contact with camera, fast cut.",
      },
      {
        timeRange: "0:03 - 0:10",
        phase: "Problem & Agitation",
        visualCue: "Frustrated customer showing typical poor quality or delayed delivery from generic online shops.",
        audioVoiceover: "ছবিতে এক রকম আর বাস্তবে আরেক রকম পণ্য পাওয়ার অভিজ্ঞতা নিশ্চয়ই আপনারও হয়েছে?",
        onScreenText: "ছবি vs বাস্তব? আর না!",
        directorNotes: "Empathetic body language, relatability trigger.",
      },
      {
        timeRange: "0:10 - 0:24",
        phase: "Product Reveal & Demo",
        visualCue: `Slow-motion reveal of ${productName}. Testing fabric/quality directly under bright ring light.`,
        audioVoiceover: `এই দেখুন আমাদের ১০০% অরিজিনাল ${productName}। প্রিমিয়াম ফিনিশিং এবং সর্বোচ্চ কোয়ালিটি সরাসরি দেখে নেওয়ার সুযোগ!`,
        onScreenText: `১০০% অরিজিনাল ${productName} ✨`,
        directorNotes: "Crisp lighting, ASMR sound effects, touch texture clearly.",
      },
      {
        timeRange: "0:24 - 0:34",
        phase: "Social Proof & Urgency",
        visualCue: "Stack of packaged parcel boxes ready to ship with customer review screenshots popping on screen.",
        audioVoiceover: "এই দেখুন প্রিমিয়াম কালেকশনটি সরাসরি, কোনো এডিট ছাড়াই — যেমন দেখছেন, হুবহু তেমনই পাবেন।",
        onScreenText: "ক্যাশ অন ডেলিভারি | পণ্য দেখে পেমেন্ট 📦",
        directorNotes: "Fast-paced pop-up animations, trust reinforcement.",
      },
      {
        timeRange: "0:34 - 0:45",
        phase: "Offer & CTA",
        visualCue: "Creator pointing down toward Order Now button with website offer badge.",
        audioVoiceover: "ডেলিভারি ম্যানের সামনে প্রোডাক্ট দেখে চেক করে মূল্য পরিশোধের সুযোগ। স্টক শেষ হওয়ার আগেই এখনই অর্ডার করুন!",
        onScreenText: "ক্যাশ অন ডেলিভারি | স্টক সীমিত ⚡",
        directorNotes: "Friendly confident smile, urgent call-to-action gesture.",
      },
    ];

    const fallback: DeconstructedVideoScript = {
      competitorAdId: adId,
      origin: "template",
      format: "TikTok & Reels (9:16)",
      totalDurationSeconds: 45,
      hookCategory: "Pattern Interrupt",
      competitorHookBreakdown: {
        firstThreeSecondsHook: `খসড়া অনুমান: ${competitorName}-এর বিজ্ঞাপনের টেক্সটের ভিত্তিতে হুকটি সম্ভবত ক্রেতার পরিচিত একটি সমস্যা দিয়ে শুরু হয় — আসল ভিডিওটি দেখা হয়নি, তাই এটি নিশ্চিত তথ্য নয়।`,
        whyItRetainsViewers: "খসড়া অনুমান: curiosity gap ও সরাসরি প্রোডাক্ট ডেমো ধারণাটি এই টেমপ্লেটের ধারণা — পরিমাপ করা retention তথ্য নয়।",
        coreEmotionalTrigger: "সম্ভাব্য ট্রিগার (খসড়া অনুমান): FOMO (Fear of Missing Out) ও trust anxiety relief।",
      },
      adaptedScript: {
        conceptTitle: `${productName} — High-Retention UGC Video Formula`,
        targetProductName: productName,
        scenes: fallbackScenes,
        fullVoiceoverBangla:
          "আপনার কি এখনো অনলাইন থেকে অর্ডার করতে ভয় লাগে? ছবিতে এক রকম আর বাস্তবে আরেক রকম পণ্য পাওয়ার অভিজ্ঞতা নিশ্চয়ই আপনারও হয়েছে? এই দেখুন আমাদের ১০০% অরিজিনাল প্রোডাক্ট। ডেলিভারি ম্যানের সামনে চেক করে টাকা দেওয়ার গ্যারান্টি। স্টক শেষ হওয়ার আগেই এখনই অর্ডার করুন!",
        creatorShootingChecklist: [
          "Use vertical 9:16 format with 4K 60fps mobile camera",
          "Ensure bright daylight or dual softbox lighting on the product",
          "Keep background authentic (home, studio desk, or lifestyle setting)",
          "Maintain rapid cuts every 2.5 to 3 seconds to keep retention high",
          "Include clear on-screen subtitles for muted viewers",
        ],
        suggestedAudioTrack: "Upbeat Lo-Fi E-commerce Groove or Trending TikTok Pop Instrumental (No Copyright)",
      },
    };

    try {
      const provider = this.llm.getProvider();
      const prompt = `You are an elite UGC video director and TikTok/Reels marketing scriptwriter for Bangladeshi and global e-commerce brands.
Competitor: ${competitorName}
Competitor Creative Ad Text: "${adText}"
Target Product: "${productName}"
Video Style: "${videoStyle}"

Task:
Deconstruct the winning video pattern of this ad and produce a scene-by-scene viral 9:16 video script (approx 35-45 seconds) in Bengali + English.
Format as JSON matching this schema:
{
  "hookCategory": "Pattern Interrupt",
  "competitorHookBreakdown": {
    "firstThreeSecondsHook": "...",
    "whyItRetainsViewers": "...",
    "coreEmotionalTrigger": "..."
  },
  "adaptedScript": {
    "conceptTitle": "...",
    "targetProductName": "${productName}",
    "scenes": [
      {
        "timeRange": "0:00 - 0:03",
        "phase": "Scroll-Stopping Hook",
        "visualCue": "...",
        "audioVoiceover": "...",
        "onScreenText": "...",
        "directorNotes": "..."
      },
      {
        "timeRange": "0:03 - 0:10",
        "phase": "Problem & Agitation",
        "visualCue": "...",
        "audioVoiceover": "...",
        "onScreenText": "...",
        "directorNotes": "..."
      },
      {
        "timeRange": "0:10 - 0:25",
        "phase": "Product Reveal & Demo",
        "visualCue": "...",
        "audioVoiceover": "...",
        "onScreenText": "...",
        "directorNotes": "..."
      },
      {
        "timeRange": "0:25 - 0:35",
        "phase": "Social Proof & Urgency",
        "visualCue": "...",
        "audioVoiceover": "...",
        "onScreenText": "...",
        "directorNotes": "..."
      },
      {
        "timeRange": "0:35 - 0:45",
        "phase": "Offer & CTA",
        "visualCue": "...",
        "audioVoiceover": "...",
        "onScreenText": "...",
        "directorNotes": "..."
      }
    ],
    "fullVoiceoverBangla": "...",
    "creatorShootingChecklist": ["...", "..."],
    "suggestedAudioTrack": "..."
  }
}`;

      const res = await provider.complete(
        [{ role: "system", content: "You are an award-winning TikTok, Reels & Meta video ad director." }, { role: "user", content: prompt }],
        { jsonMode: true },
      );

      const parsed = JSON.parse(res.text.match(/\{[\s\S]*\}/)?.[0] || "{}");
      if (parsed?.adaptedScript?.scenes?.length) {
        return {
          competitorAdId: adId,
          origin: "ai",
          format: "TikTok & Reels (9:16)",
          totalDurationSeconds: 45,
          hookCategory: parsed.hookCategory || fallback.hookCategory,
          competitorHookBreakdown: {
            firstThreeSecondsHook: parsed.competitorHookBreakdown?.firstThreeSecondsHook || fallback.competitorHookBreakdown.firstThreeSecondsHook,
            whyItRetainsViewers: parsed.competitorHookBreakdown?.whyItRetainsViewers || fallback.competitorHookBreakdown.whyItRetainsViewers,
            coreEmotionalTrigger: parsed.competitorHookBreakdown?.coreEmotionalTrigger || fallback.competitorHookBreakdown.coreEmotionalTrigger,
          },
          adaptedScript: {
            conceptTitle: parsed.adaptedScript.conceptTitle || fallback.adaptedScript.conceptTitle,
            targetProductName: productName,
            scenes: parsed.adaptedScript.scenes,
            fullVoiceoverBangla: parsed.adaptedScript.fullVoiceoverBangla || fallback.adaptedScript.fullVoiceoverBangla,
            creatorShootingChecklist: parsed.adaptedScript.creatorShootingChecklist || fallback.adaptedScript.creatorShootingChecklist,
            suggestedAudioTrack: parsed.adaptedScript.suggestedAudioTrack || fallback.adaptedScript.suggestedAudioTrack,
          },
        };
      }
    } catch {
      // Return rich fallback
    }

    return fallback;
  }
}
