import { createServerFn } from "@tanstack/react-start";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { buildUsageAdvisor } from "../../src/usage/advisor";
import { usageAdvisorInput, usageInput } from "./action-schemas";
import { usageBucketDto } from "./dto";

export const getUsageStats = createServerFn({ method: "GET" })
  .validator(usageInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    return {
      buckets: runtime.usage.byDay(data.days ?? 30).map(usageBucketDto),
      totals: runtime.usage.totals(),
    };
  });

export const getUsageAdvisor = createServerFn({ method: "GET" })
  .validator(usageAdvisorInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const records = runtime.usage.recordsSince(data.days ?? 30);
    const runIds = records
      .map((record) => record.runId)
      .filter((runId): runId is string => Boolean(runId));
    const outcomes = runtime.tasks.outcomesByIds(runIds).map((task) => ({
      runId: task.id,
      status: task.status,
      attempt: task.attempt,
      retryOfTaskId: task.retryOfTaskId,
    }));
    return buildUsageAdvisor({
      records,
      outcomes,
      component: data.component ?? null,
    });
  });
