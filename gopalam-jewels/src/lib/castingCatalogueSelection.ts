import { createHmac } from "crypto";

const getSelectionSecret = () => {
  const secret = process.env.CATALOGUE_SELECTION_SECRET || process.env.AUTH_SECRET ||
    (process.env.NODE_ENV !== "production" ? "gopalam-local-catalogue-selection-secret" : "");
  if (secret.length < 32) {
    throw new Error("CATALOGUE_SELECTION_SECRET or AUTH_SECRET must contain at least 32 characters");
  }
  return secret;
};

export const createCatalogueSelectionId = (catalogueToken: string, barcode: string) =>
  createHmac("sha256", getSelectionSecret())
    .update(`${catalogueToken}\u0000${barcode}`)
    .digest("base64url");

export const createCatalogueAbuseKey = (catalogueToken: string, clientAddress: string) =>
  createHmac("sha256", getSelectionSecret())
    .update(`abuse\u0000${catalogueToken}\u0000${clientAddress}`)
    .digest("base64url");
