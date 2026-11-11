#!/usr/bin/env node
"use strict";
// Standalone worker: never imports the web app or mail workers.
const path = require("node:path"),
  { slot } = require("../server/integrations/google-sheets/model");
async function main() {
  const args = process.argv.slice(2),
    check = args.at(-1) === "--check";
  if (check) args.pop();
  if (
    args.length !== 6 ||
    args[0] !== "--env" ||
    args[2] !== "--host" ||
    args[4] !== "--database" ||
    !path.isAbsolute(args[1])
  )
    throw Error();
  if (!check && !slot()) {
    console.log(JSON.stringify({ skipped: true, reason: "outside_schedule" }));
    return;
  }
  const database = require("./database"),
    config = database.settings(args[1], args[3], args[5]);
  const env = config.env;
  if (!check && env.CRM_SHEETS_ENABLED !== "1") {
    console.log(JSON.stringify({ skipped: true, reason: "disabled" }));
    return;
  }
  const db = database.connect(config);
  try {
    const service = require("../server/integrations/google-sheets/service")(
      db,
      { env },
    );
    const result = await (check ? service.check() : service.sync());
    console.log(JSON.stringify(result));
    if (result.ok === false) process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(
      JSON.stringify(
        require("../server/integrations/google-sheets/model").diagnostic(error),
      ),
    );
    process.exitCode = 1;
  });
module.exports = { main };
