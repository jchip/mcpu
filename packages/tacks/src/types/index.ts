export interface Project {
  id: string;
  name: string;
  description?: string;
  prefix?: string;
  next_id?: number;
  created_at: string;
}

export const MaxTitleLength = 500;
export const MinPriority = 0;
export const MaxPriority = 4;

export const Status = {
  Draft: "draft",
  Planning: "planning",
  Approved: "approved",
  ReadyToStart: "ready_to_start",
  Open: "open",
  InProgress: "in_progress",
  InReview: "in_review",
  Blocked: "blocked",
  Done: "done",
  Released: "released",
  Closed: "closed",
  WontDo: "wont_do",
} as const;
export type Status = typeof Status[keyof typeof Status];

export const IssueType = {
  Bug: "bug",
  Feature: "feature",
  Task: "task",
  Epic: "epic",
  Chore: "chore",
  Design: "design",
} as const;
export type IssueType = typeof IssueType[keyof typeof IssueType];

export interface Issue {
  id: string;
  project_id: string;
  content_hash?: string;
  title: string;
  description: string;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
  status: Status;
  priority: number;
  issue_type: IssueType;
  assignee?: string;
  estimated_minutes?: number;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  due_date?: string;
  external_ref?: string;
  // Compaction fields
  compaction_level?: number;
  compacted_at?: string;
  compacted_at_commit?: string;
  original_size?: number;
  // Denormalized fields
  labels?: string[];
  dependencies?: Dependency[];
  comments?: Comment[];
}

export const DependencyType = {
  Blocks: "blocks",
  Related: "related",
  ParentChild: "parent-child",
  DiscoveredFrom: "discovered-from",
  Duplicates: "duplicates",
  Clones: "clones",
  Causes: "causes",
} as const;
export type DependencyType = typeof DependencyType[keyof typeof DependencyType];

export interface Dependency {
  issue_id: string;
  depends_on_id: string;
  type: DependencyType;
  created_at: string;
  created_by: string;
}

export interface Comment {
  id: number;
  issue_id: string;
  author: string;
  text: string;
  created_at: string;
}

export interface Label {
  issue_id: string;
  label: string;
}

export interface Template {
  name: string;
  project_id?: string;
  description?: string;
  issue_type?: IssueType;
  priority?: number;
  labels?: string[];
  design?: string;
  acceptance_criteria?: string;
  is_built_in?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface User {
  id: string;
  name?: string;
  roles?: string[];
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: number;
  issue_id: string;
  event_type: string;
  actor: string;
  old_value?: string;
  new_value?: string;
  comment?: string;
  created_at: string;
}

export interface Statistics {
  total_issues: number;
  open_issues: number;
  in_progress_issues: number;
  closed_issues: number;
  blocked_issues: number;
  ready_issues: number;
  epics_eligible_for_closure: number;
  average_lead_time_hours: number;
}

// IssueFilter is defined in storage/index.ts with full filter options

export interface BlockedIssue extends Issue {
  blocked_by_count: number;
  blocked_by: string[];
}