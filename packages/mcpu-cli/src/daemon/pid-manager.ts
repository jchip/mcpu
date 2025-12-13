import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { hasErrorCode } from '../utils/error.ts';

export interface DaemonInfo {
  pid: number;
  ppid: number;  // Parent PID (0 for shared/singleton daemons)
  port: number;
  startTime: string;
}

/**
 * Manages daemon PID files
 */
export class PidManager {
  private dataDir: string;

  constructor() {
    // Use XDG_DATA_HOME or fallback to ~/.local/share
    const xdgDataHome = process.env.XDG_DATA_HOME;
    const dataHome = xdgDataHome || join(homedir(), '.local', 'share');
    this.dataDir = join(dataHome, 'mcpu');
  }

  /**
   * Ensure data directory exists
   */
  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw error;
      }
    }
  }

  /**
   * Get PID file path for a specific daemon
   */
  private getPidFilePath(ppid: number, pid: number): string {
    return join(this.dataDir, `daemon.${ppid}-${pid}.json`);
  }

  /**
   * Write daemon info to PID file
   */
  async saveDaemonInfo(info: DaemonInfo): Promise<void> {
    await this.ensureDataDir();
    const filePath = this.getPidFilePath(info.ppid, info.pid);
    await fs.writeFile(filePath, JSON.stringify(info, null, 2), 'utf-8');
  }

  /**
   * Read daemon info from PID file
   */
  async readDaemonInfo(ppid: number, pid: number): Promise<DaemonInfo | null> {
    try {
      const filePath = this.getPidFilePath(ppid, pid);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Remove daemon PID file
   */
  async removeDaemonInfo(ppid: number, pid: number): Promise<void> {
    try {
      const filePath = this.getPidFilePath(ppid, pid);
      await fs.unlink(filePath);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        throw error;
      }
    }
  }

  /**
   * Check if a process is running
   */
  isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 doesn't kill the process, just checks if it exists
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Find all daemon PID files
   */
  async findAllDaemons(): Promise<DaemonInfo[]> {
    try {
      await this.ensureDataDir();
      const files = await fs.readdir(this.dataDir);

      const daemons: DaemonInfo[] = [];

      for (const file of files) {
        if (file.startsWith('daemon.') && file.endsWith('.json')) {
          const match = file.match(/daemon\.(\d+)-(\d+)\.json/);
          if (match) {
            const ppid = parseInt(match[1], 10);
            const pid = parseInt(match[2], 10);
            const info = await this.readDaemonInfo(ppid, pid);

            if (info) {
              // Check if process is still running
              if (this.isProcessRunning(pid)) {
                daemons.push(info);
              } else {
                // Clean up stale PID file
                await this.removeDaemonInfo(ppid, pid);
              }
            }
          }
        }
      }

      return daemons;
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Find daemon by parent PID
   */
  async findDaemonByPpid(ppid: number): Promise<DaemonInfo | null> {
    const allDaemons = await this.findAllDaemons();
    return allDaemons.find(d => d.ppid === ppid) || null;
  }

  /**
   * Find daemon by PID (any ppid)
   */
  async findDaemonByPid(pid: number): Promise<DaemonInfo | null> {
    const allDaemons = await this.findAllDaemons();
    return allDaemons.find(d => d.pid === pid) || null;
  }

  /**
   * Find the most recently started daemon
   */
  async findLatestDaemon(): Promise<DaemonInfo | null> {
    const daemons = await this.findAllDaemons();

    if (daemons.length === 0) {
      return null;
    }

    // Sort by start time (most recent first)
    daemons.sort((a, b) => {
      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    });

    return daemons[0];
  }

  /**
   * Clean up all stale daemon files
   */
  async cleanupStale(): Promise<number> {
    const allFiles = await fs.readdir(this.dataDir);
    let cleaned = 0;

    for (const file of allFiles) {
      if (file.startsWith('daemon.') && file.endsWith('.json')) {
        const match = file.match(/daemon\.(\d+)-(\d+)\.json/);
        if (match) {
          const ppid = parseInt(match[1], 10);
          const pid = parseInt(match[2], 10);
          if (!this.isProcessRunning(pid)) {
            await this.removeDaemonInfo(ppid, pid);
            cleaned++;
          }
        }
      }
    }

    return cleaned;
  }
}
