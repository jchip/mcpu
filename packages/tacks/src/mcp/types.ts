import { z } from 'zod';
import { Status, IssueType, DependencyType, Project, Issue, Template, User, Role, Comment, Event, Statistics, BlockedIssue } from '../types/index.js';

// --- Input Data Schemas (from fyntacks/internal/mcp/tools.go) ---

export const ProjectDataSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  prefix: z.string().optional(),
}).partial();

export const IssueDataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(Object.values(Status)).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  issue_type: z.enum(Object.values(IssueType)).optional(),
  assignee: z.string().optional(),
  due_date: z.string().optional(), // RFC3339 format
  labels: z.array(z.string()).optional(),
  template: z.string().optional(),
  reason: z.string().optional(), // For close command
  design: z.string().optional(),
  acceptance_criteria: z.string().optional(),
  notes: z.string().optional(),
  estimated_minutes: z.number().int().min(0).optional(),
  external_ref: z.string().optional(),
}).partial();

export const DependencyDataSchema = z.object({
  target: z.string(),
  type: z.enum(Object.values(DependencyType)).optional().default(DependencyType.Blocks),
}).partial();

export const CommentDataSchema = z.object({
  text: z.string(),
});

export const LabelDataSchema = z.object({
  name: z.string(),
});

export const TemplateDataSchema = z.object({
  issue_type: z.enum(Object.values(IssueType)).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  labels: z.array(z.string()).optional(),
  design: z.string().optional(),
  acceptance_criteria: z.string().optional(),
}).partial();

export const UserDataSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
}).partial();

export const RoleDataSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
}).partial();

export const FilterDataSchema = z.object({
  status: z.enum(Object.values(Status)).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  issue_type: z.enum(Object.values(IssueType)).optional(),
  assignee: z.string().optional(),
  query: z.string().optional(), // For title search
  overdue: z.boolean().optional(),
  dependency_type: z.enum(Object.values(DependencyType)).optional(),
  limit: z.number().int().positive().optional(),
}).partial();

export const InputSchema = z.object({
  cmd: z.enum(['create', 'get', 'list', 'update', 'delete', 'close', 'add', 'remove', 'assign', 'unassign', 'stats', 'queue', 'ready']),
  type: z.enum(['project', 'issue', 'dependency', 'dependent', 'label', 'comment', 'template', 'user', 'role', 'event']),

  proj: z.string(), // Project ID (use "" if N/A)
  id: z.string().optional(),   // Entity ID (issue_id, user_id, role_id, template name, etc.)

  project: ProjectDataSchema.optional(),
  issue: IssueDataSchema.optional(),
  template: TemplateDataSchema.optional(),
  user: UserDataSchema.optional(),
  role: RoleDataSchema.optional(),
  dependency: DependencyDataSchema.optional(),
  comment: CommentDataSchema.optional(),
  label: LabelDataSchema.optional(),

  queue_type: z.enum(['ready', 'blocked']).optional().default('ready'),

  filter: FilterDataSchema.optional(),

  limit: z.number().int().positive().optional(),
}).passthrough(); // passthrough allows unknown keys which can be useful for flexible inputs

export type Input = z.infer<typeof InputSchema>;

// --- Output Data (from fyntacks/internal/mcp/tools.go) ---

export interface Output {
  projects?: Project[];
  issues?: Issue[];
  templates?: Template[];
  users?: User[];
  roles?: Role[];
  dependencies?: Issue[]; // In Go this was types.Issue
  blocked?: BlockedIssue[];
  labels?: string[];
  comments?: Comment[];
  events?: Event[];
  stats?: Statistics;
  success?: boolean;
}
