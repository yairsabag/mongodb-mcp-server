#!/usr/bin/env node

import { spawn } from 'child_process';
import readline from 'readline';

class SimpleMCPClient {
  constructor() {
    this.requestId = 1;
    this.serverProcess = null;
  }

  async startLocalServer() {
    console.log('🚀 Starting local MCP server...\n');
    
    // Start the server locally with your environment variables
    this.serverProcess = spawn('node', ['index.js'], {
      env: {
        ...process.env,
        MONGODB_URI: 'mongodb+srv://Y70754028s:whatsapp.i9inrzy.mongodb.net/?retryWrites=true&w=majority&appName=Whatsapp',
        DB_NAME: 'test', // You can change this to match your DB
        JWT_SECRET: 'G8Id@f74L29_3Vh9x'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.serverProcess.stderr.on('data', (data) => {
      console.log('Server:', data.toString());
    });

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: '2.0',
        id: this.requestId++,
        method: method,
        params: params
      };

      console.log('📤 Sending:', JSON.stringify(request, null, 2));
      
      let responseData = '';
      
      const onData = (data) => {
        responseData += data.toString();
        try {
          const response = JSON.parse(responseData);
          this.serverProcess.stdout.off('data', onData);
          console.log('📥 Response:', JSON.stringify(response, null, 2));
          resolve(response);
        } catch (e) {
          // Partial response, wait for more data
        }
      };

      this.serverProcess.stdout.on('data', onData);
      
      this.serverProcess.stdin.write(JSON.stringify(request) + '\n');
      
      // Timeout after 10 seconds
      setTimeout(() => {
        this.serverProcess.stdout.off('data', onData);
        reject(new Error('Request timeout'));
      }, 10000);
    });
  }

  async runInteractiveClient() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('🎯 MongoDB MCP Interactive Client');
    console.log('Available commands:');
    console.log('  1. list - List collections');
    console.log('  2. find [collection] - Find documents');
    console.log('  3. insert [collection] - Insert test document');
    console.log('  4. tools - List available tools');
    console.log('  5. quit - Exit');
    console.log('');

    const askQuestion = (question) => {
      return new Promise((resolve) => {
        rl.question(question, resolve);
      });
    };

    while (true) {
      try {
        const input = await askQuestion('MCP> ');
        const [command, ...args] = input.trim().split(' ');

        switch (command.toLowerCase()) {
          case 'tools':
            await this.sendRequest('tools/list');
            break;

          case 'list':
            await this.sendRequest('tools/call', {
              name: 'list_collections',
              arguments: {}
            });
            break;

          case 'find':
            const collection = args[0] || 'messages';
            await this.sendRequest('tools/call', {
              name: 'find_documents',
              arguments: {
                collection: collection,
                limit: 5
              }
            });
            break;

          case 'insert':
            const insertCollection = args[0] || 'test_collection';
            await this.sendRequest('tools/call', {
              name: 'insert_document',
              arguments: {
                collection: insertCollection,
                document: {
                  message: 'Hello from MCP client!',
                  timestamp: new Date().toISOString(),
                  test: true
                }
              }
            });
            break;

          case 'quit':
          case 'exit':
            console.log('👋 Goodbye!');
            rl.close();
            return;

          default:
            console.log('❓ Unknown command. Type "tools", "list", "find", "insert", or "quit"');
        }

      } catch (error) {
        console.error('❌ Error:', error.message);
      }

      console.log(''); // Empty line for readability
    }
  }

  async quickTest() {
    try {
      console.log('🧪 Quick Test Mode\n');

      // Test 1: List tools
      console.log('1️⃣ Testing: List Tools');
      await this.sendRequest('tools/list');
      
      console.log('\n2️⃣ Testing: List Collections');
      await this.sendRequest('tools/call', {
        name: 'list_collections',
        arguments: {}
      });

      console.log('\n3️⃣ Testing: Find Documents (trying common collection names)');
      const testCollections = ['messages', 'users', 'chats', 'contacts'];
      
      for (const collection of testCollections) {
        try {
          console.log(`\n   Trying collection: ${collection}`);
          await this.sendRequest('tools/call', {
            name: 'find_documents',
            arguments: {
              collection: collection,
              limit: 2
            }
          });
          break; // Stop after first successful collection
        } catch (error) {
          console.log(`   Collection ${collection} not found or empty`);
        }
      }

      console.log('\n✅ Quick test completed!');
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
    }
  }

  async cleanup() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      console.log('🛑 Server stopped');
    }
  }

  async run() {
    try {
      await this.startLocalServer();
      
      const args = process.argv.slice(2);
      if (args.includes('--interactive') || args.includes('-i')) {
        await this.runInteractiveClient();
      } else {
        await this.quickTest();
      }
      
    } catch (error) {
      console.error('❌ Client failed:', error.message);
    } finally {
      await this.cleanup();
    }
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n👋 Stopping client...');
  process.exit(0);
});

// Run the client
const client = new SimpleMCPClient();

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('MongoDB MCP Client Usage:');
  console.log('  node simple-mcp-client.js           # Quick test mode');
  console.log('  node simple-mcp-client.js -i        # Interactive mode');
  console.log('  node simple-mcp-client.js --help    # Show this help');
} else {
  client.run().catch(console.error);
}
