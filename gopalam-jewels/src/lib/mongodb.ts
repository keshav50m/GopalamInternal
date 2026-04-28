import { MongoClient } from 'mongodb';

const uri = "mongodb+srv://keshav50m_db_user:pMqXx2YPvhoGnEWH@cluster0.knba3b7.mongodb.net/?appName=Cluster0";

if (!uri) {
  throw new Error("MongoDB URI is missing!");
}

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  let globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>;
  };

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri);
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export default clientPromise;