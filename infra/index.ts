import * as pulumi from "@pulumi/pulumi";
import {
  PlanillaEnvironment,
  type WranglerTarget,
} from "./planillaEnvironment";

const config = new pulumi.Config();

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!accountId) {
  throw new Error(
    "CLOUDFLARE_ACCOUNT_ID is required (provider and resource account).",
  );
}

const wranglerTarget = (config.get("wranglerTarget") ??
  "production") as WranglerTarget;
if (wranglerTarget !== "production" && wranglerTarget !== "preview") {
  throw new Error(
    `wranglerTarget must be "production" or "preview", got ${wranglerTarget}`,
  );
}

const environment = new PlanillaEnvironment("environment", {
  accountId,
  nameSuffix: config.get("nameSuffix") ?? "",
  pagesNameSuffix: config.get("pagesNameSuffix") ?? "",
  pagesProductionBranch: config.require("pagesProductionBranch"),
  wranglerTarget,
});

export const d1DatabaseId = environment.d1DatabaseId;
export const d1DatabaseName = environment.d1DatabaseName;
export const kvNamespaceId = environment.kvNamespaceId;
export const r2BucketName = environment.r2BucketName;
export const queueName = environment.queueName;
export const dlqName = environment.dlqName;
export const workspaceProjectName = environment.workspaceProjectName;
export const landingProjectName = environment.landingProjectName;
export const pagesProductionBranch = environment.pagesProductionBranch;
export { wranglerTarget };
