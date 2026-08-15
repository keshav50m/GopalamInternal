import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    const { searchParams } = new URL(req.url);
    const requestedLimit = Number(searchParams.get("limit")) || 50;
    const limit = Math.min(Math.max(requestedLimit, 1), 150);

    const client = await clientPromise;
    const db = client.db("gopalamJewels");

    const productsMissingSavedImage = await db
      .collection("savedProducts")
      .find({
        $and: [
          {
            $or: [
              { image: { $exists: false } },
              { image: "" },
              { image: null },
            ],
          },
          {
            $or: [
              { imageUrl: { $exists: false } },
              { imageUrl: "" },
              { imageUrl: null },
            ],
          },
        ],
      })
      .toArray();

    const itemNos = Array.from(
      new Set(
        productsMissingSavedImage
          .map((product: any) => String(product.data?.ITEMNO || "").trim())
          .filter(Boolean)
      )
    );

    const catalogueItems = itemNos.length
      ? await db
          .collection("imageCatalogue")
          .find({ itemNo: { $in: itemNos }, image: { $nin: ["", null] } })
          .project({ itemNo: 1 })
          .toArray()
      : [];

    const itemNosWithImages = new Set(
      catalogueItems.map((item: any) => String(item.itemNo || "").trim())
    );

    const products = productsMissingSavedImage
      .filter((product: any) => {
        const itemNo = String(product.data?.ITEMNO || "").trim();
        return !itemNo || !itemNosWithImages.has(itemNo);
      })
      .slice(0, limit)
      .map((product: any) => ({
        ...product,
        itemNo: String(product.data?.ITEMNO || "").trim(),
      }));

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
    const { barcode, itemNo, image } = await request.json();
    const normalizedBarcode = String(barcode || "").trim();
    const normalizedItemNo = String(itemNo || "").trim();
    const normalizedImage = String(image || "").trim();

    if (!normalizedBarcode || !normalizedItemNo || !normalizedImage) {
      return NextResponse.json(
        { error: "Barcode, Item No, and image are required" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const updatedAt = new Date();

    const savedProductResult = await db.collection("savedProducts").updateOne(
      { barcode: normalizedBarcode },
      {
        $set: {
          image: normalizedImage,
          updatedAt,
        },
      }
    );

    if (savedProductResult.matchedCount === 0) {
      return NextResponse.json(
        { error: "Saved product was not found" },
        { status: 404 }
      );
    }

    await db.collection("imageCatalogue").updateOne(
      { itemNo: normalizedItemNo },
      {
        $set: {
          itemNo: normalizedItemNo,
          image: normalizedImage,
          updatedAt,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      message: "Product image saved successfully",
    });
  } catch (error) {
    console.error("Missing Products POST Error:", error);
    return NextResponse.json(
      { error: "Failed to save product image" },
      { status: 500 }
    );
  }
}
