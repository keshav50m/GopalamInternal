import { polkiSearchFields, polkiHasImage } from "@/lib/polki/productFields";
import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/polki/databaseIndexes";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { QR_PRODUCT_FIELDS } from "@/utils/polki/qrProductData";

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
  const itemNo = String(record.ITEM ?? "").trim();
  if (!itemNo || [barcode,itemNo,record["LOT NO."],record.TAG].some(value => String(value ?? "").length > 128) || normalizeBarcode(record.BARCODE) !== barcode) return null;

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
    if (!Array.isArray(body.updates) || body.updates.length === 0 || body.updates.length > 100) {
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

    const currentProducts = await db.collection("polkiProducts").find({barcode:{$in:[...uniqueUpdates.keys()]}}).project({barcode:1,data:1,image:1,r2Image:1,imageRemoved:1}).limit(100).toArray();
    const currentByBarcode = new Map(currentProducts.map(product => [product.barcode,product]));
    const productOps = [];
    const catalogueOps = [];
    const updatedAt = new Date();
    for (const update of uniqueUpdates.values()) {
      const current = currentByBarcode.get(update.barcode);
      if (!current) {results.push({barcode:update.barcode,success:false,error:"Saved product no longer exists"});continue;}
      const mergedData = {...current.data,...update.newData,BARCODE:update.barcode};
      const image = update.replaceImage ? update.image : String(current.image || update.image || "");
      const r2Image = update.replaceImage ? update.r2Image || "" : String(current.r2Image || "");
      productOps.push({updateOne:{filter:{barcode:update.barcode},update:{
        $set:{...polkiSearchFields(update.barcode,mergedData),data:mergedData,image,r2Image,hasImage:polkiHasImage(image,r2Image),updatedAt},
        ...(image || r2Image ? {$unset:{imageRemoved:""}} : {}),
      }}});
      if (polkiHasImage(image,r2Image)) catalogueOps.push({updateOne:{filter:{itemNo:String(mergedData.ITEM).trim().toUpperCase()},update:{$set:{itemNo:String(mergedData.ITEM).trim().toUpperCase(),image,r2Image,updatedAt}},upsert:true}});
      results.push({barcode:update.barcode,success:true});
    }
    if (productOps.length) await db.collection("polkiProducts").bulkWrite(productOps,{ordered:false});
    if (catalogueOps.length) {
      await db.collection("polkiImageCatalogue").bulkWrite(catalogueOps,{ordered:false});
      await db.collection("polkiProducts").updateMany({itemNo:{$in:catalogueOps.map(op => op.updateOne.filter.itemNo)},imageRemoved:{$ne:true}},{$set:{hasImage:true}});
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
