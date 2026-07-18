import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import clientPromise from "@/lib/mongodb";

type QRUploadRow = {
  barcode: string;
  itemNo: string;
};

const normalizeItemNo = (value: unknown) =>
  String(value || "").trim().toUpperCase();

const normalizeHeader = (value: unknown) =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseQRValue = (value: unknown): QRUploadRow | null => {
  const qrValue = String(value || "").trim();
  if (!qrValue) return null;

  const parts = qrValue.split(",").map((part) => part.trim());
  const barcode = parts[0] || "";
  const itemNo = parts[1] || "";

  if (!barcode || !itemNo) return null;

  return { barcode, itemNo };
};

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
    const workbook = XLSX.read(bytes, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      defval: "",
    });

    const headerRow = rows[0] || [];
    const qrColumnIndex = headerRow.findIndex((cell) => {
      const header = normalizeHeader(cell);
      return header === "qrcode" || header === "qr";
    });

    const dataRows = qrColumnIndex >= 0 ? rows.slice(1) : rows;
    const uniqueRowsByItemNo = new Map<string, QRUploadRow>();

    dataRows.forEach((row) => {
      const qrValue = qrColumnIndex >= 0 ? row[qrColumnIndex] : row[0];
      const parsedRow = parseQRValue(qrValue);
      if (!parsedRow) return;

      const normalizedItemNo = normalizeItemNo(parsedRow.itemNo);
      if (!normalizedItemNo || uniqueRowsByItemNo.has(normalizedItemNo)) return;

      uniqueRowsByItemNo.set(normalizedItemNo, parsedRow);
    });

    const uniqueRows = Array.from(uniqueRowsByItemNo.values());

    if (uniqueRows.length === 0) {
      return NextResponse.json(
        { error: "No valid QR codes found in the uploaded Excel." },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const itemNos = uniqueRows.map((row) => row.itemNo);

    const catalogueImages = await db
      .collection("imageCatalogue")
      .find({
        $or: itemNos.map((itemNo) => ({
          itemNo: {
            $regex: `^\\s*${escapeRegex(itemNo)}\\s*$`,
            $options: "i",
          },
        })),
      })
      .toArray();

    const imageMap = new Map(
      catalogueImages.map((item: any) => [
        normalizeItemNo(item.itemNo),
        item.image,
      ])
    );

    return NextResponse.json({
      rows: uniqueRows.map((row) => ({
        barcode: row.barcode,
        itemNo: row.itemNo,
        image: imageMap.get(normalizeItemNo(row.itemNo)) || "",
      })),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to process QR excel" },
      { status: 500 }
    );
  }
}
