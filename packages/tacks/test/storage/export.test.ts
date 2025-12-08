import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { Issue, Status, IssueType, DependencyType, Project } from '../../src/types/index.js';

describe('Export/Import Support', () => {
  let db: DB;
  let store: SqliteStorage;
  const projectID = 'test-project';
  const actor = 'test-user';

  beforeEach(async () => {
    db = new DB(':memory:');
    await db.connect();
    store = new SqliteStorage(db);
    await (store as any).initDefaults();

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

  it('GetAllDependencyRecords', async () => {
    // Create issues
    const issue1: Issue = {
      id: 'EXPORT-001',
      project_id: projectID,
      title: 'Issue 1',
      description: '',
      status: Status.Open,
      priority: 1,
      issue_type: IssueType.Task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const issue2: Issue = {
      id: 'EXPORT-002',
      project_id: projectID,
      title: 'Issue 2',
      description: '',
      status: Status.Open,
      priority: 1,
      issue_type: IssueType.Task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const issue3: Issue = {
      id: 'EXPORT-003',
      project_id: projectID,
      title: 'Issue 3',
      description: '',
      status: Status.Open,
      priority: 1,
      issue_type: IssueType.Task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await store.createIssue(projectID, issue1, actor);
    await store.createIssue(projectID, issue2, actor);
    await store.createIssue(projectID, issue3, actor);

    // Add dependencies
    await store.addDependency(
      projectID,
      { issue_id: issue1.id, depends_on_id: issue2.id, type: DependencyType.Blocks },
      actor
    );
    await store.addDependency(
      projectID,
      { issue_id: issue1.id, depends_on_id: issue3.id, type: DependencyType.Related },
      actor
    );
    await store.addDependency(
      projectID,
      { issue_id: issue2.id, depends_on_id: issue3.id, type: DependencyType.Blocks },
      actor
    );

    // Get all dependency records
    const depsMap = await store.getAllDependencyRecords(projectID);

    // issue1 has 2 dependencies
    expect(depsMap.get(issue1.id)?.length).toBe(2);

    // issue2 has 1 dependency
    expect(depsMap.get(issue2.id)?.length).toBe(1);

    // issue3 has 0 dependencies (it's only depended upon)
    expect(depsMap.get(issue3.id)?.length || 0).toBe(0);
  });

  it('GetAllDependencyRecords - Empty', async () => {
    const depsMap = await store.getAllDependencyRecords(projectID);
    expect(depsMap.size).toBe(0);
  });

  it('GetAllComments', async () => {
    // Create issues
    const issue1: Issue = {
      id: 'COMMENT-001',
      project_id: projectID,
      title: 'Issue 1',
      description: '',
      status: Status.Open,
      priority: 1,
      issue_type: IssueType.Task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const issue2: Issue = {
      id: 'COMMENT-002',
      project_id: projectID,
      title: 'Issue 2',
      description: '',
      status: Status.Open,
      priority: 1,
      issue_type: IssueType.Task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await store.createIssue(projectID, issue1, actor);
    await store.createIssue(projectID, issue2, actor);

    // Add comments
    await store.addComment(projectID, issue1.id, 'alice', 'Comment 1');
    await store.addComment(projectID, issue1.id, 'bob', 'Comment 2');
    await store.addComment(projectID, issue2.id, 'charlie', 'Comment 3');

    // Get all comments
    const commentsMap = await store.getAllComments(projectID);

    expect(commentsMap.get(issue1.id)?.length).toBe(2);
    expect(commentsMap.get(issue2.id)?.length).toBe(1);
  });

  it('GetAllComments - Empty', async () => {
    const commentsMap = await store.getAllComments(projectID);
    expect(commentsMap.size).toBe(0);
  });

  it('CommentExists', async () => {
    // Create issue with comment
    const issue: Issue = {
      id: 'EXISTS-001',
      project_id: projectID,
      title: 'Test',
      description: '',
      status: Status.Open,
      priority: 1,
      issue_type: IssueType.Task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await store.createIssue(projectID, issue, actor);
    await store.addComment(projectID, issue.id, 'alice', 'Test comment');

    // Check existing comment
    const exists = await store.commentExists(projectID, issue.id, 'alice', 'Test comment');
    expect(exists).toBe(true);

    // Check non-existing comment (different text)
    const exists2 = await store.commentExists(projectID, issue.id, 'alice', 'Different comment');
    expect(exists2).toBe(false);

    // Check non-existing comment (different author)
    const exists3 = await store.commentExists(projectID, issue.id, 'bob', 'Test comment');
    expect(exists3).toBe(false);
  });
});
