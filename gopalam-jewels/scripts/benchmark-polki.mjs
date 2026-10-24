// Run only against a test MongoDB server: PERF_MONGO_URI=... npm run benchmark:polki
// A uniquely named scratch database is created and removed. App data is never read.
import { MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { polkiSearchFields } from "../src/lib/polki/productFields.ts";
import { polkiProductIndexes } from "../src/lib/polki/indexDefinitions.ts";
if (!process.env.PERF_MONGO_URI) throw new Error("Set PERF_MONGO_URI to a test MongoDB server");
const client=new MongoClient(process.env.PERF_MONGO_URI);
const db=client.db(`polki_performance_${Date.now()}`);
try {
  await client.connect();
  const products=db.collection("products");
  await products.createIndexes(polkiProductIndexes);
  for(const size of [1000,5000,10000]) {
    await products.deleteMany({});
    for(let offset=0;offset<size;offset+=500) {
      await products.insertMany(Array.from({length:Math.min(500,size-offset)},(_,i) => {
        const barcode=`B${String(offset+i).padStart(6,"0")}`;
        const data={ITEM:`P${offset+i}`,"LOT NO.":`LOT${i%20}`,"TAG":"T1","FINAL":String(i*10),"GROSSWT.":"5.5"};
        return {...polkiSearchFields(barcode,data),data,hasImage:i%2===0,updatedAt:new Date()};
      }));
    }
    const queries={barcode:{barcode:"B000050"},contains:{"searchText.barcode":{$elemMatch:{$gte:"000050",$lt:"000050\uffff"}}},price:{"search.price":{$gte:100,$lte:200}},missing:{hasImage:false}};
    for(const [name,query] of Object.entries(queries)) {
      const samples=[];
      for(let i=0;i<10;i++) {const start=performance.now();await products.find(query).project({barcode:1,data:1}).limit(50).toArray();samples.push(performance.now()-start);}
      const plan=await products.find(query).limit(50).explain("executionStats");
      assert.ok(!JSON.stringify(plan.queryPlanner.winningPlan).includes('"COLLSCAN"'),`${name} must use an index`);
      samples.sort((a,b)=>a-b);
      console.log(JSON.stringify({size,query:name,p95Ms:samples[9],keysExamined:plan.executionStats.totalKeysExamined,documentsExamined:plan.executionStats.totalDocsExamined,returned:plan.executionStats.nReturned}));
    }
  }
} finally {await db.dropDatabase();await client.close();}
