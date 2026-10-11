import type { Metadata } from "next";
import PublicCatalogue from "@/components/interactiveCatalogue/PublicCatalogue";

export const metadata: Metadata = {
  title: "Casting Jewellery Catalogue — Gopalam Jewels",
  description: "A shared Gopalam Jewels Casting Jewellery catalogue.",
  robots: { index: false, follow: false },
};

export default async function CataloguePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicCatalogue token={token} />;
}
