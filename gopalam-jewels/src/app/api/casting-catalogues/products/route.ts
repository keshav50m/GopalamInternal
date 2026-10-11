import { NextRequest, NextResponse } from "next/server";
import type { Document, Filter } from "mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { escapeCatalogueSearch } from "@/lib/castingCatalogue";
import { ensureProductIndexes } from "@/lib/databaseIndexes";
import { withResolvedImageFields } from "@/lib/imageRead";
import clientPromise from "@/lib/mongodb";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (auth.user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await ensureProductIndexes();
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize")) || 50));
    const barcode = request.nextUrl.searchParams.get("barcode")?.trim() || "";
    const itemNo = request.nextUrl.searchParams.get("itemNo")?.trim() || "";
    const clauses: Filter<Document>[] = [];
    if (barcode) clauses.push({ barcode: { $regex: escapeCatalogueSearch(barcode), $options: "i" } });
    if (itemNo) clauses.push({ "data.ITEMNO": { $regex: escapeCatalogueSearch(itemNo), $options: "i" } });
    const query: Filter<Document> = clauses.length ? { $and: clauses } : {};

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const collection = db.collection("savedProducts");
    const [total, products] = await Promise.all([
      collection.countDocuments(query),
      collection.find(query)
        .project({ barcode: 1, image: 1, r2Image: 1, imageRemoved: 1, data: 1 })
        .sort({ barcode: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);

    const itemNos = Array.from(new Set(products.map((product) => String(product.data?.ITEMNO || "").trim()).filter(Boolean)));
    const catalogueItems = itemNos.length
      ? await db.collection("imageCatalogue").find({ itemNo: { $in: itemNos } })
        .project({ itemNo: 1, image: 1, r2Image: 1 }).toArray()
      : [];
    const images = new Map(catalogueItems.map((item) => [String(item.itemNo || "").trim(), withResolvedImageFields(item)]));

    return NextResponse.json({
      products: products.map((product) => {
        const resolved = withResolvedImageFields(product);
        const catalogueImage = images.get(String(product.data?.ITEMNO || "").trim());
        const primaryImageUrl = resolved.resolvedImageUrl || catalogueImage?.resolvedImageUrl || "";
        const fallbackImageUrl = resolved.fallbackImageUrl ||
          (catalogueImage?.resolvedImageUrl !== primaryImageUrl ? catalogueImage?.resolvedImageUrl : "") ||
          catalogueImage?.fallbackImageUrl || "";
        return {
          barcode: String(product.barcode || ""),
          itemNo: String(product.data?.ITEMNO || ""),
          stone: String(product.data?.["STONE NAME"] || ""),
          primaryImageUrl: product.imageRemoved ? "" : primaryImageUrl,
          fallbackImageUrl: product.imageRemoved ? "" : fallbackImageUrl,
        };
      }),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("Casting catalogue product search failed:", error);
    return NextResponse.json({ error: "Failed to search Casting products" }, { status: 500 });
  }
}
