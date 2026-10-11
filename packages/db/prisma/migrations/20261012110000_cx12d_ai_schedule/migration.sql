-- CX12d: Channel-wise AI schedule — per-channel windows during
-- which the inbox autopilot, the order bot and the social-comment
-- AI may reply, stored on InboxSetting as
-- { "<channel>": { "enabled": bool, "windows": [{ "days": [0..6],
-- "start": "HH:mm", "end": "HH:mm" }] } } (organization timezone).
-- Null = no schedule anywhere (pre-CX12d behaviour).
ALTER TABLE "InboxSetting" ADD COLUMN "aiScheduleByChannel" JSONB;
