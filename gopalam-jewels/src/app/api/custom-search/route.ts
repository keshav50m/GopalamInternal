import { NextRequest, NextResponse } from "next/server";
import type { Document, Filter } from "mongodb";
import clientPromise from "@/lib/mongodb";

const textFieldMap = {
  barcode: "barcode",
  itemNo: "data.ITEMNO",
  stone: "data.STONE NAME",
  size: "data.SIZE",
} as const;

const numericFieldMap = {
  gross: "data.GROSS WT",
  stoneWt: "data.STONE WT",
  dai: "data.DAI WT",
  price: "data.TAG PRICE",
  usd: "data.USD",
} as const;

let indexPromise: Promise<unknown> | null = null;

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ensureIndexes = async () => {
  if (!indexPromise) {
    indexPromise = clientPromise.then(async (client) => {
      const collection = client.db("gopalamJewels").collection("savedProducts");

      await Promise.all([
        collection.createIndex({ barcode: 1 }, { name: "barcode_search" }),
        collection.createIndex({ "data.ITEMNO": 1 }, { name: "item_no_search" }),
        collection.createIndex(
          { "data.STONE NAME": 1 },
          { name: "stone_search" }
        ),
        collection.createIndex({ "data.SIZE": 1 }, { name: "size_search" }),
        collection.createIndex(
          { "data.TAG PRICE": 1 },
          { name: "price_search" }
        ),
        collection.createIndex(
          { "data.GROSS WT": 1 },
          { name: "gross_search" }
        ),
        collection.createIndex(
          { "data.STONE WT": 1 },
          { name: "stone_weight_search" }
        ),
      ]);
    });
  }

  return indexPromise;
};

const parseNumber = (value: string | null) => {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(request: NextRequest) {
  try {
    await ensureIndexes();

    const { searchParams } = request.nextUrl;
    const requestedPage = Number(searchParams.get("page")) || 1;
    const requestedPageSize = Number(searchParams.get("pageSize")) || 25;
    const page = Math.max(1, requestedPage);

    const pageSize =
      requestedPageSize > 0
        ? Math.min(requestedPageSize, 10000)
        : 25;
    const clauses: Filter<Document>[] = [];

    Object.entries(textFieldMap).forEach(([parameter, field]) => {
      const value = searchParams.get(parameter)?.trim();
      if (!value) return;

      clauses.push({
        [field]: {
          $regex: escapeRegex(value),
          $options: "i",
        },
      });
    });

    Object.entries(numericFieldMap).forEach(([parameter, field]) => {
      const minimum = parseNumber(searchParams.get(`${parameter}Min`));
      const maximum = parseNumber(searchParams.get(`${parameter}Max`));
      if (minimum === null && maximum === null) return;

      const convertedValue = {
        $convert: {
          input: `$${field}`,
          to: "double",
          onError: null,
          onNull: null,
        },
      };
      const comparisons: Document[] = [];

      if (minimum !== null) comparisons.push({ $gte: [convertedValue, minimum] });
      if (maximum !== null) comparisons.push({ $lte: [convertedValue, maximum] });

      clauses.push({ $expr: { $and: comparisons } });
    });

    const query: Filter<Document> = clauses.length ? { $and: clauses } : {};
    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const collection = db.collection("savedProducts");
    const [total, products] = await Promise.all([
      collection.countDocuments(query),
      collection
        .find(query)
        .sort({ barcode: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);

    const itemNos = Array.from(
      new Set(
        products
          .map((product) => String(product.data?.ITEMNO || "").trim())
          .filter(Boolean)
      )
    );
    const catalogueItems = itemNos.length
      ? await db
        .collection("imageCatalogue")
        .find({ itemNo: { $in: itemNos } })
        .toArray()
      : [];
    const catalogueImages = new Map(
      catalogueItems.map((item) => [
        String(item.itemNo || "").trim(),
        String(item.image || "").trim(),
      ])
    );

    const productsWithImages = products.map((product) => {
      const itemNo = String(product.data?.ITEMNO || "").trim();

      return {
        ...product,
        imageCatalogueImage: catalogueImages.get(itemNo) || "",
      };
    });

    return NextResponse.json({
      products: productsWithImages,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("Custom Search GET Error:", error);
    return NextResponse.json(
      { error: "Failed to search products" },
      { status: 500 }
    );
  }
}
