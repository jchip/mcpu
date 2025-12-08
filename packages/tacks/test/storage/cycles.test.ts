import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage, ErrCycle } from '../../src/storage/sqlite.js'; // Ensure ErrCycle is exported if we use it, but here we just check result
import { Project, Issue, Status, IssueType, DependencyType, Dependency } from '../../src/types/index.js';

describe('Cycle Detection', () => {
  let db: DB;
  let store: SqliteStorage;
  const projectID = 'test-project';
  const actor = 'test-user';

  beforeEach(async () => {
    db = new DB(':memory:');
    await db.connect();
    store = new SqliteStorage(db);
    
    const project: Project = {
      id: projectID,
      name: 'Test Project',
      created_at: new Date().toISOString(),
      next_id: 1,
    };
    await store.createProject(project);
  });

  afterEach(async () => {
    await db.close();
  });

  // Since we rely on SQLite triggers for cycle detection (if implemented there) or application logic
  // Go implementation used `AddDependency` which likely does the check.
  // Wait, `SqliteStorage` in `sqlite.ts` has `addDependency`.
  // Does it check for cycles?
  // Looking at `addDependency` in `sqlite.ts`:
  // It inserts into `dependencies` table.
  // If the DB schema has triggers to prevent cycles, it will fail.
  // The Go tests used `sqlStore.db.ExecContext` to insert directly to bypass `AddDependency` checks for detection tests?
  // Ah, the Go test `TestDetectCyclesSimple` says:
  // "Manually create a cycle by inserting directly into dependencies table (bypassing AddDependency's cycle prevention)"
  // This implies `AddDependency` PREVENTS cycles.
  // So our test should verify that `addDependency` throws an error when a cycle is attempted.
  
  it('PreventSimpleCycle', async () => {
      // 1 -> 2
      // 2 -> 1 (Cycle)
      const i1 = 'ISS-1';
      const i2 = 'ISS-2';
      await store.createIssue(projectID, { id: i1, title: '1', status: Status.Open, priority: 1, issue_type: IssueType.Task }, actor);
      await store.createIssue(projectID, { id: i2, title: '2', status: Status.Open, priority: 1, issue_type: IssueType.Task }, actor);

      await store.addDependency(projectID, { issue_id: i1, depends_on_id: i2, type: DependencyType.Blocks }, actor);

      // Try adding 2->1
      await expect(store.addDependency(projectID, { issue_id: i2, depends_on_id: i1, type: DependencyType.Blocks }, actor))
        .rejects.toThrow(); // Should throw something indicating cycle or trigger error
  });

  it('PreventSelfLoop', async () => {
      const i1 = 'ISS-1';
      await store.createIssue(projectID, { id: i1, title: '1', status: Status.Open, priority: 1, issue_type: IssueType.Task }, actor);

      await expect(store.addDependency(projectID, { issue_id: i1, depends_on_id: i1, type: DependencyType.Blocks }, actor))
        .rejects.toThrow();
  });

  it('PreventTransitiveCycle', async () => {
      // 1 -> 2 -> 3 -> 1
      const i1 = 'ISS-1';
      const i2 = 'ISS-2';
      const i3 = 'ISS-3';
      await store.createIssue(projectID, { id: i1, title: '1', status: Status.Open, priority: 1, issue_type: IssueType.Task }, actor);
      await store.createIssue(projectID, { id: i2, title: '2', status: Status.Open, priority: 1, issue_type: IssueType.Task }, actor);
      await store.createIssue(projectID, { id: i3, title: '3', status: Status.Open, priority: 1, issue_type: IssueType.Task }, actor);

      await store.addDependency(projectID, { issue_id: i1, depends_on_id: i2, type: DependencyType.Blocks }, actor);
      await store.addDependency(projectID, { issue_id: i2, depends_on_id: i3, type: DependencyType.Blocks }, actor);

      await expect(store.addDependency(projectID, { issue_id: i3, depends_on_id: i1, type: DependencyType.Blocks }, actor))
        .rejects.toThrow();
  });

});
