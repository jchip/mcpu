/**
 * Core argument parser - shared parsing logic
 */

export interface ParsedCommand {
  command: string;
  args: any;
  options: {
    json?: boolean;
    config?: string;
    verbose?: boolean;
    noCache?: boolean;
    stdin?: boolean;
  };
}

/**
 * Parse raw argv array into structured command
 */
export function parseCommandArgs(argv: string[]): ParsedCommand {
  const result: ParsedCommand = {
    command: '',
    args: {},
    options: {},
  };

  // Extract command (first non-option argument)
  const nonOptions = argv.filter(arg => !arg.startsWith('-'));
  if (nonOptions.length > 0) {
    result.command = nonOptions[0];
  }

  // Parse global options
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--json') {
      result.options.json = true;
    } else if (arg.startsWith('--config=')) {
      result.options.config = arg.split('=')[1];
    } else if (arg === '--config' && i + 1 < argv.length) {
      result.options.config = argv[++i];
    } else if (arg === '--verbose') {
      result.options.verbose = true;
    } else if (arg === '--no-cache') {
      result.options.noCache = true;
    } else if (arg === '--stdin') {
      result.options.stdin = true;
    }
  }

  // Parse command-specific args based on command
  switch (result.command) {
    case 'servers':
      result.args = parseServersArgs(argv);
      break;
    case 'tools':
      result.args = parseToolsArgs(argv);
      break;
    case 'info':
      result.args = parseInfoArgs(argv);
      break;
    case 'call':
      result.args = parseCallArgs(argv);
      break;
  }

  return result;
}

function parseServersArgs(argv: string[]): any {
  const args: any = {};

  if (argv.includes('--tools-desc')) {
    args.tools = 'desc';
  } else if (argv.includes('--tools')) {
    args.tools = 'names';
  }

  return args;
}

function parseToolsArgs(argv: string[]): any {
  const args: any = {};

  // Collect server names (non-option arguments after 'tools')
  const servers: string[] = [];
  let foundCommand = false;

  for (const arg of argv) {
    if (arg === 'tools') {
      foundCommand = true;
      continue;
    }
    if (foundCommand && !arg.startsWith('-')) {
      servers.push(arg);
    }
  }

  if (servers.length > 0) {
    args.servers = servers;
  }

  return args;
}

function parseInfoArgs(argv: string[]): any {
  const args: any = {};

  // Find 'info' command position
  const cmdIndex = argv.indexOf('info');
  if (cmdIndex === -1) return args;

  // Collect non-option arguments after 'info'
  const positional: string[] = [];
  for (let i = cmdIndex + 1; i < argv.length; i++) {
    if (!argv[i].startsWith('-')) {
      positional.push(argv[i]);
    }
  }

  if (positional.length > 0) {
    args.server = positional[0];
    args.tools = positional.slice(1);
  }

  return args;
}

function parseCallArgs(argv: string[]): any {
  const args: any = {
    args: [] as string[],
  };

  // Find 'call' command position
  const cmdIndex = argv.indexOf('call');
  if (cmdIndex === -1) return args;

  // Collect arguments
  const positional: string[] = [];
  const toolArgs: string[] = [];

  for (let i = cmdIndex + 1; i < argv.length; i++) {
    const arg = argv[i];

    // Skip global options
    if (arg === '--json' || arg === '--verbose' || arg === '--no-cache' || arg === '--stdin') {
      continue;
    }
    if (arg.startsWith('--config')) {
      if (arg.includes('=')) {
        continue;
      } else {
        i++; // Skip next arg (config value)
        continue;
      }
    }

    // Positional args (server, tool)
    if (!arg.startsWith('-') && positional.length < 2) {
      positional.push(arg);
    } else {
      // Tool arguments
      toolArgs.push(arg);
    }
  }

  if (positional.length > 0) {
    args.server = positional[0];
  }
  if (positional.length > 1) {
    args.tool = positional[1];
  }
  args.args = toolArgs;

  return args;
}
