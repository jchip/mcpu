/**
 * Workspace Directory Auto-Detection
 *
 * Attempts to detect the workspace directory from a project directory.
 * A workspace directory is typically a parent directory that contains multiple projects.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

/**
 * Auto-detect workspace directory from projectDir
 *
 * Logic:
 * 1. Start from projectDir and walk up the directory tree
 * 2. Stop at user's home directory
 * 3. For each parent directory, check if it contains multiple subdirectories (sibling projects)
 * 4. If found, that's likely the workspace directory
 *
 * Example:
 * - projectDir: /Users/jc/dev/mcpu
 * - Parent: /Users/jc/dev
 * - If /Users/jc/dev contains other directories (fynjs, my-project, etc.), it's the workspace
 *
 * @param projectDir - The project directory to analyze
 * @returns The detected workspace directory, or undefined if not found
 */
export function autoDetectWorkspaceDir(projectDir: string | undefined): string | undefined {
  if (!projectDir) {
    return undefined;
  }

  // Normalize paths
  const normalizedProjectDir = projectDir.replace(/\\/g, '/');
  const homeDir = homedir().replace(/\\/g, '/');

  // Start from the parent of projectDir
  let currentDir = dirname(normalizedProjectDir);

  // Walk up the directory tree until we reach home or root
  while (currentDir !== homeDir && currentDir !== '/' && currentDir !== '.') {
    try {
      // Check if this directory exists
      if (!existsSync(currentDir)) {
        currentDir = dirname(currentDir);
        continue;
      }

      // Get all entries in this directory
      const entries = readdirSync(currentDir);

      // Count subdirectories (potential sibling projects)
      const subdirs = entries.filter((entry) => {
        const fullPath = join(currentDir, entry);
        try {
          const stats = statSync(fullPath);
          // Filter out hidden directories and node_modules
          return (
            stats.isDirectory() &&
            !entry.startsWith('.') &&
            entry !== 'node_modules'
          );
        } catch {
          return false;
        }
      });

      // If there are 2+ subdirectories (including our project), this is likely a workspace
      // We need at least 2 because one is the projectDir itself
      if (subdirs.length >= 2) {
        return currentDir;
      }

      // Move up one level
      currentDir = dirname(currentDir);
    } catch {
      // Error reading directory, move up
      currentDir = dirname(currentDir);
    }
  }

  // No workspace detected
  return undefined;
}
