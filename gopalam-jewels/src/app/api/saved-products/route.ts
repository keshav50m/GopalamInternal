import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    
    const savedProducts = await db.collection("savedProducts").find({}).toArray();

    return NextResponse.json(savedProducts);
  } catch (error: any) {
    console.error("GET saved-products Error:", error);
    return NextResponse.json({ 
      error: "Failed to fetch saved products",
      message: error.message,
      code: error.code 
    }, { status: 500 });
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

    const bulkOps = products.map((item: any) => ({
      updateOne: {
        filter: { barcode: String(item.barcode).trim() },
        update: {
          $set: {
            barcode: String(item.barcode).trim(),
            image: item.image || "",
            data: item.data || {},
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    await db.collection("savedProducts").bulkWrite(bulkOps);

    return NextResponse.json({ 
      success: true, 
      message: `${products.length} products saved successfully` 
    });

  } catch (error: any) {
    console.error("POST saved-products Error:", error);
    return NextResponse.json({ 
      error: error.message || "Failed to save products" 
    }, { status: 500 });
  }
}