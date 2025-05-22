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
import url from 'url';

dotenv.config();

class MongoDBMCPServer {
  constructor() {
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

    this.mongoClient = null;
    this.db = null;
    this.httpServer = null;
    
    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  async connectToMongoDB() {
    try {
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) {
        throw new Error('MONGODB_URI environment variable is required');
      }

      this.mongoClient = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
      });

      await this.mongoClient.connect();
      
      // Extract database name from URI or use default
      const dbName = process.env.DB_NAME || 'mcp_database';
      this.db = this.mongoClient.db(dbName);
      
      console.log('✅ Connected to MongoDB Atlas');
      return true;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      throw error;
    }
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'find_documents',
            description: 'Find documents in a MongoDB collection with optional query and projection',
            inputSchema: {
              type: 'object',
              properties: {
                collection: {
                  type: 'string',
                  description: 'Collection name'
                },
                query: {
                  type: 'object',
                  description: 'MongoDB query object (optional)',
                  default: {}
                },
                projection: {
                  type: 'object',
                  description: 'Fields to include/exclude (optional)'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of documents to return',
                  default: 10
                }
              },
              required: ['collection']
            }
          },
          {
            name: 'insert_document',
            description: 'Insert a single document into a MongoDB collection',
            inputSchema: {
              type: 'object',
              properties: {
                collection: {
                  type: 'string',
                  description: 'Collection name'
                },
                document: {
                  type: 'object',
                  description: 'Document to insert'
                }
              },
              required: ['collection', 'document']
            }
          },
          {
            name: 'update_document',
            description: 'Update documents in a MongoDB collection',
            inputSchema: {
              type: 'object',
              properties: {
                collection: {
                  type: 'string',
                  description: 'Collection name'
                },
                filter: {
                  type: 'object',
                  description: 'Filter to match documents'
                },
                update: {
                  type: 'object',
                  description: 'Update operations'
                },
                upsert: {
                  type: 'boolean',
                  description: 'Create document if not found',
                  default: false
                }
              },
              required: ['collection', 'filter', 'update']
            }
          },
          {
            name: 'delete_documents',
            description: 'Delete documents from a MongoDB collection',
            inputSchema: {
              type: 'object',
              properties: {
                collection: {
                  type: 'string',
                  description: 'Collection name'
                },
                filter: {
                  type: 'object',
                  description: 'Filter to match documents to delete'
                },
                deleteMany: {
                  type: 'boolean',
                  description: 'Delete all matching documents (default: false)',
                  default: false
                }
              },
              required: ['collection', 'filter']
            }
          },
          {
            name: 'aggregate',
            description: 'Run aggregation pipeline on a MongoDB collection',
            inputSchema: {
              type: 'object',
              properties: {
                collection: {
                  type: 'string',
                  description: 'Collection name'
                },
                pipeline: {
                  type: 'array',
                  description: 'Aggregation pipeline stages'
                }
              },
              required: ['collection', 'pipeline']
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
          },
          {
            name: 'create_index',
            description: 'Create an index on a collection',
            inputSchema: {
              type: 'object',
              properties: {
                collection: {
                  type: 'string',
                  description: 'Collection name'
                },
                indexSpec: {
                  type: 'object',
                  description: 'Index specification'
                },
                options: {
                  type: 'object',
                  description: 'Index options (optional)'
                }
              },
              required: ['collection', 'indexSpec']
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (!this.db) {
          throw new McpError(ErrorCode.InternalError, 'Database connection not established');
        }

        const { name, arguments: args } = request.params;

        switch (name) {
          case 'find_documents':
            return await this.findDocuments(args);
          case 'insert_document':
            return await this.insertDocument(args);
          case 'update_document':
            return await this.updateDocument(args);
          case 'delete_documents':
            return await this.deleteDocuments(args);
          case 'aggregate':
            return await this.aggregate(args);
          case 'list_collections':
            return await this.listCollections();
          case 'create_index':
            return await this.createIndex(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error.message}`);
      }
    });
  }

  async findDocuments({ collection, query = {}, projection, limit = 10 }) {
    try {
      // Handle ObjectId conversion in query
      const processedQuery = this.processObjectIds(query);
      
      let cursor = this.db.collection(collection).find(processedQuery);
      
      if (projection) {
        cursor = cursor.project(projection);
      }
      
      const documents = await cursor.limit(limit).toArray();
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${documents.length} document(s) in collection '${collection}':\n\n${JSON.stringify(documents, null, 2)}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Find operation failed: ${error.message}`);
    }
  }

  async insertDocument({ collection, document }) {
    try {
      const result = await this.db.collection(collection).insertOne(document);
      
      return {
        content: [
          {
            type: 'text',
            text: `Document inserted successfully into '${collection}' with ID: ${result.insertedId}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Insert operation failed: ${error.message}`);
    }
  }

  async updateDocument({ collection, filter, update, upsert = false }) {
    try {
      const processedFilter = this.processObjectIds(filter);
      const result = await this.db.collection(collection).updateMany(processedFilter, update, { upsert });
      
      return {
        content: [
          {
            type: 'text',
            text: `Update operation completed for collection '${collection}'. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}${result.upsertedId ? `, Upserted ID: ${result.upsertedId}` : ''}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Update operation failed: ${error.message}`);
    }
  }

  async deleteDocuments({ collection, filter, deleteMany = false }) {
    try {
      const processedFilter = this.processObjectIds(filter);
      const result = deleteMany 
        ? await this.db.collection(collection).deleteMany(processedFilter)
        : await this.db.collection(collection).deleteOne(processedFilter);
      
      return {
        content: [
          {
            type: 'text',
            text: `Delete operation completed for collection '${collection}'. Deleted: ${result.deletedCount} document(s)`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Delete operation failed: ${error.message}`);
    }
  }

  async aggregate({ collection, pipeline }) {
    try {
      const results = await this.db.collection(collection).aggregate(pipeline).toArray();
      
      return {
        content: [
          {
            type: 'text',
            text: `Aggregation completed for collection '${collection}':\n\n${JSON.stringify(results, null, 2)}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Aggregation failed: ${error.message}`);
    }
  }

  async listCollections() {
    try {
      const collections = await this.db.listCollections().toArray();
      const collectionNames = collections.map(col => col.name);
      
      return {
        content: [
          {
            type: 'text',
            text: `Available collections:\n${collectionNames.join('\n')}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `List collections failed: ${error.message}`);
    }
  }

  async createIndex({ collection, indexSpec, options = {} }) {
    try {
      const result = await this.db.collection(collection).createIndex(indexSpec, options);
      
      return {
        content: [
          {
            type: 'text',
            text: `Index created successfully on collection '${collection}': ${result}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Create index failed: ${error.message}`);
    }
  }

  processObjectIds(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const processed = Array.isArray(obj) ? [] : {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (key === '_id' && typeof value === 'string' && ObjectId.isValid(value)) {
        processed[key] = new ObjectId(value);
      } else if (typeof value === 'object' && value !== null) {
        processed[key] = this.processObjectIds(value);
      } else {
        processed[key] = value;
      }
    }
    
    return processed;
  }

  setupHTTPServer() {
    const port = process.env.PORT || 3000;
    
    this.httpServer = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      try {
        if (parsedUrl.pathname === '/') {
          // Health check endpoint
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const status = {
            name: 'MongoDB MCP Server',
            version: '1.0.0',
            status: 'running',
            mongodb: this.db ? 'connected' : 'disconnected',
            endpoints: {
              health: '/',
              collections: '/api/collections',
              test: '/api/test'
            },
            note: 'This is an MCP server. Use MCP clients to interact with MongoDB operations.'
          };
          res.end(JSON.stringify(status, null, 2));
          
        } else if (parsedUrl.pathname === '/api/collections') {
          // Test endpoint to list collections
          if (!this.db) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Database not connected' }));
            return;
          }
          
          const collections = await this.db.listCollections().toArray();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ collections: collections.map(c => c.name) }, null, 2));
          
        } else if (parsedUrl.pathname === '/api/test') {
          // Test endpoint to sample data
          if (!this.db) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Database not connected' }));
            return;
          }
          
          const collections = await this.db.listCollections().toArray();
          const testResults = {};
          
          for (const col of collections.slice(0, 3)) { // Test first 3 collections
            try {
              const count = await this.db.collection(col.name).countDocuments();
              const sample = await this.db.collection(col.name).findOne();
              testResults[col.name] = {
                count,
                sampleFields: sample ? Object.keys(sample) : []
              };
            } catch (error) {
              testResults[col.name] = { error: error.message };
            }
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(testResults, null, 2));
          
        } else {
          // 404 for other paths
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }
        
      } catch (error) {
        console.error('HTTP request error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    
    this.httpServer.listen(port, () => {
      console.log(`🌐 HTTP server listening on port ${port}`);
      console.log(`📍 Health check: http://localhost:${port}/`);
      console.log(`📊 Collections: http://localhost:${port}/api/collections`);
      console.log(`🧪 Test data: http://localhost:${port}/api/test`);
    });
  }

  setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  async cleanup() {
    if (this.httpServer) {
      this.httpServer.close();
      console.log('HTTP server closed');
    }
    if (this.mongoClient) {
      await this.mongoClient.close();
      console.log('MongoDB connection closed');
    }
  }

  async run() {
    try {
      await this.connectToMongoDB();
      
      // Start HTTP server for Railway (health checks and testing)
      this.setupHTTPServer();
      
      // MCP server runs on stdio
      if (process.stdin.isTTY) {
        console.log('🚀 MCP Server running in HTTP-only mode (for Railway)');
        console.log('💡 For MCP functionality, use a stdio client locally');
      } else {
        console.log('🚀 MCP Server running on stdio');
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
      }
      
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new MongoDBMCPServer();
server.run().catch(console.error);
