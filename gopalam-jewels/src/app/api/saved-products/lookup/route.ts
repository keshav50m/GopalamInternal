import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import clientPromise from "@/lib/mongodb";
import { normalizeBarcode } from "@/utils/normalizeBarcode";

const MAX_BARCODES_PER_LOOKUP = 1000;

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

    if (barcodes.length > MAX_BARCODES_PER_LOOKUP) {
      return NextResponse.json(
        { error: `A maximum of ${MAX_BARCODES_PER_LOOKUP} barcodes is allowed` },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const products = await db
      .collection("savedProducts")
      .find({ barcode: { $in: barcodes } })
      .toArray();

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
