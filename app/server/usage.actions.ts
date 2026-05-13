import { createServerFn } from "@tanstack/react-start";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { usageInput } from "./action-schemas";
import { usageBucketDto } from "./dto";

export const getUsageStats = createServerFn({ method: "GET" })
  .inputValidator(usageInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    return {
      buckets: runtime.usage.byDay(data.days ?? 30).map(usageBucketDto),
      totals: runtime.usage.totals(),
    };
  });
