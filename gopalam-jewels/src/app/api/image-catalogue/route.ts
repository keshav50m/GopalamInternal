import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const itemNo = searchParams.get("itemNo");

  if (!itemNo) {
    return Response.json(null);
  }

  const client = await clientPromise;

  const db = client.db("gopalamJewels");

  const image = await db
    .collection("imageCatalogue")
    .findOne({
      itemNo: itemNo.trim(),
    });

  return Response.json(image);
}
export async function POST(request: NextRequest) {
  try {
    const { itemNo, image } = await request.json();
    const normalizedItemNo = String(itemNo || "").trim();
    const normalizedImage = String(image || "").trim();

    if (!normalizedItemNo || !normalizedImage) {
      return NextResponse.json(
        { error: "Item No and image are required" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");

    await db.collection("imageCatalogue").updateOne(
      { itemNo: normalizedItemNo },
      {
        $set: {
          itemNo: normalizedItemNo,
          image: normalizedImage,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      message: "Image catalogue updated successfully",
    });
  } catch (error: any) {
    console.error("Image Catalogue POST Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
