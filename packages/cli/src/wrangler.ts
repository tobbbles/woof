import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

// ── Wrangler config types ───────────────────────────────────────────

export interface WranglerRoute {
  pattern: string;
  zone_name: string;
}

export interface WranglerKvNamespace {
  binding: string;
  id: string;
  preview_id?: string;
}

export interface WranglerD1Database {
  binding: string;
  database_name: string;
  database_id: string;
  migrations_dir?: string;
}

export interface WranglerAssets {
  directory: string;
}

export interface WranglerConfig {
  name?: string;
  main?: string;
  compatibility_date?: string;
  routes?: WranglerRoute[];
  kv_namespaces?: WranglerKvNamespace[];
  d1_databases?: WranglerD1Database[];
  assets?: WranglerAssets;
  vars?: Record<string, string>;
}

// ── Config read/write ───────────────────────────────────────────────

/** Read and parse a wrangler.toml into a typed config. */
export function readConfig(packageDir: string): WranglerConfig {
  const raw = readFileSync(resolve(packageDir, "wrangler.toml"), "utf-8");
  return parseToml(raw) as unknown as WranglerConfig;
}

/** Serialize and write a typed config back to wrangler.toml. */
export function writeConfig(packageDir: string, config: WranglerConfig): void {
  const content = stringifyToml(config as Record<string, unknown>);
  writeFileSync(resolve(packageDir, "wrangler.toml"), content, "utf-8");
}

// ── Wrangler CLI execution ──────────────────────────────────────────

export interface WranglerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Run a wrangler command in a package directory.
 * Streams stdout/stderr to the provided log function in real-time.
 */
export function wrangler(args: string, cwd: string, onOutput?: (line: string) => void): Promise<WranglerResult> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["wrangler", ...args.split(" ")], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      if (onOutput) {
        for (const line of text.split("\n").filter(Boolean)) {
          onOutput(line.trim());
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      if (onOutput) {
        for (const line of text.split("\n").filter(Boolean)) {
          onOutput(line.trim());
        }
      }
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
      });
    });
  });
}
