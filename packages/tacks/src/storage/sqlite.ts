import { readFileSync } from 'fs';
import { join } from 'path';
import { DB } from './db.js';
import {
  Storage, ErrNotFound, ErrConflict, ErrValidation, ErrCycle, ErrAssigned,
  IssueFilter, WorkFilter, EpicStatus, CompactionCandidate, IssueWithDependencyMetadata, IssueWithCounts, Transaction
} from './index.js';
import {
  Project, Issue, Dependency, Label, Comment, Template, User, Role, Event, Statistics,
  Status, IssueType, DependencyType
} from '../types/index.js';
import { CreateIssueInput, IssueService } from '../service/issue.js';

// Helper for converting SQLite result to boolean (though `sqlite` package often maps to JS types)
const sqliteBoolean = (value: any): boolean => value === 1;

// Helper for converting boolean to SQLite integer
const toSqliteBoolean = (value: boolean): number => (value ? 1 : 0);

// Helper functions for date conversions
const toISOString = (date?: Date | string | null): string | undefined => {
  if (!date) return undefined;
  if (typeof date === 'string') return date; // Assume already ISO string
  return date.toISOString();
};

const toDate = (isoString?: string | null): Date | undefined => {
  if (!isoString) return undefined;
  return new Date(isoString);
};

// Helper for nullable string values
const nullIfEmpty = (str?: string | null): string | null => (str && str.trim() !== '' ? str : null);

// Column names for issues, useful for dynamic query building and scanning
const ISSUE_COLUMNS = `
  id, project_id, content_hash, title, description, design, acceptance_criteria, notes,
  status, priority, issue_type, assignee_id, estimated_minutes, created_at, updated_at,
  closed_at, due_date, external_ref, compaction_level, compacted_at, compacted_at_commit, original_size
`;

const ISSUE_COLUMNS_PREFIXED = ISSUE_COLUMNS.split(',').map(c => 'i.' + c.trim()).join(', ');

export class SqliteStorage implements Storage, Transaction {
  private db: DB;

  constructor(dbInstance: DB) {
    this.db = dbInstance;
  }

  private async insertDefaultRoles() {
    const roles = [
      { id: 'architect', name: 'Architect', description: 'System and software architecture', instructions: 'Focus on high-level design, system boundaries, and architectural patterns.' },
      { id: 'designer', name: 'Designer', description: 'UX/UI and product design', instructions: 'Focus on user experience, interface design, and visual consistency.' },
      { id: 'senior-swe', name: 'Senior SWE', description: 'Senior software engineer', instructions: 'Implement features with attention to code quality and maintainability.' },
      { id: 'staff-swe', name: 'Staff SWE', description: 'Staff software engineer', instructions: 'Lead technical initiatives and mentor other engineers.' },
      { id: 'principal-swe', name: 'Principal SWE', description: 'Principal software engineer', 'instructions': 'Drive technical strategy and solve complex cross-cutting concerns.' },
      { id: 'release-engineer', name: 'Release Engineer', description: 'Release and deployment', 'instructions': 'Manage releases, CI/CD pipelines, and deployment processes.' },
      { id: 'agent', name: 'Agent', description: 'AI agent assistant', instructions: 'Autonomous AI agent that can work on tasks independently.' }
    ];

    await this.db.transaction(async (tx) => {
      for (const role of roles) {
        await tx.run(`
          INSERT OR IGNORE INTO roles (id, name, description, instructions, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `, role.id, role.name, role.description, role.instructions);
        await tx.run(`
          INSERT OR IGNORE INTO entities (kind_id, native_id)
          SELECT 4, id FROM roles WHERE id = ?
        `, role.id);
      }
    });
  }

  private async insertEntityKinds() {
    const entityKinds = [
      { id: 1, name: 'project' },
      { id: 2, name: 'issue' },
      { id: 3, name: 'user' },
      { id: 4, name: 'role' }
    ];
    await this.db.transaction(async (tx) => {
      for (const kind of entityKinds) {
        await tx.run(`
          INSERT OR IGNORE INTO entity_kinds (id, name)
          VALUES (?, ?)
        `, kind.id, kind.name);
      }
    });
  }

  private async initDefaults() {
    await this.insertEntityKinds();
    await this.insertDefaultRoles();
  }

  private mapRowToProject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      prefix: row.prefix,
      next_id: row.next_id,
      created_at: toISOString(row.created_at)!,
    };
  }

  private mapRowToIssue(row: any): Issue {
    return {
      id: row.id,
      project_id: row.project_id,
      content_hash: row.content_hash || undefined,
      title: row.title,
      description: row.description,
      design: row.design || undefined,
      acceptance_criteria: row.acceptance_criteria || undefined,
      notes: row.notes || undefined,
      status: row.status as Status,
      priority: row.priority,
      issue_type: row.issue_type as IssueType,
      assignee: row.assignee_id || undefined,
      estimated_minutes: row.estimated_minutes || undefined,
      created_at: toISOString(row.created_at)!,
      updated_at: toISOString(row.updated_at)!,
      closed_at: toISOString(row.closed_at) || undefined,
      due_date: toISOString(row.due_date) || undefined,
      external_ref: row.external_ref || undefined,
      compaction_level: row.compaction_level || undefined,
      compacted_at: toISOString(row.compacted_at) || undefined,
      compacted_at_commit: row.compacted_at_commit || undefined,
      original_size: row.original_size || undefined,
    };
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async ping(): Promise<void> {
    // With 'sqlite' package, checking if a simple query runs indicates connection is alive
    await this.db.get('SELECT 1');
  }

  // --- Projects ---

  async createProject(project: Project): Promise<void> {
    if (!project.id) throw new ErrValidation('id', 'Project ID is required');
    if (!project.name) throw new ErrValidation('name', 'Project name is required');

    const now = new Date();
    project.created_at = toISOString(now)!;
    project.next_id = project.next_id || 1;

    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`
          INSERT INTO projects (id, name, description, prefix, next_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          project.id,
          project.name,
          project.description || '',
          project.prefix || '',
          project.next_id,
          project.created_at
        );
        // Register entity: kind_id 1 for project
        await tx.run(`
          INSERT OR IGNORE INTO entities (kind_id, native_id) VALUES (1, ?)
        `, project.id);
      });
    } catch (e: any) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        throw new ErrConflict('project', project.id);
      }
      throw new Error(`Failed to create project: ${e.message}`);
    }
  }

  async getProject(id: string): Promise<Project | undefined> {
    const row = await this.db.get(`SELECT id, name, description, prefix, next_id, created_at FROM projects WHERE id = ?`, id);
    return row ? this.mapRowToProject(row) : undefined;
  }

  async listProjects(): Promise<Project[]> {
    const rows = await this.db.query(`SELECT id, name, description, prefix, next_id, created_at FROM projects`);
    return (rows as any[]).map(this.mapRowToProject);
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    const project = await this.getProject(id);
    if (!project) {
      throw new ErrNotFound('project', id);
    }

    const allowedUpdates: string[] = ['name', 'description', 'prefix'];
    const setClauses: string[] = [];
    const params: any[] = [];

    for (const key of Object.keys(updates)) {
      if (!allowedUpdates.includes(key)) {
        throw new ErrValidation(key, 'Invalid field for update');
      }
      setClauses.push(`${key} = ?`);
      params.push(updates[key]);
    }

    if (setClauses.length === 0) {
      return; // No updates provided
    }

    params.push(id);
    const updateSql = `UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`;

    try {
      const result = await this.db.run(updateSql, params);
      if (result.changes === 0) {
        throw new ErrNotFound('project', id);
      }
    } catch (e: any) {
      throw new Error(`Failed to update project: ${e.message}`);
    }
  }

  async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (!project) {
      throw new ErrNotFound('project', id);
    }
    try {
      const result = await this.db.run(`DELETE FROM projects WHERE id = ?`, id);
      if (result.changes === 0) {
        throw new ErrNotFound('project', id);
      }
    } catch (e: any) {
      throw new Error(`Failed to delete project: ${e.message}`);
    }
  }

  async getNextIssueID(projectID: string): Promise<number> {
    // Use atomic UPDATE...RETURNING to prevent race conditions.
    // RETURNING gives us the NEW value after increment, so we subtract 1 to get the allocated ID.
    try {
      const row = await this.db.get(
        `UPDATE projects SET next_id = next_id + 1 WHERE id = ? RETURNING next_id`,
        projectID
      ) as { next_id: number } | undefined;

      if (!row) {
        throw new ErrNotFound('project', projectID);
      }

      return row.next_id - 1; // Return the value before increment (the allocated ID)
    } catch (e: any) {
      if (e instanceof ErrNotFound) throw e;
      throw new Error(`Failed to get next issue ID: ${e.message}`);
    }
  }

  // --- Issues ---

  async createIssue(projectID: string, issue: Issue, actor: string): Promise<void> {
    // Simplified validation here, more complete validation should be in a service layer
    if (!issue.title) throw new ErrValidation('title', 'Title is required');
    if (issue.title.length > 500) throw new ErrValidation('title', 'Title too long');
    if (issue.priority < 0 || issue.priority > 4) throw new ErrValidation('priority', 'Priority out of range');

    const now = new Date();
    issue.created_at = toISOString(now)!;
    issue.updated_at = toISOString(now)!;
    issue.project_id = projectID;

    // ContentHash logic (simplified, without Go's sha256)
    issue.content_hash = issue.content_hash || `hash-${Date.now()}`; // Placeholder

    if (!issue.id) {
      // In Go, issue ID is generated by prefix + next_id or a hash.
      // For now, let's use a simple hash. A service layer will handle prefix+next_id.
      issue.id = `ISS-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    }

    try {
      await this.db.transaction(async (tx) => {
        // Verify project exists
        const projectExists = await tx.get(`SELECT 1 FROM projects WHERE id = ?`, projectID);
        if (!projectExists) {
          throw new ErrNotFound('project', projectID);
        }

        await tx.run(`
          INSERT INTO issues (
            id, project_id, content_hash, title, description, design, acceptance_criteria, notes,
            status, priority, issue_type, assignee_id, estimated_minutes, created_at, updated_at,
            closed_at, due_date, external_ref
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          issue.id,
          issue.project_id,
          nullIfEmpty(issue.content_hash),
          issue.title,
          issue.description || '',
          issue.design || '',
          issue.acceptance_criteria || '',
          issue.notes || '',
          issue.status,
          issue.priority,
          issue.issue_type,
          nullIfEmpty(issue.assignee),
          issue.estimated_minutes || null,
          issue.created_at,
          issue.updated_at,
          nullIfEmpty(issue.closed_at),
          nullIfEmpty(issue.due_date),
          nullIfEmpty(issue.external_ref)
        );

        await tx.run(`
          INSERT INTO events (issue_id, event_type, actor, old_value, new_value, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `, issue.id, 'created', actor, null, JSON.stringify({ issue_id: issue.id, project_id: issue.project_id, title: issue.title }));

        await tx.run(`
          INSERT OR IGNORE INTO entities (kind_id, native_id) VALUES (2, ?)
        `, issue.id);
      });
    } catch (e: any) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        throw new ErrConflict('issue', issue.id);
      }
      throw new Error(`Failed to create issue: ${e.message}`);
    }
  }

  async getIssue(projectID: string, id: string): Promise<Issue | undefined> {
    const row = await this.db.get(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE project_id = ? AND id = ?`, projectID, id);
    if (!row) return undefined;
    const issue = this.mapRowToIssue(row);
    issue.labels = await this.getLabels(projectID, id);
    return issue;
  }

  async getIssueByExternalRef(projectID: string, externalRef: string): Promise<Issue | undefined> {
    const row = await this.db.get(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE project_id = ? AND external_ref = ?`, projectID, externalRef);
    if (!row) return undefined;
    const issue = this.mapRowToIssue(row);
    issue.labels = await this.getLabels(projectID, issue.id);
    return issue;
  }

  async updateIssue(projectID: string, id: string, updates: Partial<Issue>, actor: string): Promise<void> {
    const oldIssue = await this.getIssue(projectID, id);
    if (!oldIssue) {
      throw new ErrNotFound('issue', id);
    }

    // Apply specific Go-like logic for status transitions
    if ('status' in updates && updates.status === 'in_progress' && oldIssue.status !== 'in_progress') {
      if (oldIssue.assignee && oldIssue.assignee !== actor) {
        throw new ErrAssigned(id, oldIssue.assignee);
      }
      if (!oldIssue.assignee) { // Auto-assign if not assigned
        updates.assignee_id = actor;
      }
    }

    // Map 'assignee' to 'assignee_id' if present (Go compatibility)
    if ('assignee' in updates) {
      updates.assignee_id = updates.assignee;
      delete updates.assignee;
    }

    const allowedUpdates = [
      'status', 'priority', 'title', 'assignee_id', 'description', 'design',
      'acceptance_criteria', 'notes', 'issue_type', 'estimated_minutes', 'due_date', 'external_ref', 'closed_at'
    ];

    const setClauses: string[] = ['updated_at = ?'];
    const params: any[] = [toISOString(new Date())];
    const newIssueData: Record<string, any> = {};

    for (const key of Object.keys(updates)) {
      if (!allowedUpdates.includes(key)) {
        throw new ErrValidation(key, 'Invalid field for update');
      }
      setClauses.push(`${key} = ?`);
      params.push(updates[key]);
      newIssueData[key] = updates[key];
    }

    // Handle closed_at based on status transition
    if ('status' in updates) {
      const newStatus = updates.status as Status;
      const wasTerminal = oldIssue.status === 'closed' || oldIssue.status === 'wont_do';
      const isTerminal = newStatus === 'closed' || newStatus === 'wont_do';

      if (isTerminal && !wasTerminal) {
        setClauses.push('closed_at = ?');
        params.push(toISOString(new Date()));
        newIssueData.closed_at = toISOString(new Date());
      } else if (!isTerminal && wasTerminal) {
        setClauses.push('closed_at = ?');
        params.push(null);
        newIssueData.closed_at = null;
      }
    }

    params.push(projectID, id);
    const updateSql = `UPDATE issues SET ${setClauses.join(', ')} WHERE project_id = ? AND id = ?`;

    try {
      await this.db.transaction(async (tx) => {
        const result = await tx.run(updateSql, params);
        if (result.changes === 0) {
          throw new ErrNotFound('issue', id);
        }

        // Record event
        const eventType = updates.status ? 'status_changed' : 'updated';
        await tx.run(`
          INSERT INTO events (issue_id, event_type, actor, old_value, new_value, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `, id, eventType, actor, JSON.stringify(oldIssue), JSON.stringify({ ...oldIssue, ...newIssueData }));
      });
    } catch (e: any) {
      throw new Error(`Failed to update issue: ${e.message}`);
    }
  }

  async closeIssue(projectID: string, id: string, reason: string, actor: string): Promise<void> {
    await this.updateIssue(projectID, id, { status: 'closed' as Status, closed_at: new Date().toISOString() }, actor);
    // Go's CloseIssue event recorded the reason. This needs to be handled in updateIssue's event logic.
    // For now, the event simply says 'status_changed'.
  }

  async reopenIssue(projectID: string, id: string, actor: string): Promise<void> {
    await this.updateIssue(projectID, id, { status: 'open' as Status, closed_at: null }, actor);
  }

  async deleteIssue(projectID: string, id: string): Promise<void> {
    const issue = await this.getIssue(projectID, id);
    if (!issue) {
      throw new ErrNotFound('issue', id);
    }
    try {
      const result = await this.db.run(`DELETE FROM issues WHERE project_id = ? AND id = ?`, projectID, id);
      if (result.changes === 0) {
        throw new ErrNotFound('issue', id); // Should not happen if getIssue passed
      }
    } catch (e: any) {
      throw new Error(`Failed to delete issue: ${e.message}`);
    }
  }

  async searchIssues(projectID: string, query: string, filter: IssueFilter): Promise<Issue[]> {
    let sql = `SELECT ${ISSUE_COLUMNS} FROM issues WHERE project_id = ?`;
    const params: any[] = [projectID];
    const conditions: string[] = [];

    if (query) {
      conditions.push('(title LIKE ? OR description LIKE ? OR id LIKE ?)');
      const searchPattern = `%${query}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    if (filter.priority !== undefined) {
      conditions.push('priority = ?');
      params.push(filter.priority);
    }

    if (filter.issue_type) {
      conditions.push('issue_type = ?');
      params.push(filter.issue_type);
    }

    if (filter.assignee) {
      conditions.push('assignee_id = ?');
      params.push(filter.assignee);
    }

    if (filter.ids && filter.ids.length > 0) {
      conditions.push(`id IN (${filter.ids.map(() => '?').join(', ')})`);
      params.push(...filter.ids);
    }

    if (filter.title_contains) {
      conditions.push('title LIKE ?');
      params.push(`%${filter.title_contains}%`);
    }
    if (filter.description_contains) {
      conditions.push('description LIKE ?');
      params.push(`%${filter.description_contains}%`);
    }
    if (filter.notes_contains) {
      conditions.push('notes LIKE ?');
      params.push(`%${filter.notes_contains}%`);
    }

    if (filter.created_after) {
      conditions.push('created_at >= ?');
      params.push(filter.created_after);
    }
    if (filter.created_before) {
      conditions.push('created_at <= ?');
      params.push(filter.created_before);
    }
    if (filter.updated_after) {
      conditions.push('updated_at >= ?');
      params.push(filter.updated_after);
    }
    if (filter.updated_before) {
      conditions.push('updated_at <= ?');
      params.push(filter.updated_before);
    }
    if (filter.closed_after) {
      conditions.push('closed_at >= ?');
      params.push(filter.closed_after);
    }
    if (filter.closed_before) {
      conditions.push('closed_at <= ?');
      params.push(filter.closed_before);
    }

    if (filter.empty_description) {
      conditions.push('description = ?');
      params.push('');
    }
    if (filter.no_assignee) {
      conditions.push('assignee_id IS NULL');
    }
    if (filter.no_labels) {
      conditions.push('id NOT IN (SELECT issue_id FROM labels)');
    }

    if (filter.priority_min !== undefined) {
      conditions.push('priority >= ?');
      params.push(filter.priority_min);
    }
    if (filter.priority_max !== undefined) {
      conditions.push('priority <= ?');
      params.push(filter.priority_max);
    }

    // Label filtering (AND semantics)
    if (filter.labels && filter.labels.length > 0) {
      for (const label of filter.labels) {
        conditions.push(`EXISTS (SELECT 1 FROM labels WHERE issue_id = issues.id AND label = ?)`);
        params.push(label);
      }
    }
    // Label filtering (OR semantics)
    if (filter.labels_any && filter.labels_any.length > 0) {
        conditions.push(`EXISTS (SELECT 1 FROM labels WHERE issue_id = issues.id AND label IN (${filter.labels_any.map(() => '?').join(', ')}))`);
        params.push(...filter.labels_any);
    }


    if (conditions.length > 0) {
      sql += ' AND ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY priority ASC, created_at DESC';

    if (filter.limit !== undefined && filter.limit > 0) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        sql += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    try {
      const rows = await this.db.query(sql, params);
      const issues: Issue[] = (rows as any[]).map(this.mapRowToIssue);
      const issueIDs = issues.map(i => i.id);

      if (issueIDs.length > 0) {
        const labelsMap = await this.getLabelsForIssues(projectID, issueIDs);
        for (const issue of issues) {
          issue.labels = labelsMap.get(issue.id) || [];
        }
      }
      return issues;
    } catch (e: any) {
      throw new Error(`Failed to search issues: ${e.message}`);
    }
  }


  // --- Dependencies ---
  async addDependency(projectID: string, dep: Dependency, actor: string): Promise<void> {
    const { issue_id, depends_on_id, type } = dep;
    if (!issue_id || !depends_on_id || !type) {
      throw new ErrValidation('dependency', 'Missing required fields');
    }

    if (issue_id === depends_on_id) {
        throw new ErrCycle(issue_id, depends_on_id); // Self-dependency
    }

    // Check if issues exist
    const issueExists = await this.getIssue(projectID, issue_id);
    if (!issueExists) throw new ErrNotFound('issue', issue_id);
    const dependsOnExists = await this.getIssue(projectID, depends_on_id);
    if (!dependsOnExists) throw new ErrNotFound('issue', depends_on_id);

    // Cycle detection: Check if depends_on_id already transitively depends on issue_id
    // i.e. Does path B -> ... -> A exist?
    const cycleQuery = `
        WITH RECURSIVE chain(node_id) AS (
            SELECT depends_on_id FROM dependencies WHERE issue_id = ?
            UNION
            SELECT d.depends_on_id
            FROM dependencies d
            JOIN chain c ON d.issue_id = c.node_id
        )
        SELECT 1 FROM chain WHERE node_id = ? LIMIT 1
    `;
    // Note: The CTE above starts with immediate dependencies of B (depends_on_id).
    // If B depends on A directly or indirectly, a row will be returned.
    // We pass depends_on_id as the start point.
    
    const hasCycle = await this.db.get(cycleQuery, depends_on_id, issue_id);
    if (hasCycle) {
        throw new ErrCycle(issue_id, depends_on_id);
    }

    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`
          INSERT INTO dependencies (issue_id, depends_on_id, type, created_at, created_by)
          VALUES (?, ?, ?, datetime('now'), ?)
        `, issue_id, depends_on_id, type, actor);

        await tx.run(`
          INSERT INTO events (issue_id, event_type, actor, old_value, new_value, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `, issue_id, 'dependency_added', actor, null, JSON.stringify({ depends_on_id, type }));
      });
    } catch (e: any) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        throw new ErrConflict('dependency', `${issue_id}->${depends_on_id}`);
      }
      throw new Error(`Failed to add dependency: ${e.message}`);
    }
  }

  async removeDependency(projectID: string, issueID: string, dependsOnID: string, actor: string): Promise<void> {
    const dependencyExists = await this.db.get(`SELECT 1 FROM dependencies WHERE issue_id = ? AND depends_on_id = ?`, issueID, dependsOnID);
    if (!dependencyExists) {
      throw new ErrNotFound('dependency', `${issueID}->${dependsOnID}`);
    }

    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`
          DELETE FROM dependencies WHERE issue_id = ? AND depends_on_id = ?
        `, issueID, dependsOnID);

        await tx.run(`
          INSERT INTO events (issue_id, event_type, actor, old_value, new_value, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `, issueID, 'dependency_removed', actor, JSON.stringify({ depends_on_id: dependsOnID }), null);
      });
    } catch (e: any) {
      throw new Error(`Failed to remove dependency: ${e.message}`);
    }
  }

  async getDependencies(projectID: string, issueID: string): Promise<Issue[]> {
    const rows = await this.db.query(`
      SELECT ${ISSUE_COLUMNS_PREFIXED} FROM issues i
      JOIN dependencies d ON i.id = d.depends_on_id
      WHERE d.issue_id = ? AND i.project_id = ?
      ORDER BY i.priority ASC, i.created_at DESC
    `, issueID, projectID);
    const issues: Issue[] = (rows as any[]).map(this.mapRowToIssue);
    const issueIDs = issues.map(i => i.id);

    if (issueIDs.length > 0) {
      const labelsMap = await this.getLabelsForIssues(projectID, issueIDs);
      for (const issue of issues) {
        issue.labels = labelsMap.get(issue.id) || [];
      }
    }
    return issues;
  }

  async getDependents(projectID: string, issueID: string): Promise<Issue[]> {
    const rows = await this.db.query(`
      SELECT ${ISSUE_COLUMNS_PREFIXED} FROM issues i
      JOIN dependencies d ON i.id = d.issue_id
      WHERE d.depends_on_id = ? AND i.project_id = ?
      ORDER BY i.priority ASC, i.created_at DESC
    `, issueID, projectID);
    const issues: Issue[] = (rows as any[]).map(this.mapRowToIssue);
    const issueIDs = issues.map(i => i.id);

    if (issueIDs.length > 0) {
      const labelsMap = await this.getLabelsForIssues(projectID, issueIDs);
      for (const issue of issues) {
        issue.labels = labelsMap.get(issue.id) || [];
      }
    }
    return issues;
  }

  async getDependentsFiltered(projectID: string, issueID: string, depType?: DependencyType, limit?: number): Promise<Issue[]> {
    let sql = `
      SELECT ${ISSUE_COLUMNS_PREFIXED} FROM issues i
      JOIN dependencies d ON i.id = d.issue_id
      WHERE d.depends_on_id = ? AND i.project_id = ?
    `;
    const params: any[] = [issueID, projectID];

    if (depType) {
      sql += ' AND d.type = ?';
      params.push(depType);
    }
    sql += ' ORDER BY i.priority ASC, i.created_at DESC';
    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const rows = await this.db.query(sql, params);
    const issues: Issue[] = (rows as any[]).map(this.mapRowToIssue);
    const issueIDs = issues.map(i => i.id);

    if (issueIDs.length > 0) {
      const labelsMap = await this.getLabelsForIssues(projectID, issueIDs);
      for (const issue of issues) {
        issue.labels = labelsMap.get(issue.id) || [];
      }
    }
    return issues;
  }

  async getDependencyRecords(projectID: string, issueID: string): Promise<Dependency[]> {
    const rows = await this.db.query(`
      SELECT issue_id, depends_on_id, type, created_at, created_by
      FROM dependencies
      WHERE issue_id = ?
    `, issueID) as any[];

    return rows.map(row => ({
      issue_id: row.issue_id,
      depends_on_id: row.depends_on_id,
      type: row.type as DependencyType,
      created_at: toISOString(row.created_at)!,
      created_by: row.created_by,
    }));
  }

  async getDependencyCounts(projectID: string, issueIDs: string[]): Promise<Map<string, { dependency_count: number; dependent_count: number; }>> {
    const countsMap = new Map<string, { dependency_count: number; dependent_count: number }>();
    if (issueIDs.length === 0) return countsMap;

    const placeholders = issueIDs.map(() => '?').join(', ');

    const dependencyCountsRows = await this.db.query(`
      SELECT issue_id, COUNT(*) as count
      FROM dependencies
      WHERE depends_on_id IN (${placeholders})
      GROUP BY issue_id
    `, ...issueIDs) as any[];

    const dependentCountsRows = await this.db.query(`
      SELECT depends_on_id, COUNT(*) as count
      FROM dependencies
      WHERE issue_id IN (${placeholders})
      GROUP BY depends_on_id
    `, ...issueIDs) as any[];

    for (const id of issueIDs) {
      countsMap.set(id, { dependency_count: 0, dependent_count: 0 });
    }

    for (const row of dependencyCountsRows) {
      const counts = countsMap.get(row.issue_id);
      if (counts) counts.dependency_count = row.count;
    }
    for (const row of dependentCountsRows) {
      const counts = countsMap.get(row.depends_on_id);
      if (counts) counts.dependent_count = row.count;
    }

    return countsMap;
  }

  // --- Labels ---

  async addLabel(projectID: string, issueID: string, label: string, actor: string): Promise<void> {
    // Check if issue exists
    const issueExists = await this.getIssue(projectID, issueID);
    if (!issueExists) throw new ErrNotFound('issue', issueID);

    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`
          INSERT OR IGNORE INTO labels (issue_id, label) VALUES (?, ?)
        `, issueID, label);

        await tx.run(`
          INSERT INTO events (issue_id, event_type, actor, old_value, new_value, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `, issueID, 'label_added', actor, null, JSON.stringify({ label }));
      });
    } catch (e: any) {
      throw new Error(`Failed to add label: ${e.message}`);
    }
  }

  async removeLabel(projectID: string, issueID: string, label: string, actor: string): Promise<void> {
    // No need to check if label exists, DELETE will just affect 0 rows if not found.
    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`
          DELETE FROM labels WHERE issue_id = ? AND label = ?
        `, issueID, label);

        await tx.run(`
          INSERT INTO events (issue_id, event_type, actor, old_value, new_value, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `, issueID, 'label_removed', actor, JSON.stringify({ label }), null);
      });
    } catch (e: any) {
      throw new Error(`Failed to remove label: ${e.message}`);
    }
  }

  async getLabels(projectID: string, issueID: string): Promise<string[]> {
    const rows = await this.db.query(`
      SELECT label FROM labels WHERE issue_id = ?
    `, issueID) as { label: string }[];
    return rows.map(row => row.label);
  }

  async getLabelsForIssues(projectID: string, issueIDs: string[]): Promise<Map<string, string[]>> {
    const labelsMap = new Map<string, string[]>();
    if (issueIDs.length === 0) return labelsMap;

    const placeholders = issueIDs.map(() => '?').join(', ');
    const rows = await this.db.query(`
      SELECT issue_id, label FROM labels WHERE issue_id IN (${placeholders})
    `, ...issueIDs) as { issue_id: string, label: string }[];

    for (const id of issueIDs) {
      labelsMap.set(id, []);
    }
    for (const row of rows) {
      labelsMap.get(row.issue_id)?.push(row.label);
    }
    return labelsMap;
  }

  // --- Ready Work & Blocking ---

  async getReadyWork(projectID: string, filter: WorkFilter): Promise<Issue[]> {
    let sql = `SELECT ${ISSUE_COLUMNS} FROM ready_issues WHERE project_id = ?`;
    const params: any[] = [projectID];
    const conditions: string[] = [];

    if (filter.priority !== undefined) {
      conditions.push('priority = ?');
      params.push(filter.priority);
    }

    if (filter.assignee) {
      conditions.push('assignee_id = ?');
      params.push(filter.assignee);
    }

    if (filter.labels && filter.labels.length > 0) {
      for (const label of filter.labels) {
        conditions.push(`EXISTS (SELECT 1 FROM labels WHERE issue_id = ready_issues.id AND label = ?)`);
        params.push(label);
      }
    }
    if (filter.labels_any && filter.labels_any.length > 0) {
      conditions.push(`EXISTS (SELECT 1 FROM labels WHERE issue_id = ready_issues.id AND label IN (${filter.labels_any.map(() => '?').join(', ')}))`);
      params.push(...filter.labels_any);
    }

    if (conditions.length > 0) {
      sql += ' AND ' + conditions.join(' AND ');
    }

    let orderBy = ' ORDER BY priority ASC, created_at DESC';
    if (filter.sort_policy === 'priority') {
      orderBy = ' ORDER BY priority ASC, created_at DESC';
    } else if (filter.sort_policy === 'oldest') {
      orderBy = ' ORDER BY created_at ASC';
    } else if (filter.sort_policy === 'hybrid') {
      // For now, assuming default ordering is "hybrid"
    }
    sql += orderBy;

    if (filter.limit !== undefined && filter.limit > 0) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    try {
      const rows = await this.db.query(sql, params);
      const issues: Issue[] = (rows as any[]).map(this.mapRowToIssue);
      const issueIDs = issues.map(i => i.id);

      if (issueIDs.length > 0) {
        const labelsMap = await this.getLabelsForIssues(projectID, issueIDs);
        for (const issue of issues) {
          issue.labels = labelsMap.get(issue.id) || [];
        }
      }
      return issues;
    } catch (e: any) {
      throw new Error(`Failed to get ready work: ${e.message}`);
    }
  }

  async getBlockedIssues(projectID: string): Promise<BlockedIssue[]> {
    const rows = await this.db.query(`
      SELECT ${ISSUE_COLUMNS}, blocked_by_count
      FROM blocked_issues bi
      WHERE bi.project_id = ?
      ORDER BY bi.priority ASC, bi.created_at DESC
    `, projectID);

    const blockedIssues: BlockedIssue[] = [];
    const issueIDs: string[] = [];
    for (const row of rows as any[]) {
      const issue = this.mapRowToIssue(row);
      issueIDs.push(issue.id);
      blockedIssues.push({
        ...issue,
        blocked_by_count: row.blocked_by_count,
        blocked_by: [], // Will populate below
      });
    }

    if (issueIDs.length > 0) {
      // Fetch the actual blockers
      const blockersRows = await this.db.query(`
        SELECT d.issue_id, d.depends_on_id
        FROM dependencies d
        JOIN issues i ON d.issue_id = i.id
        WHERE d.type = 'blocks' AND i.project_id = ? AND d.issue_id IN (${issueIDs.map(() => '?').join(', ')})
      `, projectID, ...issueIDs) as { issue_id: string, depends_on_id: string }[];

      const blockerMap = new Map<string, string[]>();
      for (const row of blockersRows) {
        if (!blockerMap.has(row.issue_id)) {
          blockerMap.set(row.issue_id, []);
        }
        blockerMap.get(row.issue_id)?.push(row.depends_on_id);
      }

      for (const blockedIssue of blockedIssues) {
        blockedIssue.blocked_by = blockerMap.get(blockedIssue.id) || [];
        // Also fetch labels
        blockedIssue.labels = await this.getLabels(projectID, blockedIssue.id);
      }
    }

    return blockedIssues;
  }

  async getEpicsEligibleForClosure(projectID: string): Promise<EpicStatus[]> {
    // Only return open epics (closed epics are not candidates for closure)
    const epics = await this.searchIssues(projectID, '', { issue_type: 'epic', status: Status.Open });
    const epicStatuses: EpicStatus[] = [];

    for (const epic of epics) {
      const children = await this.getDependentsFiltered(projectID, epic.id, DependencyType.ParentChild);
      const totalChildren = children.length;
      const closedChildren = children.filter(c => c.status === Status.Closed || c.status === Status.WontDo).length;

      const eligibleForClose = totalChildren === closedChildren;

      epicStatuses.push({
        epic: epic,
        total_children: totalChildren,
        closed_children: closedChildren,
        eligible_for_close: eligibleForClose,
      });
    }
    return epicStatuses;
  }

  // --- Events ---

  async getEvents(projectID: string, issueID: string, limit: number): Promise<Event[]> {
    const rows = await this.db.query(`
      SELECT id, issue_id, event_type, actor, old_value, new_value, comment, created_at
      FROM events
      WHERE issue_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, issueID, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      issue_id: row.issue_id,
      event_type: row.event_type,
      actor: row.actor,
      old_value: row.old_value || undefined,
      new_value: row.new_value || undefined,
      comment: row.comment || undefined,
      created_at: toISOString(row.created_at)!,
    }));
  }

  // --- Comments ---

  async addComment(projectID: string, issueID: string, author: string, text: string): Promise<Comment> {
    const issueExists = await this.getIssue(projectID, issueID);
    if (!issueExists) throw new ErrNotFound('issue', issueID);

    try {
      let commentId: number | undefined;
      await this.db.transaction(async (tx) => {
        let entityIdRow = await tx.get(`SELECT id FROM entities WHERE kind_id = 2 AND native_id = ?`, issueID) as { id: number } | undefined;
        if (!entityIdRow) {
            await tx.run(`INSERT OR IGNORE INTO entities (kind_id, native_id) VALUES (2, ?)`, issueID);
            entityIdRow = await tx.get(`SELECT id FROM entities WHERE kind_id = 2 AND native_id = ?`, issueID) as { id: number };
        }
        const entityId = entityIdRow!.id;

        const result = await tx.run(`
          INSERT INTO comments (entity_id, author, text, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `, entityId, author, text);
        commentId = result.lastID as number;

        await tx.run(`
          INSERT INTO events (issue_id, event_type, actor, old_value, new_value, comment, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `, issueID, 'commented', author, null, JSON.stringify({ comment_id: commentId, text }), text);
      });

      if (!commentId) throw new Error('Failed to get comment ID after insert');

      return {
        id: commentId,
        issue_id: issueID,
        author: author,
        text: text,
        created_at: toISOString(new Date())!, // Current time for new comment
      };
    } catch (e: any) {
      throw new Error(`Failed to add comment: ${e.message}`);
    }
  }

  async getComments(projectID: string, issueID: string): Promise<Comment[]> {
    const rows = await this.db.query(`
      SELECT c.id, e.native_id AS issue_id, c.author, c.text, c.created_at
      FROM comments c
      JOIN entities e ON c.entity_id = e.id
      WHERE e.kind_id = 2 AND e.native_id = ?
      ORDER BY c.created_at ASC
    `, issueID) as any[];

    return rows.map(row => ({
      id: row.id,
      issue_id: row.issue_id,
      author: row.author,
      text: row.text,
      created_at: toISOString(row.created_at)!,
    }));
  }

  // --- Statistics ---

  async getStatistics(projectID: string): Promise<Statistics> {
    const totalIssues = (await this.db.get(`SELECT COUNT(*) as count FROM issues WHERE project_id = ?`, projectID) as { count: number }).count;
    const openIssues = (await this.db.get(`SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND status = 'open'`, projectID) as { count: number }).count;
    const inProgressIssues = (await this.db.get(`SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND status = 'in_progress'`, projectID) as { count: number }).count;
    const closedIssues = (await this.db.get(`SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND (status = 'closed' OR status = 'wont_do')`, projectID) as { count: number }).count;
    const blockedIssues = (await this.db.get(`SELECT COUNT(*) as count FROM blocked_issues WHERE project_id = ?`, projectID) as { count: number }).count;
    const readyIssues = (await this.db.get(`SELECT COUNT(*) as count FROM ready_issues WHERE project_id = ?`, projectID) as { count: number }).count;

    const epicsEligible = await this.getEpicsEligibleForClosure(projectID);
    const epicsEligibleForClosure = epicsEligible.filter(e => e.eligible_for_close).length;

    const leadTimeRows = await this.db.query(`
      SELECT JULIANDAY(closed_at) - JULIANDAY(created_at) as lead_time_days
      FROM issues
      WHERE project_id = ? AND (status = 'closed' OR status = 'wont_do') AND closed_at IS NOT NULL
    `, projectID) as { lead_time_days: number }[];

    let totalLeadTimeHours = 0;
    for (const row of leadTimeRows) {
      totalLeadTimeHours += row.lead_time_days * 24;
    }
    const averageLeadTime = closedIssues > 0 ? totalLeadTimeHours / closedIssues : 0;

    return {
      total_issues: totalIssues,
      open_issues: openIssues,
      in_progress_issues: inProgressIssues,
      closed_issues: closedIssues,
      blocked_issues: blockedIssues,
      ready_issues: readyIssues,
      epics_eligible_for_closure: epicsEligibleForClosure,
      average_lead_time_hours: parseFloat(averageLeadTime.toFixed(2)),
    };
  }


  // --- Config ---

  async setConfig(projectID: string, key: string, value: string): Promise<void> {
    const projectExists = await this.getProject(projectID);
    if (!projectExists) throw new ErrNotFound('project', projectID);

    try {
      await this.db.run(`
        INSERT INTO config (project_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value
      `, projectID, key, value);
    } catch (e: any) {
      throw new Error(`Failed to set config: ${e.message}`);
    }
  }

  async getConfig(projectID: string, key: string): Promise<string | undefined> {
    const row = await this.db.get(`
      SELECT value FROM config WHERE project_id = ? AND key = ?
    `, projectID, key) as { value: string } | undefined;
    return row?.value;
  }

  // --- Compaction ---

  async getTier1Candidates(projectID: string): Promise<CompactionCandidate[]> {
    return []; // TODO: Implement
  }

  async getTier2Candidates(projectID: string): Promise<CompactionCandidate[]> {
    return []; // TODO: Implement
  }

  async checkCompactionEligibility(projectID: string, issueID: string, tier: number): Promise<{ eligible: boolean, reason: string }> {
    return { eligible: false, reason: 'Compaction not implemented' }; // TODO: Implement
  }

  async applyCompaction(projectID: string, issueID: string, level: number, originalSize: number, compressedSize: number): Promise<void> {
    try {
        await this.db.run(`
            UPDATE issues
            SET compaction_level = ?, compacted_at = datetime('now'), original_size = ?
            WHERE project_id = ? AND id = ?
        `, level, originalSize, projectID, issueID);

        await this.db.run(`
          INSERT INTO events (issue_id, event_type, actor, old_value, new_value, comment, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `, issueID, 'compacted', 'system', JSON.stringify({ old_level: 0, old_size: 0 }), JSON.stringify({ new_level: level, new_size: compressedSize }), `Issue compacted to level ${level}`);
    } catch (e: any) {
        throw new Error(`Failed to apply compaction: ${e.message}`);
    }
  }

  // --- Export/Import ---

  async getAllDependencyRecords(projectID: string): Promise<Map<string, Dependency[]>> {
    const depsMap = new Map<string, Dependency[]>();
    const rows = await this.db.query(`
      SELECT d.issue_id, d.depends_on_id, d.type, d.created_at, d.created_by
      FROM dependencies d
      JOIN issues i ON d.issue_id = i.id
      WHERE i.project_id = ?
    `, projectID) as any[];

    for (const row of rows) {
      const dep: Dependency = {
        issue_id: row.issue_id,
        depends_on_id: row.depends_on_id,
        type: row.type as DependencyType,
        created_at: toISOString(row.created_at)!,
        created_by: row.created_by,
      };
      if (!depsMap.has(row.issue_id)) {
        depsMap.set(row.issue_id, []);
      }
      depsMap.get(row.issue_id)?.push(dep);
    }
    return depsMap;
  }

  async getAllComments(projectID: string): Promise<Map<string, Comment[]>> {
    const commentsMap = new Map<string, Comment[]>();
    const rows = await this.db.query(`
      SELECT c.id, e.native_id AS issue_id, c.author, c.text, c.created_at
      FROM comments c
      JOIN entities e ON c.entity_id = e.id
      JOIN issues i ON e.native_id = i.id
      WHERE e.kind_id = 2 AND i.project_id = ?
    `, projectID) as any[];

    for (const row of rows) {
      const comment: Comment = {
        id: row.id,
        issue_id: row.issue_id,
        author: row.author,
        text: row.text,
        created_at: toISOString(row.created_at)!,
      };
      if (!commentsMap.has(row.issue_id)) {
        commentsMap.set(row.issue_id, []);
      }
      commentsMap.get(row.issue_id)?.push(comment);
    }
    return commentsMap;
  }

  async commentExists(projectID: string, issueID: string, author: string, text: string): Promise<boolean> {
    const row = await this.db.get(`
      SELECT 1 FROM comments c
      JOIN entities e ON c.entity_id = e.id
      WHERE e.kind_id = 2 AND e.native_id = ? AND c.author = ? AND c.text = ?
    `, issueID, author, text);
    return !!row;
  }

  // --- Templates ---

  async createTemplate(projectID: string, template: Template): Promise<void> {
    if (!template.name) throw new ErrValidation('name', 'Template name is required');
    const projectExists = await this.getProject(projectID);
    if (!projectExists) throw new ErrNotFound('project', projectID);

    try {
      await this.db.run(`
        INSERT INTO templates (
          name, project_id, description, issue_type, priority, labels, design, acceptance_criteria,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
        template.name,
        projectID,
        template.description || '',
        template.issue_type || 'task',
        template.priority || 2,
        JSON.stringify(template.labels || []),
        template.design || '',
        template.acceptance_criteria || ''
      );
    } catch (e: any) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        throw new ErrConflict('template', template.name);
      }
      throw new Error(`Failed to create template: ${e.message}`);
    }
  }

  async getTemplate(projectID: string, name: string): Promise<Template | undefined> {
    const row = await this.db.get(`
      SELECT
        name, project_id, description, issue_type, priority, labels, design, acceptance_criteria,
        created_at, updated_at
      FROM templates WHERE project_id = ? AND name = ?
    `, projectID, name) as any;

    if (!row) return undefined;

    return {
      name: row.name,
      project_id: row.project_id,
      description: row.description || undefined,
      issue_type: row.issue_type as IssueType || undefined,
      priority: row.priority || undefined,
      labels: JSON.parse(row.labels || '[]'),
      design: row.design || undefined,
      acceptance_criteria: row.acceptance_criteria || undefined,
      created_at: toISOString(row.created_at)!,
      updated_at: toISOString(row.updated_at)!,
    };
  }

  async listTemplates(projectID: string): Promise<Template[]> {
    const rows = await this.db.query(`
      SELECT
        name, project_id, description, issue_type, priority, labels, design, acceptance_criteria,
        created_at, updated_at
      FROM templates WHERE project_id = ? OR project_id = '' -- Include global templates
      ORDER BY name ASC
    `, projectID) as any[];

    return rows.map(row => ({
      name: row.name,
      project_id: row.project_id || undefined,
      description: row.description || undefined,
      issue_type: row.issue_type as IssueType || undefined,
      priority: row.priority || undefined,
      labels: JSON.parse(row.labels || '[]'),
      design: row.design || undefined,
      acceptance_criteria: row.acceptance_criteria || undefined,
      created_at: toISOString(row.created_at)!,
      updated_at: toISOString(row.updated_at)!,
    }));
  }

  async updateTemplate(projectID: string, name: string, updates: Partial<Template>): Promise<void> {
    const template = await this.getTemplate(projectID, name);
    if (!template) {
      throw new ErrNotFound('template', name);
    }

    const allowedUpdates = ['description', 'issue_type', 'priority', 'labels', 'design', 'acceptance_criteria'];
    const setClauses: string[] = ['updated_at = datetime(\'now\')'];
    const params: any[] = [];

    for (const key of Object.keys(updates)) {
      if (!allowedUpdates.includes(key)) {
        throw new ErrValidation(key, 'Invalid field for update');
      }
      setClauses.push(`${key} = ?`);
      if (key === 'labels') {
        params.push(JSON.stringify(updates[key]));
      } else {
        params.push(updates[key]);
      }
    }

    if (setClauses.length === 1) { // Only updated_at
      return;
    }

    params.push(projectID, name);
    const updateSql = `UPDATE templates SET ${setClauses.join(', ')} WHERE project_id = ? AND name = ?`;

    try {
      const result = await this.db.run(updateSql, params);
      if (result.changes === 0) {
        throw new ErrNotFound('template', name);
      }
    } catch (e: any) {
      throw new Error(`Failed to update template: ${e.message}`);
    }
  }

  async deleteTemplate(projectID: string, name: string): Promise<void> {
    const template = await this.getTemplate(projectID, name);
    if (!template) {
      throw new ErrNotFound('template', name);
    }

    try {
      const result = await this.db.run(`DELETE FROM templates WHERE project_id = ? AND name = ?`, projectID, name);
      if (result.changes === 0) {
        throw new ErrNotFound('template', name);
      }
    } catch (e: any) {
      throw new Error(`Failed to delete template: ${e.message}`);
    }
  }


  // --- Users ---

  async createUser(user: User): Promise<void> {
    if (!user.id) throw new ErrValidation('id', 'User ID is required');

    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`
          INSERT INTO users (id, name, created_at, updated_at)
          VALUES (?, ?, datetime('now'), datetime('now'))
        `, user.id, user.name || '');
        await tx.run(`
          INSERT OR IGNORE INTO entities (kind_id, native_id) VALUES (3, ?)
        `, user.id);
      });
    } catch (e: any) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        throw new ErrConflict('user', user.id);
      }
      throw new Error(`Failed to create user: ${e.message}`);
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    const row = await this.db.get(`SELECT id, name, created_at, updated_at FROM users WHERE id = ?`, id) as any;
    if (!row) return undefined;
    const roles = await this.getUserRoles(id);
    return {
      id: row.id,
      name: row.name || undefined,
      created_at: toISOString(row.created_at)!,
      updated_at: toISOString(row.updated_at)!,
      roles: roles.map(r => r.id),
    };
  }

  async listUsers(): Promise<User[]> {
    const rows = await this.db.query(`SELECT id, name, created_at, updated_at FROM users ORDER BY id ASC`) as any[];
    const users: User[] = [];
    for (const row of rows) {
      const roles = await this.getUserRoles(row.id);
      users.push({
        id: row.id,
        name: row.name || undefined,
        created_at: toISOString(row.created_at)!,
        updated_at: toISOString(row.updated_at)!,
        roles: roles.map(r => r.id),
      });
    }
    return users;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<void> {
    const user = await this.getUser(id);
    if (!user) {
      throw new ErrNotFound('user', id);
    }

    const allowedUpdates = ['name'];
    const setClauses: string[] = ['updated_at = datetime(\'now\')'];
    const params: any[] = [];

    for (const key of Object.keys(updates)) {
      if (!allowedUpdates.includes(key)) {
        throw new ErrValidation(key, 'Invalid field for update');
      }
      setClauses.push(`${key} = ?`);
      params.push(updates[key]);
    }

    if (setClauses.length === 1) { // Only updated_at
      return;
    }

    params.push(id);
    const updateSql = `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`;

    try {
      const result = await this.db.run(updateSql, params);
      if (result.changes === 0) {
        throw new ErrNotFound('user', id);
      }
    } catch (e: any) {
      throw new Error(`Failed to update user: ${e.message}`);
    }
  }

  async deleteUser(id: string): Promise<void> {
    const user = await this.getUser(id);
    if (!user) {
      throw new ErrNotFound('user', id);
    }
    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`DELETE FROM users WHERE id = ?`, id);
        const entityRow = await tx.get(`SELECT id FROM entities WHERE kind_id = 3 AND native_id = ?`, id) as { id: number } | undefined;
        if (entityRow) {
          await tx.run(`DELETE FROM user_to_role WHERE user_entity_id = ?`, entityRow.id);
          await tx.run(`DELETE FROM entities WHERE id = ?`, entityRow.id);
        }
      });
    } catch (e: any) {
      throw new Error(`Failed to delete user: ${e.message}`);
    }
  }

  // --- Roles ---

  async createRole(role: Role): Promise<void> {
    if (!role.id) throw new ErrValidation('id', 'Role ID is required');
    if (!role.name) throw new ErrValidation('name', 'Role name is required');

    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`
          INSERT INTO roles (id, name, description, instructions, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `, role.id, role.name, role.description || '', role.instructions || '');
        await tx.run(`
          INSERT OR IGNORE INTO entities (kind_id, native_id) VALUES (4, ?)
        `, role.id);
      });
    } catch (e: any) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        throw new ErrConflict('role', role.id);
      }
      throw new Error(`Failed to create role: ${e.message}`);
    }
  }

  async getRole(id: string): Promise<Role | undefined> {
    const row = await this.db.get(`SELECT id, name, description, instructions, created_at, updated_at FROM roles WHERE id = ?`, id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      instructions: row.instructions || undefined,
      created_at: toISOString(row.created_at)!,
      updated_at: toISOString(row.updated_at)!,
    };
  }

  async listRoles(): Promise<Role[]> {
    const rows = await this.db.query(`SELECT id, name, description, instructions, created_at, updated_at FROM roles ORDER BY id ASC`) as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      instructions: row.instructions || undefined,
      created_at: toISOString(row.created_at)!,
      updated_at: toISOString(row.updated_at)!,
    }));
  }

  async updateRole(id: string, updates: Partial<Role>): Promise<void> {
    const role = await this.getRole(id);
    if (!role) {
      throw new ErrNotFound('role', id);
    }

    const allowedUpdates = ['name', 'description', 'instructions'];
    const setClauses: string[] = ['updated_at = datetime(\'now\')'];
    const params: any[] = [];

    for (const key of Object.keys(updates)) {
      if (!allowedUpdates.includes(key)) {
        throw new ErrValidation(key, 'Invalid field for update');
      }
      setClauses.push(`${key} = ?`);
      params.push(updates[key]);
    }

    if (setClauses.length === 1) { // Only updated_at
      return;
    }

    params.push(id);
    const updateSql = `UPDATE roles SET ${setClauses.join(', ')} WHERE id = ?`;

    try {
      const result = await this.db.run(updateSql, params);
      if (result.changes === 0) {
        throw new ErrNotFound('role', id);
      }
    } catch (e: any) {
      throw new Error(`Failed to update role: ${e.message}`);
    }
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.getRole(id);
    if (!role) {
      throw new ErrNotFound('role', id);
    }
    try {
      await this.db.transaction(async (tx) => {
        await tx.run(`DELETE FROM roles WHERE id = ?`, id);
        const entityRow = await tx.get(`SELECT id FROM entities WHERE kind_id = 4 AND native_id = ?`, id) as { id: number } | undefined;
        if (entityRow) {
          await tx.run(`DELETE FROM user_to_role WHERE role_entity_id = ?`, entityRow.id);
          await tx.run(`DELETE FROM entities WHERE id = ?`, entityRow.id);
        }
      });
    } catch (e: any) {
      throw new Error(`Failed to delete role: ${e.message}`);
    }
  }

  // --- User-Role assignment ---

  async assignRole(userID: string, roleID: string): Promise<void> {
    const user = await this.getUser(userID);
    if (!user) throw new ErrNotFound('user', userID);
    const role = await this.getRole(roleID);
    if (!role) throw new ErrNotFound('role', roleID);

    try {
      const userEntity = await this.db.get(`SELECT id FROM entities WHERE kind_id = 3 AND native_id = ?`, userID) as { id: number };
      const roleEntity = await this.db.get(`SELECT id FROM entities WHERE kind_id = 4 AND native_id = ?`, roleID) as { id: number };

      if (!userEntity || !roleEntity) {
        throw new Error('User or Role entity not found, internal inconsistency.');
      }

      await this.db.run(`
        INSERT OR IGNORE INTO user_to_role (user_entity_id, role_entity_id, created_at)
        VALUES (?, ?, datetime('now'))
      `, userEntity.id, roleEntity.id);
    } catch (e: any) {
      if (e.message && e.message.includes('UNIQUE constraint failed')) {
        throw new ErrConflict('user_role_assignment', `${userID}:${roleID}`);
      }
      throw new Error(`Failed to assign role: ${e.message}`);
    }
  }

  async unassignRole(userID: string, roleID: string): Promise<void> {
    const user = await this.getUser(userID);
    if (!user) throw new ErrNotFound('user', userID);
    const role = await this.getRole(roleID);
    if (!role) throw new ErrNotFound('role', roleID);

    try {
      const userEntity = await this.db.get(`SELECT id FROM entities WHERE kind_id = 3 AND native_id = ?`, userID) as { id: number } | undefined;
      const roleEntity = await this.db.get(`SELECT id FROM entities WHERE kind_id = 4 AND native_id = ?`, roleID) as { id: number } | undefined;

      if (!userEntity || !roleEntity) {
        return; // If entities don't exist, assignment can't exist
      }

      await this.db.run(`
        DELETE FROM user_to_role WHERE user_entity_id = ? AND role_entity_id = ?
      `, userEntity.id, roleEntity.id);
    } catch (e: any) {
      throw new Error(`Failed to unassign role: ${e.message}`);
    }
  }

  async getUserRoles(userID: string): Promise<Role[]> {
    const rows = await this.db.query(`
      SELECT r.id, r.name, r.description, r.instructions, r.created_at, r.updated_at
      FROM roles r
      JOIN entities re ON r.id = re.native_id AND re.kind_id = 4
      JOIN user_to_role utr ON re.id = utr.role_entity_id
      JOIN entities ue ON utr.user_entity_id = ue.id
      WHERE ue.kind_id = 3 AND ue.native_id = ?
      ORDER BY r.name ASC
    `, userID) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      instructions: row.instructions || undefined,
      created_at: toISOString(row.created_at)!,
      updated_at: toISOString(row.updated_at)!,
    }));
  }

  async getRoleUsers(roleID: string): Promise<User[]> {
    const rows = await this.db.query(`
      SELECT u.id, u.name, u.created_at, u.updated_at
      FROM users u
      JOIN entities ue ON u.id = ue.native_id AND ue.kind_id = 3
      JOIN user_to_role utr ON ue.id = utr.user_entity_id
      JOIN entities re ON utr.role_entity_id = re.id
      WHERE re.kind_id = 4 AND re.native_id = ?
      ORDER BY u.id ASC
    `, roleID) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name || undefined,
      created_at: toISOString(row.created_at)!,
      updated_at: toISOString(row.updated_at)!,
    }));
  }

  // --- Transactions ---

  async runInTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    // SQLite transactions are connection-scoped. Since SqliteStorage uses a single
    // DB connection (this.db), all operations are automatically part of any active
    // transaction. The DB.transaction() method manages BEGIN/COMMIT/ROLLBACK and
    // uses savepoints for nesting (via transactionDepth).
    //
    // We pass `this` (SqliteStorage) as the Transaction because:
    // 1. SqliteStorage implements the Transaction interface
    // 2. All its methods use this.db, which is inside the active transaction
    // 3. If any operation fails, the outer ROLLBACK undoes ALL changes since BEGIN,
    //    including any that were in released savepoints
    //
    // Methods that internally call this.db.transaction() create savepoints, but
    // the atomicity is still guaranteed by the outermost transaction boundary.
    return this.db.transaction(async () => {
      return fn(this);
    });
  }
}