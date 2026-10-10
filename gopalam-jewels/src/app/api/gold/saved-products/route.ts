import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureGoldProductIndexes } from "@/lib/goldDatabaseIndexes";
import {
  buildGoldCatalogueUpdate,
  buildGoldProductUpdate,
  type PreparedGoldProduct,
} from "@/lib/goldPersistence";
import clientPromise from "@/lib/mongodb";
import {
  normalizeGoldLotNo,
  normalizeGoldProductData,
} from "@/utils/goldProductData";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { normalizePersistentImageUrl } from "@/utils/imageProvider";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureGoldProductIndexes();

    const body = await request.json();
    const requestedProducts = Array.isArray(body.products) ? body.products : [];
    const products = requestedProducts
      .map((item: any) => {
        const data = normalizeGoldProductData(item?.data);
        const barcode = normalizeBarcode(item?.barcode || data.BARCODE);
        data.BARCODE = barcode;
        return {
          barcode,
          data,
          image: normalizePersistentImageUrl(item?.image),
          r2Image: normalizePersistentImageUrl(item?.r2Image),
          hasR2Image: Object.prototype.hasOwnProperty.call(item || {}, "r2Image"),
        };
      })
      .filter((item: PreparedGoldProduct) => item.barcode);

    if (products.length === 0) {
      return NextResponse.json(
        { error: "No valid Gold products provided" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const updatedAt = new Date();

    await db.collection("savedProducts_Gold").bulkWrite(
      products.map((item: any) => {
        return {
          updateOne: {
            filter: { barcode: item.barcode },
            update: buildGoldProductUpdate(item, updatedAt),
            upsert: true,
          },
        };
      })
    );

    const catalogueProducts = products.filter(
      (item: any) => normalizeGoldLotNo(item.data["LOT NO"]) && (item.image || item.r2Image)
    );
    if (catalogueProducts.length > 0) {
      await db.collection("ImageCatalogue_Gold").bulkWrite(
        catalogueProducts.map((item: any) => {
          const lotNo = normalizeGoldLotNo(item.data["LOT NO"]);
          return {
            updateOne: {
              filter: { "LOT NO": lotNo },
              update: buildGoldCatalogueUpdate(item, lotNo, updatedAt),
              upsert: true,
            },
          };
        })
      );
    }

    return NextResponse.json({
      success: true,
      message: `${products.length} Gold products saved successfully`,
    });
  } catch (error) {
    console.error("Gold product save failed:", error);
    return NextResponse.json(
      { error: "Failed to save Gold products" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureGoldProductIndexes();

    const body = await request.json();
    const barcode = normalizeBarcode(body?.barcode);
    if (!barcode) {
      return NextResponse.json({ error: "Barcode is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const result = await client.db("gopalamJewels").collection("savedProducts_Gold").updateOne(
      {
        $or: [
          { barcode },
          { "data.BARCODE": barcode },
          ...(/^(0|[1-9]\d*)$/.test(barcode)
            ? [{ barcode: Number(barcode) }, { "data.BARCODE": Number(barcode) }]
            : []),
        ],
      },
      {
        $unset: { image: "", r2Image: "" },
        $set: { imageRemoved: true, updatedAt: new Date() },
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Gold product not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Gold image removal failed:", error);
    return NextResponse.json({ error: "Failed to remove Gold product image" }, { status: 500 });
  }
}
