import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/databaseIndexes";
import clientPromise from "@/lib/mongodb";
import { normalizeBarcode } from "@/utils/normalizeBarcode";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    const body = await request.json();
    const barcodes = [...new Set<string>((Array.isArray(body.barcodes) ? body.barcodes : []).map(normalizeBarcode).filter(Boolean))];
    if (!barcodes.length || typeof body.isSold !== "boolean") {
      return NextResponse.json({ error: "Barcodes and a valid sold status are required" }, { status: 400 });
    }
    await ensureProductIndexes();
    const collection = (await clientPromise).db("gopalamJewels").collection("savedProducts");
    const matchedBarcodes: string[] = [];
    for (let index = 0; index < barcodes.length; index += 1000) {
      const batch = barcodes.slice(index, index + 1000);
      const matched = await collection.find({ barcode: { $in: batch } }).project({ barcode: 1 }).toArray();
      const found = matched.map((product) => String(product.barcode));
      if (found.length) {
        await collection.updateMany({ barcode: { $in: found } }, { $set: { isSold: body.isSold, stockStatusUpdatedAt: new Date() } });
      }
      matchedBarcodes.push(...found);
    }
    const found = new Set(matchedBarcodes);
    return NextResponse.json({ matchedBarcodes, unmatchedBarcodes: barcodes.filter((barcode) => !found.has(barcode)) });
  } catch (error) {
    console.error("Stock status update failed:", error);
    return NextResponse.json({ error: "Unable to update stock status. Please retry." }, { status: 500 });
  }
}
