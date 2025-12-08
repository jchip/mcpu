import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { Issue, Status, IssueType } from '../../src/types/index.js';
import { Transaction } from '../../src/storage/index.js';

describe('Transactions', () => {
  let db: DB;
  let store: SqliteStorage;
  const projectID = 'test-project';
  const actor = 'test-user';

  beforeEach(async () => {
    db = new DB(':memory:');
    await db.connect();
    store = new SqliteStorage(db);
    await (store as any).initDefaults();

    await store.createProject({
      id: projectID,
      name: 'Test Project',
      created_at: new Date().toISOString(),
      next_id: 1,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('RunInTransaction - Success', async () => {
    // Successful transaction
    await store.runInTransaction(async (tx: Transaction) => {
      const issue: Issue = {
        id: 'TX-001',
        project_id: projectID,
        title: 'Tx Issue',
        description: '',
        status: Status.Open,
        priority: 1,
        issue_type: IssueType.Task,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await tx.createIssue(projectID, issue, actor);
    });

    // Verify issue created
    const issues = await store.searchIssues(projectID, 'Tx Issue', {});
    expect(issues.length).toBe(1);
  });

  it('RunInTransaction - Rollback', async () => {
    // Failed transaction (should rollback)
    await expect(
      store.runInTransaction(async (tx: Transaction) => {
        const issue: Issue = {
          id: 'ROLLBACK-001',
          project_id: projectID,
          title: 'Rollback Issue',
          description: '',
          status: Status.Open,
          priority: 1,
          issue_type: IssueType.Task,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await tx.createIssue(projectID, issue, actor);
        throw new Error('force rollback');
      })
    ).rejects.toThrow('force rollback');

    // Verify issue NOT created (rolled back)
    const issues = await store.searchIssues(projectID, 'Rollback Issue', {});
    expect(issues.length).toBe(0);
  });
});
