import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DB } from '../../src/storage/db.js';
import { SqliteStorage } from '../../src/storage/sqlite.js';
import { User } from '../../src/types/index.js';
import { ErrConflict, ErrNotFound } from '../../src/storage/index.js';

describe('Users', () => {
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

  it('CreateUser', async () => {
    const user: User = {
      id: 'test-user',
      name: 'Test User',
      created_at: '',
      updated_at: '',
    };

    await store.createUser(user);

    // Retrieve to verify timestamps were set
    const created = await store.getUser('test-user');
    expect(created?.created_at).toBeTruthy();
    expect(created?.updated_at).toBeTruthy();
  });

  it('CreateUserDuplicate', async () => {
    const user: User = {
      id: 'test-user',
      name: 'Test User',
      created_at: '',
      updated_at: '',
    };

    await store.createUser(user);

    // Try to create the same user again
    const user2: User = {
      id: 'test-user',
      name: 'Test User 2',
      created_at: '',
      updated_at: '',
    };

    await expect(store.createUser(user2)).rejects.toThrow(ErrConflict);
  });

  it('CreateUserWithoutName', async () => {
    const user: User = {
      id: 'agent-1',
      created_at: '',
      updated_at: '',
    };

    await store.createUser(user);

    // Retrieve and verify
    const retrieved = await store.getUser(user.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBeUndefined();
  });

  it('GetUser', async () => {
    const user: User = {
      id: 'jc',
      name: 'Joel',
      created_at: '',
      updated_at: '',
    };

    await store.createUser(user);

    const retrieved = await store.getUser('jc');

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('jc');
    expect(retrieved?.name).toBe('Joel');
  });

  it('GetUserNotFound', async () => {
    const user = await store.getUser('nonexistent');
    expect(user).toBeUndefined();
  });

  it('ListUsers', async () => {
    // List should be empty initially
    let users = await store.listUsers();
    expect(users.length).toBe(0);

    // Create some users
    for (const id of ['alice', 'bob', 'charlie']) {
      await store.createUser({
        id,
        name: id,
        created_at: '',
        updated_at: '',
      });
    }

    users = await store.listUsers();
    expect(users.length).toBe(3);
  });

  it('UpdateUser', async () => {
    const user: User = {
      id: 'test-user',
      name: 'Original Name',
      created_at: '',
      updated_at: '',
    };

    await store.createUser(user);

    // Update name
    await store.updateUser('test-user', { name: 'Updated Name' });

    // Verify update
    const updated = await store.getUser('test-user');
    expect(updated?.name).toBe('Updated Name');
  });

  it('UpdateUserNotFound', async () => {
    await expect(
      store.updateUser('nonexistent', { name: 'New Name' })
    ).rejects.toThrow(ErrNotFound);
  });

  it('DeleteUser', async () => {
    const user: User = {
      id: 'test-user',
      name: 'Test User',
      created_at: '',
      updated_at: '',
    };

    await store.createUser(user);

    // Delete the user
    await store.deleteUser('test-user');

    // Verify deletion
    const deleted = await store.getUser('test-user');
    expect(deleted).toBeUndefined();
  });

  it('DeleteUserNotFound', async () => {
    await expect(store.deleteUser('nonexistent')).rejects.toThrow(ErrNotFound);
  });

  it('DeleteUserCleansUpGEREntity', async () => {
    // Create user
    const user: User = { id: 'test-user', name: 'Test', created_at: '', updated_at: '' };
    await store.createUser(user);

    // Delete user
    await store.deleteUser('test-user');

    // User should be gone
    const deleted = await store.getUser('test-user');
    expect(deleted).toBeUndefined();

    // GER entity should also be gone - creating same user should work
    const user2: User = { id: 'test-user', name: 'New User', created_at: '', updated_at: '' };
    await store.createUser(user2);

    const recreated = await store.getUser('test-user');
    expect(recreated).toBeDefined();
    expect(recreated?.name).toBe('New User');
  });

  it('UserWithRoles', async () => {
    // Create user
    const user: User = { id: 'dev-user', name: 'Developer', created_at: '', updated_at: '' };
    await store.createUser(user);

    // Assign roles (using default roles)
    await store.assignRole('dev-user', 'senior-swe');
    await store.assignRole('dev-user', 'architect');

    // Get user with roles
    const retrieved = await store.getUser('dev-user');
    expect(retrieved).toBeDefined();
    expect(retrieved?.roles?.length).toBe(2);
  });
});
