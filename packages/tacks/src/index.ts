import { TacksMcpServer } from './mcp/index.js';
import { DB } from './storage/db.js';
import { SqliteStorage } from './storage/sqlite.js';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';

const DATA_DIR = process.env.XDG_DATA_HOME
  ? join(process.env.XDG_DATA_HOME, 'tacks')
  : join(homedir(), '.local', 'share', 'tacks');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = join(DATA_DIR, 'tacks.db');

async function main() {
  const db = new DB(DB_PATH);
  await db.connect();

  const store = new SqliteStorage(db);
  const server = new TacksMcpServer(store);

  // Register signal handlers BEFORE starting server to avoid race condition
  process.on('SIGINT', async () => {
    console.error('Received SIGINT, closing...');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('Received SIGTERM, closing...');
    await server.close();
    process.exit(0);
  });

  try {
    console.error(`Tacks MCP Server starting with database: ${DB_PATH}`);
    await server.run();
    console.error('Tacks MCP Server started/connected.');
  } catch (error) {
    console.error('MCP Server encountered an error:', error);
    await server.close();
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unhandled error in main:', error);
  process.exit(1);
});