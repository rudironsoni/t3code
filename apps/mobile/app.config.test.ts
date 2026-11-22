import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({
    APP_VARIANT: process.env.APP_VARIANT,
    T3_PHONE_TEAM_ID: process.env.T3_PHONE_TEAM_ID,
    T3_PHONE_BUNDLE_ID: process.env.T3_PHONE_BUNDLE_ID,
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(
  variant: string | undefined,
  phone?: { teamId: string; bundleId: string },
) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  vi.stubEnv("T3_PHONE_TEAM_ID", phone?.teamId);
  vi.stubEnv("T3_PHONE_BUNDLE_ID", phone?.bundleId);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while app.t3.codes lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host, pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
});

it("uses the phone identity across the iOS app and its extensions", async () => {
  const bundle = "com.example.t3code.test";
  const config = await loadConfig("development", { teamId: "ABCD123456", bundleId: bundle });

  expect(config.ios?.bundleIdentifier).toBe(bundle);
  expect(config.ios?.appleTeamId).toBe("ABCD123456");
  expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
    `$(AppIdentifierPrefix)${bundle}`,
  ]);
  expect(config.plugins).toContainEqual([
    "expo-widgets",
    expect.objectContaining({
      bundleIdentifier: `${bundle}.widgets`,
      groupIdentifier: `group.${bundle}`,
    }),
  ]);
  expect(config.plugins).toContainEqual([
    "expo-sharing",
    expect.objectContaining({
      ios: expect.objectContaining({
        extensionBundleIdentifier: `${bundle}.sharing`,
        appGroupId: `group.${bundle}`,
      }),
    }),
  ]);
  expect(config.android?.package).toBe("com.t3tools.t3code.dev");
});
