const normalizeHeader = (value: string) => value.trim().toUpperCase().replace(/[ _-]/g, "");

export const getPastedLines = (text: string, headerNames: string[] = []) => {
  const headers = new Set(headerNames.map(normalizeHeader));
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !headers.has(normalizeHeader(line)));
};

export const parsePastedTable = (text: string) => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""]));
  });
};
