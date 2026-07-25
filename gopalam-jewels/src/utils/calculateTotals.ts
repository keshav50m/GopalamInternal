
import { applyDiscount } from "@/utils/applyDiscount";

export const calculateTotals = (
  rows: any[],
  priceDiscountPercent = 0,
  usdDiscountPercent = 0
) => {
  let totalGross = 0;
  let totalStoneWt = 0;
  let totalDai = 0;
  let totalPrice = 0;
  let totalUSD = 0;
  let count = 0;

  rows.forEach((row) => {
    if (!row.data) return;

    const d = row.data;

    count++;

    totalGross += parseFloat(d["GROSS WT"] || 0);
    totalStoneWt += parseFloat(d["STONE WT"] || 0);
    totalDai += parseFloat(d["DAI WT"] || 0);
    const discountedPrice = applyDiscount(
      d["TAG PRICE"],
      priceDiscountPercent
    );
    const discountedUSD = applyDiscount(d["USD"], usdDiscountPercent);

    totalPrice += Number.isFinite(Number(discountedPrice))
      ? Math.round(Number(discountedPrice))
      : 0;
    totalUSD += Number.isFinite(Number(discountedUSD))
      ? Number(discountedUSD)
      : 0;
  });

  return {
    count,
    totalGross,
    totalStoneWt,
    totalDai,
    totalPrice,
    totalUSD,
  };
};
