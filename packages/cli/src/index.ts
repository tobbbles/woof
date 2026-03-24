#!/usr/bin/env node
import { setup } from "./setup.js";

setup().catch((err) => {
  console.error(err);
  process.exit(1);
});
