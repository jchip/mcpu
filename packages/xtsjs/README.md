# xtsjs

TypeScript build tool with ESM import extension rewriting. Wraps esbuild with a pre-configured plugin that automatically rewrites `.ts` imports to `.js` for proper ESM compatibility.

## Features

- 🚀 Fast builds powered by esbuild
- 🔧 Automatic `.ts` to `.js` import rewriting
- 📘 TypeScript declaration files (.d.ts) generation
- 📦 Zero configuration needed - works without tsconfig.json
- 🎯 ESM-first design with modern defaults
- 🔍 Recursive source file discovery
- ⚙️ Optional tsconfig.json generation with `xtsjs init`

## Installation

```bash
npm install --save-dev xtsjs
```

**Optional:** To generate TypeScript declaration files (.d.ts), install TypeScript (>=5.0.0):

```bash
npm install --save-dev typescript
```

xtsjs automatically detects if TypeScript is installed and generates `.d.ts` files when available. No TypeScript? No problem - it just skips declaration generation.

## Usage

### CLI

```bash
# Build with defaults (src -> dist)
xtsjs

# Custom directories
xtsjs --src src --out dist

# Enable source maps
xtsjs --sourcemap

# Custom Node.js target
xtsjs --target node20

# Generate a default tsconfig.json (optional - xtsjs works without it!)
xtsjs init

# Generate tsconfig.json with custom directories
xtsjs init --src source --out output

# Overwrite existing tsconfig.json
xtsjs init --force
```

### Programmatic API

```typescript
import { xtsjs } from "xtsjs";

await xtsjs({
  srcDir: "src",
  outDir: "dist",
  target: "node18",
  sourcemap: false,
  declaration: true,
  esbuildOptions: {
    // Additional esbuild options
  },
});
```

## Why?

When building TypeScript for ESM, import statements must use `.js` extensions even though the source files are `.ts`. This tool automatically handles that rewriting so you can use `.ts` extensions in your source code.

It's kind of hard to wrap my head around importing a file that doesn't exist in my source.

**No configuration required!** xtsjs works out of the box without a `tsconfig.json`. It provides sensible defaults optimized for modern TypeScript/ESM projects:
- ES2022 target with ESNext modules
- Full ESM interop support
- `.ts` extension imports
- Strict type checking
- And more!

If you need to customize compiler settings, use `xtsjs init` to generate a default `tsconfig.json` that you can modify.

**Before (in your .ts files):**

```typescript
import { foo } from "./utils.ts";
```

**After (in compiled .js files):**

```typescript
import { foo } from "./utils.js";
```

## Options

### CLI Options

#### Build Command (default)

- `-s, --src <dir>` - Source directory (default: `src`)
- `-o, --out <dir>` - Output directory (default: `dist`)
- `-t, --target <ver>` - Node.js target version (default: `node18`)
- `-d, --declaration` - Generate TypeScript declaration files (default: `true`)
- `--sourcemap` - Enable source maps (default: `false`)
- `-h, --help` - Show help message

#### Init Command

Generate a default `tsconfig.json` with optimal settings for xtsjs:

```bash
xtsjs init [options]
```

Options:
- `-s, --src <dir>` - Source directory (default: `src`)
- `-o, --out <dir>` - Output directory (default: `dist`)
- `--force` - Overwrite existing tsconfig.json

The generated `tsconfig.json` includes:
- Modern ES2022 target with ESNext modules
- Bundler module resolution
- Support for `.ts` extensions in imports (`allowImportingTsExtensions`)
- Full ESM interop (`esModuleInterop`, `allowSyntheticDefaultImports`)
- Downlevel iteration support for Map/Set
- Strict type checking enabled
- Declaration file generation configured

### API Options

```typescript
interface XtsjsOptions {
  srcDir?: string; // default: 'src'
  outDir?: string; // default: 'dist'
  target?: string; // default: 'node18'
  sourcemap?: boolean; // default: false
  declaration?: boolean; // default: true
  esbuildOptions?: Partial<BuildOptions>;
}
```

## Package.json Scripts

Add to your `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "xtsjs"
  },
  "devDependencies": {
    "xtsjs": "^0.1.0",
    "typescript": "^5.0.0"
  }
}
```

## License

MIT
