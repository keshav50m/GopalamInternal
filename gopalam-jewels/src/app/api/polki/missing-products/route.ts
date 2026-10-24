import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/polki/databaseIndexes";
import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";

type MissingProductImage = {
  barcode: string;
  itemNo: string;
  image: string;
  r2Image?: string;
};

export async function GET(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    const { searchParams } = new URL(req.url);
    const requestedLimit = Number(searchParams.get("limit")) || 50;
    const limit = Math.min(Math.max(requestedLimit, 1), 150);

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    await ensureProductIndexes();

    const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
    const products = await db.collection("polkiProducts").find({hasImage:false}).project({barcode:1,itemNo:1}).sort({updatedAt:-1}).skip((page-1)*limit).limit(limit).toArray();

    return NextResponse.json(products);
  } catch (error) {
    console.error("Missing Products GET Error:", error);
    return NextResponse.json(
      { error: "Failed to load products missing images" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureProductIndexes();
    const body = await request.json();
    const isBatchRequest = Array.isArray(body.items);
    const requestedItems = isBatchRequest
      ? body.items
      : [{
          barcode: body.barcode,
          itemNo: body.itemNo,
          image: body.image,
          ...(Object.prototype.hasOwnProperty.call(body, "r2Image")
            ? { r2Image: body.r2Image }
            : {}),
        }];
    if (requestedItems.length > 500) return NextResponse.json({error:"Maximum 500 images per save"}, {status:400});
    const itemsByBarcode = new Map<string, MissingProductImage>(
      requestedItems.map((item: any): [string, MissingProductImage] => {
        const normalizedItem = {
          barcode: String(item?.barcode || "").trim(),
          itemNo: String(item?.itemNo || "").trim().toUpperCase(),
          image: normalizeStoredImageUrl(item?.image),
          ...(Object.prototype.hasOwnProperty.call(item, "r2Image")
            ? { r2Image: normalizeStoredImageUrl(item?.r2Image) }
            : {}),
        };
        return [normalizedItem.barcode, normalizedItem];
      })
    );
    const items = [...itemsByBarcode.values()];

    if (
      items.length === 0 ||
      items.some((item) => !item.barcode || !item.itemNo || !item.image)
    ) {
      return NextResponse.json(
        { error: "Barcode, Item No, and image are required for every item" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const updatedAt = new Date();

    const existingProducts = await db
      .collection("polkiProducts")
      .find({ barcode: { $in: items.map((item) => item.barcode) } })
      .project({ barcode: 1 })
      .toArray();
    const existingBarcodes = new Set(
      existingProducts.map((product: any) => String(product.barcode || "").trim())
    );
    const itemsToSave = items.filter((item) => existingBarcodes.has(item.barcode));
    const notFoundBarcodes = items
      .filter((item) => !existingBarcodes.has(item.barcode))
      .map((item) => item.barcode);

    if (!isBatchRequest && itemsToSave.length === 0) {
      return NextResponse.json(
        { error: "Saved product was not found" },
        { status: 404 }
      );
    }

    if (itemsToSave.length > 0) {
      await Promise.all([
        db.collection("polkiProducts").bulkWrite(
          itemsToSave.map((item) => {
            const fieldsToSet: Record<string, unknown> = {
              hasImage: true,
              image: item.image,
              updatedAt,
            };
            if (Object.prototype.hasOwnProperty.call(item, "r2Image")) {
              fieldsToSet.r2Image = item.r2Image;
            }
            return {
              updateOne: {
                filter: { barcode: item.barcode },
                update: { $set: fieldsToSet, $unset:{imageRemoved:""} },
              },
            };
          })
        ),
        db.collection("polkiImageCatalogue").bulkWrite(
          itemsToSave.map((item) => {
            const fieldsToSet: Record<string, unknown> = {
              itemNo: item.itemNo,
              hasImage: true,
              image: item.image,
              updatedAt,
            };
            if (Object.prototype.hasOwnProperty.call(item, "r2Image")) {
              fieldsToSet.r2Image = item.r2Image;
            }
            return {
              updateOne: {
                filter: { itemNo: item.itemNo },
                update: { $set: fieldsToSet },
                upsert: true,
              },
            };
          })
        ),
      ]);
      await db.collection("polkiProducts").updateMany({itemNo:{$in:itemsToSave.map(item => item.itemNo)},imageRemoved:{$ne:true}},{$set:{hasImage:true}});
    }

    return NextResponse.json({
      success: true,
      message: "Product image saved successfully",
      savedBarcodes: itemsToSave.map((item) => item.barcode),
      notFoundBarcodes,
    });
  } catch (error) {
    console.error("Missing Products POST Error:", error);
    return NextResponse.json(
      { error: "Failed to save product image" },
      { status: 500 }
    );
  }
}
