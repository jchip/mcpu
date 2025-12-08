import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { ErrNotFound, ErrAssigned, IssueFilter } from '../../src/storage/index.js';
import { Project, Issue, Status, IssueType, Template } from '../../src/types/index.js';

describe('SqliteStorage', () => {
  let db: DB;
  let store: SqliteStorage;
  const projectID = 'test-project';
  const actor = 'test-user';

  beforeEach(async () => {
    db = new DB(':memory:');
    await db.connect();
    store = new SqliteStorage(db);
    // await (store as any).initDefaults(); // Not strictly needed for basic issue ops but good for roles

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

  it('CreateIssue', async () => {
    const issue: Issue = {
        id: 'ISS-1',
        project_id: projectID,
        title: 'Test issue',
        description: 'Test description',
        status: Status.Open,
        priority: 1,
        issue_type: IssueType.Task,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await store.createIssue(projectID, issue, actor);

    expect(issue.id).toBe('ISS-1');
    expect(issue.created_at).toBeDefined();
    expect(issue.updated_at).toBeDefined();
  });

  it('GetIssue', async () => {
    const original: Issue = {
        id: 'ISS-1',
        project_id: projectID,
        title: 'Test issue',
        description: 'Description',
        status: Status.Open,
        priority: 1,
        issue_type: IssueType.Feature,
        assignee: 'alice',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await store.createIssue(projectID, original, actor);

    const retrieved = await store.getIssue(projectID, original.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(original.id);
    expect(retrieved?.title).toBe(original.title);
  });

  it('UpdateIssue', async () => {
    const issue: Issue = {
        id: 'ISS-1',
        project_id: projectID,
        title: 'Original',
        status: Status.Open,
        priority: 2,
        issue_type: IssueType.Task,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await store.createIssue(projectID, issue, actor);

    const updates = {
        title: 'Updated',
        status: Status.InProgress,
        priority: 1,
        assignee: 'bob',
    };

    await store.updateIssue(projectID, issue.id, updates, actor);

    const updated = await store.getIssue(projectID, issue.id);
    expect(updated?.title).toBe('Updated');
    expect(updated?.status).toBe(Status.InProgress);
    expect(updated?.priority).toBe(1);
    expect(updated?.assignee).toBe('bob');
  });

  it('DeleteIssue', async () => {
    const issue: Issue = {
        id: 'ISS-TO-DELETE',
        project_id: projectID,
        title: 'To Delete',
        status: Status.Open,
        priority: 1,
        issue_type: IssueType.Task,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await store.createIssue(projectID, issue, actor);
    await store.deleteIssue(projectID, issue.id);

    const deleted = await store.getIssue(projectID, issue.id);
    expect(deleted).toBeUndefined();

    await expect(store.deleteIssue(projectID, 'nonexistent'))
        .rejects.toThrow(ErrNotFound);
  });

  it('GetProject', async () => {
    const project = await store.getProject(projectID);
    expect(project).toBeDefined();
    expect(project?.id).toBe(projectID);

    const notFound = await store.getProject('nonexistent');
    expect(notFound).toBeUndefined();
  });

  it('ListProjects', async () => {
    const project2: Project = { id: 'project-2', name: 'Project 2', created_at: new Date().toISOString() };
    await store.createProject(project2);

    const projects = await store.listProjects();
    expect(projects.length).toBe(2);
  });

  it('UpdateProject', async () => {
      await store.updateProject(projectID, {
          name: 'Updated Name',
          description: 'New description'
      });

      const project = await store.getProject(projectID);
      expect(project?.name).toBe('Updated Name');
      expect(project?.description).toBe('New description');

      await expect(store.updateProject(projectID, { invalid: 'x' }))
        .rejects.toThrow(); // Validation error
      
      await expect(store.updateProject('nonexistent', { name: 'x' }))
        .rejects.toThrow(ErrNotFound);
  });

  it('DeleteProject', async () => {
      await store.createProject({ id: 'to-delete', name: 'Delete Me', created_at: new Date().toISOString() });
      await store.deleteProject('to-delete');

      const deleted = await store.getProject('to-delete');
      expect(deleted).toBeUndefined();

      await expect(store.deleteProject('nonexistent'))
        .rejects.toThrow(ErrNotFound);
  });

  it('Labels', async () => {
      const issue: Issue = {
          id: 'LBL-1',
          project_id: projectID,
          title: 'Label Test',
          status: Status.Open,
          priority: 1,
          issue_type: IssueType.Task,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
      };
      await store.createIssue(projectID, issue, actor);

      await store.addLabel(projectID, issue.id, 'bug', actor);
      await store.addLabel(projectID, issue.id, 'urgent', actor);

      let labels = await store.getLabels(projectID, issue.id);
      expect(labels.length).toBe(2);
      expect(labels).toContain('bug');
      expect(labels).toContain('urgent');

      await store.removeLabel(projectID, issue.id, 'bug', actor);
      labels = await store.getLabels(projectID, issue.id);
      expect(labels.length).toBe(1);
      expect(labels).toContain('urgent');
  });

  it('SearchIssues', async () => {
      const titles = ['Alpha task', 'Beta feature', 'Gamma bug'];
      for (const title of titles) {
          const issue: Issue = {
              id: `ISS-${title.split(' ')[0]}`,
              project_id: projectID,
              title,
              status: Status.Open,
              priority: 1,
              issue_type: IssueType.Task,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
          };
          await store.createIssue(projectID, issue, actor);
      }

      const results = await store.searchIssues(projectID, 'beta', {});
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Beta feature');
  });

  it('CloseIssue', async () => {
      const issue: Issue = {
          id: 'CLOSE-1',
          project_id: projectID,
          title: 'To Close',
          status: Status.Open,
          priority: 1,
          issue_type: IssueType.Task,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
      };
      await store.createIssue(projectID, issue, actor);

      await store.closeIssue(projectID, issue.id, 'completed', actor);

      const closed = await store.getIssue(projectID, issue.id);
      expect(closed?.status).toBe(Status.Closed);
      expect(closed?.closed_at).toBeDefined();
  });

  it('ReopenIssue', async () => {
      const issue: Issue = {
          id: 'REOPEN-1',
          project_id: projectID,
          title: 'To Reopen',
          status: Status.Open, // Initially open, will close first
          priority: 1,
          issue_type: IssueType.Task,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
      };
      await store.createIssue(projectID, issue, actor);
      await store.closeIssue(projectID, issue.id, 'completed', actor);

      await store.reopenIssue(projectID, issue.id, actor);

      const reopened = await store.getIssue(projectID, issue.id);
      expect(reopened?.status).toBe(Status.Open);
      expect(reopened?.closed_at).toBeUndefined();
  });

  it('Templates', async () => {
      const template: Template = {
          name: 'custom-task',
          project_id: projectID,
          description: 'A custom task template',
          issue_type: IssueType.Task,
          priority: 2,
          labels: ['custom', 'test'],
          design: 'Design section',
          acceptance_criteria: 'AC section',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
      };

      await store.createTemplate(projectID, template);
      const retrieved = await store.getTemplate(projectID, 'custom-task');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('custom-task');
      expect(retrieved?.labels).toEqual(['custom', 'test']);

      await store.updateTemplate(projectID, 'custom-task', { description: 'Updated' });
      const updated = await store.getTemplate(projectID, 'custom-task');
      expect(updated?.description).toBe('Updated');

      await store.deleteTemplate(projectID, 'custom-task');
      const deleted = await store.getTemplate(projectID, 'custom-task');
      expect(deleted).toBeUndefined();
  });

  it('Comments', async () => {
      const issue: Issue = {
          id: 'COMMENT-1',
          project_id: projectID,
          title: 'Comment Test',
          status: Status.Open,
          priority: 1,
          issue_type: IssueType.Task,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
      };
      await store.createIssue(projectID, issue, actor);

      const comment = await store.addComment(projectID, issue.id, 'tester', 'This is a comment');
      expect(comment.text).toBe('This is a comment');
      expect(comment.author).toBe('tester');

      const comments = await store.getComments(projectID, issue.id);
      expect(comments.length).toBe(1);
      expect(comments[0].text).toBe('This is a comment');
  });

  it('UpdateIssueAssignedCheck', async () => {
      const issue: Issue = {
          id: 'ASSIGN-1',
          project_id: projectID,
          title: 'Assigned Issue',
          status: Status.Open,
          priority: 1,
          issue_type: IssueType.Task,
          assignee: 'agent-1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
      };
      await store.createIssue(projectID, issue, 'creator');

      // agent-1 can update status
      await store.updateIssue(projectID, issue.id, { status: Status.InProgress }, 'agent-1');
      
      // Reset
      await store.updateIssue(projectID, issue.id, { status: Status.Open }, 'agent-1');

      // agent-2 cannot update status to in_progress if assigned to agent-1
      await expect(store.updateIssue(projectID, issue.id, { status: Status.InProgress }, 'agent-2'))
        .rejects.toThrow(ErrAssigned);

      // Unassigned can be claimed
      const unassigned: Issue = {
        id: 'UNASSIGNED-1',
        project_id: projectID,
        title: 'Unassigned',
        status: Status.Open,
        priority: 1,
        issue_type: IssueType.Task,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await store.createIssue(projectID, unassigned, 'creator');
      
      // Claim by anyone
      await store.updateIssue(projectID, unassigned.id, { status: Status.InProgress }, 'any-agent');
      
      // Verify auto-assign
      const claimed = await store.getIssue(projectID, unassigned.id);
      expect(claimed?.assignee).toBe('any-agent');
  });

  it('AutoAssignOnClaim', async () => {
    const issue: Issue = {
        id: 'CLAIM-1',
        project_id: projectID,
        title: 'Unassigned Issue',
        status: Status.Open,
        priority: 1,
        issue_type: IssueType.Task,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    await store.createIssue(projectID, issue, 'creator');

    await store.updateIssue(projectID, issue.id, { status: Status.InProgress }, 'claiming-agent');
    
    const updated = await store.getIssue(projectID, issue.id);
    expect(updated?.assignee).toBe('claiming-agent');
  });

});
