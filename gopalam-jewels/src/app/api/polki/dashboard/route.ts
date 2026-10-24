import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth";
import { ensureProductIndexes } from "@/lib/polki/databaseIndexes";
import clientPromise from "@/lib/mongodb";
import { withResolvedImageFields } from "@/lib/imageRead";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  try {
    await ensureProductIndexes();
    const collection = (await clientPromise).db("gopalamJewels").collection("polkiProducts");
    const projection = {barcode:1,data:1,image:1,r2Image:1,imageRemoved:1,updatedAt:1};
    const barcode = request.nextUrl.searchParams.get("barcode")?.trim().toUpperCase();
    if (barcode) return NextResponse.json({products: (await collection.find({"searchText.barcode":{$elemMatch:{$gte:barcode,$lt:barcode + "\uffff"}}}).project(projection).limit(50).toArray()).map(withResolvedImageFields)});
    const day = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const startDay = new Date(`${day}T00:00:00+05:30`);
    const startMonth = new Date(`${day.slice(0,7)}-01T00:00:00+05:30`);
    const [totalProducts, productsWithImages, todaysUploads, uploadsThisMonth, missingImages, recentUploads, stoneDistribution, uploadTrend] = await Promise.all([
      collection.countDocuments({}), collection.countDocuments({hasImage:true}),
      collection.countDocuments({updatedAt:{$gte:startDay}}), collection.countDocuments({updatedAt:{$gte:startMonth}}),
      collection.find({hasImage:false}).project(projection).sort({updatedAt:-1}).limit(12).toArray(),
      collection.find({}).project(projection).sort({updatedAt:-1}).limit(12).toArray(),
      collection.aggregate([{$group:{_id:"$search.stone",value:{$sum:1}}},{$sort:{value:-1}},{$limit:10},{$project:{_id:0,label:"$_id",value:1}}]).toArray(),
      collection.aggregate([{$match:{updatedAt:{$gte:new Date(Date.now()-14*86400000)}}},{$group:{_id:{$dateToString:{date:"$updatedAt",format:"%Y-%m-%d",timezone:"Asia/Kolkata"}},value:{$sum:1}}},{$sort:{_id:1}},{$project:{_id:0,label:"$_id",value:1}}]).toArray(),
    ]);
    return NextResponse.json({stats:{totalProducts,productsWithImages,productsMissingImages:totalProducts-productsWithImages,todaysUploads,uploadsThisMonth},missingImages:missingImages.map(withResolvedImageFields),recentUploads:recentUploads.map(withResolvedImageFields),stoneDistribution,uploadTrend});
  } catch (error) {
    console.error("Polki dashboard", error);
    return NextResponse.json({error:"Failed to load dashboard"},{status:500});
  }
}
