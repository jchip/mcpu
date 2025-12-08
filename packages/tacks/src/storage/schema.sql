-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    prefix TEXT NOT NULL DEFAULT '',
    next_id INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Issues table
CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    content_hash TEXT,
    title TEXT NOT NULL CHECK(length(title) <= 500),
    description TEXT NOT NULL DEFAULT '',
    design TEXT NOT NULL DEFAULT '',
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    priority INTEGER NOT NULL DEFAULT 2 CHECK(priority >= 0 AND priority <= 4),
    issue_type TEXT NOT NULL DEFAULT 'task',
    assignee_id TEXT,
    estimated_minutes INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    due_date DATETIME,
    external_ref TEXT,
    -- Compaction fields
    compaction_level INTEGER DEFAULT 0,
    compacted_at DATETIME,
    compacted_at_commit TEXT,
    original_size INTEGER,
    CHECK ((status IN ('closed', 'wont_do')) = (closed_at IS NOT NULL)),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
CREATE INDEX IF NOT EXISTS idx_issues_assignee_id ON issues(assignee_id);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at);
CREATE INDEX IF NOT EXISTS idx_issues_project_priority ON issues(project_id, priority);
CREATE INDEX IF NOT EXISTS idx_issues_project_created ON issues(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_issues_project_updated ON issues(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_issues_due_date ON issues(due_date) WHERE due_date IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_external_ref ON issues(project_id, external_ref) WHERE external_ref IS NOT NULL;

-- Dependencies table
CREATE TABLE IF NOT EXISTS dependencies (
    issue_id TEXT NOT NULL,
    depends_on_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'blocks',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    PRIMARY KEY (issue_id, depends_on_id),
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dependencies_issue ON dependencies(issue_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_depends_on ON dependencies(depends_on_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_depends_on_type ON dependencies(depends_on_id, type);
CREATE INDEX IF NOT EXISTS idx_dependencies_depends_on_type_issue ON dependencies(depends_on_id, type, issue_id);

-- Labels table
CREATE TABLE IF NOT EXISTS labels (
    issue_id TEXT NOT NULL,
    label TEXT NOT NULL,
    PRIMARY KEY (issue_id, label),
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_labels_label ON labels(label);

-- Entity kinds table (normalized entity types)
CREATE TABLE IF NOT EXISTS entity_kinds (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Pre-populate entity kinds
INSERT OR IGNORE INTO entity_kinds (id, name) VALUES (1, 'project'), (2, 'issue'), (3, 'user'), (4, 'role');

-- Entities table (Global Entity Registry)
CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind_id INTEGER NOT NULL,
    native_id TEXT NOT NULL,
    UNIQUE(kind_id, native_id),
    FOREIGN KEY (kind_id) REFERENCES entity_kinds(id)
);

CREATE INDEX IF NOT EXISTS idx_entities_kind_native ON entities(kind_id, native_id);

-- Entity links table (GER edge table for relationships)
CREATE TABLE IF NOT EXISTS entity_links (
    source_entity_id INTEGER NOT NULL,
    target_entity_id INTEGER NOT NULL,
    link_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    PRIMARY KEY (source_entity_id, target_entity_id, link_type),
    FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_links_source ON entity_links(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_target ON entity_links(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_type ON entity_links(link_type);
CREATE INDEX IF NOT EXISTS idx_entity_links_source_type ON entity_links(source_entity_id, link_type);
CREATE INDEX IF NOT EXISTS idx_entity_links_target_type ON entity_links(target_entity_id, link_type);

-- Comments table (linked via GER)
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);

-- Events table (audit trail)
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    comment TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_issue ON events(issue_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

-- Config table (per-project settings)
CREATE TABLE IF NOT EXISTS config (
    project_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (project_id, key),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Metadata table (for storing internal state)
CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Child counters table (for hierarchical ID generation)
CREATE TABLE IF NOT EXISTS child_counters (
    parent_id TEXT PRIMARY KEY,
    last_child INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (parent_id) REFERENCES issues(id) ON DELETE CASCADE
);

-- Issue snapshots table (for compaction history)
CREATE TABLE IF NOT EXISTS issue_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id TEXT NOT NULL,
    snapshot_time DATETIME NOT NULL,
    compaction_level INTEGER NOT NULL,
    original_size INTEGER NOT NULL,
    compressed_size INTEGER NOT NULL,
    original_content TEXT NOT NULL,
    archived_events TEXT,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_issue ON issue_snapshots(issue_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_level ON issue_snapshots(compaction_level);

-- Compaction snapshots table (for restoration)
CREATE TABLE IF NOT EXISTS compaction_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id TEXT NOT NULL,
    compaction_level INTEGER NOT NULL,
    snapshot_json BLOB NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comp_snap_issue_level_created ON compaction_snapshots(issue_id, compaction_level, created_at DESC);

-- Blocked issues cache (for ready work performance)
CREATE TABLE IF NOT EXISTS blocked_issues_cache (
    issue_id TEXT PRIMARY KEY,
    cached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

-- Ready work view (only 'blocks' type blocks, parent-child is containment only)
CREATE VIEW IF NOT EXISTS ready_issues AS
SELECT i.*
FROM issues i
WHERE i.status IN ('open', 'in_progress')
  AND NOT EXISTS (
    SELECT 1
    FROM dependencies d
    JOIN issues blocker ON d.depends_on_id = blocker.id
    WHERE d.issue_id = i.id
      AND d.type = 'blocks'
      AND blocker.status IN ('open', 'in_progress', 'blocked')
  );

-- Blocked issues view
CREATE VIEW IF NOT EXISTS blocked_issues AS
SELECT
    i.*,
    COUNT(d.depends_on_id) as blocked_by_count
FROM issues i
JOIN dependencies d ON i.id = d.issue_id
JOIN issues blocker ON d.depends_on_id = blocker.id
WHERE i.status IN ('open', 'in_progress', 'blocked')
  AND d.type = 'blocks'
  AND blocker.status IN ('open', 'in_progress', 'blocked')
GROUP BY i.id;

-- Templates table
CREATE TABLE IF NOT EXISTS templates (
    name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    issue_type TEXT NOT NULL DEFAULT 'task',
    priority INTEGER NOT NULL DEFAULT 2 CHECK(priority >= 0 AND priority <= 4),
    labels TEXT NOT NULL DEFAULT '[]',
    design TEXT NOT NULL DEFAULT '',
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, name),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_templates_project ON templates(project_id);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Roles table (dev characteristics)
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- User-to-role relationship table (via GER entity IDs)
CREATE TABLE IF NOT EXISTS user_to_role (
    user_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    role_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_entity_id, role_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_user_to_role_user ON user_to_role(user_entity_id);
CREATE INDEX IF NOT EXISTS idx_user_to_role_role ON user_to_role(role_entity_id);

-- Default roles
INSERT OR IGNORE INTO roles (id, name, description, instructions) VALUES
    ('architect', 'Architect', 'System and software architecture', 'Focus on high-level design, system boundaries, and architectural patterns.'),
    ('designer', 'Designer', 'UX/UI and product design', 'Focus on user experience, interface design, and visual consistency.'),
    ('senior-swe', 'Senior SWE', 'Senior software engineer', 'Implement features with attention to code quality and maintainability.'),
    ('staff-swe', 'Staff SWE', 'Staff software engineer', 'Lead technical initiatives and mentor other engineers.'),
    ('principal-swe', 'Principal SWE', 'Principal software engineer', 'Drive technical strategy and solve complex cross-cutting concerns.'),
    ('release-engineer', 'Release Engineer', 'Release and deployment', 'Manage releases, CI/CD pipelines, and deployment processes.'),
    ('agent', 'Agent', 'AI agent assistant', 'Autonomous AI agent that can work on tasks independently.');

-- Register default roles as GER entities
INSERT OR IGNORE INTO entities (kind_id, native_id)
SELECT 4, id FROM roles WHERE id IN ('architect', 'designer', 'senior-swe', 'staff-swe', 'principal-swe', 'release-engineer', 'agent');
