import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';


export async function GET(request: NextRequest) {
  try {
    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const { searchParams } = request.nextUrl;
    const barcode = searchParams.get("barcode");

    if (barcode) {
      const product = await db.collection("savedProducts").findOne({
        barcode: barcode.trim(),
      });

      if (!product) {
        return NextResponse.json({
          product: null,
        });
      }

      const itemNo = String(
        product.data?.ITEMNO || ""
      ).trim();

      const catalogueItem = await db
        .collection("imageCatalogue")
        .findOne({
          itemNo,
        });

      return NextResponse.json({
        product: {
          ...product,
          imageCatalogueImage:
            catalogueItem?.image || "",
        },
      });
    }
    
    const savedProducts = await db.collection("savedProducts").find({}).toArray();

    const itemNos = Array.from(
      new Set(
        savedProducts
          .map((product: any) => String(product.data?.ITEMNO || "").trim())
          .filter(Boolean)
      )
    );

    const imageCatalogueItems = itemNos.length
      ? await db.collection("imageCatalogue").find({ itemNo: { $in: itemNos } }).toArray()
      : [];

    const imageByItemNo = new Map(
      imageCatalogueItems.map((item: any) => [
        String(item.itemNo || "").trim(),
        item.image || "",
      ])
    );

    const productsWithCatalogueImages = savedProducts.map((product: any) => {
      const itemNo = String(product.data?.ITEMNO || "").trim();
      return {
        ...product,
        imageCatalogueImage: imageByItemNo.get(itemNo) || "",
      };
    });

    return NextResponse.json(productsWithCatalogueImages);
  } catch (error: any) {
    console.error("GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { products } = await request.json();

    if (!products || products.length === 0) {
      return NextResponse.json({ error: "No products provided" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const updatedAt = new Date();

    const bulkOps = products.map((item: any) => ({
      updateOne: {
        filter: { barcode: String(item.barcode).trim() },
        update: {
          $set: {
            barcode: String(item.barcode).trim(),
            image: item.image || "",           // Cloudinary URL
            data: item.data || {},
            updatedAt,
          },
        },
        upsert: true,
      },
    }));

    await db.collection("savedProducts").bulkWrite(bulkOps);

    const imageCatalogueOps = products
      .map((item: any) => ({
        itemNo: String(item.data?.ITEMNO || "").trim(),
        image: String(item.image || "").trim(),
      }))
      .filter((item: any) => item.itemNo && item.image)
      .map((item: any) => ({
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
      }));

    if (imageCatalogueOps.length > 0) {
      await db.collection("imageCatalogue").bulkWrite(imageCatalogueOps);
    }

    return NextResponse.json({
      success: true,
      message: `${products.length} products saved successfully`
    });

  } catch (error: any) {
    console.error("POST Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
