import { Injectable, Optional } from "@nestjs/common";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * NF2 (FB1) — Short Video Studio rendering PORT + the v1 local
 * ffmpeg template implementation (design: docs/nf2-video
 * -provider-spike.md). NO external AI video provider is selected
 * (owner decision D3 pending) — v1 renders a TEMPLATE video from
 * the product's own images: vertical 1080×1920 mp4, one slide per
 * image with a Ken Burns (zoompan) motion, and a bottom band with
 * the product name + formatted price (+ optional offer line).
 * It is template rendering, never AI generation, and is labelled
 * as such everywhere it surfaces.
 *
 * Honesty rules (spike §৩):
 *  - The binary is checked BEFORE any work. Missing ffmpeg →
 *    VideoRenderError with the Bengali label below; the caller
 *    records status=failed + that label and creates NO asset.
 *  - Any ffmpeg failure → VideoRenderError carrying a trimmed
 *    tail of ffmpeg's own stderr as the reason — never a silent
 *    or fabricated success.
 *
 * The binary path is injectable (constructor arg / FFMPEG_PATH
 * env, default "ffmpeg") so specs can point it at a bogus path
 * and prove the missing-binary branch portably.
 */

export interface VideoRenderInput {
  /** Local image files, already resolved + downloaded by the
   * service through the existing storage machinery. */
  imagePaths: string[];
  productName: string;
  /** Price text, pre-formatted by the caller via formatMinor. */
  priceText: string;
  offerText?: string | null;
  language: "bn" | "en";
  template: string; // "showcase" | "offer" (service-validated)
  /** Scratch dir owned by the caller; the output lands inside. */
  workDir: string;
}

export interface VideoRenderResult {
  filePath: string;
  durationSec: number;
  width: number;
  height: number;
}

/** Typed render failure — `label` is the merchant-readable
 * Bengali reason that lands on VideoProject.errorLabel verbatim. */
export class VideoRenderError extends Error {
  readonly label: string;
  constructor(label: string) {
    super(label);
    this.name = "VideoRenderError";
    this.label = label;
  }
}

export interface VideoGenerationProvider {
  render(input: VideoRenderInput): Promise<VideoRenderResult>;
}

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const SLIDE_SECONDS = 3;
export const MAX_SLIDES = 5; // 5 × 3s = the 15s cap
const SLIDE_FRAMES = SLIDE_SECONDS * 30;

const FONT_CANDIDATES: Record<"bn" | "en", string[]> = {
  // fonts-noto-core in the runtime image ships the Noto Sans
  // family under /usr/share/fonts/truetype/noto (the PP1 poster
  // rasterizer relies on the same package for Bengali text).
  bn: [
    "/usr/share/fonts/truetype/noto/NotoSansBengali-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
  ],
  en: [
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  ],
};

/** First EXISTING font file for the language, or null (the
 * caller then falls back to a fontconfig family name). */
export function resolveFontFile(language: "bn" | "en"): string | null {
  for (const candidate of FONT_CANDIDATES[language]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function runFfmpeg(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }, (err: any, _stdout, stderr) => {
      if (!err) return resolve();
      if (err?.code === "ENOENT") {
        reject(new VideoRenderError("ffmpeg পাওয়া যায়নি — সার্ভারে ভিডিও রেন্ডার সম্ভব নয়"));
        return;
      }
      const tail = String(stderr ?? "").trim().split("\n").slice(-3).join(" ").slice(0, 300);
      reject(new VideoRenderError(`ভিডিও রেন্ডার ব্যর্থ হয়েছে${tail ? `: ${tail}` : ""}`));
    });
  });
}

@Injectable()
export class FfmpegTemplateVideoProvider implements VideoGenerationProvider {
  /** Public seam (the SocialImportService pattern): specs may
   * substitute the binary path after construction too. */
  binaryPath: string;

  // @Optional: Nest has no String provider to inject — without it
  // the API fails to BOOT ("can't resolve dependencies of
  // FfmpegTemplateVideoProvider (?)", proven by the FB1 boot-smoke
  // gate). Nest passes undefined, the fallback chain below applies;
  // direct construction in specs passes the path explicitly.
  constructor(@Optional() binaryPath?: string) {
    this.binaryPath = binaryPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  }

  /** Fail fast with the honest label when ffmpeg is absent —
   * checked before a single slide is attempted. */
  async assertBinaryAvailable(): Promise<void> {
    await runFfmpeg(this.binaryPath, ["-version"]);
  }

  async render(input: VideoRenderInput): Promise<VideoRenderResult> {
    const images = (input.imagePaths ?? []).slice(0, MAX_SLIDES);
    if (images.length === 0) {
      throw new VideoRenderError("ভিডিও বানানোর জন্য পণ্যের কোনো ছবি পাওয়া যায়নি");
    }
    await this.assertBinaryAvailable();

    // One slide per image: scale/crop to cover 1080×1920 at 2×,
    // then zoompan from a single still frame → SLIDE_FRAMES
    // frames of slow zoom (Ken Burns). Verified shape: h264,
    // 1080×1920, exactly SLIDE_SECONDS per slide.
    const slidePaths: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const slide = join(input.workDir, `slide-${i}.mp4`);
      const vf = [
        `scale=${VIDEO_WIDTH * 2}:${VIDEO_HEIGHT * 2}:force_original_aspect_ratio=increase`,
        `crop=${VIDEO_WIDTH * 2}:${VIDEO_HEIGHT * 2}`,
        `zoompan=z='min(1+0.0015*on,1.4)':d=${SLIDE_FRAMES}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=30`,
        "setsar=1",
      ].join(",");
      await runFfmpeg(this.binaryPath, [
        "-y", "-i", images[i],
        "-vf", vf,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
        slide,
      ]);
      slidePaths.push(slide);
    }

    let joined = slidePaths[0];
    if (slidePaths.length > 1) {
      joined = join(input.workDir, "joined.mp4");
      const listPath = join(input.workDir, "concat.txt");
      await writeFile(listPath, slidePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
      await runFfmpeg(this.binaryPath, [
        "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", joined,
      ]);
    }

    // Text band: product name + price (+ offer line when the
    // template is "offer" and a text was supplied). Text goes
    // through textfile= so tenant text needs NO ffmpeg escaping.
    const namePath = join(input.workDir, "name.txt");
    const pricePath = join(input.workDir, "price.txt");
    await writeFile(namePath, input.productName.slice(0, 80), "utf8");
    await writeFile(pricePath, input.priceText.slice(0, 40), "utf8");
    const fontFile = resolveFontFile(input.language);
    const fontArg = fontFile
      ? `fontfile=${fontFile}`
      : `font=${input.language === "bn" ? "Noto Sans Bengali" : "Noto Sans"}`;
    const filters = [
      `drawbox=x=0:y=${VIDEO_HEIGHT - 400}:w=${VIDEO_WIDTH}:h=400:color=black@0.55:t=fill`,
      `drawtext=${fontArg}:textfile=${namePath}:fontsize=62:fontcolor=white:x=48:y=${VIDEO_HEIGHT - 360}`,
      `drawtext=${fontArg}:textfile=${pricePath}:fontsize=76:fontcolor=white:x=48:y=${VIDEO_HEIGHT - 250}`,
    ];
    const offer = (input.offerText ?? "").trim();
    if (input.template === "offer" && offer) {
      const offerPath = join(input.workDir, "offer.txt");
      await writeFile(offerPath, offer.slice(0, 80), "utf8");
      filters.push(
        `drawtext=${fontArg}:textfile=${offerPath}:fontsize=54:fontcolor=0xFFD166:x=48:y=${VIDEO_HEIGHT - 130}`,
      );
    }

    const output = join(input.workDir, "output.mp4");
    await runFfmpeg(this.binaryPath, [
      "-y", "-i", joined,
      "-vf", filters.join(","),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      output,
    ]);

    return {
      filePath: output,
      durationSec: images.length * SLIDE_SECONDS,
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
    };
  }
}

/** DI token for the port (specs substitute a stub provider). */
export const VIDEO_GENERATION_PROVIDER = "VIDEO_GENERATION_PROVIDER";
