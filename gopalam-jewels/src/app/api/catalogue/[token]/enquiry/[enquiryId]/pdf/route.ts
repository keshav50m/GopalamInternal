import { NextRequest, NextResponse } from "next/server";
import { getCastingCatalogueEnquiriesCollection } from "@/lib/castingCatalogueEnquiries";
import { ensureEnquiryPdf } from "@/lib/castingEnquiryPdfWorkflow";

type Context = { params: Promise<{ token: string; enquiryId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  const { token, enquiryId } = await params;
  const accessToken = String((await request.json()).accessToken || "");
  const collection = await getCastingCatalogueEnquiriesCollection();
  const enquiry = await collection.findOne({ catalogueToken: token, enquiryId, customerAccessToken: accessToken });
  if (!enquiry || !accessToken) return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
  const result = await ensureEnquiryPdf(enquiryId);
  if (result.status === "failed") return NextResponse.json({ error: "PDF generation failed. Please retry." }, { status: 500 });
  return NextResponse.json({ status: result.status });
}
