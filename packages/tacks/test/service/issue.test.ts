import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { IssueService, CreateIssueInput } from '../../src/service/issue.js';
import { Project, IssueType, Template } from '../../src/types/index.js';
import { ErrNotFound } from '../../src/storage/index.js';

describe('IssueService', () => {
  let db: DB;
  let store: SqliteStorage;
  let service: IssueService;

  beforeEach(async () => {
    // Use :memory: database for fast testing
    db = new DB(':memory:');
    await db.connect();
    store = new SqliteStorage(db);
    // Initialize defaults (roles, entity kinds) which normally happens in TacksMcpServer or via CLI init,
    // but here we might need to manually trigger it if SqliteStorage doesn't do it automatically on construction.
    // Looking at SqliteStorage, it has initDefaults but it's private and called... wait, it's NOT called in constructor.
    // It's probably supposed to be called manually or relies on schema.sql.
    // Let's check schema.sql loading. DB.connect() loads schema.sql.
    // SqliteStorage.initDefaults() inserts seed data like roles. We should expose it or replicate it.
    // Accessing private method via cast or we can just rely on basic tables if tests don't need roles.
    // Let's call the private method for completeness if possible, or better, just manually insert what we need.
    await (store as any).initDefaults();

    service = new IssueService(store);
  });

  afterEach(async () => {
    await db.close();
  });

  it('AutoID', async () => {
    const project: Project = {
      id: 'test-proj',
      name: 'Test Project',
      prefix: 'TEST',
      created_at: new Date().toISOString(),
      next_id: 1,
    };
    await store.createProject(project);

    // Create first issue
    const input1: CreateIssueInput = { title: 'First issue' };
    const issue1 = await service.create('test-proj', input1, 'test-user');
    expect(issue1.id).toBe('TEST-1');

    // Create second issue
    const input2: CreateIssueInput = { title: 'Second issue' };
    const issue2 = await service.create('test-proj', input2, 'test-user');
    expect(issue2.id).toBe('TEST-2');

    // Create third issue
    const input3: CreateIssueInput = { title: 'Third issue', issue_type: IssueType.Bug };
    const issue3 = await service.create('test-proj', input3, 'test-user');
    expect(issue3.id).toBe('TEST-3');
    expect(issue3.issue_type).toBe(IssueType.Bug);
  });

  it('ExplicitID', async () => {
    const project: Project = {
      id: 'test-proj',
      name: 'Test Project',
      prefix: 'TEST',
      created_at: new Date().toISOString(),
      next_id: 1,
    };
    await store.createProject(project);

    // Create issue with explicit ID
    const input: CreateIssueInput = { id: 'CUSTOM-123', title: 'Custom ID issue' };
    const issue = await service.create('test-proj', input, 'test-user');
    expect(issue.id).toBe('CUSTOM-123');

    // Next auto-generated should still be TEST-1
    const input2: CreateIssueInput = { title: 'Auto ID issue' };
    const issue2 = await service.create('test-proj', input2, 'test-user');
    expect(issue2.id).toBe('TEST-1');
  });

  it('NoPrefix', async () => {
    const project: Project = {
      id: 'test-proj',
      name: 'Test Project',
      // No prefix
      created_at: new Date().toISOString(),
      next_id: 1,
    };
    await store.createProject(project);

    const input: CreateIssueInput = { title: 'Issue without prefix' };
    const issue = await service.create('test-proj', input, 'test-user');

    expect(issue.id).toBeDefined();
    expect(issue.id.startsWith('ISS-')).toBe(true);
    expect(issue.id.length).toBeGreaterThan(8);
  });

  it('ContiguousIDs', async () => {
    const project: Project = {
      id: 'test-proj',
      name: 'Test Project',
      prefix: 'PROJ',
      created_at: new Date().toISOString(),
      next_id: 1,
    };
    await store.createProject(project);

    for (let i = 1; i <= 10; i++) {
      const input: CreateIssueInput = { title: `Issue ${i}` };
      const issue = await service.create('test-proj', input, 'test-user');
      expect(issue.id).toBe(`PROJ-${i}`);
    }

    const proj = await store.getProject('test-proj');
    expect(proj?.next_id).toBe(11);
  });

  describe('Template', () => {
    beforeEach(async () => {
      const project: Project = {
        id: 'test-proj',
        name: 'Test Project',
        prefix: 'TEST',
        created_at: new Date().toISOString(),
        next_id: 1,
      };
      await store.createProject(project);
    });

    it('applies template fields to issue', async () => {
      const template: Template = {
        name: 'bug-template',
        project_id: 'test-proj',
        description: 'Template description',
        issue_type: IssueType.Bug,
        priority: 1,
        design: 'Template design notes',
        acceptance_criteria: 'Template AC',
        labels: ['bug', 'urgent'],
      };
      await store.createTemplate('test-proj', template);

      const input: CreateIssueInput = {
        title: 'Bug from template',
        template: 'bug-template',
      };
      const issue = await service.create('test-proj', input, 'test-user');

      expect(issue.description).toBe('Template description');
      // Template issue_type now applies when issue has default type (Task)
      expect(issue.issue_type).toBe(IssueType.Bug);
      expect(issue.priority).toBe(1);
      expect(issue.design).toBe('Template design notes');
      expect(issue.acceptance_criteria).toBe('Template AC');
      expect(issue.labels).toContain('bug');
      expect(issue.labels).toContain('urgent');
    });

    it('throws ErrNotFound for nonexistent template', async () => {
      const input: CreateIssueInput = {
        title: 'Issue with bad template',
        template: 'nonexistent-template',
      };

      await expect(service.create('test-proj', input, 'test-user'))
        .rejects.toThrow(ErrNotFound);
    });

    it('input overrides template fields', async () => {
      const template: Template = {
        name: 'feature-template',
        project_id: 'test-proj',
        description: 'Template description',
        issue_type: IssueType.Feature,
        priority: 3,
      };
      await store.createTemplate('test-proj', template);

      const input: CreateIssueInput = {
        title: 'Feature with overrides',
        template: 'feature-template',
        description: 'Custom description',
        issue_type: IssueType.Epic,
        priority: 0,
      };
      const issue = await service.create('test-proj', input, 'test-user');

      expect(issue.description).toBe('Custom description');
      expect(issue.issue_type).toBe(IssueType.Epic);
      expect(issue.priority).toBe(0);
    });

    it('merges labels from input and template', async () => {
      const template: Template = {
        name: 'labeled-template',
        project_id: 'test-proj',
        labels: ['template-label', 'shared'],
      };
      await store.createTemplate('test-proj', template);

      const input: CreateIssueInput = {
        title: 'Issue with merged labels',
        template: 'labeled-template',
        labels: ['input-label', 'shared'],
      };
      const issue = await service.create('test-proj', input, 'test-user');

      expect(issue.labels).toContain('template-label');
      expect(issue.labels).toContain('input-label');
      expect(issue.labels).toContain('shared');
      // Should be unique
      expect(issue.labels?.filter(l => l === 'shared').length).toBe(1);
    });
  });

  describe('Input fields', () => {
    beforeEach(async () => {
      const project: Project = {
        id: 'test-proj',
        name: 'Test Project',
        prefix: 'TEST',
        created_at: new Date().toISOString(),
        next_id: 1,
      };
      await store.createProject(project);
    });

    it('sets due_date from input', async () => {
      const dueDate = '2025-12-31T23:59:59Z';
      const input: CreateIssueInput = {
        title: 'Issue with due date',
        due_date: dueDate,
      };
      const issue = await service.create('test-proj', input, 'test-user');

      expect(issue.due_date).toBe(dueDate);
    });

    it('sets assignee from input', async () => {
      const input: CreateIssueInput = {
        title: 'Assigned issue',
        assignee: 'developer-1',
      };
      const issue = await service.create('test-proj', input, 'test-user');

      expect(issue.assignee).toBe('developer-1');
    });

    it('sets labels from input without template', async () => {
      const input: CreateIssueInput = {
        title: 'Labeled issue',
        labels: ['frontend', 'p1'],
      };
      const issue = await service.create('test-proj', input, 'test-user');

      expect(issue.labels).toContain('frontend');
      expect(issue.labels).toContain('p1');
      expect(issue.labels?.length).toBe(2);
    });

    it('sets priority 0 correctly', async () => {
      const input: CreateIssueInput = {
        title: 'Critical issue',
        priority: 0,
      };
      const issue = await service.create('test-proj', input, 'test-user');

      expect(issue.priority).toBe(0);
    });

    it('sets external_ref from input', async () => {
      const input: CreateIssueInput = {
        title: 'External issue',
        external_ref: 'JIRA-123',
      };
      const issue = await service.create('test-proj', input, 'test-user');

      expect(issue.external_ref).toBe('JIRA-123');
    });
  });
});
