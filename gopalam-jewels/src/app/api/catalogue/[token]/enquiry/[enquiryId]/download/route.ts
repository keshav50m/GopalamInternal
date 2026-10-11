import { NextRequest, NextResponse } from "next/server";
import { getCastingCatalogueEnquiriesCollection } from "@/lib/castingCatalogueEnquiries";
import { getPrivatePdfFromR2 } from "@/lib/r2";

type Context = { params: Promise<{ token: string; enquiryId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  const { token, enquiryId } = await params;
  const accessToken = String((await request.json()).accessToken || "");
  const enquiry = await (await getCastingCatalogueEnquiriesCollection()).findOne({ catalogueToken: token, enquiryId, customerAccessToken: accessToken, pdfStatus: "ready" });
  if (!enquiry?.pdfStorageKey || !accessToken) return NextResponse.json({ error: "PDF not found" }, { status: 404 });
  const bytes = await getPrivatePdfFromR2(enquiry.pdfStorageKey);
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${enquiryId}-selection.pdf"`, "Cache-Control": "private, no-store" } });
}
