declare module "pg" {
  export class Pool {
    constructor(config: { connectionString: string });
    query(sql: string, values?: unknown[]): Promise<unknown>;
    end(): Promise<void>;
  }
}
