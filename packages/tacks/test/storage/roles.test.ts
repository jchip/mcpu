import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { Role, User } from '../../src/types/index.js';
import { ErrConflict, ErrNotFound } from '../../src/storage/index.js';

describe('Roles', () => {
  let db: DB;
  let store: SqliteStorage;

  beforeEach(async () => {
    db = new DB(':memory:');
    await db.connect();
    store = new SqliteStorage(db);
    await (store as any).initDefaults();
  });

  afterEach(async () => {
    await db.close();
  });

  it('CreateRole', async () => {
    const role: Role = {
      id: 'qa-engineer',
      name: 'QA Engineer',
      description: 'Quality assurance engineer',
      instructions: 'Focus on testing and quality',
      created_at: '',
      updated_at: '',
    };

    await store.createRole(role);

    // Retrieve to verify timestamps were set
    const created = await store.getRole('qa-engineer');
    expect(created?.created_at).toBeTruthy();
    expect(created?.updated_at).toBeTruthy();
  });

  it('CreateRoleDuplicate', async () => {
    const role: Role = {
      id: 'custom-role',
      name: 'Custom Role',
      created_at: '',
      updated_at: '',
    };

    await store.createRole(role);

    // Try to create the same role again
    const role2: Role = {
      id: 'custom-role',
      name: 'Custom Role 2',
      created_at: '',
      updated_at: '',
    };

    await expect(store.createRole(role2)).rejects.toThrow(ErrConflict);
  });

  it('GetRole', async () => {
    // Get a default role
    const role = await store.getRole('architect');

    expect(role).toBeDefined();
    expect(role?.id).toBe('architect');
    expect(role?.name).toBe('Architect');
  });

  it('GetRoleNotFound', async () => {
    const role = await store.getRole('nonexistent');
    expect(role).toBeUndefined();
  });

  it('ListRoles', async () => {
    // List should include default roles
    const roles = await store.listRoles();

    // Should have 7 default roles
    expect(roles.length).toBeGreaterThanOrEqual(7);

    // Check that default roles are present
    const roleIDs = new Set(roles.map(r => r.id));
    const defaultRoles = ['architect', 'designer', 'senior-swe', 'staff-swe', 'principal-swe', 'release-engineer', 'agent'];

    for (const expected of defaultRoles) {
      expect(roleIDs.has(expected)).toBe(true);
    }
  });

  it('UpdateRole', async () => {
    // Create a custom role
    const role: Role = {
      id: 'test-role',
      name: 'Test Role',
      description: 'Original description',
      created_at: '',
      updated_at: '',
    };
    await store.createRole(role);

    // Update role
    await store.updateRole('test-role', {
      name: 'Updated Role',
      description: 'Updated description',
    });

    // Verify update
    const updated = await store.getRole('test-role');
    expect(updated?.name).toBe('Updated Role');
    expect(updated?.description).toBe('Updated description');
  });

  it('UpdateRoleNotFound', async () => {
    await expect(
      store.updateRole('nonexistent', { name: 'New Name' })
    ).rejects.toThrow(ErrNotFound);
  });

  it('DeleteRole', async () => {
    // Create a custom role
    const role: Role = {
      id: 'temp-role',
      name: 'Temporary Role',
      created_at: '',
      updated_at: '',
    };
    await store.createRole(role);

    // Delete the role
    await store.deleteRole('temp-role');

    // Verify deletion
    const deleted = await store.getRole('temp-role');
    expect(deleted).toBeUndefined();
  });

  it('DeleteRoleNotFound', async () => {
    await expect(store.deleteRole('nonexistent')).rejects.toThrow(ErrNotFound);
  });

  it('AssignRole', async () => {
    // Create user
    const user: User = { id: 'test-user', name: 'Test', created_at: '', updated_at: '' };
    await store.createUser(user);

    // Assign a default role
    await store.assignRole('test-user', 'senior-swe');

    // Verify assignment
    const roles = await store.getUserRoles('test-user');
    expect(roles.length).toBe(1);
    expect(roles[0].id).toBe('senior-swe');
  });

  it('AssignRoleIdempotent', async () => {
    // Create user
    const user: User = { id: 'test-user', name: 'Test', created_at: '', updated_at: '' };
    await store.createUser(user);

    // Assign same role twice
    await store.assignRole('test-user', 'architect');
    await store.assignRole('test-user', 'architect'); // Should not throw

    // Should still only have one role
    const roles = await store.getUserRoles('test-user');
    expect(roles.length).toBe(1);
  });

  it('UnassignRole', async () => {
    // Create user
    const user: User = { id: 'test-user', name: 'Test', created_at: '', updated_at: '' };
    await store.createUser(user);

    // Assign roles
    await store.assignRole('test-user', 'senior-swe');
    await store.assignRole('test-user', 'architect');

    // Unassign one role
    await store.unassignRole('test-user', 'senior-swe');

    // Should have one role left
    const roles = await store.getUserRoles('test-user');
    expect(roles.length).toBe(1);
    expect(roles[0].id).toBe('architect');
  });

  it('GetUserRolesEmpty', async () => {
    // Create user without roles
    const user: User = { id: 'test-user', name: 'Test', created_at: '', updated_at: '' };
    await store.createUser(user);

    const roles = await store.getUserRoles('test-user');
    expect(roles.length).toBe(0);
  });

  it('GetRoleUsers', async () => {
    // Create users
    for (const id of ['alice', 'bob', 'charlie']) {
      await store.createUser({ id, name: id, created_at: '', updated_at: '' });
    }

    // Assign architect role to alice and bob
    await store.assignRole('alice', 'architect');
    await store.assignRole('bob', 'architect');

    // Get users with architect role
    const users = await store.getRoleUsers('architect');
    expect(users.length).toBe(2);

    // Check that alice and bob are in the list
    const userIDs = new Set(users.map(u => u.id));
    expect(userIDs.has('alice')).toBe(true);
    expect(userIDs.has('bob')).toBe(true);
    expect(userIDs.has('charlie')).toBe(false);
  });

  it('DeleteUserRemovesRoleAssignments', async () => {
    // Create user and assign role
    const user: User = { id: 'test-user', name: 'Test', created_at: '', updated_at: '' };
    await store.createUser(user);
    await store.assignRole('test-user', 'architect');

    // Delete user
    await store.deleteUser('test-user');

    // Role should have no users now (from test-user)
    const users = await store.getRoleUsers('architect');
    const hasTestUser = users.some(u => u.id === 'test-user');
    expect(hasTestUser).toBe(false);
  });

  it('DeleteRoleRemovesUserAssignments', async () => {
    // Create custom role
    const role: Role = { id: 'temp-role', name: 'Temp', created_at: '', updated_at: '' };
    await store.createRole(role);

    // Create user and assign custom role
    const user: User = { id: 'test-user', name: 'Test', created_at: '', updated_at: '' };
    await store.createUser(user);
    await store.assignRole('test-user', 'temp-role');

    // Delete role
    await store.deleteRole('temp-role');

    // User should have no roles now
    const roles = await store.getUserRoles('test-user');
    const hasTempRole = roles.some(r => r.id === 'temp-role');
    expect(hasTempRole).toBe(false);
  });

  it('AssignRoleUserNotFound', async () => {
    await expect(
      store.assignRole('nonexistent', 'architect')
    ).rejects.toThrow(ErrNotFound);
  });

  it('AssignRoleRoleNotFound', async () => {
    // Create user
    const user: User = { id: 'test-user', name: 'Test', created_at: '', updated_at: '' };
    await store.createUser(user);

    await expect(
      store.assignRole('test-user', 'nonexistent')
    ).rejects.toThrow(ErrNotFound);
  });
});
