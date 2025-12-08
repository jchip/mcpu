import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { Issue, Status, IssueType, DependencyType, Project } from '../../src/types/index.js';

describe('Global Entity Registry (GER)', () => {
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

  it('GERRegistration - Project and Issue', async () => {
    // Verify Project Entity exists
    const projectEntity = await db.get(
      `SELECT id FROM entities WHERE kind_id = 1 AND native_id = ?`,
      projectID
    );
    expect(projectEntity).toBeDefined();

    // Create Issue and Verify Entity
    const issue: Issue = {
      id: 'GER-001',
      project_id: projectID,
      title: 'GER Test',
      description: '',
      status: Status.Open,
      priority: 1,
      issue_type: IssueType.Task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await store.createIssue(projectID, issue, actor);

    const issueEntity = await db.get(
      `SELECT id FROM entities WHERE kind_id = 2 AND native_id = ?`,
      issue.id
    );
    expect(issueEntity).toBeDefined();
  });

  it('GERComments - Comments linked via GER', async () => {
    const issue: Issue = {
      id: 'COMMENT-001',
      project_id: projectID,
      title: 'Comment Test',
      description: '',
      status: Status.Open,
      priority: 1,
      issue_type: IssueType.Task,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await store.createIssue(projectID, issue, actor);

    // Add Comment (should go via GER)
    const comment = await store.addComment(projectID, issue.id, actor, 'Hello GER');

    // Verify direct DB state - comment should reference entity_id
    const commentRow = await db.get(
      `SELECT entity_id FROM comments WHERE id = ?`,
      comment.id
    );
    expect(commentRow).toBeDefined();
    expect(commentRow.entity_id).toBeDefined();

    // Verify retrieval
    const comments = await store.getComments(projectID, issue.id);
    expect(comments.length).toBe(1);
    expect(comments[0].text).toBe('Hello GER');
  });

  it('EntityLinksTableExists', async () => {
    // Verify entity_links table exists with correct columns
    const columns = await db.query(`
      SELECT name FROM pragma_table_info('entity_links')
      WHERE name IN ('source_entity_id', 'target_entity_id', 'link_type', 'created_at', 'created_by')
    `);
    expect(columns.length).toBe(5);
  });

  it('EntityLinksUniqueConstraint', async () => {
    // Create issues
    const issue1: Issue = {
      id: 'LINK-001',
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
      id: 'LINK-002',
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

    // Get entity IDs
    const srcRow = await db.get(
      `SELECT id FROM entities WHERE kind_id = 2 AND native_id = ?`,
      issue1.id
    );
    const tgtRow = await db.get(
      `SELECT id FROM entities WHERE kind_id = 2 AND native_id = ?`,
      issue2.id
    );
    const srcID = srcRow.id;
    const tgtID = tgtRow.id;

    // Insert a link
    await db.run(
      `INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, created_by)
       VALUES (?, ?, 'blocks', 'user')`,
      srcID,
      tgtID
    );

    // Try to insert duplicate (same source, target, type) - should be ignored
    await db.run(
      `INSERT OR IGNORE INTO entity_links (source_entity_id, target_entity_id, link_type, created_by)
       VALUES (?, ?, 'blocks', 'user')`,
      srcID,
      tgtID
    );

    // Verify only one link exists
    const count1 = await db.get(
      `SELECT COUNT(*) as count FROM entity_links WHERE source_entity_id = ? AND target_entity_id = ?`,
      srcID,
      tgtID
    );
    expect(count1.count).toBe(1);

    // But same source/target with different type should work
    await db.run(
      `INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, created_by)
       VALUES (?, ?, 'related', 'user')`,
      srcID,
      tgtID
    );

    const count2 = await db.get(
      `SELECT COUNT(*) as count FROM entity_links WHERE source_entity_id = ? AND target_entity_id = ?`,
      srcID,
      tgtID
    );
    expect(count2.count).toBe(2);
  });
});
