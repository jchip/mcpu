#!/usr/bin/env node
import { NixClap } from "nix-clap";
import { xtsjs, init } from "./index.js";

const nc = new NixClap({ name: "xtsjs" })
  .version("0.1.0")
  .usage("$0 [options]")
  .init2({
    desc: "TypeScript build tool with ESM import extension rewriting",
    options: {
      src: {
        alias: "s",
        desc: "Source directory",
        args: "<dir string>",
        argDefault: ["src"],
      },
      out: {
        alias: "o",
        desc: "Output directory",
        args: "<dir string>",
        argDefault: ["dist"],
      },
      target: {
        alias: "t",
        desc: "Node.js target version",
        args: "<ver string>",
        argDefault: ["node18"],
      },
      sourcemap: {
        desc: "Enable source maps",
        args: "<flag boolean>",
        argDefault: ["false"],
      },
      declaration: {
        alias: "d",
        desc: "Generate TypeScript declaration files (.d.ts)",
        args: "<flag boolean>",
        argDefault: ["true"],
      },
      cjs: {
        desc: "Output CommonJS format instead of ESM",
      },
      typecheck: {
        desc: "Run type checking before build (requires tsconfig.json)",
      },
    },
    exec: async (cmd) => {
      const opts = cmd.jsonMeta.opts;

      try {
        await xtsjs({
          srcDir: opts.src as string,
          outDir: opts.out as string,
          target: opts.target as string,
          sourcemap: opts.sourcemap as boolean,
          declaration: opts.declaration as boolean,
          format: opts.cjs ? "cjs" : "esm",
          typecheck: opts.typecheck as boolean,
        });
        console.log("Build complete!");
      } catch (error) {
        console.error(
          "Build failed:",
          error instanceof Error ? error.message : error
        );
        process.exit(1);
      }
    },
    subCommands: {
      init: {
        desc: "Generate a default tsconfig.json file",
        options: {
          force: {
            desc: "Overwrite existing tsconfig.json",
            args: "<flag boolean>",
            argDefault: ["false"],
          },
        },
        exec: async (cmd) => {
          const opts = cmd.jsonMeta.opts;

          try {
            await init({
              srcDir: opts.src as string,
              outDir: opts.out as string,
              force: opts.force as boolean,
            });
          } catch (error) {
            console.error(
              "Init failed:",
              error instanceof Error ? error.message : error
            );
            process.exit(1);
          }
        },
      },
    },
  });

await nc.parseAsync();
