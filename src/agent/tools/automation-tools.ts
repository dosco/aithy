import { f, fn, type AxAgentFunction } from "@ax-llm/ax";
import type { AutomationAttentionType, AutomationNotificationPolicy } from "../../automations/types";
import { argsPreview } from "../../security/capability-broker";
import type { ToolContext } from "../tool-context";

export function createAutomationTools(ctx: ToolContext): AxAgentFunction[] {
  if (!ctx.automations) return [];
  return [
    fn("create")
      .namespace("automations")
      .description(
        "Create an attention: something the agent will keep looking at later as a normal agent turn in a sub-session of this chat.",
      )
      .arg("attentionType", f.string("vigil, reminder, ritual, or briefing. Default ritual.").optional())
      .arg("title", f.string("Short title for the attention"))
      .arg("prompt", f.string("The full focus or instruction for this attention"))
      .arg("scheduleKind", f.string("once, daily, weekdays, weekly, hourly, interval_minutes, or cron"))
      .arg("time", f.string("HH:MM local time. Default 08:00.").optional())
      .arg("dayOfWeek", f.string("For weekly schedules: 0 Sunday through 6 Saturday.").optional())
      .arg("everyMinutes", f.number("For interval_minutes schedules.").optional())
      .arg("cronPattern", f.string("Internal five-field cron pattern, only when scheduleKind is cron.").optional())
      .arg("runAt", f.string("ISO or local datetime for one-time reminder schedules. Required when scheduleKind is once.").optional())
      .arg("human", f.string("Human-readable schedule label.").optional())
      .arg("timezone", f.string("IANA timezone. Default is local system timezone.").optional())
      .arg("notificationPolicy", f.string("always, attention_only, failures_only, or silent.").optional())
      .returnsField("id", f.string("Attention id"))
      .returnsField("title", f.string("Attention title"))
      .returnsField("schedule", f.string("Human-readable rhythm"))
      .handler(async (args) => {
        requireAutomationManage(ctx, "automations.create", args);
        const automation = await ctx.automations!.create({
          attentionType: attentionType(args.attentionType),
          title: args.title,
          prompt: args.prompt,
          scheduleKind: args.scheduleKind,
          time: args.time,
          dayOfWeek: args.dayOfWeek,
          everyMinutes: args.everyMinutes,
          cronPattern: args.cronPattern,
          runAt: args.runAt,
          human: args.human,
          timezone: args.timezone,
          notificationPolicy: policy(args.notificationPolicy),
          originSessionId: ctx.session.conversationId,
          createdSource: "chat",
        });
        return { id: automation.id, title: automation.title, schedule: automation.schedule.human };
      })
      .build(),
    fn("list")
      .namespace("automations")
      .description("List active and paused attentions, optionally scoped to this chat.")
      .arg("scope", f.string("Use 'this_chat' or 'all'."))
      .returnsField("automations", f.object({
        id: f.string("Attention id"),
        title: f.string("Attention title"),
        type: f.string("Attention type"),
        status: f.string("Attention status"),
        schedule: f.string("Human-readable rhythm"),
        nextRunAt: f.string("Next look ISO timestamp, or empty string"),
      }, "Attention summary").array("Attentions"))
      .handler(({ scope }) => ({
        automations: ctx.automations!.list(scope === "this_chat" ? ctx.session.conversationId : undefined).map((a) => ({
          id: a.id,
          title: a.title,
          type: a.attentionType,
          status: a.status,
          schedule: a.schedule.human,
          nextRunAt: a.nextRunAt ?? "",
        })),
      }))
      .build(),
    simpleStatusTool(ctx, "pause", "Pause an attention so it stops waking.", (id) => ctx.automations!.pause(id)),
    simpleStatusTool(ctx, "resume", "Resume a paused attention.", (id) => ctx.automations!.resume(id)),
    simpleStatusTool(ctx, "archive", "Archive an attention permanently.", (id) => ctx.automations!.archive(id)),
    fn("runNow")
      .namespace("automations")
      .description("Queue an immediate look for an attention.")
      .arg("id", f.string("Attention id"))
      .returnsField("queued", f.boolean("Whether the run was queued"))
      .handler(async ({ id }) => {
        requireAutomationManage(ctx, "automations.runNow", { id });
        await ctx.automations!.runNow(id);
        return { queued: true };
      })
      .build(),
  ];
}

function simpleStatusTool(
  ctx: ToolContext,
  name: string,
  description: string,
  action: (id: string) => Promise<{ id: string; status: string } | null>,
): AxAgentFunction {
  return fn(name)
    .namespace("automations")
    .description(description)
    .arg("id", f.string("Attention id"))
    .returnsField("id", f.string("Attention id"))
    .returnsField("status", f.string("New status, or missing"))
    .handler(async ({ id }) => {
      requireAutomationManage(ctx, `automations.${name}`, { id });
      const automation = await action(id);
      return { id: automation?.id ?? id, status: automation?.status ?? "missing" };
    })
    .build();
}

function requireAutomationManage(ctx: ToolContext, toolName: string, args: unknown): void {
  ctx.capabilities?.require({
    conversationId: ctx.session.conversationId,
    capability: "automation.manage",
    toolName,
    argsPreview: argsPreview(args),
  });
}

function policy(value: string | undefined): AutomationNotificationPolicy {
  if (value === "always" || value === "attention_only" || value === "failures_only" || value === "silent") return value;
  return "attention_only";
}

function attentionType(value: string | undefined): AutomationAttentionType {
  if (value === "vigil" || value === "reminder" || value === "ritual" || value === "briefing") return value;
  return "ritual";
}
