// Local development uses local CORS allowances; production start keeps its configured environment.
process.env.APP_ENV = "development";
await import("./index.js");
