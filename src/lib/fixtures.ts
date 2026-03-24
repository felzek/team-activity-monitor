import { readFileSync } from "node:fs";
import path from "node:path";

export function loadFixture<T>(fixtureDir: string, fileName: string): T {
  const absolutePath = path.join(fixtureDir, fileName);
  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as T;
}
