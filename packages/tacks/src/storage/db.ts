import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Resolve path relative to this module, not cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DB {
  private db: Database | undefined;
  private dbPath: string;
  private transactionDepth = 0;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    if (this.db) return; // Already connected

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });

    await this.db.exec('PRAGMA journal_mode = WAL');
    await this.db.exec('PRAGMA foreign_keys = ON');
    await this.initSchema();
  }

  private async initSchema() {
    if (!this.db) throw new Error('Database not connected.');
    const schemaPath = join(__dirname, 'schema.sql');
    try {
      const schema = readFileSync(schemaPath, 'utf-8');
      await this.db.exec(schema);
    } catch (error) {
      console.error('Failed to initialize database schema:', error);
      throw error;
    }
  }

  async query<T>(sql: string, ...params: any[]): Promise<T[]> {
    if (!this.db) throw new Error('Database not connected.');
    return this.db.all<T>(sql, ...params);
  }

  async get<T>(sql: string, ...params: any[]): Promise<T | undefined> {
    if (!this.db) throw new Error('Database not connected.');
    return this.db.get<T>(sql, ...params);
  }

  async run(sql: string, ...params: any[]): Promise<sqlite3.RunResult> {
    if (!this.db) throw new Error('Database not connected.');
    return this.db.run(sql, ...params);
  }
  
  async transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
      if (!this.db) throw new Error('Database not connected.');
      
      const isRoot = this.transactionDepth === 0;
      const savepoint = `sp_${this.transactionDepth}`;
      this.transactionDepth++;

      try {
          if (isRoot) {
            await this.db.run('BEGIN TRANSACTION');
          } else {
            await this.db.run(`SAVEPOINT ${savepoint}`);
          }
          
          const result = await fn(this); // Pass itself as a "transactional" DB executor
          
          if (isRoot) {
            await this.db.run('COMMIT');
          } else {
            await this.db.run(`RELEASE SAVEPOINT ${savepoint}`);
          }
          return result;
      } catch (error) {
          if (isRoot) {
            await this.db.run('ROLLBACK');
          } else {
            await this.db.run(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await this.db.run(`RELEASE SAVEPOINT ${savepoint}`);
          }
          throw error;
      } finally {
          this.transactionDepth--;
      }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = undefined;
    }
  }
}