import { randomBytes } from "crypto";
import { MongoServerError } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { CASTING_CATALOGUE_FIELDS, catalogueProductValues } from "@/lib/castingCatalogue";
import {
  ensureCastingCatalogueEnquiryIndexes,
  getCastingCatalogueEnquiriesCollection,
  type CastingCatalogueEnquiryProduct,
} from "@/lib/castingCatalogueEnquiries";
import {
  calculatePermittedTotals,
  validateCustomerDetails,
  validateEnquirySelections,
} from "@/lib/castingCatalogueEnquiryValidation";
import { createCatalogueAbuseKey, createCatalogueSelectionId } from "@/lib/castingCatalogueSelection";
import { getCastingSharedCataloguesCollection } from "@/lib/castingSharedCatalogues";
import clientPromise from "@/lib/mongodb";
import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";

type RouteContext = { params: Promise<{ token: string }> };
type DetailField = Exclude<(typeof CASTING_CATALOGUE_FIELDS)[number], "image">;

const SUBMISSION_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ABUSE_WINDOW_MS = 10 * 60 * 1000;
const MAX_SUBMISSIONS_PER_WINDOW = 5;

const createEnquiryId = () => {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `GJ-${date}-${randomBytes(5).toString("hex").toUpperCase()}`;
};

const getClientAddress = (request: NextRequest) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  "unknown";

export async function POST(request: NextRequest, context: RouteContext) {
  let resolvedToken = "";
  let resolvedSubmissionKey = "";
  try {
    const { token } = await context.params;
    resolvedToken = token;
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
      return NextResponse.json({ error: "Catalogue not found" }, { status: 404 });
    }

    const body = await request.json();
    const submissionKey = String(body.submissionKey || "").trim();
    resolvedSubmissionKey = submissionKey;
    if (!SUBMISSION_KEY_PATTERN.test(submissionKey)) {
      return NextResponse.json({ error: "Invalid submission request" }, { status: 400 });
    }
    const customerResult = validateCustomerDetails(body.customer);
    if (customerResult.error || !customerResult.customer) {
      return NextResponse.json({ error: customerResult.error }, { status: 400 });
    }
    const selectionResult = validateEnquirySelections(body.selections);
    if (selectionResult.error) {
      return NextResponse.json({ error: selectionResult.error }, { status: 400 });
    }

    const catalogueCollection = await getCastingSharedCataloguesCollection();
    const catalogue = await catalogueCollection.findOne({ token, active: true });
    if (!catalogue || !catalogue._id) {
      return NextResponse.json({ error: "Catalogue not found" }, { status: 404 });
    }

    await ensureCastingCatalogueEnquiryIndexes();
    const enquiryCollection = await getCastingCatalogueEnquiriesCollection();
    const existing = await enquiryCollection.findOne({ catalogueToken: token, submissionKey });
    if (existing) {
      return NextResponse.json({
        success: true,
        enquiryId: existing.enquiryId,
        customerAccessToken: existing.customerAccessToken,
        duplicate: true,
      });
    }

    const abuseKey = createCatalogueAbuseKey(token, getClientAddress(request));
    const recentSubmissions = await enquiryCollection.countDocuments({
      abuseKey,
      submittedAt: { $gte: new Date(Date.now() - ABUSE_WINDOW_MS) },
    }, { limit: MAX_SUBMISSIONS_PER_WINDOW });
    if (recentSubmissions >= MAX_SUBMISSIONS_PER_WINDOW) {
      return NextResponse.json(
        { error: "Too many enquiries were submitted recently. Please try again later." },
        { status: 429, headers: { "Retry-After": "600" } }
      );
    }

    const barcodeBySelectionId = new Map(
      catalogue.productBarcodes.map((barcode) => [createCatalogueSelectionId(token, barcode), barcode])
    );
    const resolvedSelections = selectionResult.selections.map((selection) => ({
      ...selection,
      barcode: barcodeBySelectionId.get(selection.selectionId) || "",
    }));
    if (resolvedSelections.some((selection) => !selection.barcode)) {
      return NextResponse.json({ error: "One or more selected products are not in this catalogue" }, { status: 400 });
    }

    const requestedBarcodes = resolvedSelections.map((selection) => selection.barcode);
    const client = await clientPromise;
    const db = client.db("gopalamJewels");
    const products = await db.collection("savedProducts")
      .find({ barcode: { $in: requestedBarcodes } })
      .project({ barcode: 1, image: 1, r2Image: 1, imageRemoved: 1, data: 1 })
      .toArray();
    const productByBarcode = new Map(products.map((product) => [String(product.barcode || "").trim(), product]));
    if (productByBarcode.size !== requestedBarcodes.length) {
      return NextResponse.json({ error: "One or more selected products are no longer available" }, { status: 400 });
    }

    const itemNos = Array.from(new Set(products.map((product) => String(product.data?.ITEMNO || "").trim()).filter(Boolean)));
    const imageCatalogueItems = itemNos.length
      ? await db.collection("imageCatalogue").find({ itemNo: { $in: itemNos } })
        .project({ itemNo: 1, image: 1, r2Image: 1 }).toArray()
      : [];
    const catalogueImageByItemNo = new Map(
      imageCatalogueItems.map((item) => [String(item.itemNo || "").trim(), item])
    );

    const totalEntries: Array<{ price: string; usd: string; quantity: number }> = [];
    const enquiryProducts: CastingCatalogueEnquiryProduct[] = resolvedSelections.map((selection) => {
      const product = productByBarcode.get(selection.barcode)!;
      const values = catalogueProductValues(product);
      const visibleDetails = Object.fromEntries(
        CASTING_CATALOGUE_FIELDS
          .filter((field): field is DetailField => field !== "image" && catalogue.visibleFields[field])
          .map((field) => [field, values[field]])
      );
      totalEntries.push({ price: values.price, usd: values.usd, quantity: selection.quantity });
      const catalogueImage = catalogueImageByItemNo.get(values.item);
      const imageRemoved = product.imageRemoved === true;
      return {
        barcode: selection.barcode,
        itemNo: values.item,
        quantity: selection.quantity,
        visibleDetails,
        image: imageRemoved ? "" : normalizeStoredImageUrl(product.image) || normalizeStoredImageUrl(catalogueImage?.image),
        r2Image: imageRemoved ? "" : normalizeStoredImageUrl(product.r2Image) || normalizeStoredImageUrl(catalogueImage?.r2Image),
      };
    });

    const totals = calculatePermittedTotals(totalEntries, catalogue.visibleFields);
    const enquiryId = createEnquiryId();
    const customerAccessToken = randomBytes(32).toString("base64url");
    const submittedAt = new Date();
    await enquiryCollection.insertOne({
      enquiryId,
      catalogueId: catalogue._id,
      catalogueToken: token,
      catalogueTitle: catalogue.title || "Casting Jewellery Catalogue",
      visibleFields: catalogue.visibleFields,
      customer: customerResult.customer,
      products: enquiryProducts,
      distinctProductCount: enquiryProducts.length,
      totalQuantity: enquiryProducts.reduce((sum, product) => sum + product.quantity, 0),
      totals,
      submittedAt,
      status: "new",
      pdfStatus: "pending",
      notificationStatus: "unread",
      customerAccessToken,
      submissionKey,
      abuseKey,
    });

    return NextResponse.json({ success: true, enquiryId, customerAccessToken, totals }, { status: 201 });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      try {
        const existing = await (await getCastingCatalogueEnquiriesCollection()).findOne({
          catalogueToken: resolvedToken,
          submissionKey: resolvedSubmissionKey,
        });
        if (existing) {
          return NextResponse.json({ success: true, enquiryId: existing.enquiryId, customerAccessToken: existing.customerAccessToken, duplicate: true });
        }
      } catch {
        // Return the safe generic error below.
      }
    }
    console.error("Casting catalogue enquiry submission failed:", error);
    return NextResponse.json({ error: "Unable to submit the enquiry. Please try again." }, { status: 500 });
  }
}
