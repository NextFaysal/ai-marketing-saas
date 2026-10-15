# IN5a — Voice Transcoding (WebM → OGG/Opus) — Acceptance

**তারিখ:** ২০২৬-১০-১২ · **প্যাকেজ:** IN প্যাকেজ Batch B1, দ্বিতীয় অংশ · **বেস:** IN1 commit `528d7e4`-এর ওপর (branch `in-package`) · **প্ল্যান:** §৩ IN5a

## ffmpeg যাচাই (আগে এটা করা হয়েছে)
- এই পরিবেশে **ffmpeg আছে: `/usr/bin/ffmpeg`, version 8.1.2**, configure ফ্ল্যাগে `--enable-libopus` আছে — অর্থাৎ OGG/Opus encode সত্যিই সম্ভব, অনুমান নয়। Spec-এর ভেতরে আসল encode চালিয়ে তা প্রমাণও করা হয়েছে (নিচে)।
- Production (Dokploy) হোস্টে ffmpeg থাকা **আলাদা করে যাচাই হয়নি** — না থাকলে আচরণ সৎ পথে ফিরে যায় (নিচের সীমা দেখুন); deploy-এর পর হোস্টে `ffmpeg -version` একবার দেখে নেওয়া IN-B1-এর follow-up।

## যা বানানো হয়েছে
- নতুন module `apps/api/src/inbox/audio-transcode.ts`:
  - `shouldTranscodeAudio(contentType, channel)` — সংকীর্ণ গেট: শুধু **WebM/Matroska audio**, শুধু **WhatsApp ও Telegram** গন্তব্যে। OGG (লক্ষ্য ফরম্যাট নিজেই), MP4/M4A (WhatsApp গ্রহণ করে — P1 acceptance অনুযায়ী Safari recording কাজ করে), MP3, এবং Webchat/Messenger/Email গন্তব্য — কোনোটাই transcode হয় না।
  - `transcodeAudioToOggOpus(bytes)` — temp ফাইলে `ffmpeg -vn -ac 1 -c:a libopus -b:a 32k -application voip` দিয়ে OGG/Opus-এ রূপান্তর (30s timeout)। আউটপুট **magic-byte sniffer দিয়ে যাচাই** করেই কেবল ফেরত দেওয়া হয় — ffmpeg বললেই বিশ্বাস নয়।
  - `isFfmpegAvailable()` — `ffmpeg -version` চালিয়ে যাচাই, path অনুযায়ী cache; `FFMPEG_PATH` env দিয়ে binary বদলানো যায়।
- `InboxService.sendMediaReply`-তে যুক্ত: sniff-এর পর, row তৈরি/সংরক্ষণের **আগে** transcode চেষ্টা হয় — তাই thread-এ সংরক্ষিত কপিটাই পাঠানো কপি (audio/ogg, `voice.ogg`)। Delivery (Meta upload / Telegram adapter) transcoded bytes-ই পায়; Telegram-এ এর ফলে `sendVoice` (আসল voice note) পথ চালু হয়, `sendAudio` নয়।

## সৎ fallback (সবগুলো spec-প্রমাণিত)
| অবস্থা | আচরণ |
|---|---|
| ffmpeg নেই / binary পথ ভুল | `null` → আসল bytes-ই যায় (IN5a-র আগের আচরণ); platform প্রত্যাখ্যান করলে verbatim error + row `failed` |
| Transcode ব্যর্থ (নষ্ট/ভুয়া WebM) | একই — আসল bytes, সৎ ব্যর্থতা |
| আউটপুট sniff-এ audio/ogg নয় | বাতিল, আসল bytes |
| `INBOX_AUDIO_TRANSCODE=off` | Transcode বন্ধ, আসল পথ |
কোনো অবস্থাতেই "transcode হয়েছে" বা "পাঠানো হয়েছে" মিথ্যে বলা হয় না।

## যাচাই
- নতুন spec `apps/api/src/inbox/in5a-transcode.spec.ts` — **9/9 pass**:
  - gate matrix (শুধু WebM × WhatsApp/Telegram; OGG/MP4/অন্য channel বাদ);
  - আসল ffmpeg দিয়ে তৈরি WAV→OGG: আউটপুট `OggS` header + sniffer `audio/ogg` যাচাই;
  - EBML-header-ওয়ালা আবর্জনা, non-audio input, অনুপস্থিত binary, kill switch — প্রতিটিতে `null`;
  - **Integration:** আসল ffmpeg-encode করা WebM clip `sendMediaReply` দিয়ে WhatsApp conversation-এ — integration না থাকায় delivery সৎভাবে `failed` (verbatim error), কিন্তু সংরক্ষিত row `mediaContentType: audio/ogg`, content `voice.ogg`, আর `getMessageMedia` দিয়ে ফেরত পাওয়া bytes `OggS` — অর্থাৎ transcode send path-এর ভেতরেই ঘটেছে;
  - একই WebM Webchat-এ **transcode ছাড়াই** `sent` (সংকীর্ণ scope-এর প্রমাণ)।
- API `tsc --noEmit` clean (B1 full gate-এ পুনঃযাচাই)।

## সৎ সীমা
- **আসল WhatsApp নম্বরে live delivery প্রমাণ হয়নি** — sandbox-এ Meta credential নেই (M30 বাকি)। প্রমাণিত হয়েছে: transcode-এর আউটপুট ফরম্যাট ঠিক + send path transcoded ফাইলটাই Meta upload-এর দিকে পাঠায় (integration ধাপে থামে)। Meta সার্ভার OGG/Opus গ্রহণ করে — এটি WhatsApp Cloud API-র নথিবদ্ধ গ্রহণযোগ্য ফরম্যাট; গ্রহণের চূড়ান্ত প্রমাণ M30 live verification-এ হবে।
- Production হোস্টে ffmpeg-এর উপস্থিতি অযাচাইকৃত (ওপরে দেখুন) — না থাকলে feature নীরবে অকেজো নয়, আগের সৎ আচরণে ফেরে; তবে voice পাঠানোর আগে হোস্ট যাচাই করা উচিত।
- Transcode শুধু agent-এর পাঠানো voice-এ (sendMediaReply); customer-এর পাঠানো inbound WebM হুবহু থাকে (transcription পথ আলাদা, CX12c)।
