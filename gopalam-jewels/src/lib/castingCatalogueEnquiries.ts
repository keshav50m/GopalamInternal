import type { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import type { CastingCatalogueFieldSettings } from "@/lib/castingCatalogue";

export type CastingCatalogueEnquiryProduct = {
  barcode: string;
  itemNo: string;
  quantity: number;
  visibleDetails: Record<string, string>;
  image: string;
  r2Image: string;
};

export type CastingCatalogueEnquiryDocument = {
  _id?: ObjectId;
  enquiryId: string;
  catalogueId: ObjectId;
  catalogueToken: string;
  catalogueTitle: string;
  visibleFields: CastingCatalogueFieldSettings;
  customer: { name: string; mobile?: string; remarks?: string };
  products: CastingCatalogueEnquiryProduct[];
  distinctProductCount: number;
  totalQuantity: number;
  totals: { tagPrice?: number; usd?: number };
  submittedAt: Date;
  status: "new";
  pdfStatus: "pending" | "processing" | "ready" | "failed";
  notificationStatus: "unread" | "read";
  customerAccessToken?: string;
  pdfStorageKey?: string;
  pdfGeneratedAt?: Date;
  pdfError?: string;
  submissionKey: string;
  abuseKey: string;
};

let indexPromise: Promise<unknown> | null = null;

export const getCastingCatalogueEnquiriesCollection = async () => {
  const client = await clientPromise;
  return client.db("gopalamJewels")
    .collection<CastingCatalogueEnquiryDocument>("castingCatalogueEnquiries");
};

export const ensureCastingCatalogueEnquiryIndexes = () => {
  if (!indexPromise) {
    indexPromise = getCastingCatalogueEnquiriesCollection().then((collection) => Promise.all([
      collection.createIndex({ enquiryId: 1 }, { unique: true, name: "enquiry_id_unique" }),
      collection.createIndex(
        { catalogueToken: 1, submissionKey: 1 },
        { unique: true, name: "catalogue_submission_idempotency_unique" }
      ),
      collection.createIndex({ abuseKey: 1, submittedAt: -1 }, { name: "enquiry_abuse_window" }),
      collection.createIndex({ submittedAt: -1 }, { name: "enquiry_submitted_at" }),
    ]));
  }
  return indexPromise;
};
