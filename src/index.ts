import http from 'http';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('🚀 Starting MongoDB MCP Server...');
console.log('📊 Environment check:');
console.log('- Node version:', process.version);
console.log('- PORT:', process.env.PORT || 'not set');
console.log('- MONGODB_URI:', process.env.MONGODB_URI ? 'configured' : 'missing');

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

let mongoClient = null;
let db = null;

// MongoDB connection function
async function connectToMongoDB() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.log('⚠️  MONGODB_URI not found, running in HTTP-only mode');
      return false;
    }

    console.log('🔌 Attempting MongoDB connection...');
    
    // Dynamic import to handle potential missing dependency
    const { MongoClient } = await import('mongodb');
    
    mongoClient = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    await mongoClient.connect();
    
    const dbName = process.env.DB_NAME || 'test';
    db = mongoClient.db(dbName);
    
    console.log('✅ Connected to MongoDB Atlas');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('📡 Continuing in HTTP-only mode...');
    return false;
  }
}

// Create HTTP server
function createHTTPServer() {
  const port = process.env.PORT || 3000;
  
  const server = http.createServer(async (req, res) => {
    console.log(`📥 ${req.method} ${req.url}`);
    
    // CORS headers
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
        // Health check endpoint
        const response = {
          name: 'MongoDB MCP Server',
          version: '1.0.0',
          status: 'running',
          mongodb: db ? 'connected' : 'disconnected',
          timestamp: new Date().toISOString(),
          environment: {
            node: process.version,
            port: port,
            mongoUri: process.env.MONGODB_URI ? 'configured' : 'missing'
          },
          endpoints: {
            health: '/',
            status: '/api/status',
            collections: '/api/collections',
            test: '/api/test'
          }
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response, null, 2));

      } else if (url.pathname === '/api/status') {
        // Detailed status
        const status = {
          server: 'MongoDB MCP Server',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          mongodb: {
            connected: !!db,
            uri: process.env.MONGODB_URI ? 'configured' : 'missing'
          },
          environment: process.env.NODE_ENV || 'development'
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));

      } else if (url.pathname === '/api/collections') {
        if (!db) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Database not connected',
            message: 'MongoDB connection is not available'
          }));
          return;
        }

        try {
          const collections = await db.listCollections().toArray();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            collections: collections.map(c => c.name),
            count: collections.length,
            database: db.databaseName
          }, null, 2));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }

      } else if (url.pathname === '/api/test') {
        if (!db) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Database not connected',
            message: 'MongoDB connection is not available'
          }));
          return;
        }

        try {
          const collections = await db.listCollections().toArray();
          const testResults = {
            database: db.databaseName,
            collectionsFound: collections.length,
            collections: {}
          };
          
          // Test first 3 collections
          for (const col of collections.slice(0, 3)) {
            try {
              const count = await db.collection(col.name).countDocuments();
              const sample = await db.collection(col.name).findOne();
              testResults.collections[col.name] = {
                documentCount: count,
                sampleFields: sample ? Object.keys(sample) : [],
                hasData: count > 0
              };
            } catch (error) {
              testResults.collections[col.name] = { 
                error: error.message 
              };
            }
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(testResults, null, 2));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }

      } else {
        // 404 for unknown paths
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Not found',
          availableEndpoints: ['/', '/api/status', '/api/collections', '/api/test']
        }));
      }

    } catch (error) {
      console.error('💥 Request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }));
    }
  });

  server.on('error', (error) => {
    console.error('💥 HTTP Server Error:', error);
    process.exit(1);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🌐 HTTP server listening on port ${port}`);
    console.log(`📍 Health check: http://localhost:${port}/`);
    console.log(`🔗 Public URL: https://mongodb-mcp-server-production.up.railway.app/`);
  });

  return server;
}

// Graceful shutdown
function setupGracefulShutdown(server) {
  const cleanup = async () => {
    console.log('🛑 Shutting down gracefully...');
    
    if (server) {
      server.close(() => {
        console.log('📪 HTTP server closed');
      });
    }
    
    if (mongoClient) {
      await mongoClient.close();
      console.log('🔌 MongoDB connection closed');
    }
    
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// Main function
async function main() {
  try {
    console.log('🎯 Starting main function...');
    
    // Try to connect to MongoDB (optional)
    await connectToMongoDB();
    
    // Start HTTP server (required)
    const server = createHTTPServer();
    
    // Setup graceful shutdown
    setupGracefulShutdown(server);
    
    console.log('✅ Server started successfully!');
    console.log('🎉 Ready to serve requests!');
    
  } catch (error) {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
console.log('🏁 Executing main function...');
main().catch((error) => {
  console.error('💥 Main function crashed:', error);
  process.exit(1);
});
