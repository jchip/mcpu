import { Server as MCP } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequest, CallToolResult, ServerRequest, ServerNotification, ServerResult, CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Storage, ErrNotFound } from '../storage/index.js';
import { IssueService, CreateIssueInput } from '../service/issue.js';
import { Project, Issue, Dependency, Label, Comment, Template, User, Role, Event, Status, IssueType, DependencyType } from '../types/index.js';
import { Input, Output, InputSchema } from './types.js';

export class TacksMcpServer {
  private mcp: MCP;
  private store: Storage;
  private issueService: IssueService;

  constructor(store: Storage) {
    this.store = store;
    this.issueService = new IssueService(store);
    this.mcp = new MCP<ServerRequest, ServerNotification, ServerResult>( // Explicitly provide generic types
      { name: 'tacks', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.registerTools();
  }

  private registerTools() {
    console.log('--- Registering Tools ---');

    this.mcp.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "tm",
            description: "Task Management Tool",
            inputSchema: {
              type: "object",
              properties: {
                cmd: { type: "string", enum: ['create', 'get', 'list', 'update', 'delete', 'close', 'add', 'remove', 'assign', 'unassign', 'stats', 'queue', 'ready'] },
                type: { type: "string", enum: ['project', 'issue', 'dependency', 'dependent', 'label', 'comment', 'template', 'user', 'role', 'event'] },
                proj: { type: "string", description: 'Project ID (use "" if N/A)' },
                id: { type: "string" },
                project: { type: "object" },
                issue: { type: "object" },
                template: { type: "object" },
                user: { type: "object" },
                role: { type: "object" },
                dependency: { type: "object" },
                comment: { type: "object" },
                label: { type: "object" },
                filter: { type: "object" },
                limit: { type: "number" },
                queue_type: { type: "string" }
              },
              required: ["cmd", "type", "proj"]
            }
          }
        ]
      };
    });

    this.mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "tm") {
        const input = request.params.arguments as Input;
        return this.handleTasks(request, input);
      }
      throw new Error(`Tool not found: ${request.params.name}`);
    });
  }

  private async handleTasks(req: CallToolRequest, input: Input): Promise<CallToolResult> {
    try {
      // Validate input using Zod
      const parsedInput = InputSchema.parse(input);

      let output: Output = {};

      switch (parsedInput.type) {
        case 'project':
          output = await this.handleProject(parsedInput);
          break;
        case 'issue':
          output = await this.handleIssue(parsedInput);
          break;
        case 'dependency':
          output = await this.handleDependency(parsedInput);
          break;
        case 'dependent':
          output = await this.handleDependent(parsedInput);
          break;
        case 'label':
          output = await this.handleLabel(parsedInput);
          break;
        case 'comment':
          output = await this.handleComment(parsedInput);
          break;
        case 'template':
          output = await this.handleTemplate(parsedInput);
          break;
        case 'user':
          output = await this.handleUser(parsedInput);
          break;
        case 'role':
          output = await this.handleRole(parsedInput);
          break;
        case 'event':
          output = await this.handleEvent(parsedInput);
          break;
        default:
          throw new Error(`Unknown entity type: ${parsedInput.type}`);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2)
          }
        ]
      };
    } catch (error: any) {
      console.error('MCP Tool Error:', error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleProject(input: Input): Promise<Output> {
    const projId = input.proj || input.id; // Allow 'id' for project ops if 'proj' is missing
    if (!projId && input.cmd !== 'list') throw new Error('Project ID is required.');

    switch (input.cmd) {
      case 'create':
        if (!input.project) throw new Error('Project data required for create.');
        const newProject: Project = {
          id: projId!,
          name: input.project.name!,
          description: input.project.description,
          prefix: input.project.prefix,
          created_at: new Date().toISOString(), // Will be overwritten by store
        };
        await this.store.createProject(newProject);
        const createdProject = await this.store.getProject(projId!);
        return { projects: createdProject ? [createdProject] : [] };

      case 'get':
        const project = await this.store.getProject(projId!);
        return { projects: project ? [project] : [] };

      case 'list':
        const projects = await this.store.listProjects();
        return { projects };

      case 'update':
        if (!input.project) throw new Error('Project data required for update.');
        await this.store.updateProject(projId!, input.project);
        const updatedProject = await this.store.getProject(projId!);
        return { projects: updatedProject ? [updatedProject] : [] };

      case 'stats':
        const stats = await this.store.getStatistics(projId!);
        return { stats };

      case 'delete':
        await this.store.deleteProject(projId!);
        return { success: true };

      default:
        throw new Error(`Unknown command for project: ${input.cmd}`);
    }
  }

  private async handleIssue(input: Input): Promise<Output> {
    if (!input.proj) throw new Error('Project ID is required for issue operations.');
    const issueId = input.id;

    switch (input.cmd) {
      case 'create':
        if (!input.issue) throw new Error('Issue data required for create.');
        const createInput: CreateIssueInput = {
          title: input.issue.title!,
          description: input.issue.description,
          priority: input.issue.priority,
          issue_type: input.issue.issue_type as IssueType,
          assignee: input.issue.assignee,
          due_date: input.issue.due_date,
          labels: input.issue.labels,
          template: input.issue.template,
          external_ref: input.issue.external_ref,
        };
        const createdIssue = await this.issueService.create(input.proj, createInput, input.user?.id || 'agent');
        return { issues: [createdIssue] };

      case 'get':
        if (!issueId) throw new Error('Issue ID is required for get.');
        const issue = await this.store.getIssue(input.proj, issueId);
        return { issues: issue ? [issue] : [] };

      case 'list':
        const filter = {
          limit: input.filter?.limit,
          offset: 0, // Go's filter has offset, but MCP input doesn't explicitly. Default to 0.
          status: input.filter?.status,
          priority: input.filter?.priority,
          issue_type: input.filter?.issue_type,
          assignee: input.filter?.assignee,
          title_search: input.filter?.query,
          overdue: input.filter?.overdue,
          // Other filter properties from Go need mapping if MCP input expands
        };
        const issues = await this.store.searchIssues(input.proj, input.filter?.query || '', filter);
        return { issues };

      case 'update':
        if (!issueId) throw new Error('Issue ID is required for update.');
        if (!input.issue) throw new Error('Issue data required for update.');
        await this.store.updateIssue(input.proj, issueId, input.issue, input.user?.id || 'agent');
        const updatedIssue = await this.store.getIssue(input.proj, issueId);
        return { issues: updatedIssue ? [updatedIssue] : [] };

      case 'close':
        if (!issueId) throw new Error('Issue ID is required for close.');
        await this.store.closeIssue(input.proj, issueId, input.issue?.reason || 'closed by agent', input.user?.id || 'agent');
        const closedIssue = await this.store.getIssue(input.proj, issueId);
        return { issues: closedIssue ? [closedIssue] : [] };

      case 'queue':
      case 'ready':
        const workFilter = {
          status: Status.Open, // Go's default
          limit: input.filter?.limit,
          priority: input.filter?.priority,
          assignee: input.filter?.assignee,
          labels: input.filter?.labels, // Assuming labels can be passed through filter
          labels_any: input.filter?.labels_any,
        };
        if (input.queue_type === 'blocked') {
          const blockedIssues = await this.store.getBlockedIssues(input.proj);
          return { blocked: blockedIssues };
        }
        const readyIssues = await this.store.getReadyWork(input.proj, workFilter);
        return { issues: readyIssues };

      case 'delete':
        if (!issueId) throw new Error('Issue ID is required for delete.');
        await this.store.deleteIssue(input.proj, issueId);
        return { success: true };

      default:
        throw new Error(`Unknown command for issue: ${input.cmd}`);
    }
  }

  private async handleDependency(input: Input): Promise<Output> {
    if (!input.proj) throw new Error('Project ID is required.');
    if (!input.id) throw new Error('Issue ID (source) is required.'); // Go's input.ID is issue_id
    if (!input.dependency) throw new Error('Dependency data required.');

    const dep: Dependency = {
      issue_id: input.id,
      depends_on_id: input.dependency.target!,
      type: input.dependency.type || DependencyType.Blocks, // Default from Go
      created_at: new Date().toISOString(),
      created_by: input.user?.id || 'agent',
    };

    switch (input.cmd) {
      case 'add':
        await this.store.addDependency(input.proj, dep, dep.created_by);
        return { success: true };

      case 'remove':
        await this.store.removeDependency(input.proj, dep.issue_id, dep.depends_on_id, dep.created_by);
        return { success: true };

      case 'get':
      case 'list':
        const dependencies = await this.store.getDependencies(input.proj, dep.issue_id);
        return { dependencies };

      default:
        throw new Error(`Unknown command for dependency: ${input.cmd}`);
    }
  }

  private async handleDependent(input: Input): Promise<Output> {
    if (!input.proj) throw new Error('Project ID is required.');
    if (!input.id) throw new Error('Issue ID is required.');

    switch (input.cmd) {
      case 'get':
      case 'list':
        const dependents = await this.store.getDependentsFiltered(
          input.proj,
          input.id,
          input.filter?.dependency_type as DependencyType,
          input.filter?.limit
        );
        return { dependencies: dependents };
      default:
        throw new Error(`Unknown command for dependent: ${input.cmd}`);
    }
  }

  private async handleLabel(input: Input): Promise<Output> {
    if (!input.proj) throw new Error('Project ID is required.');
    if (!input.id) throw new Error('Issue ID is required.');
    if (!input.label) throw new Error('Label data required.');

    switch (input.cmd) {
      case 'add':
        await this.store.addLabel(input.proj, input.id, input.label.name!, input.user?.id || 'agent');
        const labelsAdded = await this.store.getLabels(input.proj, input.id);
        return { labels: labelsAdded };

      case 'remove':
        await this.store.removeLabel(input.proj, input.id, input.label.name!, input.user?.id || 'agent');
        const labelsRemoved = await this.store.getLabels(input.proj, input.id);
        return { labels: labelsRemoved };

      default:
        throw new Error(`Unknown command for label: ${input.cmd}`);
    }
  }

  private async handleComment(input: Input): Promise<Output> {
    if (!input.proj) throw new Error('Project ID is required.');
    if (!input.id) throw new Error('Issue ID is required.');
    if (!input.comment) throw new Error('Comment data required.');

    switch (input.cmd) {
      case 'add':
        const addedComment = await this.store.addComment(input.proj, input.id, input.user?.id || 'agent', input.comment.text!);
        return { comments: [addedComment] };

      case 'list':
        const comments = await this.store.getComments(input.proj, input.id);
        return { comments };

      default:
        throw new Error(`Unknown command for comment: ${input.cmd}`);
    }
  }

  private async handleTemplate(input: Input): Promise<Output> {
    if (!input.proj) throw new Error('Project ID is required.');
    const templateName = input.id;

    switch (input.cmd) {
      case 'create':
        if (!templateName) throw new Error('Template name is required.');
        if (!input.template) throw new Error('Template data required.');
        const newTemplate: Template = {
          id: templateName, // Templates have an id in Go's type, but not explicitly in MCP input
          name: templateName,
          project_id: input.proj,
          description: input.template.description,
          issue_type: input.template.issue_type || IssueType.Task, // Default from Go
          priority: input.template.priority || 2, // Default from Go
          labels: input.template.labels,
          design: input.template.design,
          acceptance_criteria: input.template.acceptance_criteria,
          created_at: new Date().toISOString(), // Will be overwritten by store
        };
        await this.store.createTemplate(input.proj, newTemplate);
        const createdTemplate = await this.store.getTemplate(input.proj, templateName);
        return { templates: createdTemplate ? [createdTemplate] : [] };

      case 'get':
        if (!templateName) throw new Error('Template name is required.');
        const template = await this.store.getTemplate(input.proj, templateName);
        return { templates: template ? [template] : [] };

      case 'list':
        const templates = await this.store.listTemplates(input.proj);
        return { templates };

      case 'update':
        if (!templateName) throw new Error('Template name is required.');
        if (!input.template) throw new Error('Template data required.');
        await this.store.updateTemplate(input.proj, templateName, input.template);
        const updatedTemplate = await this.store.getTemplate(input.proj, templateName);
        return { templates: updatedTemplate ? [updatedTemplate] : [] };

      case 'delete':
        if (!templateName) throw new Error('Template name is required.');
        await this.store.deleteTemplate(input.proj, templateName);
        return { success: true };

      default:
        throw new Error(`Unknown command for template: ${input.cmd}`);
    }
  }

  private async handleUser(input: Input): Promise<Output> {
    const userId = input.id;
    if (!userId && input.cmd !== 'list') throw new Error('User ID is required.');

    switch (input.cmd) {
      case 'create':
        if (!input.user) throw new Error('User data required for create.');
        const newUser: User = {
          id: userId!,
          name: input.user.name,
          created_at: new Date().toISOString(), // Will be overwritten by store
          updated_at: new Date().toISOString(), // Will be overwritten by store
        };
        await this.store.createUser(newUser);
        const createdUser = await this.store.getUser(userId!);
        return { users: createdUser ? [createdUser] : [] };

      case 'get':
        const user = await this.store.getUser(userId!);
        return { users: user ? [user] : [] };

      case 'list':
        const users = await this.store.listUsers();
        return { users };

      case 'update':
        if (!input.user) throw new Error('User data required for update.');
        await this.store.updateUser(userId!, input.user);
        const updatedUser = await this.store.getUser(userId!);
        return { users: updatedUser ? [updatedUser] : [] };

      case 'delete':
        await this.store.deleteUser(userId!);
        return { success: true };

      default:
        throw new Error(`Unknown command for user: ${input.cmd}`);
    }
  }

  private async handleRole(input: Input): Promise<Output> {
    const roleId = input.id;
    if (!roleId && input.cmd !== 'list') throw new Error('Role ID is required.');

    switch (input.cmd) {
      case 'create':
        if (!input.role) throw new Error('Role data required for create.');
        const newRole: Role = {
          id: roleId!,
          name: input.role.name!,
          description: input.role.description,
          instructions: input.role.instructions,
          created_at: new Date().toISOString(), // Will be overwritten by store
          updated_at: new Date().toISOString(), // Will be overwritten by store
        };
        await this.store.createRole(newRole);
        const createdRole = await this.store.getRole(roleId!);
        return { roles: createdRole ? [createdRole] : [] };

      case 'get':
        const role = await this.store.getRole(roleId!);
        return { roles: role ? [role] : [] };

      case 'list':
        const roles = await this.store.listRoles();
        return { roles };

      case 'update':
        if (!input.role) throw new Error('Role data required for update.');
        await this.store.updateRole(roleId!, input.role);
        const updatedRole = await this.store.getRole(roleId!);
        return { roles: updatedRole ? [updatedRole] : [] };

      case 'delete':
        await this.store.deleteRole(roleId!);
        return { success: true };

      case 'assign':
        if (!input.user?.id || !roleId) throw new Error('User ID and Role ID are required for assign.');
        await this.store.assignRole(input.user.id, roleId);
        return { success: true };

      case 'unassign':
        if (!input.user?.id || !roleId) throw new Error('User ID and Role ID are required for unassign.');
        await this.store.unassignRole(input.user.id, roleId);
        return { success: true };

      default:
        throw new Error(`Unknown command for role: ${input.cmd}`);
    }
  }

  private async handleEvent(input: Input): Promise<Output> {
    if (!input.proj) throw new Error('Project ID is required.');
    if (!input.id) throw new Error('Issue ID is required.');

    switch (input.cmd) {
      case 'list':
      case 'get': // Go's 'get' for event was just list with limit 1
        const limit = input.limit || 50;
        const events = await this.store.getEvents(input.proj, input.id, limit);
        return { events };
      default:
        throw new Error(`Unknown command for event: ${input.cmd}`);
    }
  }

  async run() {
    console.log('Tacks MCP Server running...');
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
  }

  async close() {
    await this.store.close();
    console.log('Tacks MCP Server closed.');
  }
}