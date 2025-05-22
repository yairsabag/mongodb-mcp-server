export const config = {
  connectionString: process.env.MONGODB_URI!,
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  logPath: "./logs",
  apiClientId: process.env.MDB_MCP_API_CLIENT_ID,
  apiClientSecret: process.env.MDB_MCP_API_CLIENT_SECRET,
  telemetry: "disabled",
};
