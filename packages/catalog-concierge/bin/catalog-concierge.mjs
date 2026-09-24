#!/usr/bin/env node
/**
 * Thin wrapper so `npx catalog-concierge` works from the published package.
 * The command itself lives in src/cli.ts and is testable without a process.
 */
import { run } from "../dist/cli.js";

process.exitCode = await run(process.argv.slice(2));
