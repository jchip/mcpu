import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { WorkFilter } from '../../src/storage/index.js';
import { Project, Issue, Status, IssueType, DependencyType } from '../../src/types/index.js';

describe('Ready Work & Blocking', () => {
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

  it('GetReadyWork', async () => {
      // 1: open, no deps -> READY
      // 2: open, depends on 1 (open) -> BLOCKED
      // 3: open, no deps -> READY
      // 4: closed, no deps -> NOT READY (closed)
      // 5: open, depends on 4 (closed) -> READY
      
      const issues = [
          { id: 'ISS-1', title: 'Ready 1', status: Status.Open, priority: 1 },
          { id: 'ISS-2', title: 'Blocked', status: Status.Open, priority: 1 },
          { id: 'ISS-3', title: 'Ready 2', status: Status.Open, priority: 2 },
          { id: 'ISS-4', title: 'Closed', status: Status.Closed, priority: 1 },
          { id: 'ISS-5', title: 'Ready 3', status: Status.Open, priority: 0 },
      ];

      for (const i of issues) {
          const initialStatus = i.status === Status.Closed ? Status.Open : i.status;
          await store.createIssue(projectID, { ...i, status: initialStatus, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
          if (i.status === Status.Closed) {
              await store.closeIssue(projectID, i.id, 'Done', actor);
          }
      }

      await store.addDependency(projectID, { issue_id: 'ISS-2', depends_on_id: 'ISS-1', type: DependencyType.Blocks }, actor);
      await store.addDependency(projectID, { issue_id: 'ISS-5', depends_on_id: 'ISS-4', type: DependencyType.Blocks }, actor);

      const ready = await store.getReadyWork(projectID, { status: Status.Open });
      
      // Expect 1, 3, 5
      expect(ready.length).toBe(3);
      const ids = ready.map(r => r.id).sort();
      expect(ids).toEqual(['ISS-1', 'ISS-3', 'ISS-5']);
  });

  it('GetReadyWorkPriorityOrder', async () => {
      const issues = [
          { id: 'P2', title: 'Medium', status: Status.Open, priority: 2 },
          { id: 'P0', title: 'Highest', status: Status.Open, priority: 0 },
          { id: 'P1', title: 'High', status: Status.Open, priority: 1 },
      ];

      for (const i of issues) {
          await store.createIssue(projectID, { ...i, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      }

      const ready = await store.getReadyWork(projectID, { status: Status.Open });
      expect(ready.length).toBe(3);
      expect(ready[0].id).toBe('P0');
      expect(ready[1].id).toBe('P1');
      expect(ready[2].id).toBe('P2');
  });

  it('GetReadyWorkFilters', async () => {
      const issues = [
          { id: 'P0', title: 'P0', status: Status.Open, priority: 0 },
          { id: 'P1', title: 'P1', status: Status.Open, priority: 1 },
          { id: 'Alice', title: 'Alice', status: Status.Open, priority: 1, assignee: 'alice' },
      ];
      for (const i of issues) {
          await store.createIssue(projectID, { ...i, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      }

      // Priority Filter
      let ready = await store.getReadyWork(projectID, { status: Status.Open, priority: 0 });
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('P0');

      // Assignee Filter
      ready = await store.getReadyWork(projectID, { status: Status.Open, assignee: 'alice' });
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('Alice');
  });

  it('GetReadyWorkLimit', async () => {
      for (let i = 0; i < 5; i++) {
          await store.createIssue(projectID, { id: `ISS-${i}`, title: 'Task', status: Status.Open, priority: 2, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      }

      const ready = await store.getReadyWork(projectID, { status: Status.Open, limit: 3 });
      expect(ready.length).toBe(3);
  });

  it('GetReadyWorkIgnoresRelatedDeps', async () => {
      const i1 = { id: 'ISS-1', title: '1', status: Status.Open, priority: 1 };
      const i2 = { id: 'ISS-2', title: '2', status: Status.Open, priority: 1 };
      await store.createIssue(projectID, { ...i1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      await store.createIssue(projectID, { ...i2, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);

      // Related dep
      await store.addDependency(projectID, { issue_id: 'ISS-2', depends_on_id: 'ISS-1', type: DependencyType.Related }, actor);

      const ready = await store.getReadyWork(projectID, { status: Status.Open });
      expect(ready.length).toBe(2);
  });

  it('GetBlockedIssues', async () => {
      // 1: open
      // 2: open, blocked by 1
      // 3: open, blocked by 1 and 2
      await store.createIssue(projectID, { id: 'ISS-1', title: '1', status: Status.Open, priority: 1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      await store.createIssue(projectID, { id: 'ISS-2', title: '2', status: Status.Open, priority: 1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      await store.createIssue(projectID, { id: 'ISS-3', title: '3', status: Status.Open, priority: 1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);

      await store.addDependency(projectID, { issue_id: 'ISS-2', depends_on_id: 'ISS-1', type: DependencyType.Blocks }, actor);
      await store.addDependency(projectID, { issue_id: 'ISS-3', depends_on_id: 'ISS-1', type: DependencyType.Blocks }, actor);
      await store.addDependency(projectID, { issue_id: 'ISS-3', depends_on_id: 'ISS-2', type: DependencyType.Blocks }, actor);

      const blocked = await store.getBlockedIssues(projectID);
      expect(blocked.length).toBe(2); // ISS-2 and ISS-3

      const iss3 = blocked.find(b => b.id === 'ISS-3');
      expect(iss3).toBeDefined();
      expect(iss3?.blocked_by_count).toBe(2);
      expect(iss3?.blocked_by.sort()).toEqual(['ISS-1', 'ISS-2']);
  });

  it('ParentChildIsContainmentOnly', async () => {
      // blocker: open
      // epic1: blocked by blocker
      // task1: child of epic1 (parent-child)
      // Expected: task1 is READY
      
      await store.createIssue(projectID, { id: 'BLOCKER', title: 'Blocker', status: Status.Open, priority: 1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      await store.createIssue(projectID, { id: 'EPIC-1', title: 'Epic', status: Status.Open, priority: 1, project_id: projectID, issue_type: IssueType.Epic, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      await store.createIssue(projectID, { id: 'TASK-1', title: 'Task', status: Status.Open, priority: 1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);

      await store.addDependency(projectID, { issue_id: 'EPIC-1', depends_on_id: 'BLOCKER', type: DependencyType.Blocks }, actor);
      await store.addDependency(projectID, { issue_id: 'TASK-1', depends_on_id: 'EPIC-1', type: DependencyType.ParentChild }, actor);

      const ready = await store.getReadyWork(projectID, { status: Status.Open });
      const ids = ready.map(r => r.id);
      
      expect(ids).not.toContain('EPIC-1');
      expect(ids).toContain('TASK-1');
      expect(ids).toContain('BLOCKER');
  });

  it('GetReadyWorkIncludesInProgress', async () => {
      // 1: open -> READY
      // 2: in_progress -> READY
      // 3: in_progress, blocked by 4 (open) -> BLOCKED
      // 4: open -> READY
      await store.createIssue(projectID, { id: 'ISS-1', title: '1', status: Status.Open, priority: 1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      await store.createIssue(projectID, { id: 'ISS-2', title: '2', status: Status.InProgress, priority: 1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      await store.createIssue(projectID, { id: 'ISS-3', title: '3', status: Status.InProgress, priority: 1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);
      await store.createIssue(projectID, { id: 'ISS-4', title: '4', status: Status.Open, priority: 1, project_id: projectID, issue_type: IssueType.Task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, actor);

      await store.addDependency(projectID, { issue_id: 'ISS-3', depends_on_id: 'ISS-4', type: DependencyType.Blocks }, actor);

      const ready = await store.getReadyWork(projectID, { status: Status.Open }); // This filter status is a bit misleading in name, implementation might use it as base but view logic might include others?
      // Wait, Go test `TestGetReadyWorkIncludesInProgress` passed empty filter.
      // `getReadyWork` implementation uses `ready_issues` view.
      // The view `ready_issues` filters for `status = 'open'`.
      // Wait, check `schema.sql`:
      // CREATE VIEW IF NOT EXISTS ready_issues AS SELECT i.* FROM issues i WHERE i.status = 'open' ...
      
      // If the view only selects 'open', then in_progress won't be returned unless we change the view or query.
      // Go implementation:
      // `GetReadyWork` takes `WorkFilter`. If status is not set, it defaults to Open?
      // Let's check Go `GetReadyWork`:
      // `if filter.Status == "" { filter.Status = types.StatusOpen }` (Usually)
      // But `TestGetReadyWorkIncludesInProgress` in Go says:
      // `ready, err := store.GetReadyWork(ctx, projectID, types.WorkFilter{})`
      // And expects 3 issues including in_progress.
      
      // This implies `GetReadyWork` in Go handles multiple statuses or defaults to Open|InProgress?
      // Or the view includes them?
      // My `schema.sql` view: `WHERE i.status = 'open'`.
      // This contradicts the requirement if we want InProgress.
      
      // Let's check `src/storage/sqlite.ts`:
      // `let sql = SELECT ... FROM ready_issues WHERE ...`
      // If `ready_issues` only has Open, then we can't get InProgress.
      
      // I probably need to update `ready_issues` view or the query.
      // If I change the view, I need to run migration or update schema.
      // `WHERE i.status IN ('open', 'in_progress')`?
      
      // Let's see `schema.sql` again.
      // `WHERE i.status = 'open'`
      
      // If I cannot change schema easily (it's applied on connect), I might need to handle it in code if I want to support InProgress in ready work.
      // Or update schema.sql and delete the .temp/tacks.db to regenerate it.
      
      // I will update `schema.sql` to include 'in_progress' in `ready_issues` view.
      // AND update `src/storage/sqlite.ts` to handle filter.status better (if filter.status is set, add condition, otherwise maybe all?).
      
      // The Go test expects `types.WorkFilter{}` (empty) to return both.
      // But in `src/storage/sqlite.ts`:
      // `if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }`
      // If filter is empty, it just queries the view.
      
      // So if I update the view to include 'in_progress', then empty filter will return both.
      // But if I pass `{ status: Status.Open }`, it will filter the view results to only open.
      
      // Plan:
      // 1. Update `schema.sql` ready_issues view.
      // 2. Delete `.temp/tacks.db`.
      // 3. Update test.
  });
});
