// Live smoke checks against the deployed site. NOT part of
// `npm test` (it needs the deployment to be up). Run after a deploy:
//   npm run test:smoke
// Override the target with SITE_ORIGIN=https://... if needed.
const origin = process.env.SITE_ORIGIN ?? "https://truthai-six.vercel.app";
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

await check("sitemap uses the real origin, not the xyro.ai fallback", async () => {
  const response = await fetch(`${origin}/sitemap.xml`);
  expect(response.ok, `sitemap status ${response.status}`);
  const xml = await response.text();
  expect(xml.includes(`<loc>${origin}`), "sitemap locs do not start with the site origin");
  expect(!xml.includes("xyro.ai"), "sitemap still references xyro.ai");
});

await check("Permissions-Policy allows the microphone for voice input", async () => {
  const response = await fetch(`${origin}/sign-in`);
  const policy = response.headers.get("permissions-policy") ?? "";
  expect(policy.includes("microphone=(self)"), `permissions-policy was: ${policy}`);
});

await check("key pages respond 200", async () => {
  for (const path of ["/", "/sign-in", "/models", "/api-reference", "/roadmap", "/faq"]) {
    const response = await fetch(`${origin}${path}`, { redirect: "manual" });
    expect(response.status === 200, `${path} returned ${response.status}`);
  }
});

await check("health endpoint responds", async () => {
  const response = await fetch(`${origin}/api/health`);
  expect(response.ok, `health status ${response.status}`);
});

if (failures) {
  console.error(`${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log("smoke checks passed");
