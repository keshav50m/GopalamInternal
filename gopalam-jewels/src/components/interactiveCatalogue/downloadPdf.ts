export const downloadPdfResponse = async (response: Response, enquiryId: string) => {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to download PDF. Please retry.");
  }
  if (!response.headers.get("content-type")?.includes("application/pdf")) {
    throw new Error("Unable to download PDF. Please refresh the page and retry.");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${enquiryId}-selection.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};
