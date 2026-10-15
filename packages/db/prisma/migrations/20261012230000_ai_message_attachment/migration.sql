-- AP2 (AI Assistant Input & Knowledge): optional attachment columns
-- on AIMessage — the server-extracted text (documents) or vision
-- description (images) of a file the user attached to that message.
-- Additive nullable columns only; existing rows are unaffected.
ALTER TABLE "AIMessage" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "AIMessage" ADD COLUMN "attachmentKind" TEXT;
ALTER TABLE "AIMessage" ADD COLUMN "attachmentText" TEXT;
