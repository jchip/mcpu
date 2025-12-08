import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage, ErrNotFound, ErrConflict } from '../../src/storage/sqlite.js';
import { Project, Issue, Status, IssueType, DependencyType, Dependency } from '../../src/types/index.js';

describe('Dependencies', () => {
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

    // Create 3 issues
    const issues = ['ISS-1', 'ISS-2', 'ISS-3'];
    for (const id of issues) {
        await store.createIssue(projectID, {
            id,
            project_id: projectID,
            title: `Issue ${id}`,
            status: Status.Open,
            priority: 1,
            issue_type: IssueType.Task,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }, actor);
    }
  });

  afterEach(async () => {
    await db.close();
  });

  it('AddDependency', async () => {
      const dep: Dependency = {
          issue_id: 'ISS-1',
          depends_on_id: 'ISS-2',
          type: DependencyType.Blocks,
      };

      await store.addDependency(projectID, dep, actor);

      const deps = await store.getDependencies(projectID, 'ISS-1');
      expect(deps.length).toBe(1);
      expect(deps[0].id).toBe('ISS-2');
  });

  it('RemoveDependency', async () => {
      const dep: Dependency = {
          issue_id: 'ISS-1',
          depends_on_id: 'ISS-2',
          type: DependencyType.Blocks,
      };
      await store.addDependency(projectID, dep, actor);

      await store.removeDependency(projectID, 'ISS-1', 'ISS-2', actor);

      const deps = await store.getDependencies(projectID, 'ISS-1');
      expect(deps.length).toBe(0);
  });

  it('GetDependents', async () => {
      // ISS-2 depends on ISS-1
      // ISS-3 depends on ISS-1
      await store.addDependency(projectID, { issue_id: 'ISS-2', depends_on_id: 'ISS-1', type: DependencyType.Blocks }, actor);
      await store.addDependency(projectID, { issue_id: 'ISS-3', depends_on_id: 'ISS-1', type: DependencyType.Blocks }, actor);

      const dependents = await store.getDependents(projectID, 'ISS-1');
      expect(dependents.length).toBe(2);
      const ids = dependents.map(d => d.id).sort();
      expect(ids).toEqual(['ISS-2', 'ISS-3']);
  });

  it('DependencyRecords', async () => {
      await store.addDependency(projectID, { issue_id: 'ISS-1', depends_on_id: 'ISS-2', type: DependencyType.Blocks }, actor);
      await store.addDependency(projectID, { issue_id: 'ISS-1', depends_on_id: 'ISS-3', type: DependencyType.ParentChild }, actor);

      const records = await store.getDependencyRecords(projectID, 'ISS-1');
      expect(records.length).toBe(2);
      
      const map = new Map();
      records.forEach(r => map.set(r.depends_on_id, r.type));
      
      expect(map.get('ISS-2')).toBe(DependencyType.Blocks);
      expect(map.get('ISS-3')).toBe(DependencyType.ParentChild);
  });

  it('DependencyCounts', async () => {
      // ISS-2 -> ISS-1
      // ISS-3 -> ISS-1
      // ISS-1 -> ISS-3 (Wait, let's keep it simple: ISS-1 -> None)
      // Actually, let's mirror the test case:
      // Hub (ISS-1)
      // ISS-2 -> ISS-1
      // ISS-3 -> ISS-1
      await store.addDependency(projectID, { issue_id: 'ISS-2', depends_on_id: 'ISS-1', type: DependencyType.Blocks }, actor);
      await store.addDependency(projectID, { issue_id: 'ISS-3', depends_on_id: 'ISS-1', type: DependencyType.Blocks }, actor);

      const counts = await store.getDependencyCounts(projectID, ['ISS-1', 'ISS-2', 'ISS-3']);
      
      // ISS-1: 0 dependencies, 2 dependents
      expect(counts.get('ISS-1')?.dependency_count).toBe(0);
      expect(counts.get('ISS-1')?.dependent_count).toBe(2);

      // ISS-2: 1 dependency, 0 dependents
      expect(counts.get('ISS-2')?.dependency_count).toBe(1);
      expect(counts.get('ISS-2')?.dependent_count).toBe(0);
  });

  it('AddDependencyNotFound', async () => {
      await expect(store.addDependency(projectID, {
          issue_id: 'ISS-1',
          depends_on_id: 'NONEXISTENT',
          type: DependencyType.Blocks
      }, actor)).rejects.toThrow(ErrNotFound);

      await expect(store.addDependency(projectID, {
          issue_id: 'NONEXISTENT',
          depends_on_id: 'ISS-1',
          type: DependencyType.Blocks
      }, actor)).rejects.toThrow(ErrNotFound);
  });

  it('AddDuplicateDependency', async () => {
      await store.addDependency(projectID, { issue_id: 'ISS-1', depends_on_id: 'ISS-2', type: DependencyType.Blocks }, actor);
      await expect(store.addDependency(projectID, {
          issue_id: 'ISS-1',
          depends_on_id: 'ISS-2',
          type: DependencyType.Blocks
      }, actor)).rejects.toThrow(ErrConflict);
  });
});
