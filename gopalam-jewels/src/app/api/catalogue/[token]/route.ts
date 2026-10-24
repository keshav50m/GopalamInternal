import { NextRequest, NextResponse } from "next/server";
import type { Document, Filter } from "mongodb";
import {
  CASTING_CATALOGUE_FIELDS,
  applyCatalogueDiscounts,
  catalogueProductValues,
} from "@/lib/castingCatalogue";
import { getCastingSharedCataloguesCollection } from "@/lib/castingSharedCatalogues";
import { createCatalogueSelectionId } from "@/lib/castingCatalogueSelection";
import { withResolvedImageFields } from "@/lib/imageRead";
import clientPromise from "@/lib/mongodb";

type RouteContext = { params: Promise<{ token: string }> };
type DetailField = Exclude<(typeof CASTING_CATALOGUE_FIELDS)[number], "image">;

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
      return NextResponse.json({ error: "Catalogue not found" }, { status: 404 });
    }
    const catalogueCollection = await getCastingSharedCataloguesCollection();
    const catalogue = await catalogueCollection.findOne({ token, active: true });
    if (!catalogue) return NextResponse.json({ error: "Catalogue not found" }, { status: 404 });

    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
    const pageSize = Math.min(60, Math.max(12, Number(request.nextUrl.searchParams.get("pageSize")) || 24));
    const clauses: Filter<Document>[] = [{ barcode: { $in: catalogue.productBarcodes } }];
    const query: Filter<Document> = { $and: clauses };
    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const productsCollection = db.collection("savedProducts");
    const [total, products] = await Promise.all([
      productsCollection.countDocuments(query),
      productsCollection.find(query)
        .project({ barcode: 1, image: 1, r2Image: 1, imageRemoved: 1, data: 1, isSold: 1 })
        .sort({ barcode: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);

    const includeImages = catalogue.visibleFields.image;
    const itemNos = includeImages
      ? Array.from(new Set(products.map((product) => String(product.data?.ITEMNO || "").trim()).filter(Boolean)))
      : [];
    const catalogueItems = itemNos.length
      ? await db.collection("imageCatalogue").find({ itemNo: { $in: itemNos } })
        .project({ itemNo: 1, image: 1, r2Image: 1 }).toArray()
      : [];
    const imageByItemNo = new Map(catalogueItems.map((item) => [
      String(item.itemNo || "").trim(),
      withResolvedImageFields(item),
    ]));

    return NextResponse.json({
      catalogue: {
        title: catalogue.title || "Casting Jewellery Catalogue",
        visibleFields: catalogue.visibleFields,
        discounts: catalogue.discounts || { pricePercent: 0, usdPercent: 0 },
        createdAt: catalogue.createdAt,
      },
      products: products.map((product) => {
        const values = applyCatalogueDiscounts(catalogueProductValues(product), catalogue.discounts);
        const barcode = String(product.barcode || "").trim();
        const visibleValues = Object.fromEntries(
          CASTING_CATALOGUE_FIELDS
            .filter((field): field is DetailField => field !== "image" && catalogue.visibleFields[field])
            .map((field) => [field, values[field]])
        );
        const selectionId = createCatalogueSelectionId(token, barcode);
        if (!includeImages || product.imageRemoved) return { selectionId, values: visibleValues, isSold: product.isSold === true };
        const resolved = withResolvedImageFields(product);
        const catalogueImage = imageByItemNo.get(String(product.data?.ITEMNO || "").trim());
        const primaryImageUrl = resolved.resolvedImageUrl || catalogueImage?.resolvedImageUrl || "";
        const fallbackImageUrl = resolved.fallbackImageUrl ||
          (catalogueImage?.resolvedImageUrl !== primaryImageUrl ? catalogueImage?.resolvedImageUrl : "") ||
          catalogueImage?.fallbackImageUrl || "";
        return {
          selectionId,
          values: visibleValues,
          primaryImageUrl,
          fallbackImageUrl,
          isSold: product.isSold === true,
        };
      }),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("Public Casting catalogue failed:", error);
    return NextResponse.json({ error: "Failed to load catalogue" }, { status: 500 });
  }
}
