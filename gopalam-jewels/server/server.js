const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
require("dotenv").config();

const app = express();

// ✅ FIX CORS (THIS WAS YOUR MAIN ISSUE)
app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type"],
}));

app.use(express.json());

// ---------------- CLOUDINARY ----------------
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// ---------------- MULTER ----------------
const storage = multer.diskStorage({});
const upload = multer({ storage });

// ---------------- MONGODB ----------------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// ---------------- MODEL ----------------
const ProductSchema = new mongoose.Schema({
  barcode: String,
  itemNo: String,
  stone: String,
  gross: String,
  stoneWt: String,
  dai: String,
  price: String,
  size: String,
  image: String,
});

const Product = mongoose.model("Product", ProductSchema);

// ---------------- ROUTES ----------------

// SAVE ALL PRODUCTS
app.post("/products", async (req, res) => {
  try {
    await Product.insertMany(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
});

// FETCH PRODUCT BY BARCODE
app.get("/products/:barcode", async (req, res) => {
  try {
    const product = await Product.findOne({ barcode: req.params.barcode });

    if (!product) {
      return res.status(200).json(null); // 👈 IMPORTANT (not 403)
    }

    res.json(product);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/test", (req, res) => {
  res.send("Server working");
});

// IMAGE UPLOAD
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);
    res.json({ url: result.secure_url });
  } catch (err) {
    res.status(500).json(err);
  }
});

// ---------------- START SERVER ----------------
app.listen(5000, () => {
  console.log("Server running on 5000");
});