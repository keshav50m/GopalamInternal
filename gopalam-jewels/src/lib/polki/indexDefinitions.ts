import type { IndexDescription } from "mongodb";
export const polkiProductIndexes: IndexDescription[] = [
  {key:{barcode:1 as const},unique:true,name:"polki_barcode_unique"},
  {key:{itemNo:1 as const}},
  {key:{hasImage:1 as const,updatedAt:-1 as const}},
  {key:{updatedAt:-1 as const}},
  ...["barcode","itemNo","stone","size"].map(field => ({key:{[`searchText.${field}`]:1 as const,barcode:1 as const}})),
  ...["barcode","itemNo","stone","size","gross","stoneWt","dai","price","usd","labour","labourPuwai"].map(field => ({key:{[`search.${field}`]:1 as const,barcode:1 as const}})),
];
