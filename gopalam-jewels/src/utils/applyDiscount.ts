export const applyDiscount = (
  value: unknown,
  discountPercent: number
) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return value;
  }

  const safeDiscount = Math.min(
    100,
    Math.max(0, discountPercent || 0)
  );

  return numericValue * (1 - safeDiscount / 100);
};
