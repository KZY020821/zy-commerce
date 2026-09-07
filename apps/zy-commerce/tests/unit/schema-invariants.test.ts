/**
 * Guards the multi-tenancy invariant at the schema level: every Prisma model
 * must either carry `tenantId` and be listed in TENANT_SCOPED_MODELS, or be
 * explicitly allow-listed in UNSCOPED_MODELS. Adding a model without deciding
 * fails CI.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TENANT_SCOPED_MODELS, UNSCOPED_MODELS } from "@/lib/db/tenant-scope";

const schema = readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

interface ModelInfo {
  name: string;
  fields: Map<string, string>; // field name → type token (e.g. "String?", "Tenant")
}

function parseModels(src: string): Map<string, ModelInfo> {
  const models = new Map<string, ModelInfo>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const fields = new Map<string, string>();
    for (const raw of m[2]!.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const [name, type] = line.split(/\s+/);
      if (name && type) fields.set(name, type);
    }
    models.set(m[1]!, { name: m[1]!, fields });
  }
  return models;
}

const models = parseModels(schema);

describe("schema tenant-isolation invariants", () => {
  it("parsed the schema", () => {
    expect(models.size).toBeGreaterThan(5);
  });

  it("every model is either tenant-scoped or explicitly unscoped, with no overlap", () => {
    const scoped = new Set<string>(TENANT_SCOPED_MODELS);
    const unscoped = new Set<string>(UNSCOPED_MODELS);
    for (const s of scoped) expect(unscoped.has(s), `${s} in both lists`).toBe(false);
    const declared = new Set([...scoped, ...unscoped]);
    const inSchema = new Set(models.keys());
    expect([...inSchema].sort()).toEqual([...declared].sort());
  });

  it("every tenant-scoped model has a tenantId column and a tenant relation", () => {
    for (const name of TENANT_SCOPED_MODELS) {
      const model = models.get(name);
      expect(model, `${name} missing from schema`).toBeDefined();
      expect(model!.fields.get("tenantId"), `${name}.tenantId`).toMatch(/^String\??$/);
      expect(model!.fields.get("tenant"), `${name}.tenant relation`).toMatch(/^Tenant\??$/);
    }
  });

  it("tenantId is NOT NULL on every scoped model except User (super admins)", () => {
    for (const name of TENANT_SCOPED_MODELS) {
      const type = models.get(name)!.fields.get("tenantId");
      if (name === "User") expect(type).toBe("String?");
      else expect(type, `${name}.tenantId must be required`).toBe("String");
    }
  });

  it("unscoped models really have no tenantId", () => {
    for (const name of UNSCOPED_MODELS) {
      expect(models.get(name)!.fields.has("tenantId"), name).toBe(false);
    }
  });
});
