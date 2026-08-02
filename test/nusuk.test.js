import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nusuk } from "../src/nusuk.js";

test("loadEntity applies explicit, environment, then file precedence per field", () => {
  const directory = mkdtempSync(join(tmpdir(), "toque-"));
  const entityPath = join(directory, "entity.json");
  writeFileSync(entityPath, JSON.stringify({ activeEntityId: "file-id", activeEntityTypeId: "file-type" }));

  const previousId = process.env.ACTIVE_ENTITY_ID;
  process.env.ACTIVE_ENTITY_ID = "env-id";
  try {
    const nusuk = new Nusuk().loadEntity({ path: entityPath, activeEntityTypeId: "explicit-type" });
    assert.equal(nusuk.entityId, "env-id");
    assert.equal(nusuk.entityTypeId, "explicit-type");
  } finally {
    if (previousId === undefined) delete process.env.ACTIVE_ENTITY_ID;
    else process.env.ACTIVE_ENTITY_ID = previousId;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadEntity refreshes entity headers from the current entity.json state", () => {
  const directory = mkdtempSync(join(tmpdir(), "toque-entity-"));
  const entityPath = join(directory, "entity.json");
  writeFileSync(entityPath, JSON.stringify({ activeEntityId: "new-entity", activeEntityTypeId: "new-type" }));

  const nusuk = new Nusuk();
  nusuk.setEntityId("old-entity");
  nusuk.setEntityTypeId("old-type");
  nusuk.loadEntity({ path: entityPath });

  assert.equal(nusuk.entityId, "new-entity");
  assert.equal(nusuk.entityTypeId, "new-type");
  assert.equal(nusuk.defaultHeaders["activeentityid"], "new-entity");
  assert.equal(nusuk.defaultHeaders["entity-id"], "new-entity");
  assert.equal(nusuk.defaultHeaders["activeentitytypeid"], "new-type");
  rmSync(directory, { recursive: true, force: true });
});

test("request rejects cross-origin URLs before browser evaluation", async () => {
  let evaluated = false;
  const nusuk = new Nusuk({ baseUrl: "https://masar.nusuk.sa" });
  nusuk.page = {
    url: () => "https://masar.nusuk.sa/dashboard",
    evaluate: async () => { evaluated = true; },
  };

  await assert.rejects(
    nusuk.request("https://masar.nusuk.sa.attacker.example/collect"),
    /Refusing cross-origin request/
  );
  assert.equal(evaluated, false);
});

test("request permits paths on the configured origin", async () => {
  const nusuk = new Nusuk({ baseUrl: "https://example.test" });
  nusuk.page = {
    url: () => "https://example.test/dashboard",
    evaluate: async (_callback, input) => ({ url: input.url }),
  };

  const result = await nusuk.request("/api/status");
  assert.equal(result.url, "https://example.test/api/status");
});
