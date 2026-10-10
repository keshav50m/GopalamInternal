import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureGoldProductIndexes } from "@/lib/goldDatabaseIndexes";
import { withResolvedImageFields } from "@/lib/imageRead";
import clientPromise from "@/lib/mongodb";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { normalizeGoldLotNo } from "@/utils/goldProductData";

const QUERY_BATCH_SIZE = 1000;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureGoldProductIndexes();

    const body = await request.json();
    const barcodes: string[] = Array.from(new Set<string>(
      (Array.isArray(body.barcodes) ? body.barcodes : [])
        .map((value: unknown) => normalizeBarcode(value))
        .filter(Boolean)
    ));
    const lotNos: string[] = Array.from(new Set<string>(
      (Array.isArray(body.lotNos) ? body.lotNos : [])
        .map((value: unknown) => normalizeGoldLotNo(value))
        .filter(Boolean)
    ));

    if (barcodes.length === 0 && lotNos.length === 0) {
      return NextResponse.json(
        { error: "At least one barcode or LOT NO is required" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const products: any[] = [];

    for (let index = 0; index < barcodes.length; index += QUERY_BATCH_SIZE) {
      const batch = barcodes.slice(index, index + QUERY_BATCH_SIZE);
      const compatibleBarcodes: Array<string | number> = [...batch];
      batch.forEach((barcode) => {
        if (/^(0|[1-9]\d*)$/.test(barcode)) compatibleBarcodes.push(Number(barcode));
      });
      products.push(...await db.collection("savedProducts_Gold")
        .find({
          $or: [
            { barcode: { $in: compatibleBarcodes } },
            { "data.BARCODE": { $in: compatibleBarcodes } },
          ],
        })
        .project({ barcode: 1, image: 1, r2Image: 1, imageRemoved: 1, data: 1, sold: 1, updatedAt: 1 })
        .toArray());
    }

    const requiredLotNos = Array.from(new Set([
      ...lotNos,
      ...products.map((product) => normalizeGoldLotNo(product.data?.["LOT NO"])),
    ].filter(Boolean)));
    const catalogueItems = requiredLotNos.length
      ? await db.collection("ImageCatalogue_Gold")
          .find({ "LOT NO": { $in: requiredLotNos } })
          .project({ "LOT NO": 1, image: 1, r2Image: 1 })
          .toArray()
      : [];
    const catalogueByLotNo = new Map(
      catalogueItems.map((item) => [
        normalizeGoldLotNo(item["LOT NO"]),
        withResolvedImageFields(item),
      ])
    );

    return NextResponse.json({
      products: products.map((product) => {
        const resolvedProduct = withResolvedImageFields(product);
        const catalogue = catalogueByLotNo.get(
          normalizeGoldLotNo(product.data?.["LOT NO"])
        );
        return {
          ...resolvedProduct,
          barcode: normalizeBarcode(product.barcode || product.data?.BARCODE),
          catalogueImage: catalogue?.image || "",
          catalogueR2Image: catalogue?.r2Image || "",
          catalogueResolvedImageUrl: catalogue?.resolvedImageUrl || "",
          catalogueFallbackImageUrl: catalogue?.fallbackImageUrl || "",
        };
      }),
      lotImages: Object.fromEntries(
        [...catalogueByLotNo].map(([lotNo, item]) => [lotNo, {
          image: item.image || "",
          r2Image: item.r2Image || "",
          resolvedImageUrl: item.resolvedImageUrl || "",
          fallbackImageUrl: item.fallbackImageUrl || "",
        }])
      ),
    });
  } catch (error) {
    console.error("Gold product lookup failed:", error);
    return NextResponse.json(
      { error: "Failed to look up Gold products" },
      { status: 500 }
    );
  }
}
