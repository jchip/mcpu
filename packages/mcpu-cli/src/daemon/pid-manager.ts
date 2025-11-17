import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface DaemonInfo {
  pid: number;
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
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Get PID file path for a specific PID
   */
  private getPidFilePath(pid: number): string {
    return join(this.dataDir, `daemon.${pid}.json`);
  }

  /**
   * Write daemon info to PID file
   */
  async writeDaemonInfo(info: DaemonInfo): Promise<void> {
    await this.ensureDataDir();
    const filePath = this.getPidFilePath(info.pid);
    await fs.writeFile(filePath, JSON.stringify(info, null, 2), 'utf-8');
  }

  /**
   * Read daemon info from PID file
   */
  async readDaemonInfo(pid: number): Promise<DaemonInfo | null> {
    try {
      const filePath = this.getPidFilePath(pid);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Remove daemon PID file
   */
  async removeDaemonInfo(pid: number): Promise<void> {
    try {
      const filePath = this.getPidFilePath(pid);
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
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
          const pidMatch = file.match(/daemon\.(\d+)\.json/);
          if (pidMatch) {
            const pid = parseInt(pidMatch[1], 10);
            const info = await this.readDaemonInfo(pid);

            if (info) {
              // Check if process is still running
              if (this.isProcessRunning(pid)) {
                daemons.push(info);
              } else {
                // Clean up stale PID file
                await this.removeDaemonInfo(pid);
              }
            }
          }
        }
      }

      return daemons;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
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
        const pidMatch = file.match(/daemon\.(\d+)\.json/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          if (!this.isProcessRunning(pid)) {
            await this.removeDaemonInfo(pid);
            cleaned++;
          }
        }
      }
    }

    return cleaned;
  }
}
