import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { CASTING_CATALOGUE_FIELDS, normalizeCatalogueDiscounts, normalizeCatalogueFields } from "@/lib/castingCatalogue";
import { ensureCastingSharedCatalogueIndexes, getCastingSharedCataloguesCollection } from "@/lib/castingSharedCatalogues";
import clientPromise from "@/lib/mongodb";

const MAX_PRODUCTS = 5000;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (auth.user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await ensureCastingSharedCatalogueIndexes();
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
    const pageSize = Math.min(50, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize")) || 20));
    const collection = await getCastingSharedCataloguesCollection();
    const filter = { deletedAt: { $exists: false } };
    const [total, catalogues] = await Promise.all([
      collection.countDocuments(filter),
      collection.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    ]);
    return NextResponse.json({
      catalogues: catalogues.map((catalogue) => ({
        token: catalogue.token,
        title: catalogue.title || "",
        productCount: catalogue.productBarcodes.length,
        visibleFields: catalogue.visibleFields,
        discounts: catalogue.discounts || { pricePercent: 0, usdPercent: 0 },
        createdAt: catalogue.createdAt,
        active: catalogue.active,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("Casting catalogue list failed:", error);
    return NextResponse.json({ error: "Failed to load catalogues" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (auth.user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json();
    const productBarcodes: string[] = Array.from(new Set<string>(
      (Array.isArray(body.productBarcodes) ? body.productBarcodes : [])
        .map((value: unknown) => String(value || "").trim())
        .filter((value: string) => Boolean(value))
    ));
    if (!productBarcodes.length || productBarcodes.length > MAX_PRODUCTS) {
      return NextResponse.json({ error: `Select between 1 and ${MAX_PRODUCTS} products` }, { status: 400 });
    }
    const visibleFields = normalizeCatalogueFields(body.visibleFields);
    if (!CASTING_CATALOGUE_FIELDS.some((field) => visibleFields[field])) {
      return NextResponse.json({ error: "Select at least one visible field" }, { status: 400 });
    }
    const title = String(body.title || "").trim().slice(0, 120);
    const discounts = normalizeCatalogueDiscounts(body.discounts);
    const client = await clientPromise;
    const matched = await client.db("gopalamJewels").collection("savedProducts")
      .find({ barcode: { $in: productBarcodes } }).project({ barcode: 1 }).toArray();
    const matchedBarcodes = new Set(matched.map((product) => String(product.barcode || "")));
    if (matchedBarcodes.size !== productBarcodes.length) {
      return NextResponse.json({ error: "One or more selected products no longer exist" }, { status: 400 });
    }
    await ensureCastingSharedCatalogueIndexes();
    const token = randomBytes(24).toString("base64url");
    const collection = await getCastingSharedCataloguesCollection();
    await collection.insertOne({
      token,
      productBarcodes,
      visibleFields,
      discounts,
      ...(title ? { title } : {}),
      createdAt: new Date(),
      createdBy: new ObjectId(auth.user._id),
      active: true,
    });
    return NextResponse.json({ token, url: `/catalogue/${token}` }, { status: 201 });
  } catch (error) {
    console.error("Casting catalogue creation failed:", error);
    return NextResponse.json({ error: "Failed to create catalogue" }, { status: 500 });
  }
}
