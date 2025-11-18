import { build as esbuild, BuildOptions, Plugin } from "esbuild";
import { readdirSync, statSync, existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join, relative, dirname } from "path";

// TypeScript is an optional peer dependency - loaded on demand
let ts: typeof import("typescript") | undefined;
let tsLoadAttempted = false;

async function loadTypeScript(): Promise<typeof import("typescript") | null> {
  if (!tsLoadAttempted) {
    tsLoadAttempted = true;
    try {
      ts = await import("typescript");
    } catch (error) {
      // TypeScript not installed, return null
      ts = undefined;
    }
  }
  return ts ?? null;
}

export interface XtsjsOptions {
  /**
   * Source directory containing TypeScript files
   * @default 'src'
   */
  srcDir?: string;

  /**
   * Output directory for compiled JavaScript files
   * @default 'dist'
   */
  outDir?: string;

  /**
   * Node.js target version
   * @default 'node18'
   */
  target?: string;

  /**
   * Enable source maps
   * @default false
   */
  sourcemap?: boolean;

  /**
   * Generate TypeScript declaration files (.d.ts)
   * @default true
   */
  declaration?: boolean;

  /**
   * Additional esbuild options to merge
   */
  esbuildOptions?: Partial<BuildOptions>;
}

/**
 * Plugin that rewrites .ts imports to .js for proper ESM compatibility
 */
function createTsImportRewritePlugin(): Plugin {
  return {
    name: "rewrite-ts-imports",
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        let contents = await readFile(args.path, "utf8");
        // Rewrite .ts imports to .js
        // This regex targets import/export statements with relative paths ending in .ts
        // Pattern: from/import followed by quote, dot (relative), non-quotes, .ts, quote
        contents = contents.replace(
          /\b(from|import)\s+(['"])(\.[^'"]+)\.ts\2/g,
          "$1 $2$3.js$2"
        );
        return { contents, loader: "ts" };
      });
    },
  };
}

/**
 * Find all .ts entry points in a directory recursively
 */
function findEntryPoints(dir: string, base?: string): string[] {
  const entries: string[] = [];
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      entries.push(...findEntryPoints(fullPath, base));
    } else if (item.endsWith(".ts")) {
      entries.push(fullPath);
    }
  }

  return entries;
}

/**
 * Get default compiler options for xtsjs
 */
function getDefaultCompilerOptions(
  ts: NonNullable<typeof import("typescript")>,
  srcDir: string,
  outDir: string
) {
  return {
    // Module resolution
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,

    // ESM support
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,

    // Iteration support
    downlevelIteration: true,

    // Type checking
    strict: true,
    skipLibCheck: true,
    resolveJsonModule: true,

    // Declaration output
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    outDir,
    rootDir: srcDir,

    // Additional flags
    noEmit: false,
    isolatedModules: true,
    forceConsistentCasingInFileNames: true,
  };
}

/**
 * Generate TypeScript declaration files using tsc
 */
async function generateDeclarations(
  srcDir: string,
  outDir: string
): Promise<void> {
  // Try to load TypeScript
  const ts = await loadTypeScript();

  if (!ts) {
    // TypeScript not installed, skip declaration generation
    console.log("typescript not installed, skipping .d.ts generation");
    return;
  }

  // Find tsconfig.json or create default config
  const configPath = ts.findConfigFile(
    process.cwd(),
    ts.sys.fileExists,
    "tsconfig.json"
  );

  // Start with our default options
  let compilerOptions = getDefaultCompilerOptions(ts, srcDir, outDir);

  // If tsconfig.json exists, use it as base
  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(configPath)
    );

    // Merge: our defaults first, then user config, then override with our required options
    compilerOptions = {
      ...getDefaultCompilerOptions(ts, srcDir, outDir),
      ...parsedConfig.options, // User can override defaults
      // But these are always required for xtsjs to work
      declaration: true,
      emitDeclarationOnly: true,
      noEmit: false,
      outDir,
    };
  }

  // Find all TypeScript files
  const files = findEntryPoints(srcDir);

  // Create program and emit declarations
  const program = ts.createProgram(files, compilerOptions);
  const emitResult = program.emit();

  // Check for errors
  const allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);

  if (allDiagnostics.length > 0) {
    const formatHost = {
      getCanonicalFileName: (path: string) => path,
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getNewLine: () => ts.sys.newLine,
    };

    const errorMessage = ts.formatDiagnosticsWithColorAndContext(
      allDiagnostics,
      formatHost
    );
    throw new Error(
      `TypeScript declaration generation failed:\n${errorMessage}`
    );
  }
}

/**
 * Build TypeScript files with ESM import extension rewriting
 */
export async function xtsjs(options: XtsjsOptions = {}): Promise<void> {
  const {
    srcDir = "src",
    outDir = "dist",
    target = "node18",
    sourcemap = false,
    declaration = true,
    esbuildOptions = {},
  } = options;

  const entryPoints = findEntryPoints(srcDir);

  if (entryPoints.length === 0) {
    throw new Error(`No TypeScript files found in ${srcDir}`);
  }

  // Compile TypeScript to JavaScript with esbuild
  await esbuild({
    entryPoints,
    outdir: outDir,
    format: "esm",
    platform: "node",
    target,
    outExtension: { ".js": ".js" },
    bundle: false,
    sourcemap,
    plugins: [createTsImportRewritePlugin()],
    ...esbuildOptions,
  });

  // Generate declaration files with TypeScript compiler
  if (declaration) {
    await generateDeclarations(srcDir, outDir);
  }
}

/**
 * Generate a default tsconfig.json file
 */
export async function init(options: {
  srcDir?: string;
  outDir?: string;
  force?: boolean;
} = {}): Promise<void> {
  const { srcDir = "src", outDir = "dist", force = false } = options;
  const tsconfigPath = join(process.cwd(), "tsconfig.json");

  if (existsSync(tsconfigPath) && !force) {
    throw new Error(
      "tsconfig.json already exists. Use --force to overwrite."
    );
  }

  const config = {
    compilerOptions: {
      // Module resolution
      module: "ESNext",
      moduleResolution: "bundler",
      target: "ES2022",

      // ESM support
      allowImportingTsExtensions: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,

      // Iteration support
      downlevelIteration: true,

      // Type checking
      strict: true,
      skipLibCheck: true,
      resolveJsonModule: true,

      // Declaration output
      declaration: true,
      declarationMap: false,
      emitDeclarationOnly: true,

      // Paths
      rootDir: `./${srcDir}`,
      outDir: `./${outDir}`,

      // Additional flags
      noEmit: false,
      isolatedModules: true,
      forceConsistentCasingInFileNames: true,
    },
    include: [`${srcDir}/**/*`],
    exclude: ["node_modules", outDir],
  };

  await writeFile(tsconfigPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Created tsconfig.json`);
}
