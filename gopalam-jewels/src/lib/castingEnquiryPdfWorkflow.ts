import "server-only";
import { NextResponse } from "next/server";
import type { CastingCatalogueEnquiryDocument } from "@/lib/castingCatalogueEnquiries";
import { generateCastingEnquiryPdf } from "@/lib/castingEnquiryPdf";

// Share only concurrent renders. Completed PDFs are never cached or uploaded.
const inFlight = new Map<string, Promise<Uint8Array>>();
const requests = new Map<string, { count: number; expiresAt: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 10;

export const enquiryPdfDownload = async (enquiry: CastingCatalogueEnquiryDocument) => {
  const now = Date.now();
  for (const [key, value] of requests) if (value.expiresAt <= now) requests.delete(key);
  const requestWindow = requests.get(enquiry.enquiryId) || { count: 0, expiresAt: now + WINDOW_MS };
  if (requestWindow.count >= MAX_REQUESTS || (!requests.has(enquiry.enquiryId) && requests.size >= 5000)) {
    return NextResponse.json({ error: "Too many PDF requests. Please try again shortly." }, {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil((requestWindow.expiresAt - now) / 1000))) },
    });
  }
  requestWindow.count++;
  requests.set(enquiry.enquiryId, requestWindow);

  try {
    let rendering = inFlight.get(enquiry.enquiryId);
    if (!rendering) {
      rendering = generateCastingEnquiryPdf(enquiry);
      inFlight.set(enquiry.enquiryId, rendering);
      void rendering.finally(() => inFlight.delete(enquiry.enquiryId)).catch(() => {});
    }
    const bytes = await rendering;
    const filename = enquiry.enquiryId.replace(/[^A-Za-z0-9_-]/g, "_");
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}-selection.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to generate your PDF. Your enquiry is saved; please retry." }, { status: 500 });
  }
};
