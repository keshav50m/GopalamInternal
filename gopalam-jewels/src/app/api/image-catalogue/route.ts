import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/databaseIndexes";

export async function GET(req: Request) {
  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  await ensureProductIndexes();
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
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureProductIndexes();
    const body = await request.json();
    const requestedItems = Array.isArray(body.items)
      ? body.items
      : [{ itemNo: body.itemNo, image: body.image }];
    const items = requestedItems.map((item: any) => ({
      itemNo: String(item?.itemNo || "").trim(),
      image: String(item?.image || "").trim(),
    }));

    if (
      items.length === 0 ||
      items.some((item: any) => !item.itemNo || !item.image)
    ) {
      return NextResponse.json(
        { error: "Item No and image are required for every item" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");

    const updatedAt = new Date();
    await db.collection("imageCatalogue").bulkWrite(
      items.map((item: any) => ({
        updateOne: {
          filter: { itemNo: item.itemNo },
          update: {
            $set: {
              itemNo: item.itemNo,
              image: item.image,
              updatedAt,
            },
          },
          upsert: true,
        },
      }))
    );

    return NextResponse.json({
      success: true,
      message: `${items.length} image catalogue item${items.length === 1 ? "" : "s"} updated successfully`,
    });
  } catch (error) {
    console.error("Image Catalogue POST Error:", error);
    return NextResponse.json({ error: "Failed to update image catalogue" }, { status: 500 });
  }
}
