import { createHash } from "node:crypto";
import artifactPackaging from "../../config/skills/builtin/artifact-packaging.md" with { type: "text" };
import batchDocumentConversion from "../../config/skills/builtin/batch-document-conversion.md" with { type: "text" };
import batchOcrWorkflow from "../../config/skills/builtin/batch-ocr-workflow.md" with { type: "text" };
import cjkDocumentHandling from "../../config/skills/builtin/cjk-document-handling.md" with { type: "text" };
import csvJsonCleaning from "../../config/skills/builtin/csv-json-cleaning.md" with { type: "text" };
import datasetReconciliation from "../../config/skills/builtin/dataset-reconciliation.md" with { type: "text" };
import documentConversionDocling from "../../config/skills/builtin/document-conversion-docling.md" with { type: "text" };
import downloadAndStageFiles from "../../config/skills/builtin/download-and-stage-files.md" with { type: "text" };
import htmlTableExtraction from "../../config/skills/builtin/html-table-extraction.md" with { type: "text" };
import imagePrepForOcr from "../../config/skills/builtin/image-prep-for-ocr.md" with { type: "text" };
import knowledgeBasePrep from "../../config/skills/builtin/knowledge-base-prep.md" with { type: "text" };
import mediaInspectionExtraction from "../../config/skills/builtin/media-inspection-extraction.md" with { type: "text" };
import officeDocumentExtraction from "../../config/skills/builtin/office-document-extraction.md" with { type: "text" };
import pdfFastTextExtraction from "../../config/skills/builtin/pdf-fast-text-extraction.md" with { type: "text" };
import pdfOptimizationPrint from "../../config/skills/builtin/pdf-optimization-print.md" with { type: "text" };
import pdfPageImagesAssets from "../../config/skills/builtin/pdf-page-images-assets.md" with { type: "text" };
import pdfPageRangeAssembly from "../../config/skills/builtin/pdf-page-range-assembly.md" with { type: "text" };
import pdfRepairValidation from "../../config/skills/builtin/pdf-repair-validation.md" with { type: "text" };
import pdfSecurityInspection from "../../config/skills/builtin/pdf-security-inspection.md" with { type: "text" };
import receiptInvoiceExtraction from "../../config/skills/builtin/receipt-invoice-extraction.md" with { type: "text" };
import researchPaperExtraction from "../../config/skills/builtin/research-paper-extraction.md" with { type: "text" };
import scannedDocumentOcr from "../../config/skills/builtin/scanned-document-ocr.md" with { type: "text" };
import spreadsheetDataAnalysis from "../../config/skills/builtin/spreadsheet-data-analysis.md" with { type: "text" };
import spreadsheetWorkbookEditing from "../../config/skills/builtin/spreadsheet-workbook-editing.md" with { type: "text" };
import webPageToMarkdown from "../../config/skills/builtin/web-page-to-markdown.md" with { type: "text" };
import { frontmatterString, parseSkillMarkdown } from "./frontmatter";
import type { SqliteSkillsStore, SkillUpsert } from "./skills-store";

export const BUILT_IN_SKILL_SOURCE_VERSION = "2026.05-document-media-sandbox";

export interface BuiltInSkillSource {
  sourceId: string;
  preferredId: string;
  raw: string;
}

export const builtInSkillSources: BuiltInSkillSource[] = [
  source("document-conversion-docling", documentConversionDocling),
  source("batch-document-conversion", batchDocumentConversion),
  source("office-document-extraction", officeDocumentExtraction),
  source("research-paper-extraction", researchPaperExtraction),
  source("knowledge-base-prep", knowledgeBasePrep),
  source("scanned-document-ocr", scannedDocumentOcr),
  source("image-prep-for-ocr", imagePrepForOcr),
  source("batch-ocr-workflow", batchOcrWorkflow),
  source("receipt-invoice-extraction", receiptInvoiceExtraction),
  source("cjk-document-handling", cjkDocumentHandling),
  source("pdf-fast-text-extraction", pdfFastTextExtraction),
  source("pdf-page-range-assembly", pdfPageRangeAssembly),
  source("pdf-repair-validation", pdfRepairValidation),
  source("pdf-optimization-print", pdfOptimizationPrint),
  source("pdf-page-images-assets", pdfPageImagesAssets),
  source("pdf-security-inspection", pdfSecurityInspection),
  source("media-inspection-extraction", mediaInspectionExtraction),
  source("spreadsheet-data-analysis", spreadsheetDataAnalysis),
  source("spreadsheet-workbook-editing", spreadsheetWorkbookEditing),
  source("csv-json-cleaning", csvJsonCleaning),
  source("dataset-reconciliation", datasetReconciliation),
  source("html-table-extraction", htmlTableExtraction),
  source("web-page-to-markdown", webPageToMarkdown),
  source("download-and-stage-files", downloadAndStageFiles),
  source("artifact-packaging", artifactPackaging),
];

export function syncBuiltInSkills(store: SqliteSkillsStore): void {
  for (const source of builtInSkillSources) {
    const existing = store.getBySourceId(source.sourceId);
    const id = existing?.id ?? builtInLocalId(store, source.preferredId);
    store.upsert(seedToUpsert(id, source), { allowBuiltIn: true });
  }
}

function source(sourceId: string, raw: string): BuiltInSkillSource {
  return { sourceId, preferredId: sourceId, raw };
}

function builtInLocalId(store: SqliteSkillsStore, preferredId: string): string {
  if (!store.get(preferredId)) return preferredId;
  const base = `${preferredId}-builtin`;
  if (!store.get(base)) return base;
  for (let index = 2; index < 1_000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!store.get(candidate)) return candidate;
  }
  throw new Error(`Could not create local id for built-in skill: ${preferredId}`);
}

function seedToUpsert(id: string, source: BuiltInSkillSource): SkillUpsert {
  const { frontmatter, body } = parseSkillMarkdown(source.raw);
  return {
    id,
    name: frontmatterString(frontmatter, ["name"]) ?? source.sourceId,
    description: frontmatterString(frontmatter, ["description"]) ?? "",
    whenToUse: frontmatterString(frontmatter, ["when_to_use", "when-to-use"]),
    body,
    allowedTools: frontmatterString(frontmatter, ["allowed-tools", "allowed_tools", "tools"]),
    tags: frontmatterString(frontmatter, ["tags"]),
    sourceKind: "builtin",
    sourceId: source.sourceId,
    sourceVersion: BUILT_IN_SKILL_SOURCE_VERSION,
    sourceHash: hash(source.raw),
  };
}

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
