const FILE_EXTENSION_PATTERN = /\b[\w.-]+\.(?:txt|md|json|csv|tsv|html|css|js|ts|tsx|jsx|py|sh|sql|xml|yaml|yml|pdf|docx|pptx|xlsx|png|jpe?g|gif|webp|svg)\b/i;
const ARTIFACT_ACTION_PATTERN = /\b(?:create|write|save|export|generate|make|produce|build)\b/i;
const FILE_NOUN_PATTERN = /\b(?:file|report|document|doc|spreadsheet|presentation|deck|image|chart|csv|json|markdown|pdf)\b/i;

export function shouldRequireArtifactForRequest(text: string): boolean {
  if (!ARTIFACT_ACTION_PATTERN.test(text)) return false;
  return FILE_EXTENSION_PATTERN.test(text) || FILE_NOUN_PATTERN.test(text);
}

export function artifactRepairRequest(originalRequest: string, runOutboxPath: string): string {
  return [
    originalRequest,
    "",
    "The previous response did not publish a file artifact. Complete the user's file request now.",
    `Write the deliverable under the current run outbox (${runOutboxPath}).`,
    "For text-like files, call artifact.write. For files created with shell commands, create them under $AITHY_OUTBOX and then call artifact.publish.",
    "Do not answer as though the file exists unless it has been written and published.",
  ].join("\n");
}
