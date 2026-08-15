import { hash } from "bcryptjs";
import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URI;
const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;

if (!uri) throw new Error("MONGO_URI is required");
if (!initialPassword) throw new Error("INITIAL_ADMIN_PASSWORD is required");
if (initialPassword.length < 10 || !/[^A-Za-z0-9]/.test(initialPassword)) {
  throw new Error("INITIAL_ADMIN_PASSWORD must be at least 10 characters and include a special character");
}

const client = new MongoClient(uri);

try {
  await client.connect();
  const users = client.db("gopalamJewels").collection("users");
  await users.createIndex({ username: 1 }, { unique: true, name: "username_unique" });
  await users.createIndex({ email: 1 }, { name: "email_lookup" });

  const existingAdmin = await users.findOne({ username: "admin" });
  if (existingAdmin) {
    console.log("Initial admin already exists; no changes were made.");
  } else {
    const now = new Date();
    await users.insertOne({
      username: "admin",
      email: "gopalamgems@gmail.com",
      passwordHash: await hash(initialPassword, 12),
      role: "admin",
      isActive: true,
      authVersion: 0,
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
    });
    console.log("Initial admin created successfully.");
  }
} finally {
  await client.close();
}
