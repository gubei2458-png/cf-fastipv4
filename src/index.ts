import { resolveA } from "./dns";

export interface Env {
  CF_API_TOKEN: string;   // secret
  CF_ZONE_ID: string;     // e.g. 70ead...
  CF_RECORD_NAME: string; // e.g. www.xymianliao.xy
  SOURCE_DOMAIN?: string; // e.g. cf.090227.xyz
  IP_COUNT?: string;      // e.g. 3
  PROXIED?: string;       // "true" / "false"
}

async function cfApi(env: Env, path: string, init?: RequestInit) {
  return fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

async function updateCloudflareARecords(env: Env, ips: string[]) {
  const zoneId = env.CF_ZONE_ID;
  const name = env.CF_RECORD_NAME;
  const proxied = (env.PROXIED ?? "true").toLowerCase() === "true";

  // list existing A records for this name
  const listResp = await cfApi(
    env,
    `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(name)}`
  );
  const listJson: any = await listResp.json();
  if (!listJson.success) throw new Error(`List DNS failed: ${JSON.stringify(listJson.errors)}`);

  // delete old A records
  for (const r of listJson.result || []) {
    await cfApi(env, `/zones/${zoneId}/dns_records/${r.id}`, { method: "DELETE" });
  }

  // create new A records
  for (const ip of ips) {
    const createResp = await cfApi(env, `/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: "A",
        name,
        content: ip,
        ttl: 60,
        proxied,
      }),
    });
    const createJson: any = await createResp.json();
    if (!createJson.success) throw new Error(`Create DNS failed: ${JSON.stringify(createJson.errors)}`);
  }
}

async function run(env: Env) {
  if (!env.CF_API_TOKEN || !env.CF_ZONE_ID || !env.CF_RECORD_NAME) {
    throw new Error("Missing CF_API_TOKEN / CF_ZONE_ID / CF_RECORD_NAME");
  }

  const sourceDomain = env.SOURCE_DOMAIN || "cf.090227.xyz";
  const ipCount = Math.max(1, Math.min(10, Number(env.IP_COUNT || "3")));

  const ips = await resolveA(sourceDomain);
  if (!ips.length) throw new Error(`No A records resolved from ${sourceDomain}`);

  const selected = ips.slice(0, ipCount);
  await updateCloudflareARecords(env, selected);
  return selected;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 微信验证文件
    if (url.pathname === "/ac9b8bf2370e83ad8c95345905cbedf1.txt") {
      return new Response("0936ac956094a205679411f55ea23b00bea4cb8b", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/trigger") {
      const selected = await run(env);
      return new Response(`OK. Updated ${env.CF_RECORD_NAME} with: ${selected.join(", ")}`);
    }

    return new Response("Worker running. Use /trigger");
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env).then(() => undefined));
  },
};
