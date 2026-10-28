import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Buttons wired at load must exist in the page, or the whole script stops.
test("every element wired at load is in index.html", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../ui.js", import.meta.url), "utf8");
  const wired = [...ui.matchAll(/^\$\("#([\w-]+)"\)\.(?:onclick|addEventListener)/gm)].map((m) => m[1]);
  assert.ok(wired.length > 5);
  for (const id of wired) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});
