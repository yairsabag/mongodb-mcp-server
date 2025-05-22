import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ErrorCode, 
  ListToolsRequestSchema, 
  McpError 
} from '@modelcontextprotocol/sdk/types.js';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

class MongoDBMCPServer {
  constructor() {
    this.mongoClient = null;
    this.db = null;
    this.httpServer = null;
    
    this.setupMCPServer();
  }

  setupMCPServer() {
    this.server = new Server(
      {
        name: 'mongodb-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  async connectToMongoDB() {
    try {
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) {
        console.log('⚠️  MONGODB_URI not found, running in HTTP-only mode');
        return false;
      }

      console.log('🔌 Connecting to MongoDB...');
      this.mongoClient = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });

      await this.mongoClient.connect();
      
      const dbName = process.env.DB_NAME || 'test';
      this.db = this.mongoClient.db(dbName);
      
      console.log('✅ Connected to MongoDB Atlas');
      return true;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      console.log('📡 Continuing in HTTP-only mode...');
      return false;
    }
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'find_documents',
            description: 'Find documents in a MongoDB collection',
            inputSchema: {
              type: 'object',
              properties: {
                collection: { type: 'string', description: 'Collection name' },
                query: { type: 'object', description: 'Query object', default: {} },
                limit: { type: 'number', description: 'Limit results', default: 10 }
              },
              required: ['collection']
            }
          },
          {
            name: 'list_collections',
            description: 'List all collections in the database',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (!this.db) {
          throw new McpError(ErrorCode.InternalError, 'Database connection not available');
        }

        const { name, arguments: args } = request.params;

        switch (name) {
          case 'find_documents':
            return await this.findDocuments(args);
          case 'list_collections':
            return await this.listCollections();
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error('Tool execution error:', error);
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error.message}`);
      }
    });
  }

  async findDocuments({ collection, query = {}, limit = 10 }) {
    try {
      const documents = await this.db.collection(collection).find(query).limit(limit).toArray();
      return {
        content: [
          {
            type: 'text',
            text: `Found ${documents.length} documents:\n${JSON.stringify(documents, null, 2)}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Find operation failed: ${error.message}`);
    }
  }

  async listCollections() {
    try {
      const collections = await this.db.listCollections().toArray();
      const names = collections.map(c => c.name);
      return {
        content: [
          {
            type: 'text',
            text: `Collections: ${names.join(', ')}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `List collections failed: ${error.message}`);
    }
  }

  startHTTPServer() {
    const port = process.env.PORT || 3000;
    
    this.httpServer = http.createServer(async (req, res) => {
      // Handle CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        
        if (url.pathname === '/' || url.pathname === '/health') {
          // Health check
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            name: 'MongoDB MCP Server',
            status: 'running',
            mongodb: this.db ? 'connected' : 'disconnected',
            timestamp: new Date().toISOString(),
            endpoints: ['/health', '/api/collections', '/api/status']
          }, null, 2));

        } else if (url.pathname === '/api/collections') {
          if (!this.db) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Database not connected' }));
            return;
          }

          const collections = await this.db.listCollections().toArray();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            collections: collections.map(c => c.name),
            count: collections.length 
          }, null, 2));

        } else if (url.pathname === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            server: 'MongoDB MCP Server',
            version: '1.0.0',
            mongodb: {
              connected: !!this.db,
              uri: process.env.MONGODB_URI ? 'configured' : 'missing'
            },
            environment: {
              port: port,
              nodeVersion: process.version
            }
          }, null, 2));

        } else {
          // 404
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }

      } catch (error) {
        console.error('HTTP Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    this.httpServer.on('error', (error) => {
      console.error('HTTP Server Error:', error);
    });

    this.httpServer.listen(port, '0.0.0.0', () => {
      console.log(`🌐 HTTP server listening on port ${port}`);
    });
  }

  setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    // Graceful shutdown
    const cleanup = async () => {
      console.log('🛑 Shutting down...');
      if (this.httpServer) {
        this.httpServer.close();
      }
      if (this.mongoClient) {
        await this.mongoClient.close();
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Handle unhandled errors
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      cleanup();
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      cleanup();
    });
  }

  async run() {
    console.log('🚀 Starting MongoDB MCP Server...');
    
    try {
      // Try to connect to MongoDB (don't fail if it doesn't work)
      await this.connectToMongoDB();
      
      // Always start HTTP server for Railway
      this.startHTTPServer();
      
      // Only start MCP server if we're in a proper stdio environment
      if (!process.stdin.isTTY && process.env.NODE_ENV !== 'production') {
        console.log('📡 Starting MCP server on stdio...');
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
      } else {
        console.log('📱 Running in HTTP-only mode (Railway deployment)');
      }

      console.log('✅ Server started successfully!');
      
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new MongoDBMCPServer();
server.run().catch((error) => {
  console.error('💥 Server crashed:', error);
  process.exit(1);
});
