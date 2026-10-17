import sharp from "sharp";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegBin, isFfmpegAvailable } from "../inbox/audio-transcode";

export { isFfmpegAvailable };

/**
 * CA2 — slideshow video assembly for AI video ads.
 *
 * Honest scope: this renders a SLIDESHOW from the product's
 * own photos — a slow Ken Burns zoom per photo with a Bengali
 * text band — encoded as a real MP4 (libx264/yuv420p). It is
 * not filmed footage and is never presented as such. Text is
 * drawn through an SVG overlay composited by sharp — the same
 * rendering path the Social poster flow (PP1) proves renders
 * Bengali correctly in this stack.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy word-wrap to at most `maxLines` lines of ~`maxChars`. */
export function wrapSlideText(text: string, maxChars: number, maxLines = 2): string[] {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) { current = candidate; continue; }
    if (current) lines.push(current);
    if (lines.length >= maxLines) break;
    current = word.slice(0, maxChars);
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === 0) lines.push("");
  const joined = lines.join(" ");
  if (joined !== words.join(" ")) {
    const last = lines.length - 1;
    lines[last] = `${lines[last].slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
}

/**
 * One slideshow frame: the photo cover-cropped to the target
 * aspect, with a bottom band carrying title (+ optional
 * subtitle). Returns PNG bytes at exactly width×height.
 */
export async function renderSlidePng(input: {
  photo: Buffer;
  width: number;
  height: number;
  title?: string;
  subtitle?: string;
  bandColor?: string;
}): Promise<Buffer> {
  const { width, height } = input;
  const bandColor = /^#[0-9a-fA-F]{6}$/.test(input.bandColor ?? "") ? (input.bandColor as string) : "#111827";
  const base = sharp(input.photo).resize(width, height, { fit: "cover", position: "centre" });
  const title = (input.title ?? "").trim();
  const subtitle = (input.subtitle ?? "").trim();
  if (!title && !subtitle) return base.png().toBuffer();

  const bandH = Math.round(height * 0.30);
  const titleSize = Math.round(width * 0.058);
  const subSize = Math.round(width * 0.042);
  const maxChars = Math.max(10, Math.floor(width / (titleSize * 0.52)));
  const lines = title ? wrapSlideText(title, maxChars, 2) : [];
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`);
  parts.push(`<rect x="0" y="${height - bandH}" width="${width}" height="${bandH}" fill="${bandColor}" opacity="0.93"/>`);
  const tspans = lines
    .map((line, i) => `<tspan x="${Math.round(width * 0.05)}" dy="${i === 0 ? 0 : Math.round(titleSize * 1.25)}">${escapeXml(line)}</tspan>`)
    .join("");
  if (lines.length) {
    parts.push(`<text x="${Math.round(width * 0.05)}" y="${height - bandH + Math.round(bandH * 0.42)}" font-size="${titleSize}" font-weight="bold" fill="#FFFFFF" font-family="sans-serif">${tspans}</text>`);
  }
  if (subtitle) {
    parts.push(`<text x="${Math.round(width * 0.05)}" y="${height - Math.round(bandH * 0.16)}" font-size="${subSize}" fill="#FFFFFF" opacity="0.95" font-family="sans-serif">${escapeXml(subtitle)}</text>`);
  }
  parts.push(`</svg>`);
  return base.composite([{ input: Buffer.from(parts.join(""), "utf8"), top: 0, left: 0 }]).png().toBuffer();
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBin(), args, { timeout: 240_000, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${String(stderr ?? err.message).slice(-600)}`));
      else resolve();
    });
  });
}

/**
 * Assemble frame PNGs into one MP4: each frame becomes a
 * segment with a slow zoom (Ken Burns), segments are then
 * concatenated (identical codec/size/fps, stream copy).
 * Throws with ffmpeg's own tail message on any failure —
 * callers surface it; nothing is half-produced.
 */
export async function assembleSlideshowMp4(
  frames: { png: Buffer; seconds: number }[],
  opts: { width: number; height: number; fps?: number },
): Promise<Buffer> {
  if (!frames.length) throw new Error("assembleSlideshowMp4 needs at least one frame");
  const fps = opts.fps ?? 25;
  const { width, height } = opts;
  const dir = await mkdtemp(join(tmpdir(), "ca2-slides-"));
  try {
    const segments: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const framePath = join(dir, `frame-${i}.png`);
      const segPath = join(dir, `seg-${i}.mp4`);
      await writeFile(framePath, frames[i].png);
      const totalFrames = Math.max(1, Math.round(frames[i].seconds * fps));
      const vf = [
        `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase`,
        `crop=${width * 2}:${height * 2}`,
        `zoompan=z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps}`,
        "format=yuv420p",
      ].join(",");
      await runFfmpeg([
        "-y", "-i", framePath,
        "-vf", vf,
        "-frames:v", String(totalFrames),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(fps),
        segPath,
      ]);
      segments.push(segPath);
    }
    const listPath = join(dir, "list.txt");
    await writeFile(listPath, segments.map((s) => `file '${s}'`).join("\n"), "utf8");
    const outPath = join(dir, "out.mp4");
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
