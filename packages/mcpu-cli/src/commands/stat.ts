/**
 * mcpu stat - Display schema size statistics for MCP servers
 *
 * Measures actual command outputs to ensure accuracy:
 * - MCP Native: JSON.stringify of raw tools array (minified)
 * - MCPU Full: Output of `mcpu info <server>` (text format)
 * - MCPU Compact: Output of `mcpu tools <server>` (text format)
 */

import { ConfigDiscovery } from '../config.ts';
import {
  executeToolsCommand,
  executeInfoCommand,
  type ExecuteOptions,
} from '../core/executor.ts';

/**
 * Format byte size as human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}

/**
 * Calculate percentage reduction
 */
function formatReduction(original: number, reduced: number): string {
  if (original === 0) return '-';
  const percent = ((1 - reduced / original) * 100).toFixed(0);
  return `-${percent}%`;
}

interface ServerStats {
  name: string;
  toolCount: number;
  nativeSize: number;
  fullSize: number;
  compactSize: number;
  error?: string;
}

/**
 * Execute the stat command
 */
export async function executeStat(options: {
  config?: string;
  servers?: string[];
  noCache?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const discovery = new ConfigDiscovery({
    configFile: options.config,
    verbose: options.verbose,
  });

  const configs = await discovery.loadConfigs();

  if (configs.size === 0) {
    console.log('No MCP servers configured.');
    return;
  }

  // Determine which servers to query
  let serverNames = Array.from(configs.keys());
  if (options.servers && options.servers.length > 0) {
    for (const serverName of options.servers) {
      if (!configs.has(serverName)) {
        console.error(`Server "${serverName}" not found.`);
        process.exit(1);
      }
    }
    serverNames = options.servers;
  }

  const stats: ServerStats[] = [];
  const execOptions: ExecuteOptions = {
    config: options.config,
    noCache: options.noCache,
    verbose: options.verbose,
  };

  // Collect stats for each server
  for (const serverName of serverNames) {
    try {
      // Get native schema size: use info --json, parse, then minify
      const jsonResult = await executeInfoCommand(
        { server: serverName },
        { ...execOptions, json: true }
      );

      if (!jsonResult.success) {
        throw new Error(jsonResult.error || 'Failed to get schema');
      }

      // Parse the JSON output and re-stringify to get minified size
      let parsed = JSON.parse(jsonResult.output || '[]');

      // Handle the case where array was spread into object with _meta
      // { "0": {...}, "1": {...}, "_meta": {...} } -> extract tools
      let toolsArray: any[];
      if (Array.isArray(parsed)) {
        toolsArray = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Extract numeric keys as tools array
        const numericKeys = Object.keys(parsed).filter(k => /^\d+$/.test(k)).sort((a, b) => +a - +b);
        if (numericKeys.length > 0) {
          toolsArray = numericKeys.map(k => parsed[k]);
        } else {
          // Single tool object
          const { _meta, ...tool } = parsed;
          toolsArray = [tool];
        }
      } else {
        toolsArray = [];
      }

      const nativeSize = Buffer.byteLength(JSON.stringify(toolsArray), 'utf8');
      const toolCount = toolsArray.length;

      // Get full format size: info command text output
      const fullResult = await executeInfoCommand(
        { server: serverName },
        execOptions
      );

      if (!fullResult.success) {
        throw new Error(fullResult.error || 'Failed to get info');
      }

      const fullSize = Buffer.byteLength(fullResult.output || '', 'utf8');

      // Get compact format size: tools command text output
      const compactResult = await executeToolsCommand(
        { servers: [serverName] },
        execOptions
      );

      if (!compactResult.success) {
        throw new Error(compactResult.error || 'Failed to get tools');
      }

      const compactSize = Buffer.byteLength(compactResult.output || '', 'utf8');

      stats.push({
        name: serverName,
        toolCount,
        nativeSize,
        fullSize,
        compactSize,
      });
    } catch (error: any) {
      stats.push({
        name: serverName,
        toolCount: 0,
        nativeSize: 0,
        fullSize: 0,
        compactSize: 0,
        error: error.message || String(error),
      });
    }
  }

  // Calculate column widths
  const headers = ['Server', 'Tools', 'MCP Native', 'MCPU Full', 'Δ Full', 'MCPU Compact', 'Δ Compact'];

  const colWidths = headers.map((h, i) => {
    let maxWidth = h.length;
    for (const s of stats) {
      let cellWidth = 0;
      switch (i) {
        case 0: cellWidth = s.name.length; break;
        case 1: cellWidth = String(s.toolCount).length; break;
        case 2: cellWidth = s.error ? 5 : formatSize(s.nativeSize).length; break;
        case 3: cellWidth = s.error ? 0 : formatSize(s.fullSize).length; break;
        case 4: cellWidth = s.error ? 0 : formatReduction(s.nativeSize, s.fullSize).length; break;
        case 5: cellWidth = s.error ? 0 : formatSize(s.compactSize).length; break;
        case 6: cellWidth = s.error ? 0 : formatReduction(s.nativeSize, s.compactSize).length; break;
      }
      maxWidth = Math.max(maxWidth, cellWidth);
    }
    return maxWidth;
  });

  // Print table
  const pad = (str: string, width: number, align: 'left' | 'right' = 'left') => {
    if (align === 'right') {
      return str.padStart(width);
    }
    return str.padEnd(width);
  };

  // Header
  const headerLine = '| ' + headers.map((h, i) => pad(h, colWidths[i], i === 0 ? 'left' : 'right')).join(' | ') + ' |';
  const separator = '|' + colWidths.map(w => '-'.repeat(w + 2)).join('|') + '|';

  console.log();
  console.log('MCPU Schema Size Statistics');
  console.log();
  console.log(headerLine);
  console.log(separator);

  // Data rows
  for (const s of stats) {
    if (s.error) {
      const row = [
        pad(s.name, colWidths[0]),
        pad('-', colWidths[1], 'right'),
        pad('Error', colWidths[2], 'right'),
        pad('-', colWidths[3], 'right'),
        pad('-', colWidths[4], 'right'),
        pad('-', colWidths[5], 'right'),
        pad('-', colWidths[6], 'right'),
      ];
      console.log('| ' + row.join(' | ') + ' |');
    } else {
      const row = [
        pad(s.name, colWidths[0]),
        pad(String(s.toolCount), colWidths[1], 'right'),
        pad(formatSize(s.nativeSize), colWidths[2], 'right'),
        pad(formatSize(s.fullSize), colWidths[3], 'right'),
        pad(formatReduction(s.nativeSize, s.fullSize), colWidths[4], 'right'),
        pad(formatSize(s.compactSize), colWidths[5], 'right'),
        pad(formatReduction(s.nativeSize, s.compactSize), colWidths[6], 'right'),
      ];
      console.log('| ' + row.join(' | ') + ' |');
    }
  }

  // Totals
  const totalTools = stats.reduce((sum, s) => sum + s.toolCount, 0);
  const totalNative = stats.reduce((sum, s) => sum + s.nativeSize, 0);
  const totalFull = stats.reduce((sum, s) => sum + s.fullSize, 0);
  const totalCompact = stats.reduce((sum, s) => sum + s.compactSize, 0);

  console.log(separator);
  const totalsRow = [
    pad('TOTAL', colWidths[0]),
    pad(String(totalTools), colWidths[1], 'right'),
    pad(formatSize(totalNative), colWidths[2], 'right'),
    pad(formatSize(totalFull), colWidths[3], 'right'),
    pad(formatReduction(totalNative, totalFull), colWidths[4], 'right'),
    pad(formatSize(totalCompact), colWidths[5], 'right'),
    pad(formatReduction(totalNative, totalCompact), colWidths[6], 'right'),
  ];
  console.log('| ' + totalsRow.join(' | ') + ' |');
  console.log();
}
