import { NextRequest, NextResponse } from "next/server";
import { getCastingCatalogueEnquiriesCollection } from "@/lib/castingCatalogueEnquiries";
import { enquiryPdfDownload } from "@/lib/castingEnquiryPdfWorkflow";

export const runtime = "nodejs";

type Context = { params: Promise<{ token: string; enquiryId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  const { token, enquiryId } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(token) || !/^GJ-\d{8}-[A-F0-9]{10}$/.test(enquiryId)) {
    return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(accessToken)) return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
  const collection = await getCastingCatalogueEnquiriesCollection();
  const enquiry = await collection.findOne({ catalogueToken: token, enquiryId, customerAccessToken: accessToken });
  if (!enquiry || !accessToken) return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
  return enquiryPdfDownload(enquiry);
}
