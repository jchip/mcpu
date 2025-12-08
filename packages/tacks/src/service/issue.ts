import { randomUUID } from 'crypto';
import { Issue, Project, Template, Status, IssueType } from '../types/index.js';
import { Storage, ErrNotFound, ErrValidation, Transaction } from '../storage/index.js';

// CreateIssueInput contains all fields for creating an issue with optional template.
export interface CreateIssueInput {
  id?: string; // Optional explicit ID (empty = auto-generate)
  title: string; // Required
  description?: string; // Optional
  priority?: number; // undefined = use template/default (2)
  issue_type?: IssueType; // undefined = use template/default (task)
  assignee?: string; // Optional
  due_date?: string; // Optional due date in ISO format
  labels?: string[]; // Optional, merged with template labels
  external_ref?: string; // Optional external reference
  template?: string; // Optional template name to apply
}

// IssueService provides shared business logic for issue operations.
export class IssueService {
  private store: Storage;

  constructor(store: Storage) {
    this.store = store;
  }

  // Create creates a new issue, optionally applying a template first.
  // The flow is:
  //  1. Build base issue with defaults
  //  2. Apply template if specified (may set description, priority, type, labels)
  //  3. Override with any explicit input fields
  //  4. Auto-generate ID if not provided and project has a prefix
  //  5. Create issue in storage
  //  6. Add labels (from input + template)
  //  7. Return fresh issue with all fields populated
  async create(projectID: string, input: CreateIssueInput, actor: string): Promise<Issue> {
    const now = new Date();

    // 1. Build base issue with defaults
    const issue: Issue = {
      id: input.id || '',
      project_id: projectID,
      title: input.title,
      description: input.description || '',
      design: '', // Defaults from Go
      acceptance_criteria: '', // Defaults from Go
      notes: '', // Defaults from Go
      status: Status.Open,
      priority: 2, // Default priority
      issue_type: IssueType.Task, // Default issue type
      assignee: input.assignee,
      estimated_minutes: undefined,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      closed_at: undefined,
      due_date: input.due_date,
      external_ref: input.external_ref,
      labels: input.labels || [],
    };

    // 2. Apply template if specified
    if (input.template) {
      const template = await this.store.getTemplate(projectID, input.template);
      if (!template) {
        throw new ErrNotFound('template', input.template);
      }
      this.applyTemplateToIssue(issue, template);
    }

    // 3. Override with any explicit input fields (input takes precedence over template/defaults)
    if (input.priority !== undefined) {
      issue.priority = input.priority;
    }
    if (input.issue_type) {
      issue.issue_type = input.issue_type;
    }
    if (input.assignee) {
      issue.assignee = input.assignee;
    }
    if (input.due_date) {
      issue.due_date = input.due_date;
    }
    if (input.description) {
        issue.description = input.description;
    }

    // 4. Auto-generate ID if not provided and project has a prefix
    if (!issue.id) {
      const project = await this.store.getProject(projectID);
      if (project?.prefix) {
        const nextID = await this.store.getNextIssueID(projectID);
        issue.id = `${project.prefix}-${nextID}`;
      } else {
        // Fallback if no prefix: generate UUID-based ID
        issue.id = `ISS-${randomUUID().split('-')[0].toUpperCase()}`;
      }
    }

    // Ensure labels are unique
    issue.labels = Array.from(new Set(issue.labels));

    // 5. Create issue in storage (this needs to be in a transaction to handle labels)
    await this.store.runInTransaction(async (tx) => {
      await tx.createIssue(projectID, issue, actor);

      // 6. Add labels (from input + template)
      for (const label of issue.labels || []) {
        await tx.addLabel(projectID, issue.id, label, actor);
      }
    });


    // 7. Return fresh issue with all fields populated
    const createdIssue = await this.store.getIssue(projectID, issue.id);
    if (!createdIssue) {
        throw new Error('Failed to retrieve created issue.');
    }
    return createdIssue;
  }

  // Helper function to apply template fields to an issue
  private applyTemplateToIssue(issue: Issue, template: Template): void {
    if (!issue.description && template.description) {
      issue.description = template.description;
    }
    if (issue.issue_type === IssueType.Task && template.issue_type) {
      issue.issue_type = template.issue_type;
    }
    if (issue.priority === 2 && template.priority && template.priority !== 0) { // Go default is 2, template can override
      issue.priority = template.priority;
    }
    if (!issue.design && template.design) {
      issue.design = template.design;
    }
    if (!issue.acceptance_criteria && template.acceptance_criteria) {
      issue.acceptance_criteria = template.acceptance_criteria;
    }
    // Labels are additive
    if (template.labels && template.labels.length > 0) {
      const existingLabels = new Set(issue.labels);
      for (const label of template.labels) {
        if (!existingLabels.has(label)) {
          issue.labels?.push(label);
        }
      }
    }
  }
}

