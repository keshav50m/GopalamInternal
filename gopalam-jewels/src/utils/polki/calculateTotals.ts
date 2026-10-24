
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
  let totalSILVER = 0;
  let count = 0;

  rows.forEach((row) => {
    if (!row.data) return;

    const d = row.data;

    count++;

    totalGross += parseFloat(d["GROSSWT."] || 0);
    totalStoneWt += parseFloat(d["NET WT."] || 0);
    totalDai += parseFloat(d["PUWAI"] || 0);
    const discountedPrice = applyDiscount(
      d["FINAL"],
      priceDiscountPercent
    );
    const discountedSILVER = applyDiscount(d["SILVER"], usdDiscountPercent);

    totalPrice += Number.isFinite(Number(discountedPrice))
      ? Math.round(Number(discountedPrice))
      : 0;
    totalSILVER += Number.isFinite(Number(discountedSILVER))
      ? Number(discountedSILVER)
      : 0;
  });

  return {
    count,
    totalGross,
    totalStoneWt,
    totalDai,
    totalPrice,
    totalSILVER,
  };
};
