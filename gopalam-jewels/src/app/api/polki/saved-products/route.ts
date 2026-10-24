import { polkiSearchFields, polkiHasImage } from "@/lib/polki/productFields";
import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { requireAuthenticatedUser } from '@/lib/auth';
import { ensureProductIndexes } from '@/lib/polki/databaseIndexes';
import { withResolvedImageFields } from '@/lib/imageRead';


export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureProductIndexes();
    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const { searchParams } = request.nextUrl;
    const barcode = searchParams.get("barcode");

    if (barcode) {
      const product = await db.collection("polkiProducts").findOne({
        barcode: barcode.trim(),
      });

      if (!product) {
        return NextResponse.json({
          product: null,
        });
      }

      const itemNo = String(
        product.data?.ITEM || ""
      ).trim().toUpperCase();

      const catalogueItem = await db
        .collection("polkiImageCatalogue")
        .findOne({
          itemNo,
        });

      return NextResponse.json({
        product: {
          ...withResolvedImageFields(product),
          imageCatalogueImage:
            catalogueItem?.image || "",
          imageCatalogueR2Image: catalogueItem?.r2Image || "",
          imageCatalogueResolvedImageUrl: catalogueItem
            ? withResolvedImageFields(catalogueItem).resolvedImageUrl
            : "",
          imageCatalogueFallbackImageUrl: catalogueItem
            ? withResolvedImageFields(catalogueItem).fallbackImageUrl
            : "",
        },
      });
    }
    
    const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(searchParams.get("pageSize")) || 50)));
    const savedProducts = await db.collection("polkiProducts").find({}).project({barcode:1,data:1,image:1,r2Image:1,imageRemoved:1,updatedAt:1}).sort({barcode:1}).skip((page-1)*limit).limit(limit).toArray();

    const itemNos = Array.from(
      new Set(
        savedProducts
          .map((product: any) => String(product.data?.ITEM || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );

    const imageCatalogueItems = itemNos.length
      ? await db.collection("polkiImageCatalogue").find({ itemNo: { $in: itemNos } }).toArray()
      : [];

    const imageByItemNo = new Map(
      imageCatalogueItems.map((item: any) => [
        String(item.itemNo || "").trim().toUpperCase(),
        withResolvedImageFields(item),
      ])
    );

    const productsWithCatalogueImages = savedProducts.map((product: any) => {
      const itemNo = String(product.data?.ITEM || "").trim().toUpperCase();
      const catalogue = imageByItemNo.get(itemNo);
      return {
        ...withResolvedImageFields(product),
        imageCatalogueImage: catalogue?.image || "",
        imageCatalogueR2Image: catalogue?.r2Image || "",
        imageCatalogueResolvedImageUrl: catalogue?.resolvedImageUrl || "",
        imageCatalogueFallbackImageUrl: catalogue?.fallbackImageUrl || "",
      };
    });

    return NextResponse.json(productsWithCatalogueImages);
  } catch (error) {
    console.error("GET Error:", error);
    return NextResponse.json({ error: "Failed to load saved products" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureProductIndexes();
    const { products } = await request.json();

    if (!Array.isArray(products) || products.length === 0 || products.length > 500 || products.some((item: any) => !item?.barcode || !item?.data?.ITEM || [item.barcode,item.data.ITEM,item.data["LOT NO."],item.data.TAG].some(value => String(value ?? "").length > 128))) {
      return NextResponse.json({ error: "No products provided" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const updatedAt = new Date();

    const catalogueImages = await db.collection("polkiImageCatalogue").find({itemNo:{$in:products.map((item: any) => String(item.data.ITEM).trim().toUpperCase())}}).project({itemNo:1,image:1,r2Image:1}).limit(500).toArray();
    const catalogueByItem = new Map(catalogueImages.map(item => [item.itemNo,item]));
    const bulkOps = products.map((item: any) => {
      const fieldsToSet: Record<string, unknown> = {
        ...polkiSearchFields(item.barcode, item.data || {}),
        hasImage: item.imageRemoved && !polkiHasImage(item.image,item.r2Image) ? false : polkiHasImage(item.image, item.r2Image, catalogueByItem.get(String(item.data.ITEM).trim().toUpperCase())?.image, catalogueByItem.get(String(item.data.ITEM).trim().toUpperCase())?.r2Image),
        image: item.image || "",           // Cloudinary primary URL
        data: item.data || {},
        updatedAt,
      };
      if (Object.prototype.hasOwnProperty.call(item, "r2Image")) {
        fieldsToSet.r2Image = String(item.r2Image || "").trim();
      }
      const hasReplacementImage = Boolean(
        String(item.image || "").trim() || String(item.r2Image || "").trim()
      );
      return {
        updateOne: {
          filter: { barcode: String(item.barcode).trim() },
          update: {
            $set: fieldsToSet,
            ...(hasReplacementImage ? { $unset: { imageRemoved: "" } } : {}),
          },
          upsert: true,
        },
      };
    });

    await db.collection("polkiProducts").bulkWrite(bulkOps);

    const imageCatalogueOps = products
      .map((item: any) => ({
        itemNo: String(item.data?.ITEM || "").trim().toUpperCase(),
        image: String(item.image || "").trim(),
        ...(Object.prototype.hasOwnProperty.call(item, "r2Image")
          ? { r2Image: String(item.r2Image || "").trim() }
          : {}),
      }))
      .filter((item: any) => item.itemNo && item.image)
      .map((item: any) => {
        const fieldsToSet: Record<string, unknown> = {
          itemNo: item.itemNo,
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
      });

    if (imageCatalogueOps.length > 0) {
      await db.collection("polkiImageCatalogue").bulkWrite(imageCatalogueOps);
      await db.collection("polkiProducts").updateMany({itemNo:{$in:imageCatalogueOps.map(op => op.updateOne.filter.itemNo)},imageRemoved:{$ne:true}},{$set:{hasImage:true}});
    }

    return NextResponse.json({
      success: true,
      message: `${products.length} products saved successfully`
    });

  } catch (error) {
    console.error("POST Error:", error);
    return NextResponse.json({ error: "Failed to save products" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureProductIndexes();

    const body = await request.json();
    const barcode = String(body?.barcode || "").trim();
    if (!barcode) {
      return NextResponse.json({ error: "Barcode is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const result = await client.db("gopalamJewels").collection("polkiProducts").updateOne(
      { barcode },
      {
        $unset: { image: "", r2Image: "" },
        $set: { imageRemoved: true, hasImage: false, updatedAt: new Date() },
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Image removal failed:", error);
    return NextResponse.json({ error: "Failed to remove product image" }, { status: 500 });
  }
}
