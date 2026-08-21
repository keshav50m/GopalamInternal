import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import clientPromise from "@/lib/mongodb";
import { normalizeBarcode } from "@/utils/normalizeBarcode";

const BARCODE_QUERY_BATCH_SIZE = 1000;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;

    const body = await request.json();
    const barcodes = Array.from(
      new Set(
        (Array.isArray(body.barcodes) ? body.barcodes : [])
          .map(normalizeBarcode)
          .filter(Boolean)
      )
    );

    if (barcodes.length === 0) {
      return NextResponse.json(
        { error: "At least one barcode is required" },
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
        .toArray();

      products.push(...matchedProducts);
    }

    const itemNos = Array.from(
      new Set(
        products
          .map((product: any) => String(product.data?.ITEMNO || "").trim())
          .filter(Boolean)
      )
    );
    const catalogueItems = itemNos.length
      ? await db
          .collection("imageCatalogue")
          .find({ itemNo: { $in: itemNos } })
          .toArray()
      : [];
    const imageByItemNo = new Map(
      catalogueItems.map((item: any) => [
        String(item.itemNo || "").trim(),
        item.image || "",
      ])
    );

    return NextResponse.json({
      products: products.map((product: any) => {
        const itemNo = String(product.data?.ITEMNO || "").trim();
        return {
          ...product,
          imageCatalogueImage: imageByItemNo.get(itemNo) || "",
        };
      }),
    });
  } catch (error) {
    console.error("Barcode lookup failed:", error);
    return NextResponse.json(
      { error: "Failed to look up saved products" },
      { status: 500 }
    );
  }
}
