import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { createDnsRecord, findApiToken, findDnsRecord, getZoneId } from "./cloudflare.js";
import { readConfig, wrangler, writeConfig } from "./wrangler.js";

// import.meta.dirname = packages/cli/dist → ../.. = packages/
const PACKAGES_DIR = resolve(import.meta.dirname, "../..");

function serviceDir(): string {
  return resolve(PACKAGES_DIR, "service");
}

function adminUiDir(): string {
  return resolve(PACKAGES_DIR, "admin-ui");
}

// ── Config detection ──────────────────────────────────────────────────

interface ExistingConfig {
  domain: string | undefined;
  zoneName: string | undefined;
  kvId: string | undefined;
  kvPreviewId: string | undefined;
  accessTeamDomain: string | undefined;
  accessAud: string | undefined;
  corsOrigins: string | undefined;
}

function detectExistingConfig(): ExistingConfig {
  const service = readConfig(serviceDir());
  const admin = readConfig(adminUiDir());

  // Domain from routes (first route's pattern, strip the path)
  const routePattern = admin.routes?.[0]?.pattern ?? service.routes?.[0]?.pattern;
  const domain = routePattern?.replace(/\/.*$/, "");

  // Zone from routes
  const zoneName = service.routes?.[0]?.zone_name ?? admin.routes?.[0]?.zone_name;

  // KV namespace — find the FLAGS binding
  const flagsNs = service.kv_namespaces?.find((ns) => ns.binding === "FLAGS");
  const kvId = flagsNs?.id && flagsNs.id !== "REPLACE_ME" ? flagsNs.id : undefined;
  const kvPreviewId =
    flagsNs?.preview_id && flagsNs.preview_id !== "REPLACE_ME_PREVIEW" ? flagsNs.preview_id : undefined;

  // SERVICE_URL as a fallback for domain
  const serviceUrlDomain = admin.vars?.SERVICE_URL?.replace(/^https?:\/\//, "");

  // Access config from .dev.vars
  const accessTeamDomain = readDevVar("ACCESS_TEAM_DOMAIN");
  const accessAud = readDevVar("ACCESS_AUD");

  // CORS origins from wrangler.toml [vars] or .dev.vars
  const corsOrigins = service.vars?.CORS_ORIGINS ?? readDevVar("CORS_ORIGINS");

  // Ignore placeholder domains from the .example template
  const resolvedDomain = domain ?? serviceUrlDomain;
  const isPlaceholder = resolvedDomain?.includes("example.com");

  return {
    domain: isPlaceholder ? undefined : resolvedDomain,
    zoneName: isPlaceholder ? undefined : zoneName,
    kvId,
    kvPreviewId,
    accessTeamDomain,
    accessAud,
    corsOrigins: corsOrigins || undefined,
  };
}

function readDevVar(name: string): string | undefined {
  const devVarsPath = resolve(serviceDir(), ".dev.vars");
  if (!existsSync(devVarsPath)) return undefined;
  const content = readFileSync(devVarsPath, "utf-8");
  const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));
  return match?.[1]?.trim() || undefined;
}

// ── Main setup flow ─────────────────────────────────────────────────

export async function setup() {
  p.intro(pc.bgCyan(pc.black(" woof setup ")));

  // Bootstrap wrangler.toml from .example template if it doesn't exist yet
  bootstrapConfig(serviceDir());
  bootstrapConfig(adminUiDir());

  const existing = detectExistingConfig();

  if (existing.domain || existing.kvId || existing.accessTeamDomain) {
    p.log.info("Detected existing configuration — values will be used as defaults.");
  }

  // ── Step 1: Domain ──────────────────────────────────────────────────

  const domain = await p.text({
    message: "What subdomain will Woof be deployed to?",
    placeholder: "woof.example.com",
    initialValue: existing.domain ?? "",
    validate(value) {
      if (!value) return "A domain is required.";
      if (!value.includes(".")) return "Enter a full domain (e.g., woof.example.com).";
    },
  });
  if (p.isCancel(domain)) return cancelAndExit();

  const detectedZone = existing.zoneName ?? extractZoneName(domain);

  const confirmZone = await p.confirm({
    message: `Zone name detected as ${pc.cyan(detectedZone)}. Is this correct?`,
    initialValue: true,
  });
  if (p.isCancel(confirmZone)) return cancelAndExit();

  let finalZone = detectedZone;
  if (!confirmZone) {
    const customZone = await p.text({
      message: "Enter your Cloudflare zone name:",
      placeholder: "example.com",
      initialValue: existing.zoneName ?? "",
    });
    if (p.isCancel(customZone)) return cancelAndExit();
    finalZone = customZone;
  }

  // ── Step 2: Write routes to wrangler.toml files ─────────────────────

  const s = p.spinner();
  s.start("Configuring routes");

  configureServiceConfig(domain, finalZone);
  configureAdminConfig(domain, finalZone);

  s.stop("Routes configured");

  p.log.success(`${pc.bold("packages/service/wrangler.toml")} → /api/v1/*, /ofrep/v1/*, /healthz`);
  p.log.success(`${pc.bold("packages/admin-ui/wrangler.toml")} → /*, SERVICE_URL = https://${domain}`);

  // ── Step 2b: DNS record ───────────────────────────────────────────

  p.log.step(pc.bold("DNS"));
  p.log.message("Workers routes require a proxied DNS record for the subdomain.");

  const auth = findApiToken();
  if (auth) {
    s.start("Looking up zone…");
    const zoneId = await getZoneId(finalZone, auth.token);

    if (!zoneId) {
      s.stop("Zone not found");
      p.log.warn(`Could not find zone ${pc.cyan(finalZone)} via the Cloudflare API.`);
      printDnsManualGuide(domain);
    } else {
      s.start(`Checking DNS for ${domain}…`);
      const existingRecord = await findDnsRecord(zoneId, domain, auth.token);

      if (existingRecord) {
        s.stop(`DNS record already exists (${existingRecord.type} → ${existingRecord.content})`);
      } else {
        s.stop("No DNS record found");

        if (auth.source === "oauth") {
          // Wrangler's OAuth token doesn't have DNS write permissions.
          p.log.warn("Wrangler's login token doesn't include DNS write permissions.");
          p.log.info(
            `To allow the CLI to create DNS records, set ${pc.cyan("CLOUDFLARE_API_TOKEN")} with Zone:DNS:Edit scope.`,
          );
          p.log.info(`Create one at: ${pc.cyan("https://dash.cloudflare.com/profile/api-tokens")}`);
          p.log.message("");
          printDnsManualGuide(domain);
        } else {
          const createDns = await p.confirm({
            message: `Create a proxied AAAA record for ${pc.cyan(domain)}?`,
            initialValue: true,
          });
          if (p.isCancel(createDns)) return cancelAndExit();

          if (createDns) {
            s.start("Creating DNS record…");
            const dnsResult = await createDnsRecord(zoneId, domain, auth.token);
            if (dnsResult.ok) {
              s.stop(`DNS record created: ${pc.cyan(domain)} → AAAA 100:: (proxied)`);
            } else {
              s.stop("Failed to create DNS record");
              const errMsg = dnsResult.errors?.map((e) => e.message).join(", ") ?? "Unknown error";
              p.log.error(errMsg);
              printDnsManualGuide(domain);
            }
          }
        }
      }
    }
  } else {
    p.log.warn("No Cloudflare API token found. Skipping DNS setup.");
    p.log.info(`Run ${pc.cyan("npx wrangler login")} first, or set ${pc.cyan("CLOUDFLARE_API_TOKEN")}.`);
    printDnsManualGuide(domain);
  }

  // ── Step 3: KV namespace ────────────────────────────────────────────

  if (existing.kvId) {
    p.log.success(`KV namespace already configured: ${pc.cyan(existing.kvId)}`);
  }

  const createKv = await p.confirm({
    message: existing.kvId
      ? "KV namespace already exists. Create a new one instead?"
      : "Create a Cloudflare KV namespace for flag storage?",
    initialValue: !existing.kvId,
  });
  if (p.isCancel(createKv)) return cancelAndExit();

  if (createKv) {
    p.log.info(pc.dim(`$ npx wrangler kv namespace create FLAGS`));
    s.start("Creating KV namespace…");
    const result = await wrangler("kv namespace create FLAGS", serviceDir(), (line) => {
      s.message(`Creating KV namespace… ${pc.dim(line)}`);
    });

    if (result.ok) {
      s.stop("KV namespace created");

      const idMatch = result.stdout.match(/id\s*=\s*"([^"]+)"/);
      if (idMatch) {
        const kvId = idMatch[1];
        updateServiceKvId(kvId);
        p.log.success(`KV namespace ID ${pc.cyan(kvId)} written to wrangler.toml`);
      } else {
        p.log.warn("Could not parse namespace ID from wrangler output. Update wrangler.toml manually:");
        p.log.message(result.stdout);
      }
    } else {
      s.stop("KV namespace creation failed");
      p.log.error(result.stderr || result.stdout);
      p.log.info("You can create it manually later:");
      p.log.message(`  cd packages/service && npx wrangler kv namespace create FLAGS`);
    }
  }

  // Preview namespace
  if (existing.kvPreviewId) {
    p.log.success(`Preview KV namespace already configured: ${pc.cyan(existing.kvPreviewId)}`);
  }

  const createPreview = await p.confirm({
    message: existing.kvPreviewId
      ? "Preview KV namespace already exists. Create a new one?"
      : "Create a preview KV namespace for local development?",
    initialValue: !existing.kvPreviewId,
  });
  if (p.isCancel(createPreview)) return cancelAndExit();

  if (createPreview) {
    p.log.info(pc.dim(`$ npx wrangler kv namespace create FLAGS --preview`));
    s.start("Creating preview KV namespace…");
    const previewResult = await wrangler("kv namespace create FLAGS --preview", serviceDir(), (line) => {
      s.message(`Creating preview KV namespace… ${pc.dim(line)}`);
    });

    if (previewResult.ok) {
      s.stop("Preview KV namespace created");

      const previewIdMatch = previewResult.stdout.match(/id\s*=\s*"([^"]+)"/);
      if (previewIdMatch) {
        updateServiceKvPreviewId(previewIdMatch[1]);
        p.log.success(`Preview namespace ID written to wrangler.toml`);
      }
    } else {
      s.stop("Preview namespace creation failed");
      p.log.warn(previewResult.stderr || previewResult.stdout);
    }
  }

  // ── Step 4: Cloudflare Access ───────────────────────────────────────

  p.log.step(pc.bold("Cloudflare Access (SSO)"));

  if (existing.accessTeamDomain && existing.accessAud) {
    p.log.success(`Access already configured:`);
    p.log.message(`  Team domain: ${pc.cyan(existing.accessTeamDomain)}`);
    p.log.message(`  AUD tag:     ${pc.cyan(existing.accessAud.slice(0, 16))}…`);
  } else {
    p.log.message(`Woof uses Cloudflare Access to protect the admin API and UI.
You'll need to configure this in the Cloudflare Zero Trust dashboard.`);
  }

  const configureAccess = await p.confirm({
    message: existing.accessTeamDomain
      ? "Update Cloudflare Access configuration?"
      : "Have you already set up Cloudflare Access for this domain?",
    initialValue: !existing.accessTeamDomain,
  });
  if (p.isCancel(configureAccess)) return cancelAndExit();

  if (configureAccess) {
    const teamDomain = await p.text({
      message: "Cloudflare Access team domain:",
      placeholder: "https://myteam.cloudflareaccess.com",
      initialValue: existing.accessTeamDomain ?? "",
      validate(value) {
        if (!value) return "Required.";
        if (!value.startsWith("https://")) return "Must start with https://";
      },
    });
    if (p.isCancel(teamDomain)) return cancelAndExit();

    const aud = await p.text({
      message: "Access Application Audience (AUD) tag:",
      placeholder: "paste from Access dashboard",
      initialValue: existing.accessAud ?? "",
      validate(value) {
        if (!value) return "Required.";
      },
    });
    if (p.isCancel(aud)) return cancelAndExit();

    // Write .dev.vars for local development
    writeDevVars(teamDomain, aud);
    p.log.success(`${pc.bold("packages/service/.dev.vars")} written for local development`);

    // Check if the Worker exists before attempting to set secrets.
    s.start("Checking if woof-api Worker exists…");
    const listResult = await wrangler("secret list", serviceDir());
    s.stop(listResult.ok ? "Worker found" : "Worker not yet deployed");

    if (listResult.ok) {
      const setSecrets = await p.confirm({
        message: "Set Access secrets on the deployed Worker now?",
        initialValue: true,
      });
      if (p.isCancel(setSecrets)) return cancelAndExit();

      if (setSecrets) {
        s.start("Setting ACCESS_TEAM_DOMAIN secret…");
        const r1 = await wrangler(`secret put ACCESS_TEAM_DOMAIN --value "${teamDomain}"`, serviceDir(), (line) => {
          s.message(`Setting ACCESS_TEAM_DOMAIN… ${pc.dim(line)}`);
        });
        if (r1.ok) {
          s.stop("ACCESS_TEAM_DOMAIN set");
        } else {
          s.stop("Failed to set ACCESS_TEAM_DOMAIN");
          p.log.error(r1.stderr || r1.stdout || `wrangler exited with code ${r1.code}`);
        }

        s.start("Setting ACCESS_AUD secret…");
        const r2 = await wrangler(`secret put ACCESS_AUD --value "${aud}"`, serviceDir(), (line) => {
          s.message(`Setting ACCESS_AUD… ${pc.dim(line)}`);
        });
        if (r2.ok) {
          s.stop("ACCESS_AUD set");
        } else {
          s.stop("Failed to set ACCESS_AUD");
          p.log.error(r2.stderr || r2.stdout || `wrangler exited with code ${r2.code}`);
        }
      }
    } else {
      p.log.info(`Worker not yet deployed. After your first ${pc.cyan("yarn deploy")}, set secrets with:`);
      p.log.message(`  ${pc.cyan("cd packages/service")}`);
      p.log.message(`  ${pc.cyan(`npx wrangler secret put ACCESS_TEAM_DOMAIN`)} → enter: ${teamDomain}`);
      p.log.message(`  ${pc.cyan(`npx wrangler secret put ACCESS_AUD`)} → enter: ${aud}`);
    }
  } else if (!existing.accessTeamDomain) {
    printAccessGuide(domain);
  }

  // ── Step 5: CORS origins ──────────────────────────────────────────

  p.log.step(pc.bold("CORS"));
  p.log.message(
    "Browser-based apps using the OFREP web provider need their origin\nallowed in the CORS policy. Server-side SDKs are not affected.",
  );

  if (existing.corsOrigins) {
    p.log.success(`Current CORS origins: ${pc.cyan(existing.corsOrigins)}`);
  }

  const corsInput = await p.text({
    message: "Allowed CORS origins (comma-separated, leave blank to skip):",
    placeholder: "https://app.example.com,https://staging.example.com",
    initialValue: existing.corsOrigins ?? "",
  });
  if (p.isCancel(corsInput)) return cancelAndExit();

  const corsOrigins = corsInput.trim();
  if (corsOrigins) {
    updateServiceCorsOrigins(corsOrigins);
    p.log.success(`CORS_ORIGINS written to ${pc.bold("packages/service/wrangler.toml")} [vars]`);

    // Also add to .dev.vars for local development
    appendDevVar("CORS_ORIGINS", corsOrigins);
    p.log.success(`CORS_ORIGINS added to ${pc.bold("packages/service/.dev.vars")}`);
  } else if (!existing.corsOrigins) {
    p.log.info(
      `No CORS origins configured. Cross-origin browser requests will be rejected.\n` +
        `You can set this later in ${pc.cyan("packages/service/wrangler.toml")} under ${pc.cyan("[vars]")}:\n` +
        `  ${pc.cyan('CORS_ORIGINS = "https://app.example.com"')}`,
    );
  }

  // ── Summary ─────────────────────────────────────────────────────────

  p.log.step(pc.bold("Next steps"));

  const steps: string[] = [];
  if (!configureAccess && !existing.accessTeamDomain) {
    steps.push("Set up Cloudflare Access (see guide above)");
    steps.push("Run this setup again to configure Access secrets, or set them manually");
  }
  steps.push(`Deploy: ${pc.cyan("yarn deploy")}`);
  steps.push(`Verify: ${pc.cyan(`curl https://${domain}/healthz`)}`);

  p.log.message(steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n"));

  p.outro(pc.green("Setup complete!"));
}

// ── Helpers ──────────────────────────────────────────────────────────────

function cancelAndExit(): never {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

function extractZoneName(domain: string): string {
  const parts = domain.split(".");
  if (parts.length <= 2) return domain;
  return parts.slice(-2).join(".");
}

/** Update the service wrangler.toml with routes for the given domain/zone. */
function configureServiceConfig(domain: string, zone: string): void {
  const config = readConfig(serviceDir());
  config.routes = [
    { pattern: `${domain}/api/v1/*`, zone_name: zone },
    { pattern: `${domain}/ofrep/v1/*`, zone_name: zone },
    { pattern: `${domain}/healthz`, zone_name: zone },
  ];
  writeConfig(serviceDir(), config);
}

/** Update the admin-ui wrangler.toml with routes and SERVICE_URL. */
function configureAdminConfig(domain: string, zone: string): void {
  const config = readConfig(adminUiDir());
  config.routes = [{ pattern: `${domain}/*`, zone_name: zone }];
  config.vars = {
    ...config.vars,
    SERVICE_URL: `https://${domain}`,
  };
  writeConfig(adminUiDir(), config);
}

/** Update the FLAGS KV namespace ID in the service config. */
function updateServiceKvId(id: string): void {
  const config = readConfig(serviceDir());
  const ns = config.kv_namespaces?.find((ns) => ns.binding === "FLAGS");
  if (ns) {
    ns.id = id;
  } else {
    config.kv_namespaces = [...(config.kv_namespaces ?? []), { binding: "FLAGS", id }];
  }
  writeConfig(serviceDir(), config);
}

/** Update the FLAGS KV preview namespace ID in the service config. */
function updateServiceKvPreviewId(id: string): void {
  const config = readConfig(serviceDir());
  const ns = config.kv_namespaces?.find((ns) => ns.binding === "FLAGS");
  if (ns) {
    ns.preview_id = id;
  }
  writeConfig(serviceDir(), config);
}

function writeDevVars(teamDomain: string, aud: string): void {
  const content = `ACCESS_TEAM_DOMAIN=${teamDomain}\nACCESS_AUD=${aud}\n`;
  writeFileSync(resolve(serviceDir(), ".dev.vars"), content, "utf-8");
}

/** Append or update a variable in .dev.vars. */
function appendDevVar(name: string, value: string): void {
  const devVarsPath = resolve(serviceDir(), ".dev.vars");
  let content = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf-8") : "";
  const regex = new RegExp(`^${name}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${name}=${value}`);
  } else {
    content = content.trimEnd() + `\n${name}=${value}\n`;
  }
  writeFileSync(devVarsPath, content, "utf-8");
}

/** Write CORS_ORIGINS to the service wrangler.toml [vars] section. */
function updateServiceCorsOrigins(origins: string): void {
  const config = readConfig(serviceDir());
  config.vars = {
    ...config.vars,
    CORS_ORIGINS: origins,
  };
  writeConfig(serviceDir(), config);
}

function printDnsManualGuide(domain: string): void {
  p.log.info("Create the DNS record manually in the Cloudflare dashboard:");
  p.log.message(`  1. Go to ${pc.cyan("DNS > Records")} for your zone`);
  p.log.message(`  2. Add record: Type = ${pc.cyan("AAAA")}, Name = ${pc.cyan(domain)}, Content = ${pc.cyan("100::")}`);
  p.log.message(`  3. Ensure ${pc.cyan("Proxy status")} is enabled (orange cloud)`);
}

/**
 * Copy wrangler.toml.example → wrangler.toml if the real config doesn't exist.
 * This lets us gitignore wrangler.toml (contains real secrets/IDs) while
 * shipping the .example template for new users.
 */
function bootstrapConfig(dir: string): void {
  const configPath = resolve(dir, "wrangler.toml");
  const examplePath = resolve(dir, "wrangler.toml.example");
  if (!existsSync(configPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, configPath);
  }
  if (!existsSync(configPath)) {
    p.cancel(`Could not find wrangler.toml or wrangler.toml.example in ${dir}. Run this from the woof repo root.`);
    process.exit(1);
  }
}

function printAccessGuide(domain: string): void {
  p.log.message(`
${pc.bold("To set up Cloudflare Access:")}

1. Open the ${pc.cyan("Cloudflare Zero Trust dashboard")}:
   https://one.dash.cloudflare.com/

2. ${pc.bold("Add an identity provider")}:
   Go to ${pc.cyan("Settings > Authentication > Login methods")}
   Add Google, GitHub, Okta, or any SAML/OIDC provider.

3. ${pc.bold("Create three Access applications")}:
   Go to ${pc.cyan("Access > Applications > Add an application")}

   Access policies work at the application level, not per-path
   within a policy. You need separate applications for public
   and protected routes.

   ${pc.bold("App 1 — Woof Public (OFREP + health check):")}
   • Type: Self-hosted
   • Domain: ${pc.cyan(domain)}, Path: ${pc.cyan("ofrep/v1")}
   • Add second domain entry: ${pc.cyan(domain)}, Path: ${pc.cyan("healthz")}
   • Policy: ${pc.cyan("Bypass")} — Include: Everyone

   ${pc.bold("App 2 — Woof Admin (protected):")}
   • Type: Self-hosted
   • Domain: ${pc.cyan(domain)} (no path — catch-all)
   • Policy: ${pc.cyan("Allow")} — e.g., Emails ending in ${pc.cyan("@yourcompany.com")}

   Access evaluates more-specific paths first, so the OFREP and
   healthz bypasses take priority over the admin catch-all.

4. ${pc.bold("Find the Application Audience (AUD) tag")}:
   From the ${pc.bold("Woof Admin")} application (App 2):
   Go to ${pc.cyan("Access > Applications")}
   Click ${pc.cyan("Configure")} on your Admin application.
   On the ${pc.cyan("Overview")} tab, copy the
   ${pc.bold("Application Audience (AUD) Tag")} — a 64-char hex string.
   The Worker uses this to verify JWTs were issued for this application.

5. ${pc.bold("Find your team domain")}:
   Visible at the top of the Zero Trust dashboard, or under
   ${pc.cyan("Settings > Custom Pages")}. Looks like: https://myteam.cloudflareaccess.com

6. ${pc.bold("Set the secrets")}:
   ${pc.cyan(`cd packages/service`)}
   ${pc.cyan(`npx wrangler secret put ACCESS_TEAM_DOMAIN`)}
   ${pc.cyan(`npx wrangler secret put ACCESS_AUD`)}

   Or re-run ${pc.cyan("yarn setup")} after configuring Access.
`);
}
