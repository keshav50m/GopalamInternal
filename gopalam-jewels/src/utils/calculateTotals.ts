
export const calculateTotals = (rows: any[]) => {
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
    totalPrice += parseFloat(d["TAG PRICE"] || 0);
    totalUSD += parseFloat(d["USD"] || 0);
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