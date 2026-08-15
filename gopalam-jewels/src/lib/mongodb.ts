import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const getDevelopmentMongoUri = () => {
  if (process.env.NODE_ENV === 'production') return '';

  try {
    const envPath = path.join(process.cwd(), 'server', '.env');
    const envContents = fs.readFileSync(envPath, 'utf8');
    const mongoLine = envContents
      .split(/\r?\n/)
      .find((line) => line.startsWith('MONGO_URI='));
    return mongoLine?.slice('MONGO_URI='.length).trim() || '';
  } catch {
    return '';
  }
};

const uri = process.env.MONGO_URI || getDevelopmentMongoUri();

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
