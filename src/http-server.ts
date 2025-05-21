import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.send("🚀 WhatsApp MongoDB MCP server is running!");
});

app.listen(PORT, () => {
  console.log(`✅ HTTP server listening on port ${PORT}`);
});
