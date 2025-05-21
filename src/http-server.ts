import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (_, res) => {
  res.send("MongoDB MCP Server is running.");
});

app.listen(port, () => {
  console.log(`✅ Server is listening on port ${port}`);
});
