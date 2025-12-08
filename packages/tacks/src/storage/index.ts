import {
  Project, Issue, Dependency, Label, Comment, Template, User, Role, Event, Statistics,
  Status, IssueType, DependencyType, BlockedIssue
} from '../types/index.js';

// Custom Error Types
export class ErrNotFound extends Error {
  resource: string;
  id: string;
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'ErrNotFound';
    this.resource = resource;
    this.id = id;
  }
}

export class ErrConflict extends Error {
  resource: string;
  id: string;
  constructor(resource: string, id: string) {
    super(`${resource} already exists: ${id}`);
    this.name = 'ErrConflict';
    this.resource = resource;
    this.id = id;
  }
}

export class ErrValidation extends Error {
  field: string;
  message: string;
  constructor(field: string, message: string) {
    super(`validation error on ${field}: ${message}`);
    this.name = 'ErrValidation';
    this.field = field;
    this.message = message;
  }
}

export class ErrCycle extends Error {
  from: string;
  to: string;
  constructor(from: string, to: string) {
    super(`adding dependency from ${from} to ${to} would create a cycle`);
    this.name = 'ErrCycle';
    this.from = from;
    this.to = to;
  }
}

export class ErrAssigned extends Error {
  issue_id: string;
  assigned_to: string;
  constructor(issue_id: string, assigned_to: string) {
    super(`${issue_id} already assigned to ${assigned_to}`);
    this.name = 'ErrAssigned';
    this.issue_id = issue_id;
    this.assigned_to = assigned_to;
  }
}

// Replicate Go's IssueFilter and WorkFilter
export interface IssueFilter {
  status?: Status;
  priority?: number;
  issue_type?: IssueType;
  assignee?: string;
  labels?: string[]; // AND semantics
  labels_any?: string[]; // OR semantics
  title_search?: string;
  ids?: string[];
  limit?: number;
  offset?: number;
  overdue?: boolean;
  title_contains?: string;
  description_contains?: string;
  notes_contains?: string;
  created_after?: string;
  created_before?: string;
  updated_after?: string;
  updated_before?: string;
  closed_after?: string;
  closed_before?: string;
  empty_description?: boolean;
  no_assignee?: boolean;
  no_labels?: boolean;
  priority_min?: number;
  priority_max?: number;
}

export type SortPolicy = "hybrid" | "priority" | "oldest";

export interface WorkFilter {
  status?: Status;
  priority?: number;
  assignee?: string;
  labels?: string[];
  labels_any?: string[];
  limit?: number;
  sort_policy?: SortPolicy;
}

export interface EpicStatus {
  epic: Issue;
  total_children: number;
  closed_children: number;
  eligible_for_close: boolean;
}

export interface CompactionCandidate {
  issue_id: string;
  closed_at: string;
  original_size: number;
  estimated_size: number;
  dependent_count: number;
}

export interface IssueWithDependencyMetadata extends Issue {
  dependency_type: DependencyType;
}

export interface IssueWithCounts extends Issue {
  dependency_count: number;
  dependent_count: number;
}


// Storage Interface
export interface Storage {
  // Projects
  createProject(project: Project): Promise<void>;
  getProject(id: string): Promise<Project | undefined>;
  listProjects(): Promise<Project[]>;
  updateProject(id: string, updates: Partial<Project>): Promise<void>;
  deleteProject(id: string): Promise<void>;
  getNextIssueID(projectID: string): Promise<number>;

  // Issues
  createIssue(projectID: string, issue: Issue, actor: string): Promise<void>;
  getIssue(projectID: string, id: string): Promise<Issue | undefined>;
  getIssueByExternalRef(projectID: string, externalRef: string): Promise<Issue | undefined>;
  updateIssue(projectID: string, id: string, updates: Partial<Issue>, actor: string): Promise<void>;
  closeIssue(projectID: string, id: string, reason: string, actor: string): Promise<void>;
  reopenIssue(projectID: string, id: string, actor: string): Promise<void>;
  deleteIssue(projectID: string, id: string): Promise<void>;
  searchIssues(projectID: string, query: string, filter: IssueFilter): Promise<Issue[]>;

  // Dependencies
  addDependency(projectID: string, dep: Dependency, actor: string): Promise<void>;
  removeDependency(projectID: string, issueID: string, dependsOnID: string, actor: string): Promise<void>;
  getDependencies(projectID: string, issueID: string): Promise<Issue[]>;
  getDependents(projectID: string, issueID: string): Promise<Issue[]>;
  getDependentsFiltered(projectID: string, issueID: string, depType?: DependencyType, limit?: number): Promise<Issue[]>;
  getDependencyRecords(projectID: string, issueID: string): Promise<Dependency[]>;
  getDependencyCounts(projectID: string, issueIDs: string[]): Promise<Map<string, { dependency_count: number, dependent_count: number }>>;
  // getDependencyTree(projectID: string, issueID: string, maxDepth: number, reverse: boolean): Promise<TreeNode[]>;
  // detectCycles(projectID: string): Promise<Issue[][]>;

  // Labels
  addLabel(projectID: string, issueID: string, label: string, actor: string): Promise<void>;
  removeLabel(projectID: string, issueID: string, label: string, actor: string): Promise<void>;
  getLabels(projectID: string, issueID: string): Promise<string[]>;
  getLabelsForIssues(projectID: string, issueIDs: string[]): Promise<Map<string, string[]>>;

  // Ready Work & Blocking
  getReadyWork(projectID: string, filter: WorkFilter): Promise<Issue[]>;
  getBlockedIssues(projectID: string): Promise<BlockedIssue[]>;
  getEpicsEligibleForClosure(projectID: string): Promise<EpicStatus[]>;

  // Events
  getEvents(projectID: string, issueID: string, limit: number): Promise<Event[]>;

  // Comments
  addComment(projectID: string, issueID: string, author: string, text: string): Promise<Comment>;
  getComments(projectID: string, issueID: string): Promise<Comment[]>;

  // Statistics
  getStatistics(projectID: string): Promise<Statistics>;

  // Config (per-project settings)
  setConfig(projectID: string, key: string, value: string): Promise<void>;
  getConfig(projectID: string, key: string): Promise<string | undefined>;

  // Compaction
  getTier1Candidates(projectID: string): Promise<CompactionCandidate[]>;
  getTier2Candidates(projectID: string): Promise<CompactionCandidate[]>;
  checkCompactionEligibility(projectID: string, issueID: string, tier: number): Promise<{ eligible: boolean, reason: string }>;
  applyCompaction(projectID: string, issueID: string, level: number, originalSize: number, compressedSize: number): Promise<void>;
  // saveCompactionSnapshot(projectID: string, issueID: string, level: number, snapshotJSON: Uint8Array): Promise<void>;
  // getCompactionSnapshot(projectID: string, issueID: string, level: number): Promise<Uint8Array | undefined>;

  // Export/Import
  getAllDependencyRecords(projectID: string): Promise<Map<string, Dependency[]>>;
  getAllComments(projectID: string): Promise<Map<string, Comment[]>>;
  commentExists(projectID: string, issueID: string, author: string, text: string): Promise<boolean>;

  // Templates
  createTemplate(projectID: string, template: Template): Promise<void>;
  getTemplate(projectID: string, name: string): Promise<Template | undefined>;
  listTemplates(projectID: string): Promise<Template[]>;
  updateTemplate(projectID: string, name: string, updates: Partial<Template>): Promise<void>;
  deleteTemplate(projectID: string, name: string): Promise<void>;

  // Users
  createUser(user: User): Promise<void>;
  getUser(id: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  updateUser(id: string, updates: Partial<User>): Promise<void>;
  deleteUser(id: string): Promise<void>;

  // Roles
  createRole(role: Role): Promise<void>;
  getRole(id: string): Promise<Role | undefined>;
  listRoles(): Promise<Role[]>;
  updateRole(id: string, updates: Partial<Role>): Promise<void>;
  deleteRole(id: string): Promise<void>;

  // User-Role assignment (via GER entity IDs)
  assignRole(userID: string, roleID: string): Promise<void>;
  unassignRole(userID: string, roleID: string): Promise<void>;
  getUserRoles(userID: string): Promise<Role[]>;
  getRoleUsers(roleID: string): Promise<User[]>;

  // Transactions
  runInTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;

  // Lifecycle
  close(): Promise<void>;
}

// Transaction interface (subset of Storage for transactional operations)
export interface Transaction {
  createIssue(projectID: string, issue: Issue, actor: string): Promise<void>;
  updateIssue(projectID: string, id: string, updates: Partial<Issue>, actor: string): Promise<void>;
  closeIssue(projectID: string, id: string, reason: string, actor: string): Promise<void>;
  deleteIssue(projectID: string, id: string): Promise<void>;
  getIssue(projectID: string, id: string): Promise<Issue | undefined>;
  addDependency(projectID: string, dep: Dependency, actor: string): Promise<void>;
  removeDependency(projectID: string, issueID: string, dependsOnID: string, actor: string): Promise<void>;
  addLabel(projectID: string, issueID: string, label: string, actor: string): Promise<void>;
  removeLabel(projectID: string, issueID: string, label: string, actor: string): Promise<void>;
  setConfig(projectID: string, key: string, value: string): Promise<void>;
  getConfig(projectID: string, key: string): Promise<string | undefined>;
}
