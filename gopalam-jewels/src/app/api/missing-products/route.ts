import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/databaseIndexes";
import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";

type MissingProductImage = {
  barcode: string;
  itemNo: string;
  image: string;
};

const hasDurableImageExpression = (field: string) => ({
  $let: {
    vars: {
      imageUrl: {
        $trim: {
          input: {
            $convert: {
              input: field,
              to: "string",
              onError: "",
              onNull: "",
            },
          },
        },
      },
    },
    in: {
      $and: [
        { $ne: ["$$imageUrl", ""] },
        {
          $eq: [
            {
              $regexMatch: {
                input: "$$imageUrl",
                regex: /^blob:/i,
              },
            },
            false,
          ],
        },
      ],
    },
  },
});

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

    const products = await db.collection("savedProducts").aggregate([
      {
        $match: {
          $expr: {
            $and: [
              { $eq: [hasDurableImageExpression("$image"), false] },
              { $eq: [hasDurableImageExpression("$imageUrl"), false] },
            ],
          },
        },
      },
      {
        $set: {
          itemNo: {
            $trim: {
              input: {
                $convert: {
                  input: "$data.ITEMNO",
                  to: "string",
                  onError: "",
                  onNull: "",
                },
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "imageCatalogue",
          localField: "itemNo",
          foreignField: "itemNo",
          as: "catalogueItems",
        },
      },
      {
        $match: {
          $expr: {
            $eq: [
              {
                $size: {
                  $filter: {
                    input: "$catalogueItems",
                    as: "catalogueItem",
                    cond: hasDurableImageExpression("$$catalogueItem.image"),
                  },
                },
              },
              0,
            ],
          },
        },
      },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          barcode: 1,
          itemNo: 1,
        },
      },
    ]).toArray();

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
      : [{ barcode: body.barcode, itemNo: body.itemNo, image: body.image }];
    const itemsByBarcode = new Map<string, MissingProductImage>(
      requestedItems.map((item: any): [string, MissingProductImage] => {
        const normalizedItem = {
          barcode: String(item?.barcode || "").trim(),
          itemNo: String(item?.itemNo || "").trim(),
          image: normalizeStoredImageUrl(item?.image),
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
      .collection("savedProducts")
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
        db.collection("savedProducts").bulkWrite(
          itemsToSave.map((item) => ({
            updateOne: {
              filter: { barcode: item.barcode },
              update: { $set: { image: item.image, updatedAt } },
            },
          }))
        ),
        db.collection("imageCatalogue").bulkWrite(
          itemsToSave.map((item) => ({
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
        ),
      ]);
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
