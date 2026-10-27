#!/usr/bin/env node
/**
 * Build script - compiles every TypeScript project and copies the static
 * renderer assets.
 *
 * Deliberately uses the TypeScript compiler API in-process instead of spawning
 * `tsc`: no bundler, no child processes, one dependency (typescript itself).
 *
 * Usage: node scripts/build.mjs [--watch]
 */

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const projects = [
  { name: "core", config: "packages/core/tsconfig.json" },
  { name: "ui", config: "packages/ui/tsconfig.json" },
  { name: "desktop:main", config: "apps/desktop/tsconfig.main.json" },
  { name: "desktop:renderer", config: "apps/desktop/tsconfig.renderer.json" },
];

/** Static files the renderer loads at runtime (copied next to the emitted JS). */
const staticFiles = [
  ["apps/desktop/src/renderer/index.html", "apps/desktop/dist/renderer/index.html"],
];

function buildProject({ name, config }) {
  const configPath = path.join(root, config);
  const started = Date.now();

  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        console.error(`[${name}] ${message}`);
        process.exit(1);
      },
    },
  );

  if (!parsed) {
    console.error(`[${name}] could not read ${config}`);
    process.exit(1);
  }

  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const result = program.emit();

  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(result.diagnostics)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

  if (diagnostics.length > 0) {
    // Plain formatting on purpose: colour escapes make CI logs and pipes noisy.
    console.error(ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }));
    console.error(`[${name}] ${diagnostics.length} error(s)`);
    process.exit(1);
  }

  const ms = Date.now() - started;
  console.log(`[${name}] built in ${ms}ms`);
}

function copyStatic() {
  for (const [from, to] of staticFiles) {
    const source = path.join(root, from);
    const target = path.join(root, to);
    if (!fs.existsSync(source)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  console.log("[static] renderer assets copied");
}

const started = Date.now();
for (const project of projects) buildProject(project);
copyStatic();
console.log(`build complete in ${Date.now() - started}ms`);
