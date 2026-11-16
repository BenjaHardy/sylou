// The commands of a Sylou Local install that are not a web request. The
// scripts on your computer call this through Docker:
//
//   docker compose run --rm tools secrets          make the secret files
//   docker compose run --rm tools migrate          apply the migrations
//   docker compose run --rm tools add-user <email> make an account
//   docker compose run --rm tools reset-password <email>
//
// Each one prints what it did and nothing it should not: a secret's name and
// length, never its value.
import { makeSecrets } from "./secrets.ts";
import { migrate } from "./migrate.ts";
import { addUser, resetPassword } from "./users.ts";
import { doctor } from "./doctor.ts";
import { models } from "./models.ts";

const USAGE = `Sylou Local tools

  secrets [--force]        make this install's secret files in /out
  migrate                  apply Sylou's migrations to the database
  add-user <email>         make an account and print a one-time link
  reset-password <email>   print a one-time link to set a new password
  doctor                   read the facts on standard input and report
  window <model>           find the largest window that runs on the card
`;

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "secrets":
      return await makeSecrets({ dir: "/out", force: rest.includes("--force") });
    case "migrate":
      return await migrate({ migrationsDir: "/migrations" });
    case "add-user":
      return await addUser(rest[0] ?? "");
    case "reset-password":
      return await resetPassword(rest[0] ?? "");
    case "doctor":
      return await doctor();
    case "window":
      return await models(rest);
    case undefined:
    case "help":
    case "--help":
      console.log(USAGE);
      return 0;
    default:
      console.error(`tools: no command called "${command}"\n`);
      console.error(USAGE);
      return 2;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
