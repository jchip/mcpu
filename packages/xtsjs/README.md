# xtsjs

Fast TypeScript build tool powered by esbuild. Zero configuration needed.

## Features

- 🚀 Fast builds powered by esbuild
- 📦 Works out of the box without tsconfig.json
- 📘 TypeScript declaration files (.d.ts) generation
- ✅ Optional type checking with `--typecheck`
- 🎯 ESM and CommonJS output support

## Installation

```bash
npm install --save-dev xtsjs
```

**Optional:** Install TypeScript for declaration files and type checking:

```bash
npm install --save-dev typescript
```

**For type checking:** If you want IDE support (VS Code IntelliSense, etc.) or build/CI type checking with `--typecheck`, you'll need a `tsconfig.json`. Generate one with `xtsjs init`.

## Usage

### CLI

```bash
# Build with defaults (src -> dist)
xtsjs

# Run type checking before build
xtsjs --typecheck

# Custom directories
xtsjs --src src --out dist

# Output CommonJS format instead of ESM
xtsjs --cjs

# Enable source maps
xtsjs --sourcemap

# Generate a tsconfig.json
xtsjs init
```

### Programmatic API

```typescript
import { xtsjs } from "xtsjs";

await xtsjs({
  srcDir: "src",
  outDir: "dist",
  typecheck: true,
  format: "esm",
});
```

## Options

### CLI Options

- `-s, --src <dir>` - Source directory (default: `src`)
- `-o, --out <dir>` - Output directory (default: `dist`)
- `-t, --target <ver>` - Node.js target version (default: `node18`)
- `-d, --declaration` - Generate .d.ts files (default: `true`)
- `--sourcemap` - Enable source maps (default: `false`)
- `--cjs` - Output CommonJS format (default: ESM)
- `--typecheck` - Run type checking before build (requires tsconfig.json)

### API Options

```typescript
interface XtsjsOptions {
  srcDir?: string; // default: 'src'
  outDir?: string; // default: 'dist'
  target?: string; // default: 'node18'
  sourcemap?: boolean; // default: false
  declaration?: boolean; // default: true
  format?: 'esm' | 'cjs'; // default: 'esm'
  typecheck?: boolean; // default: false
  esbuildOptions?: Partial<BuildOptions>;
}
```

## Package.json Scripts

```json
{
  "type": "module",
  "scripts": {
    "build": "xtsjs",
    "build:check": "xtsjs --typecheck"
  }
}
```

## Notes

By default, xtsjs rewrites `.ts` imports to `.js` in the output. If you prefer to handle this yourself (e.g., with TypeScript 5.7+ `rewriteRelativeImportExtensions`), you can use esbuild directly or pass custom esbuild options.

## License

MIT
