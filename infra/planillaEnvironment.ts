import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

export type WranglerTarget = "production" | "preview";

export interface PlanillaEnvironmentArgs {
  accountId: pulumi.Input<string>;
  /** Suffix for D1, KV, R2 and queues. Empty in prod; `-preview` in dev. */
  nameSuffix: string;
  /** Suffix for Pages project names. Empty in prod; `-dev` in dev. */
  pagesNameSuffix: string;
  pagesProductionBranch: string;
  /** Which wrangler.jsonc block CI should patch: root (`production`) or `env.preview`. */
  wranglerTarget: WranglerTarget;
}

function lastPathSegment(id: pulumi.Output<string>): pulumi.Output<string> {
  return id.apply((value) => {
    const segments = value.split("/");
    const last = segments[segments.length - 1];
    if (!last) {
      throw new Error(`Cloudflare resource id is empty: ${value}`);
    }
    return last;
  });
}

/**
 * One Cloudflare environment (prod or dev). Add a new resource here and every
 * stack that instantiates this component gets it. Add a new stack with a
 * `Pulumi.<name>.yaml` instead of branching on environment names inside this file.
 */
export class PlanillaEnvironment extends pulumi.ComponentResource {
  public readonly wranglerTarget: WranglerTarget;
  public readonly pagesProductionBranch: string;
  public readonly d1DatabaseId: pulumi.Output<string>;
  public readonly d1DatabaseName: pulumi.Output<string>;
  public readonly kvNamespaceId: pulumi.Output<string>;
  public readonly r2BucketName: pulumi.Output<string>;
  public readonly queueName: pulumi.Output<string>;
  public readonly dlqName: pulumi.Output<string>;
  public readonly workspaceProjectName: pulumi.Output<string>;
  public readonly landingProjectName: pulumi.Output<string>;

  constructor(
    name: string,
    args: PlanillaEnvironmentArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super("planilla:infra:Environment", name, args, opts);

    const prefix = "planilla-inteligente";
    const d1Name = `${prefix}${args.nameSuffix}`;
    const kvTitle = `${prefix}-session${args.nameSuffix}`;
    const r2Name = `${prefix}-assets${args.nameSuffix}`;
    const queueName = `${prefix}-enrichment${args.nameSuffix}`;
    const dlqName = `${prefix}-enrichment${args.nameSuffix}-dlq`;
    const workspaceName = `${prefix}${args.pagesNameSuffix}`;
    const landingName = `${prefix}-web-landing${args.pagesNameSuffix}`;

    const protectOpts: pulumi.CustomResourceOptions = {
      parent: this,
      protect: true,
    };
    const childOpts: pulumi.CustomResourceOptions = { parent: this };

    const d1 = new cloudflare.D1Database(
      "d1",
      {
        accountId: args.accountId,
        name: d1Name,
      },
      protectOpts,
    );

    const kv = new cloudflare.WorkersKvNamespace(
      "session-kv",
      {
        accountId: args.accountId,
        title: kvTitle,
      },
      childOpts,
    );

    const r2 = new cloudflare.R2Bucket(
      "assets",
      {
        accountId: args.accountId,
        name: r2Name,
      },
      protectOpts,
    );

    const queue = new cloudflare.Queue(
      "enrichment-queue",
      {
        accountId: args.accountId,
        queueName,
      },
      childOpts,
    );

    const dlq = new cloudflare.Queue(
      "enrichment-dlq",
      {
        accountId: args.accountId,
        queueName: dlqName,
      },
      childOpts,
    );

    const pagesOpts: pulumi.CustomResourceOptions = {
      parent: this,
      protect: true,
      // Wrangler owns bindings and runtime secrets on deploy. If Pulumi
      // managed deploymentConfigs it would overwrite them on every up.
      ignoreChanges: ["deploymentConfigs"],
    };

    const workspace = new cloudflare.PagesProject(
      "workspace",
      {
        accountId: args.accountId,
        name: workspaceName,
        productionBranch: args.pagesProductionBranch,
      },
      pagesOpts,
    );

    const landing = new cloudflare.PagesProject(
      "landing",
      {
        accountId: args.accountId,
        name: landingName,
        productionBranch: args.pagesProductionBranch,
      },
      pagesOpts,
    );

    this.wranglerTarget = args.wranglerTarget;
    this.pagesProductionBranch = args.pagesProductionBranch;
    this.d1DatabaseId = d1.uuid.apply((uuid) => {
      if (!uuid) {
        throw new Error(`D1 database ${d1Name} has no uuid`);
      }
      return uuid;
    });
    this.d1DatabaseName = d1.name;
    this.kvNamespaceId = lastPathSegment(kv.id);
    this.r2BucketName = r2.name;
    this.queueName = queue.queueName;
    this.dlqName = dlq.queueName;
    this.workspaceProjectName = workspace.name;
    this.landingProjectName = landing.name;

    this.registerOutputs({
      wranglerTarget: this.wranglerTarget,
      pagesProductionBranch: this.pagesProductionBranch,
      d1DatabaseId: this.d1DatabaseId,
      d1DatabaseName: this.d1DatabaseName,
      kvNamespaceId: this.kvNamespaceId,
      r2BucketName: this.r2BucketName,
      queueName: this.queueName,
      dlqName: this.dlqName,
      workspaceProjectName: this.workspaceProjectName,
      landingProjectName: this.landingProjectName,
    });
  }
}
