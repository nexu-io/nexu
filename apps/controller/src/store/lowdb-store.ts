import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
export class LowDbStore<T> {
  private cache: T | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly schema: { parse(input: unknown): T },
    private readonly createDefault: () => T,
  ) {}

  async read(): Promise<T> {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      this.cache = await this.readAndParse(this.filePath);
      return this.cache;
    } catch {
      const backupPath = `${this.filePath}.bak`;
      try {
        this.cache = await this.readAndParse(backupPath);
        await this.write(this.cache);
        return this.cache;
      } catch {
        const fallback = this.createDefault();
        this.cache = this.schema.parse(fallback);
        await this.write(this.cache);
        return this.cache;
      }
    }
  }

  async write(nextValue: T): Promise<void> {
    const validated = this.schema.parse(nextValue);

    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      const backupPath = `${this.filePath}.bak`;
      const payload = `${JSON.stringify(validated, null, 2)}\n`;
      await writeFile(tempPath, payload, "utf8");
      await writeFile(backupPath, payload, "utf8");
      await rename(tempPath, this.filePath);
      this.cache = validated;
    });

    await this.writeQueue;
  }

  async update(updater: (current: T) => T | Promise<T>): Promise<T> {
    const current = await this.read();
    const nextValue = await updater(current);
    await this.write(nextValue);
    return nextValue;
  }

  private async readAndParse(filePath: string): Promise<T> {
    const raw = await readFile(filePath, "utf8");
    return this.schema.parse(JSON.parse(raw));
  }
}
