/**
 * MB4 (ML10) — workflows catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the workflows module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const workflowsCatalog: CatalogNamespace = {
  "workflows.aWorkflowNeedsAtLeastOne": {
    bn: "একটি workflow-এর কমপক্ষে একটি step লাগবে",
    en: "A workflow needs at least one step",
  },
  "workflows.invalidStepType": {
    bn: "অবৈধ step type: {{stepType}}",
    en: "Invalid step type: {{stepType}}",
  },
  "workflows.invalidTrigger": {
    bn: "অবৈধ trigger",
    en: "Invalid trigger",
  },
  "workflows.onlyFailedRunsCanBeRetried": {
    bn: "শুধু failed runs-ই retry করা যায়",
    en: "Only failed runs can be retried",
  },
  "workflows.presetNotFound": {
    bn: "Preset পাওয়া যায়নি",
    en: "Preset not found",
  },
  "workflows.runNotFound": {
    bn: "Run পাওয়া যায়নি",
    en: "Run not found",
  },
  "workflows.theWorkflowNoLongerExists": {
    bn: "Workflow-টি আর নেই",
    en: "The workflow no longer exists",
  },
  "workflows.workflowNotFound": {
    bn: "Workflow পাওয়া যায়নি",
    en: "Workflow not found",
  },
  "workflows.addTagStepsNeedATag": {
    bn: "add_tag steps-এর জন্য একটি tag ও একটি target লাগবে (lead | conversation)",
    en: "add_tag steps need a tag and a target (lead | conversation)",
  },
  "workflows.aiGenerateStepsNeedAPrompt": {
    bn: "ai_generate steps-এর জন্য একটি prompt লাগবে",
    en: "ai_generate steps need a prompt",
  },
  "workflows.assignConversationStepsNeedAUserid": {
    bn: "assign_conversation steps-এর জন্য একটি userId লাগবে (অথবা clear: true)",
    en: "assign_conversation steps need a userId (or clear: true)",
  },
  "workflows.branchStepsCannotNestInsideA": {
    bn: "branch steps একটি branch arm-এর ভিতরে nest করতে পারে না",
    en: "branch steps cannot nest inside a branch arm",
  },
  "workflows.branchStepsNeedAFieldAnd": {
    bn: "branch steps-এর জন্য একটি field ও একটি operator লাগবে",
    en: "branch steps need a field and an operator",
  },
  "workflows.branchStepsNeedAtLeastOne": {
    bn: "branch steps-এর জন্য একটি arm-এ কমপক্ষে একটি sub-step লাগবে",
    en: "branch steps need at least one sub-step in an arm",
  },
  "workflows.changeLeadStageStepsNeedA": {
    bn: "change_lead_stage steps-এর জন্য একটি বৈধ stage লাগবে",
    en: "change_lead_stage steps need a valid stage",
  },
  "workflows.conditionStepsNeedAFieldAnd": {
    bn: "condition steps-এর জন্য একটি field ও একটি operator লাগবে",
    en: "condition steps need a field and an operator",
  },
  "workflows.cooldownminutesMustBe010080": {
    bn: "cooldownMinutes 0..10080 হতে হবে",
    en: "cooldownMinutes must be 0..10080",
  },
  "workflows.createFollowUpStepsNeedDays": {
    bn: "create_follow_up steps-এর জন্য days ১ থেকে ৯০-এর মধ্যে লাগবে",
    en: "create_follow_up steps need days between 1 and 90",
  },
  "workflows.dailyruncapMustBe110000Or": {
    bn: "dailyRunCap 1..10000 হতে হবে (অথবা clear করতে null)",
    en: "dailyRunCap must be 1..10000 (or null to clear)",
  },
  "workflows.httpWebhookStepsNeedAPublic": {
    bn: "http_webhook steps-এর জন্য একটি public https URL লাগবে",
    en: "http_webhook steps need a public https URL",
  },
  "workflows.notifyChannelStepsNeedAPublic": {
    bn: "notify_channel steps-এর জন্য একটি public https webhook URL লাগবে",
    en: "notify_channel steps need a public https webhook URL",
  },
  "workflows.notifyChannelStepsNeedText": {
    bn: "notify_channel steps-এর জন্য text লাগবে",
    en: "notify_channel steps need text",
  },
  "workflows.notifyTeamStepsNeedText": {
    bn: "notify_team steps-এর জন্য text লাগবে",
    en: "notify_team steps need text",
  },
  "workflows.scheduleWorkflowsNeedAScheduletimeCondition": {
    bn: "schedule workflows-এর জন্য একটি scheduleTime condition লাগবে (HH:MM, Asia/Dhaka)",
    en: "schedule workflows need a scheduleTime condition (HH:MM, Asia/Dhaka)",
  },
  "workflows.sendInboxMessageStepsNeedText": {
    bn: "send_inbox_message steps-এর জন্য text অথবা একটি whatsappTemplateId লাগবে",
    en: "send_inbox_message steps need text or a whatsappTemplateId",
  },
  "workflows.waitStepsAreNotAllowedInside": {
    bn: "একটি branch arm-এর ভিতরে wait steps অনুমোদিত নয় (v1)",
    en: "wait steps are not allowed inside a branch arm (v1)",
  },
  "workflows.waitStepsNeedMinutesBetween1": {
    bn: "wait steps-এর জন্য minutes ১ থেকে 43200-এর মধ্যে লাগবে (৩০ দিন)",
    en: "wait steps need minutes between 1 and 43200 (30 days)",
  },
  "workflows.stepsNeedATemplateid": {
    bn: "{{stepType}} steps-এর জন্য একটি templateId লাগবে",
    en: "{{stepType}} steps need a templateId",
  },
};
