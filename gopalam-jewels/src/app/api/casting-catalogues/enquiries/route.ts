import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getCastingCatalogueEnquiriesCollection } from "@/lib/castingCatalogueEnquiries";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  if (auth.user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const collection = await getCastingCatalogueEnquiriesCollection();
  const unread = await collection.countDocuments({ notificationStatus: "unread" });
  if (request.nextUrl.searchParams.get("countOnly") === "true") return NextResponse.json({ unread });
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
  const pageSize = 20;
  const [total, enquiries] = await Promise.all([
    collection.countDocuments(),
    collection.find({}).project({ customerAccessToken: 0, submissionKey: 0, abuseKey: 0 }).sort({ submittedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
  ]);
  return NextResponse.json({ enquiries, total, unread, page, pageSize });
}
