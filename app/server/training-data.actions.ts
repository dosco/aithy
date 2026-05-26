import { createServerFn } from "@tanstack/react-start";
import { HOME_SESSION_ID } from "../../src/session/home-session";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { trainingDataClearInput, trainingDataExportInput } from "./action-schemas";
import { trainingDataSummaryDto } from "./dto";

export const getTrainingDataStats = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return trainingDataSummaryDto(
      runtime.trainingData.summary(),
      runtime.config.trainingDataCaptureEnabled,
    );
  });

export const exportTrainingData = createServerFn({ method: "POST" })
  .inputValidator(trainingDataExportInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const content = data.format === "sft"
      ? runtime.trainingData.exportSftJsonl()
      : runtime.trainingData.exportDpoJsonl();
    if (!content.trim()) {
      throw new Error(data.format === "dpo"
        ? "No explicit preference pairs are ready to export."
        : "No training traces are ready to export.");
    }
    const runId = crypto.randomUUID();
    const runOutboxPath = `/outbox/${HOME_SESSION_ID}/${runId}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const kind = data.format === "sft" ? "sft" : "dpo";
    return runtime.artifacts.write({
      sessionId: HOME_SESSION_ID,
      runId,
      runOutboxPath,
      path: `${kind}-training-data-${stamp}.jsonl`,
      title: data.format === "sft" ? "SFT training data" : "DPO preference data",
      description: "Exported from local Aithy training data capture.",
      content,
    });
  });

export const clearTrainingData = createServerFn({ method: "POST" })
  .inputValidator(trainingDataClearInput)
  .handler(async () => {
    const runtime = await getAithyRuntime();
    const deleted = runtime.trainingData.resetAll();
    return {
      deleted,
      stats: trainingDataSummaryDto(
        runtime.trainingData.summary(),
        runtime.config.trainingDataCaptureEnabled,
      ),
    };
  });

