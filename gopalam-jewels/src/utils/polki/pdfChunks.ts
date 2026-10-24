// Each document owns at most 200 rows and their images. Large exports produce
// numbered PDF parts using the same layout, avoiding one ever-growing jsPDF.
const CHUNK_SIZE = 200;
let currentPart = 0;
let partCount = 1;
let running = false;
export const partFilename = (name: string) => partCount === 1 ? `Polki_${name}` : `Polki_${name.replace(/\.pdf$/i, "")}_part_${String(currentPart).padStart(3, "0")}_of_${partCount}.pdf`;
export const runPolkiPDFChunks = async <T>(rows: T[], render: (rows: T[], progress: (value: number) => void) => Promise<void>, progress?: (value: number) => void) => {
  if (running) throw new Error("A Polki PDF export is already running");
  running = true;
  partCount = Math.max(1, Math.ceil(rows.length / CHUNK_SIZE));
  try {
    for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
      currentPart = Math.floor(offset / CHUNK_SIZE) + 1;
      await render(rows.slice(offset, offset + CHUNK_SIZE), value => progress?.(Math.round(((currentPart - 1) + value / 100) * 100 / partCount)));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    progress?.(100);
  } finally { running = false; currentPart = 0; partCount = 1; }
};
