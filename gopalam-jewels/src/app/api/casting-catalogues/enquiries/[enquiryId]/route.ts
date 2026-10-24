import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getCastingCatalogueEnquiriesCollection } from "@/lib/castingCatalogueEnquiries";
import { enquiryPdfDownload } from "@/lib/castingEnquiryPdfWorkflow";

type Context = { params: Promise<{ enquiryId: string }> };
const authorize = async () => {
  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  return auth.user?.role === "admin" ? null : NextResponse.json({ error: "Forbidden" }, { status: 403 });
};
export async function GET(_: Request, { params }: Context) {
  const denied = await authorize(); if (denied) return denied;
  const { enquiryId } = await params;
  const collection = await getCastingCatalogueEnquiriesCollection();
  await collection.updateOne({ enquiryId }, { $set: { notificationStatus: "read" } });
  const enquiry = await collection.findOne({ enquiryId }, { projection: { customerAccessToken: 0, submissionKey: 0, abuseKey: 0, pdfError: 0 } });
  return enquiry ? NextResponse.json({ enquiry }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
export async function POST(_: Request, { params }: Context) {
  const denied = await authorize(); if (denied) return denied;
  const { enquiryId } = await params;
  if (!/^GJ-\d{8}-[A-F0-9]{10}$/.test(enquiryId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const enquiry = await (await getCastingCatalogueEnquiriesCollection()).findOne({ enquiryId });
  return enquiry ? enquiryPdfDownload(enquiry) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
