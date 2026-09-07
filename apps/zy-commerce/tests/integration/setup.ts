import { config } from "dotenv";

config({ path: ".env.test", override: true });

const url = process.env.DATABASE_URL ?? "";
if (!/_test(\?|$)/.test(url)) {
  throw new Error(`Refusing to run integration tests against a non-test database: "${url}". Check .env.test.`);
}
