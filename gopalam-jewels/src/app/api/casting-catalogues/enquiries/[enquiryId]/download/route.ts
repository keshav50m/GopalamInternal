import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getCastingCatalogueEnquiriesCollection } from "@/lib/castingCatalogueEnquiries";
import { getPrivatePdfFromR2 } from "@/lib/r2";

type Context = { params: Promise<{ enquiryId: string }> };
export async function GET(_: Request, { params }: Context) {
  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  if (auth.user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { enquiryId } = await params;
  const enquiry = await (await getCastingCatalogueEnquiriesCollection()).findOne({ enquiryId, pdfStatus: "ready" });
  if (!enquiry?.pdfStorageKey) return NextResponse.json({ error: "PDF not found" }, { status: 404 });
  const bytes = await getPrivatePdfFromR2(enquiry.pdfStorageKey);
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${enquiryId}-selection.pdf"`, "Cache-Control": "private, no-store" } });
}
