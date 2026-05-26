export interface TrainingDataCountDto {
  key: string;
  stage: "ctx" | "task" | null;
  count: number;
}

export interface TrainingDataSummaryDto {
  captureEnabled: boolean;
  traceCount: number;
  sftExampleCount: number;
  preferencePairCount: number;
  sessionCount: number;
  earliestAt: string | null;
  latestAt: string | null;
  byComponent: TrainingDataCountDto[];
  byModel: TrainingDataCountDto[];
  bySession: TrainingDataCountDto[];
}

