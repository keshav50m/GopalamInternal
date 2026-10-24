import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth";
import { getCastingSharedCataloguesCollection } from "@/lib/castingSharedCatalogues";

type RouteContext = { params: Promise<{ token: string }> };

export async function DELETE(_: Request, { params }: RouteContext) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (auth.user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { token } = await params;
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return NextResponse.json({ error: "Catalogue not found" }, { status: 404 });

    const collection = await getCastingSharedCataloguesCollection();
    // Revoke the link while preserving references from historical enquiries.
    const result = await collection.updateOne({ token }, { $set: { active: false, deletedAt: new Date() } });
    if (!result.matchedCount) return NextResponse.json({ error: "Catalogue not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete this catalogue link. Please retry." }, { status: 500 });
  }
}
