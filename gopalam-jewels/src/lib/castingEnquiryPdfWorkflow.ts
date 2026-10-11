import "server-only";
import { generateCastingEnquiryPdf } from "@/lib/castingEnquiryPdf";
import { getCastingCatalogueEnquiriesCollection } from "@/lib/castingCatalogueEnquiries";
import { uploadPrivatePdfToR2 } from "@/lib/r2";

export const ensureEnquiryPdf = async (enquiryId: string) => {
  const collection = await getCastingCatalogueEnquiriesCollection();
  const existing = await collection.findOne({ enquiryId });
  if (!existing) return { status: "missing" as const };
  if (existing.pdfStatus === "ready" && existing.pdfStorageKey) return { status: "ready" as const, enquiry: existing };
  if (existing.pdfStatus === "processing") return { status: "processing" as const };
  const claimed = await collection.findOneAndUpdate(
    { enquiryId, pdfStatus: { $in: ["pending", "failed"] } },
    { $set: { pdfStatus: "processing" }, $unset: { pdfError: "" } },
    { returnDocument: "after" }
  );
  if (!claimed) return { status: "processing" as const };
  try {
    const bytes = await generateCastingEnquiryPdf(claimed);
    const objectKey = `casting-enquiries/${claimed.enquiryId}/selection.pdf`;
    await uploadPrivatePdfToR2({ body: bytes, objectKey });
    const generatedAt = new Date();
    await collection.updateOne({ enquiryId, pdfStatus: "processing" }, { $set: { pdfStatus: "ready", pdfStorageKey: objectKey, pdfGeneratedAt: generatedAt }, $unset: { pdfError: "" } });
    return { status: "ready" as const, enquiry: { ...claimed, pdfStatus: "ready" as const, pdfStorageKey: objectKey, pdfGeneratedAt: generatedAt } };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "PDF generation failed";
    await collection.updateOne({ enquiryId, pdfStatus: "processing" }, { $set: { pdfStatus: "failed", pdfError: message } });
    return { status: "failed" as const };
  }
};
