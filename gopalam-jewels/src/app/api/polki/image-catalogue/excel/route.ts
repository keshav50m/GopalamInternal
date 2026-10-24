import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import clientPromise from "@/lib/mongodb";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/polki/databaseIndexes";
import { findCatalogueImagesByItemNos } from "@/lib/polki/imageCatalogueQueries";
import {
    buildCatalogueImageMap,
    buildProductsByItemNo,
    normalizeItemNo,
    resolveImageCatalogueExcelImage,
} from "@/utils/polki/resolveImageCatalogueExcelImage";
import { withResolvedImageFields } from "@/lib/imageRead";

export async function POST(req: NextRequest) {
    try {
        const auth = await requireAuthenticatedUser();
        if (auth.response) return auth.response;
        await ensureProductIndexes();
        const formData = await req.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json(
                { error: "No file uploaded" },
                { status: 400 }
            );
        }

        if (file.size > 8 * 1024 * 1024) return NextResponse.json({error:"Maximum workbook size is 8 MB"},{status:413});
    const bytes = await file.arrayBuffer();

        const workbook = XLSX.read(bytes, {
            type: "array",
            sheetRows:1002,
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

        if (barcodes.length > 1000) return NextResponse.json({error:"Maximum 1000 barcodes per workbook; split large imports"}, {status:400});
        const client = await clientPromise;
        const db = client.db("gopalamJewels");

        const products = (await db
            .collection("polkiProducts")
            .find({
                barcode: { $in: barcodes }
            })
            .project({barcode:1,data:1,image:1,r2Image:1,imageRemoved:1}).limit(1000).toArray()) as any[];

        const productsByItemNo = buildProductsByItemNo(products);
        const uniqueItemNos = [
            ...new Set(
                products
                    .map(
                        (p: any) =>
                            p.data?.ITEM
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

        const catalogueImages = await findCatalogueImagesByItemNos(
            db.collection("polkiImageCatalogue"),
            uniqueItemNos
        );

        const imageMap = buildCatalogueImageMap(catalogueImages);

        const result = uniqueItemNos.map(itemNo => {
            const firstProduct = productsByItemNo.get(itemNo)?.[0];
            const displayItemNo = firstProduct?.data?.ITEM || itemNo;

            const selected = resolveImageCatalogueExcelImage({
                itemNo,
                selectedProduct: firstProduct,
                catalogueImageMap: imageMap,
                productsByItemNo,
            });
            return {
                barcode: firstProduct?.barcode || "",
                itemNo: displayItemNo,
                ...withResolvedImageFields(selected),
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
