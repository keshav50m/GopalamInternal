import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getCastingCatalogueEnquiriesCollection } from "@/lib/castingCatalogueEnquiries";
import { enquiryPdfDownload } from "@/lib/castingEnquiryPdfWorkflow";

export const runtime = "nodejs";

type Context = { params: Promise<{ enquiryId: string }> };
export async function GET(_: Request, { params }: Context) {
  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  if (auth.user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { enquiryId } = await params;
  if (!/^GJ-\d{8}-[A-F0-9]{10}$/.test(enquiryId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const enquiry = await (await getCastingCatalogueEnquiriesCollection()).findOne({ enquiryId });
  if (!enquiry) return NextResponse.json({ error: "PDF not found" }, { status: 404 });
  return enquiryPdfDownload(enquiry);
}
