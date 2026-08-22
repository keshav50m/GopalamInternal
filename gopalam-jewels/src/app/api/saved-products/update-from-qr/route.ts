import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/databaseIndexes";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { QR_PRODUCT_FIELDS } from "@/utils/qrProductData";

type ValidUpdate = {
  barcode: string;
  image: string;
  r2Image?: string;
  replaceImage: boolean;
  newData: Record<string, string>;
};

const validateUpdate = (value: unknown): ValidUpdate | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const barcode = normalizeBarcode(candidate.barcode);
  const image = typeof candidate.image === "string" ? candidate.image.trim() : "";
  const replaceImage = candidate.replaceImage === true;
  const r2Image = Object.prototype.hasOwnProperty.call(candidate, "r2Image")
    ? String(candidate.r2Image || "").trim()
    : undefined;
  const inputData = candidate.newData;
  if (!barcode || !inputData || typeof inputData !== "object") return null;
  const record = inputData as Record<string, unknown>;
  const itemNo = String(record.ITEMNO ?? "").trim();
  if (!itemNo || normalizeBarcode(record.BARCODE) !== barcode) return null;

  const newData: Record<string, string> = { BARCODE: barcode };
  QR_PRODUCT_FIELDS.forEach((field) => {
    newData[field] = String(record[field] ?? "").trim();
  });
  return { barcode, image, r2Image, replaceImage, newData };
};

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureProductIndexes();

    const body = await request.json();
    if (!Array.isArray(body.updates) || body.updates.length === 0) {
      return NextResponse.json({ error: "At least one update is required" }, { status: 400 });
    }
    const updates = body.updates.map(validateUpdate);
    if (updates.some((update: ValidUpdate | null) => !update)) {
      return NextResponse.json({ error: "Every update requires a valid barcode and QR product data" }, { status: 400 });
    }

    const uniqueUpdates = new Map<string, ValidUpdate>();
    (updates as ValidUpdate[]).forEach((update) => uniqueUpdates.set(update.barcode, update));
    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const results: Array<{ barcode: string; success: boolean; error?: string }> = [];

    for (const update of uniqueUpdates.values()) {
      try {
        const current = await db.collection("savedProducts").findOne({ barcode: update.barcode });
        if (!current) {
          results.push({ barcode: update.barcode, success: false, error: "Saved product no longer exists" });
          continue;
        }
        const updatedAt = new Date();
        const itemNo = update.newData.ITEMNO;

        if (update.image) {
          const catalogueFields: Record<string, unknown> = {
            itemNo,
            image: update.image,
            updatedAt,
          };
          if (update.r2Image !== undefined) {
            catalogueFields.r2Image = update.r2Image;
          }
          await db.collection("imageCatalogue").updateOne(
            { itemNo },
            { $set: catalogueFields },
            { upsert: true }
          );
        }

        const mergedData = { ...(current.data || {}), ...update.newData, BARCODE: update.barcode };
        const productFields: Record<string, unknown> = {
          data: mergedData,
          image: update.image,
          updatedAt,
        };
        if (update.replaceImage && update.r2Image !== undefined) {
          productFields.r2Image = update.r2Image;
        }
        const productResult = await db.collection("savedProducts").updateOne(
          { barcode: update.barcode },
          { $set: productFields }
        );
        if (productResult.matchedCount !== 1) throw new Error("Saved product changed during update");
        results.push({ barcode: update.barcode, success: true });
      } catch (error) {
        console.error("QR product update failed", { barcode: update.barcode, error });
        results.push({ barcode: update.barcode, success: false, error: "Database update failed" });
      }
    }

    return NextResponse.json({
      success: results.every((result) => result.success),
      results,
      updatedCount: results.filter((result) => result.success).length,
      failedCount: results.filter((result) => !result.success).length,
    });
  } catch (error) {
    console.error("QR update request failed", error);
    return NextResponse.json({ error: "Failed to update products from QR" }, { status: 500 });
  }
}
