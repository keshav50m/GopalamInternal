import { readFile, writeFile } from "node:fs/promises";

type Action = { publicId: string; proposedR2Url: string; r2DestinationKey: string; sourceSha256: string; sourceBytes: number };

const dryRun = JSON.parse(await readFile("reports/r2-migration-dry-run.json", "utf8"));
const actions = dryRun.actions as Action[];
let next = 0;
const results = new Array(actions.length);

const worker = async () => {
  while (true) {
    const index = next++;
    if (index >= actions.length) return;
    const action = actions[index];
    try {
      const response = await fetch(action.proposedR2Url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30_000) });
      const status = response.status === 404
        ? "DESTINATION_AVAILABLE"
        : response.ok
          ? "EXISTING_OBJECT_REQUIRES_IDENTITY_VERIFICATION"
          : "DESTINATION_STATUS_UNKNOWN";
      results[index] = {
        publicId: action.publicId,
        r2DestinationKey: action.r2DestinationKey,
        proposedR2Url: action.proposedR2Url,
        status,
        httpStatus: response.status,
        existingContentLength: response.headers.get("content-length"),
        existingContentType: response.headers.get("content-type"),
        sourceSha256: action.sourceSha256,
        sourceBytes: action.sourceBytes,
      };
    } catch (error) {
      results[index] = {
        publicId: action.publicId,
        r2DestinationKey: action.r2DestinationKey,
        proposedR2Url: action.proposedR2Url,
        status: "DESTINATION_STATUS_UNKNOWN",
        httpStatus: null,
        error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[redacted-url]") : "Unknown error",
        sourceSha256: action.sourceSha256,
        sourceBytes: action.sourceBytes,
      };
    }
  }
};

await Promise.all(Array.from({ length: 8 }, worker));
const summary = {
  generatedAt: new Date().toISOString(),
  mode: "READ_ONLY_HEAD_PREFLIGHT",
  proposedDestinations: results.length,
  available: results.filter((entry) => entry.status === "DESTINATION_AVAILABLE").length,
  existingObjectsRequiringIdentityVerification: results.filter((entry) => entry.status === "EXISTING_OBJECT_REQUIRES_IDENTITY_VERIFICATION").length,
  unknown: results.filter((entry) => entry.status === "DESTINATION_STATUS_UNKNOWN").length,
  r2Writes: 0,
};
await writeFile("reports/r2-destination-preflight.json", `${JSON.stringify({ summary, results }, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
