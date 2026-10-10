import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/databaseIndexes";
import { findCatalogueImagesByItemNos } from "@/lib/imageCatalogueQueries";
import clientPromise from "@/lib/mongodb";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";
import { withResolvedImageFields } from "@/lib/imageRead";

const BARCODE_QUERY_BATCH_SIZE = 1000;
const normalizeItemNo = (value: unknown) =>
  String(value ?? "").trim().toUpperCase();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureProductIndexes();

    const body = await request.json();
    const barcodes = Array.from(
      new Set(
        (Array.isArray(body.barcodes) ? body.barcodes : [])
          .map(normalizeBarcode)
          .filter(Boolean)
      )
    );
    const requestedItemNos = Array.from(
      new Set(
        (Array.isArray(body.itemNos) ? body.itemNos : [])
          .map(normalizeItemNo)
          .filter(Boolean)
      )
    );

    if (barcodes.length === 0 && requestedItemNos.length === 0) {
      return NextResponse.json(
        { error: "At least one barcode or Item No is required" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const products = [];

    for (let index = 0; index < barcodes.length; index += BARCODE_QUERY_BATCH_SIZE) {
      const barcodeBatch = barcodes.slice(index, index + BARCODE_QUERY_BATCH_SIZE);
      const matchedProducts = await db
        .collection("savedProducts")
        .find({ barcode: { $in: barcodeBatch } })
        .project({ barcode: 1, image: 1, r2Image: 1, imageRemoved: 1, data: 1, updatedAt: 1 })
        .toArray();

      products.push(...matchedProducts);
    }

    const itemNos = Array.from(
      new Set(
        [
          ...requestedItemNos,
          ...products
            .filter((product: any) => !normalizeStoredImageUrl(product.image))
            .map((product: any) => normalizeItemNo(product.data?.ITEMNO)),
        ].filter(Boolean)
      )
    );
    const [catalogueItems, relatedProducts] = itemNos.length
      ? await Promise.all([
          findCatalogueImagesByItemNos(
            db.collection("imageCatalogue"),
            itemNos
          ),
          db
            .collection("savedProducts")
            .find({ "data.ITEMNO": { $in: itemNos } })
            .project({ barcode: 1, image: 1, r2Image: 1, imageRemoved: 1, data: 1 })
            .toArray(),
        ])
      : [[], []];
    const imageByItemNo = new Map(
      catalogueItems.map((item: any) => [
        normalizeItemNo(item.itemNo),
        withResolvedImageFields(item),
      ])
    );
    const itemNosWithSavedImages = new Set<string>();
    relatedProducts.forEach((product: any) => {
      const itemNo = normalizeItemNo(product.data?.ITEMNO);
      const image = normalizeStoredImageUrl(product.image);
      if (itemNo && image && !itemNosWithSavedImages.has(itemNo)) {
        imageByItemNo.set(itemNo, withResolvedImageFields(product));
        itemNosWithSavedImages.add(itemNo);
      }
    });

    const itemImages = Object.fromEntries(
      [...imageByItemNo].map(([itemNo, item]) => [itemNo, item.resolvedImageUrl || ""])
    );
    const itemImageCandidates = Object.fromEntries(
      [...imageByItemNo].map(([itemNo, item]) => [itemNo, {
        image: item.image || "",
        r2Image: item.r2Image || "",
        resolvedImageUrl: item.resolvedImageUrl || "",
        fallbackImageUrl: item.fallbackImageUrl || "",
      }])
    );

    return NextResponse.json({
      products: products.map((product: any) => {
        const itemNo = normalizeItemNo(product.data?.ITEMNO);
        return {
          ...withResolvedImageFields(product),
          imageCatalogueImage: imageByItemNo.get(itemNo)?.image || "",
          imageCatalogueR2Image: imageByItemNo.get(itemNo)?.r2Image || "",
          imageCatalogueResolvedImageUrl: imageByItemNo.get(itemNo)?.resolvedImageUrl || "",
          imageCatalogueFallbackImageUrl: imageByItemNo.get(itemNo)?.fallbackImageUrl || "",
        };
      }),
      itemImages,
      itemImageCandidates,
    });
  } catch (error) {
    console.error("Barcode lookup failed:", error);
    return NextResponse.json(
      { error: "Failed to look up saved products" },
      { status: 500 }
    );
  }
}
