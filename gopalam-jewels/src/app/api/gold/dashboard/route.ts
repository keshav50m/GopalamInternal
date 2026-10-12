import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureGoldProductIndexes } from "@/lib/goldDatabaseIndexes";
import clientPromise from "@/lib/mongodb";

// Cache aggregate summaries only; product searches always read current inventory.
let cached: { expires: number; data: Record<string, unknown> } | undefined;
let pending: Promise<Record<string, unknown>> | undefined;
const options = { maxTimeMS: 15000, allowDiskUse: true };
const projection = { barcode: 1, data: 1, sold: 1, updatedAt: 1 };

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureGoldProductIndexes();
    const collection = (await clientPromise).db("gopalamJewels").collection("savedProducts_Gold");
    const query = request.nextUrl.searchParams.get("query")?.trim() || "";
    if (query.length > 100) return NextResponse.json({ error: "Search must be 100 characters or fewer" }, { status: 400 });
    if (query) {
      const values: (string | number)[] = [query];
      if (/^(0|[1-9]\d*)$/.test(query) && Number.isSafeInteger(Number(query))) values.push(Number(query));
      const products = await collection.find({ $or: [
        { barcode: { $in: values } }, { "data.BARCODE": { $in: values } }, { "data.LOT NO": query.toUpperCase() },
      ] }, { projection, maxTimeMS: 5000 }).sort({ updatedAt: -1, _id: -1 }).limit(20).toArray();
      return NextResponse.json({ products }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (!cached || cached.expires <= Date.now()) {
      if (!pending) pending = (async () => {
        const now = new Date();
        const india = new Date(now.getTime() + 330 * 60000);
        const today = new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate()) - 330 * 60000);
        const month = new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), 1) - 330 * 60000);
        const since = new Date(today.getTime() - 13 * 86400000);
        const [summary, karats, trend, recentProducts] = await Promise.all([
          collection.aggregate([
            { $project: { sold: 1, updatedAt: 1 } },
            { $group: { _id: null, total: { $sum: 1 }, sold: { $sum: { $cond: [{ $eq: ["$sold", true] }, 1, 0] } },
              today: { $sum: { $cond: [{ $and: [{ $gte: ["$updatedAt", today] }, { $lte: ["$updatedAt", now] }] }, 1, 0] } },
              month: { $sum: { $cond: [{ $and: [{ $gte: ["$updatedAt", month] }, { $lte: ["$updatedAt", now] }] }, 1, 0] } } } },
          ], options).toArray(),
          collection.aggregate([
            { $project: { karat: { $trim: { input: { $convert: { input: "$data.KARAT1", to: "string", onError: "", onNull: "" } } } } } },
            { $group: { _id: "$karat", value: { $sum: 1 } } }, { $sort: { value: -1, _id: 1 } }, { $limit: 10 },
            { $project: { _id: 0, label: { $cond: [{ $eq: ["$_id", ""] }, "Unknown", "$_id"] }, value: 1 } },
          ], options).toArray(),
          collection.aggregate([
            { $match: { updatedAt: { $gte: since, $lte: now } } },
            { $group: { _id: { $dateToString: { date: "$updatedAt", format: "%Y-%m-%d", timezone: "Asia/Kolkata" } }, value: { $sum: 1 } } },
            { $sort: { _id: 1 } }, { $limit: 14 }, { $project: { _id: 0, label: "$_id", value: 1 } },
          ], options).toArray(),
          collection.find({}, { projection, maxTimeMS: 5000 }).sort({ updatedAt: -1, _id: -1 }).limit(12).toArray(),
        ]);
        const stats = summary[0] || { total: 0, sold: 0, today: 0, month: 0 };
        const data = { stats: { total: stats.total, sold: stats.sold, available: stats.total - stats.sold, today: stats.today, month: stats.month }, karats, trend, recentProducts, generatedAt: now.toISOString() };
        cached = { expires: Date.now() + 60000, data };
        return data;
      })().finally(() => { pending = undefined; });
      await pending;
    }
    return NextResponse.json(cached!.data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Gold dashboard failed:", error);
    return NextResponse.json({ error: "Unable to load Gold dashboard. Please retry." }, { status: 500 });
  }
}
