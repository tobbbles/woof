import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { EvalContextEntry, Flag, Rule, Segment } from "@woof/types";
import { getApiClient } from "~/lib/api.server";

export interface RulesContext {
  flags: Flag[];
  rules: Rule[];
  segments: Segment[];
  evalContexts: EvalContextEntry[];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const [{ flags }, { rules }, { segments }, { entries: evalContexts }] = await Promise.all([
    api.listFlags(),
    api.listRules(),
    api.listSegments(),
    api.listEvalContexts({ limit: 50, full: true }),
  ]);
  return json({ flags, rules, segments, evalContexts });
}

export default function RulesLayout() {
  const data = useLoaderData<typeof loader>();
  return <Outlet context={data satisfies RulesContext} />;
}
