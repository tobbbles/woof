import { createRequestHandler } from "@remix-run/cloudflare";
// @ts-expect-error - Remix Vite server build
import * as build from "./build/server/index.js";

const handler = createRequestHandler(build);

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    return handler(request, {
      cloudflare: { env, ctx },
    });
  },
};
