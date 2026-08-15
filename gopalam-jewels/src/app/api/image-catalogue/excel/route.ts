import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import clientPromise from "@/lib/mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import {
    buildCatalogueImageMap,
    buildProductsByItemNo,
    normalizeItemNo,
    resolveImageCatalogueExcelImage,
} from "@/utils/resolveImageCatalogueExcelImage";

const escapeRegex = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function POST(req: NextRequest) {
    try {
        const auth = await requireAuthenticatedUser();
        if (auth.response) return auth.response;
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

        const products = (await db
            .collection("savedProducts")
            .find({
                barcode: { $in: barcodes }
            })
            .toArray()) as any[];

        const productsByItemNo = buildProductsByItemNo(products);
        const uniqueItemNos = [
            ...new Set(
                products
                    .map(
                        (p: any) =>
                            p.data?.ITEMNO
                    )
                    .filter(Boolean)
                    .map(normalizeItemNo)
            )
        ];

        if (uniqueItemNos.length === 0) {
            return NextResponse.json({
                rows: []
            });
        }

        const catalogueImages =
            (await db
                .collection("imageCatalogue")
                .find({
                    $or: uniqueItemNos.map((itemNo) => ({
                        itemNo: {
                            $regex: `^\\s*${escapeRegex(itemNo)}\\s*$`,
                            $options: "i",
                        },
                    })),
                })
                .toArray()) as any[];

        const imageMap = buildCatalogueImageMap(catalogueImages);

        const result = uniqueItemNos.map(itemNo => {
            const firstProduct = products.find(
                (p: any) =>
                    normalizeItemNo(p.data?.ITEMNO) === itemNo
            );
            const displayItemNo = firstProduct?.data?.ITEMNO || itemNo;

            return {
                barcode: firstProduct?.barcode || "",
                itemNo: displayItemNo,
                image: resolveImageCatalogueExcelImage({
                    itemNo,
                    selectedProduct: firstProduct,
                    catalogueImageMap: imageMap,
                    productsByItemNo,
                }),
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
