import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Document, type Filter } from "mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureGoldProductIndexes } from "@/lib/goldDatabaseIndexes";
import { GoldSearchValidationError, parseGoldSearch } from "@/lib/goldSearch";
import { withResolvedImageFields } from "@/lib/imageRead";
import clientPromise from "@/lib/mongodb";
import { normalizeGoldLotNo } from "@/utils/goldProductData";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    const { clauses, pageSize, cursor } = parseGoldSearch(request.nextUrl.searchParams);
    await ensureGoldProductIndexes();
    if (cursor) clauses.push({ _id: { $lt: new ObjectId(cursor) } });
    const db = (await clientPromise).db("gopalamJewels");
    const query: Filter<Document> = clauses.length ? { $and: clauses } : {};
    const matches = await db.collection("savedProducts_Gold")
      .find(query, { projection: { barcode: 1, data: 1, sold: 1, image: 1, r2Image: 1, imageRemoved: 1 }, maxTimeMS: 10000 })
      .sort({ _id: -1 }).limit(pageSize + 1).toArray();
    const products = matches.slice(0, pageSize);
    const lots = [...new Set(products.filter(p => !p.imageRemoved).map(p => normalizeGoldLotNo(p.data?.["LOT NO"])).filter(Boolean))];
    const catalogue = lots.length ? await db.collection("ImageCatalogue_Gold")
      .find({ "LOT NO": { $in: lots } }, { projection: { "LOT NO": 1, image: 1, r2Image: 1 }, maxTimeMS: 5000 })
      .limit(lots.length * 2).toArray() : [];
    const images = new Map(catalogue.map(item => [normalizeGoldLotNo(item["LOT NO"]), withResolvedImageFields(item)]));
    return NextResponse.json({
      products: products.map(product => {
        const own = withResolvedImageFields(product);
        const lot = images.get(normalizeGoldLotNo(product.data?.["LOT NO"]));
        const source = product.imageRemoved ? undefined : own.resolvedImageUrl ? own : lot;
        return { _id: String(product._id), barcode: String(product.barcode ?? product.data?.BARCODE ?? ""),
          data: product.data || {}, sold: product.sold === true, imageRemoved: product.imageRemoved === true,
          image: source?.image || "", r2Image: source?.r2Image || "",
          resolvedImageUrl: source?.resolvedImageUrl || "", fallbackImageUrl: source?.fallbackImageUrl || "" };
      }),
      nextCursor: matches.length > pageSize ? String(products[products.length - 1]._id) : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof GoldSearchValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Gold custom search failed:", error);
    const timedOut = error instanceof Error && "code" in error && error.code === 50;
    return NextResponse.json({ error: timedOut ? "Search took too long. Narrow the barcode, lot, karat or stone filters and retry." : "Unable to search Gold products. Please retry." }, { status: timedOut ? 504 : 500 });
  }
}
