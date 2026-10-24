import test from "node:test";
import assert from "node:assert/strict";
import { parseQRCode, getChangedQRFields, POLKI_FIELDS } from "../src/utils/polki/qrProductData.ts";
import { polkiSearchFields } from "../src/lib/polki/productFields.ts";
import { runPolkiPDFChunks, partFilename } from "../src/utils/polki/pdfChunks.ts";
import { polkiFetch } from "../src/utils/polki/apiFetch.ts";

test("all eleven Polki QR columns retain their positions", () => {
  const values=["B001","P001","LOT7","12","4.250","5.500","TAG1","20","32","90","122"];
  const data=parseQRCode(values.join(","));
  assert.deepEqual(POLKI_FIELDS.map(field => data[field]),values);
  assert.deepEqual(getChangedQRFields({...data,"LABOUR PER GRM":"19"},data),["LABOUR PER GRM"]);
  assert.deepEqual(getChangedQRFields({...data,"NET WT.":"4.25"},data),[]);
  assert.equal(parseQRCode("B,P").FINAL,"");
});
test("normalized search supports indexed contains and numeric ranges", () => {
  const fields=polkiSearchFields("B",parseQRCode("B,P,Lot7,12,4.25,5.5,T,20,32,90,122"));
  assert.equal(fields.search.stone,"LOT7");
  assert.ok(fields.searchText.stone.includes("OT7"));
  assert.equal(fields.search.gross,5.5);
  assert.equal(fields.search.labourPuwai,32);
  assert.equal(polkiSearchFields("B",{ITEM:"P",FINAL:"bad"}).search.price,null);
});
for (const size of [1000,5000,10000]) {
  test(`${size} products: bounded PDF chunks preserve order and finish progress`,async () => {
    const rows=Array.from({length:size},(_,index) => ({index}));
    let processed=0,progress=0,chunks=0;
    await runPolkiPDFChunks(rows,async (chunk,report) => {
      assert.ok(chunk.length<=200);
      assert.equal(chunk[0].index,processed);
      processed+=chunk.length; chunks++;
      assert.match(partFilename("products.pdf"),/part_\d+_of_/);
      report(100);
    },value => {assert.ok(value>=progress);progress=value;});
    assert.equal(processed,size);
    assert.equal(chunks,Math.ceil(size/200));
    assert.equal(progress,100);
  });
}
test("failed PDF releases export lock",async () => {
  await assert.rejects(runPolkiPDFChunks([1],async () => {throw new Error("decode failed");}));
  await runPolkiPDFChunks([1],async () => {});
});
test("10000 QR lookups batch paired keys within server limits",async () => {
  const originalFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async (_input,init) => {
    const body=JSON.parse(String(init?.body));
    assert.ok(body.barcodes.length+body.itemNos.length<=1000);
    assert.deepEqual(body.barcodes,body.itemNos); calls++;
    return Response.json({products:body.barcodes.map((barcode:string) => ({barcode})),itemImages:{},success:true});
  };
  try {
    const keys=Array.from({length:10000},(_,index) => String(index));
    const response=await polkiFetch("/api/polki/saved-products/lookup",{method:"POST",body:JSON.stringify({barcodes:keys,itemNos:keys})});
    assert.equal((await response.json()).products.length,10000);
    assert.equal(calls,20);
  } finally {globalThis.fetch=originalFetch;}
});

test("PDF images use request timeouts and cache eviction bounds",async () => {
  const {fetchImageBlob,getOrCreateBoundedCacheEntry}=await import("../src/utils/polki/pdfImagePipeline.ts");
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (_input,init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(new Blob(["image"],{type:"image/jpeg"}));
  };
  try {assert.ok(await fetchImageBlob("https://example.com/image.jpg"));}
  finally {globalThis.fetch=originalFetch;}
  const cache=new Map<string,Promise<number>>();
  for(let i=0;i<1000;i++) await getOrCreateBoundedCacheEntry(cache,String(i),async () => i,3);
  assert.equal(cache.size,3);
  assert.ok(!cache.has("0"));
});

test("uploads resize pixels before transfer and never exceed three active requests",async () => {
  const {uploadProductImage}=await import("../src/utils/polki/uploadProductImage.ts");
  const originalFetch=globalThis.fetch;
  const originalImage=globalThis.Image;
  const originalDocument=globalThis.document;
  let active=0,maximum=0,draws=0;
  globalThis.Image=class {
    width=4000; height=2000; onload: (() => void) | null=null;
    set src(_value:string) {queueMicrotask(() => this.onload?.());}
  } as any;
  globalThis.document={createElement:() => ({width:0,height:0,getContext:()=>({drawImage:(_image:unknown,_x:number,_y:number,width:number,height:number)=>{assert.equal(width,1600);assert.equal(height,800);draws++;}}),toBlob:(callback:(blob:Blob)=>void)=>callback(new Blob(["jpeg"],{type:"image/jpeg"}))})} as any;
  globalThis.fetch=async () => {
    active++;maximum=Math.max(maximum,active);
    await new Promise(resolve=>setTimeout(resolve,5));active--;
    return Response.json({success:true,imageUrl:"https://example.com/product.jpg"});
  };
  try {
    await Promise.all(Array.from({length:12},()=>uploadProductImage(new File(["large"],"photo.png",{type:"image/png"}))));
    assert.equal(maximum,3); assert.equal(draws,12);
  } finally {globalThis.fetch=originalFetch;globalThis.Image=originalImage;globalThis.document=originalDocument;}
});
