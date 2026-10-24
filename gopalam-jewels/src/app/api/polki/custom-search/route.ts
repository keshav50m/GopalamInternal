import { NextRequest, NextResponse } from "next/server";
import type { Document, Filter } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/polki/databaseIndexes";
import { withResolvedImageFields } from "@/lib/imageRead";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureProductIndexes();

    const { searchParams } = request.nextUrl;
    const requestedPage = Number(searchParams.get("page")) || 1;
    const requestedPageSize = Number(searchParams.get("pageSize")) || 25;
    const includeTotal = searchParams.get("includeTotal") !== "false";
    const page = Math.max(1, requestedPage);

    const pageSize =
      requestedPageSize > 0
        ? Math.min(Math.floor(requestedPageSize), 100)
        : 25;
    const clauses: Filter<Document>[] = [];

    // Exact normalized text predicates and native numeric ranges use persisted indexes.
    for (const parameter of ["barcode", "itemNo", "stone", "size"]) {
      const value = searchParams.get(parameter)?.trim().toUpperCase();
      if (value) clauses.push({[`searchText.${parameter}`]: {$elemMatch:{$gte:value,$lt:value + "\uffff"}}});
    }
    for (const field of ["gross", "stoneWt", "dai", "price", "usd", "labour", "labourPuwai"]) {
      const range: Record<string, number> = {};
      for (const [suffix, operator] of [["Min", "$gte"], ["Max", "$lte"]]) {
        const text = searchParams.get(field + suffix);
        if (text?.trim() && Number.isFinite(Number(text))) range[operator] = Number(text);
      }
      if (Object.keys(range).length) clauses.push({[`search.${field}`]: range});
    }

    const query: Filter<Document> = clauses.length ? { $and: clauses } : {};
    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const collection = db.collection("polkiProducts");
    const [total, products] = await Promise.all([
      includeTotal ? collection.countDocuments(query) : Promise.resolve(0),
      collection
        .find(query).project({barcode:1,data:1,image:1,r2Image:1,imageRemoved:1,updatedAt:1})
        .sort({ barcode: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);

    const itemNos = Array.from(
      new Set(
        products
          .map((product) => String(product.data?.ITEM || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
    const catalogueItems = itemNos.length
      ? await db
        .collection("polkiImageCatalogue")
        .find({ itemNo: { $in: itemNos } })
        .toArray()
      : [];
    const catalogueImages = new Map(
      catalogueItems.map((item) => [
        String(item.itemNo || "").trim().toUpperCase(),
        withResolvedImageFields(item),
      ])
    );

    const productsWithImages = products.map((product) => {
      const itemNo = String(product.data?.ITEM || "").trim().toUpperCase();

      const catalogue = catalogueImages.get(itemNo);
      return {
        ...withResolvedImageFields(product),
        imageCatalogueImage: catalogue?.image || "",
        imageCatalogueR2Image: catalogue?.r2Image || "",
        imageCatalogueResolvedImageUrl: catalogue?.resolvedImageUrl || "",
        imageCatalogueFallbackImageUrl: catalogue?.fallbackImageUrl || "",
      };
    });

    return NextResponse.json({
      products: productsWithImages,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("Custom Search GET Error:", error);
    return NextResponse.json(
      { error: "Failed to search products" },
      { status: 500 }
    );
  }
}
