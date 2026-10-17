import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { assembleSlideshowMp4, renderSlidePng, wrapSlideText } from "./video-slides";

/**
 * CA2 — slideshow assembly, REAL sharp + REAL ffmpeg.
 *
 * The ffmpeg-dependent test runs the actual binary on tiny
 * fixtures (320×320, 1s/frame) and probes the output with
 * ffprobe. When ffmpeg/ffprobe are absent on the host the
 * test is SKIPPED with the reason in its name path (console),
 * never fake-passed — the service layer separately refuses
 * honestly when ffmpeg is unavailable.
 */

function ffmpegOk(): boolean {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "pipe" }); execFileSync("ffprobe", ["-version"], { stdio: "pipe" }); return true; }
  catch { return false; }
}
const FFMPEG_OK = ffmpegOk();
if (!FFMPEG_OK) console.warn("CA2: ffmpeg/ffprobe not available on this host — assembly test SKIPPED (service refuses honestly in this state)");
const itFfmpeg = FFMPEG_OK ? it : it.skip;

async function photoPng(width: number, height: number, rgb: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: rgb } }).png().toBuffer();
}

describe("CA2 wrapSlideText", () => {
  it("wraps Bengali text into at most 2 lines with an ellipsis on overflow", () => {
    const lines = wrapSlideText("খুব সুন্দর একটি পাঞ্জাবি সবার জন্য উপযোগী কালেকশন", 12, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.join(" ")).toContain("…");
  });
  it("short text stays on one line untouched", () => {
    expect(wrapSlideText("নতুন কালেকশন", 24, 2)).toEqual(["নতুন কালেকশন"]);
  });
});

describe("CA2 renderSlidePng (real sharp)", () => {
  it("renders a slide at the exact target size with a Bengali title band", async () => {
    const photo = await photoPng(600, 400, { r: 200, g: 60, b: 60 });
    const out = await renderSlidePng({ photo, width: 320, height: 320, title: "কটন পাঞ্জাবি", subtitle: "দাম ৳1,500" });
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(320);
    // The band changes the bottom rows vs a plain cover crop:
    // compare against the same photo rendered without text.
    const plain = await renderSlidePng({ photo, width: 320, height: 320 });
    expect(out.equals(plain)).toBe(false);
  });
});

describe("CA2 assembleSlideshowMp4 (real ffmpeg)", () => {
  itFfmpeg("assembles 2 frames into a real H.264 MP4 at the target size/duration", async () => {
    const p1 = await renderSlidePng({ photo: await photoPng(400, 400, { r: 40, g: 120, b: 200 }), width: 320, height: 320, title: "প্রথম" });
    const p2 = await renderSlidePng({ photo: await photoPng(400, 400, { r: 30, g: 160, b: 90 }), width: 320, height: 320, title: "দ্বিতীয়" });
    const mp4 = await assembleSlideshowMp4([{ png: p1, seconds: 1 }, { png: p2, seconds: 1 }], { width: 320, height: 320 });
    expect(mp4.length).toBeGreaterThan(1000);
    // ftyp box near the head of a real MP4.
    expect(mp4.subarray(4, 8).toString("ascii")).toBe("ftyp");
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "ca2-probe-"));
    try {
      const file = join(dir, "out.mp4");
      await writeFile(file, mp4);
      const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { stdio: "pipe" }).toString());
      const video = probe.streams.find((s: any) => s.codec_type === "video");
      expect(video.codec_name).toBe("h264");
      expect(video.width).toBe(320);
      expect(video.height).toBe(320);
      const duration = Number(probe.format.duration);
      expect(duration).toBeGreaterThan(1.7);
      expect(duration).toBeLessThan(2.6);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
