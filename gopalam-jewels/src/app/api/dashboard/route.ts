import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/databaseIndexes";
import clientPromise from "@/lib/mongodb";

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stringExpression = (field: string) => ({
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
});

const hasDurableImageExpression = {
  $let: {
    vars: { imageUrl: stringExpression("$image") },
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
};

const getIndiaDateKeys = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year") || "";
  const month = values.get("month") || "";
  const day = values.get("day") || "";

  return {
    today: `${year}-${month}-${day}`,
    month: `${year}-${month}`,
  };
};

const productProjection = {
  _id: 1,
  barcode: 1,
  image: 1,
  data: 1,
  updatedAt: 1,
};

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    await ensureProductIndexes();

    const client = await clientPromise;
    const collection = client.db("gopalamJewels").collection("savedProducts");
    const barcode = request.nextUrl.searchParams.get("barcode")?.trim() || "";

    if (barcode) {
      const products = await collection
        .find({
          $expr: {
            $regexMatch: {
              input: stringExpression("$barcode"),
              regex: escapeRegex(barcode),
              options: "i",
            },
          },
        })
        .sort({ barcode: 1 })
        .limit(10)
        .project(productProjection)
        .toArray();

      return NextResponse.json({ products });
    }

    const dateKeys = getIndiaDateKeys();
    const [dashboardData] = await collection.aggregate([
      {
        $set: {
          _hasDurableImage: hasDurableImageExpression,
          _updatedDate: {
            $convert: {
              input: "$updatedAt",
              to: "date",
              onError: null,
              onNull: null,
            },
          },
          _stoneName: {
            $let: {
              vars: { stoneName: stringExpression("$data.STONE NAME") },
              in: {
                $cond: [
                  { $ne: ["$$stoneName", ""] },
                  "$$stoneName",
                  "Unknown",
                ],
              },
            },
          },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalProducts: { $sum: 1 },
                productsWithImages: {
                  $sum: { $cond: ["$_hasDurableImage", 1, 0] },
                },
                todaysUploads: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          {
                            $dateToString: {
                              date: "$_updatedDate",
                              format: "%Y-%m-%d",
                              timezone: "Asia/Kolkata",
                              onNull: "",
                            },
                          },
                          dateKeys.today,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                uploadsThisMonth: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          {
                            $dateToString: {
                              date: "$_updatedDate",
                              format: "%Y-%m",
                              timezone: "Asia/Kolkata",
                              onNull: "",
                            },
                          },
                          dateKeys.month,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          stoneDistribution: [
            { $group: { _id: "$_stoneName", value: { $sum: 1 } } },
            { $sort: { value: -1, _id: 1 } },
            { $limit: 10 },
            { $project: { _id: 0, label: "$_id", value: 1 } },
          ],
          uploadTrend: [
            { $match: { _updatedDate: { $ne: null } } },
            {
              $group: {
                _id: {
                  $dateToString: {
                    date: "$_updatedDate",
                    format: "%Y-%m-%d",
                  },
                },
                value: { $sum: 1 },
              },
            },
            { $sort: { _id: -1 } },
            { $limit: 14 },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, label: "$_id", value: 1 } },
          ],
          missingImages: [
            { $match: { _hasDurableImage: false } },
            { $sort: { updatedAt: -1 } },
            { $limit: 12 },
            { $project: productProjection },
          ],
          recentUploads: [
            { $sort: { updatedAt: -1 } },
            { $limit: 12 },
            { $project: productProjection },
          ],
        },
      },
    ]).toArray();

    const summary = dashboardData?.summary?.[0] || {
      totalProducts: 0,
      productsWithImages: 0,
      todaysUploads: 0,
      uploadsThisMonth: 0,
    };

    return NextResponse.json({
      stats: {
        ...summary,
        productsMissingImages:
          summary.totalProducts - summary.productsWithImages,
      },
      stoneDistribution: dashboardData?.stoneDistribution || [],
      uploadTrend: dashboardData?.uploadTrend || [],
      missingImages: dashboardData?.missingImages || [],
      recentUploads: dashboardData?.recentUploads || [],
    });
  } catch (error) {
    console.error("Dashboard GET Error:", error);
    return NextResponse.json(
      { error: "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
