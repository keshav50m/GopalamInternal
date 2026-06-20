import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import clientPromise from "@/lib/mongodb";

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json(
                { error: "No file uploaded" },
                { status: 400 }
            );
        }

        const bytes = await file.arrayBuffer();

        const workbook = XLSX.read(bytes, {
            type: "array",
        });

        const sheet =
            workbook.Sheets[
            workbook.SheetNames[0]
            ];

        const rows =
            XLSX.utils.sheet_to_json<any>(
                sheet,
                { header: 1 }
            );

        const barcodes = rows
            .flat()
            .map(String)
            .map(v => v.trim())
            .filter(Boolean);

        const client = await clientPromise;
        const db = client.db("gopalamJewels");

        const products = await db
            .collection("savedProducts")
            .find({
                barcode: { $in: barcodes }
            })
            .toArray();

        const uniqueItemNos = [
            ...new Set(
                products
                    .map(
                        (p: any) =>
                            p.data?.ITEMNO
                    )
                    .filter(Boolean)
            )
        ];

        const catalogueImages =
            await db
                .collection("imageCatalogue")
                .find({
                    itemNo: {
                        $in: uniqueItemNos
                    }
                })
                .toArray();

        const imageMap = new Map(
            catalogueImages.map(
                (i: any) => [
                    i.itemNo,
                    i.image
                ]
            )
        );

        const result = uniqueItemNos.map(itemNo => {
            const firstProduct = products.find(
                (p: any) =>
                    String(p.data?.ITEMNO || "").trim() === itemNo
            );

            return {
                barcode: firstProduct?.barcode || "",
                itemNo,
                image: imageMap.get(itemNo) || "",
            };
        });

        return NextResponse.json({
            rows: result
        });

    } catch (error) {
        console.error(error);

        return NextResponse.json(
            {
                error:
                    "Failed to process excel"
            },
            { status: 500 }
        );
    }
}