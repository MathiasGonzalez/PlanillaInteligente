#!/usr/bin/env node
/**
 * Patches wrangler.jsonc from Pulumi stack outputs. Intended for CI (fresh checkout).
 * Do not commit the resulting IDs or rewritten preview resource names.
 *
 * Usage: node infra/apply-bindings.mjs <stack-output.json>
 *
 * production: fills database_id / KV id in the root (Pages+Worker production env).
 * preview: fills env.preview IDs (Worker --env preview) AND rewrites the root
 * R2/queue/D1-id/KV-id to preview resources. Dedicated Pages projects treat
 * `--branch dev` as production, so Wrangler reads the root block, not env.preview.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const outputPath = process.argv[2];
if (!outputPath) {
  console.error("Usage: node infra/apply-bindings.mjs <stack-output.json>");
  process.exit(1);
}

/** @typedef {"production" | "preview"} WranglerTarget */

/**
 * @typedef {object} StackOutputs
 * @property {WranglerTarget} wranglerTarget
 * @property {string} d1DatabaseId
 * @property {string} d1DatabaseName
 * @property {string} kvNamespaceId
 * @property {string} r2BucketName
 * @property {string} queueName
 * @property {string} dlqName
 */

/**
 * @param {string} id
 * @returns {string}
 */
function lastPathSegment(id) {
  const segments = String(id).split("/");
  const last = segments[segments.length - 1];
  if (!last) {
    throw new Error(`Empty Cloudflare resource id: ${id}`);
  }
  return last;
}

/**
 * @param {unknown} value
 * @returns {value is StackOutputs}
 */
function isStackOutputs(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const strings = [
    "d1DatabaseId",
    "d1DatabaseName",
    "kvNamespaceId",
    "r2BucketName",
    "queueName",
    "dlqName",
  ];
  return (
    (record.wranglerTarget === "production" ||
      record.wranglerTarget === "preview") &&
    strings.every((key) => typeof record[key] === "string" && record[key] !== "")
  );
}

/**
 * @param {string} content
 * @returns {{ root: string, rest: string }}
 */
function splitEnvBlock(content) {
  const match = content.match(/\n\s*"env"\s*:/);
  if (!match || match.index === undefined) {
    return { root: content, rest: "" };
  }
  return {
    root: content.slice(0, match.index),
    rest: content.slice(match.index),
  };
}

/**
 * @param {string} section
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
function replaceKeyedString(section, key, value) {
  const pattern = new RegExp(`("${key}"\\s*:\\s*")[^"]+(")`);
  if (!pattern.test(section)) {
    return section;
  }
  return section.replace(pattern, `$1${value}$2`);
}

/**
 * @param {string} section
 * @param {string} kvNamespaceId
 * @returns {string}
 */
function replaceSessionKvId(section, kvNamespaceId) {
  if (!/"binding"\s*:\s*"SESSION_KV"/.test(section)) {
    return section;
  }
  return section.replace(
    /("binding"\s*:\s*"SESSION_KV"[\s\S]*?"id"\s*:\s*")[^"]+(")/,
    `$1${kvNamespaceId}$2`,
  );
}

/**
 * @param {string} section
 * @param {StackOutputs} outputs
 * @param {{ rewriteResourceNames: boolean }} options
 * @returns {string}
 */
/**
 * The first `queue` key is the enrichment queue. Any later `queue` key is the
 * DLQ consumer, which must receive the DLQ name rather than the main queue.
 * @param {string} section
 * @param {StackOutputs} outputs
 * @returns {string}
 */
function rewriteQueueNames(section, outputs) {
  let seen = 0;
  return section.replace(/("queue"\s*:\s*")[^"]+(")/g, (_match, prefix, suffix) => {
    seen += 1;
    const value = seen === 1 ? outputs.queueName : outputs.dlqName;
    return `${prefix}${value}${suffix}`;
  });
}

function rewriteSection(section, outputs, options) {
  let out = section;
  if (options.rewriteResourceNames) {
    // Do not rewrite database_name: wrangler d1 migrations apply looks up by
    // unique name, and env.preview already owns the preview database name.
    out = replaceKeyedString(out, "bucket_name", outputs.r2BucketName);
    out = rewriteQueueNames(out, outputs);
    out = replaceKeyedString(out, "dead_letter_queue", outputs.dlqName);
  }
  out = replaceKeyedString(out, "database_id", outputs.d1DatabaseId);
  out = replaceSessionKvId(out, outputs.kvNamespaceId);
  return out;
}

/**
 * @param {string} content
 * @param {StackOutputs} outputs
 * @returns {string}
 */
function patchWrangler(content, outputs) {
  const { root, rest } = splitEnvBlock(content);
  if (outputs.wranglerTarget === "preview") {
    if (!rest) {
      throw new Error(
        "wranglerTarget is preview but wrangler.jsonc has no env block",
      );
    }
    return (
      rewriteSection(root, outputs, { rewriteResourceNames: true }) +
      rewriteSection(rest, outputs, { rewriteResourceNames: false })
    );
  }
  return rewriteSection(root, outputs, { rewriteResourceNames: false }) + rest;
}

const raw = JSON.parse(readFileSync(outputPath, "utf8"));
if (!isStackOutputs(raw)) {
  console.error(
    "Stack output JSON must include wranglerTarget and non-empty d1DatabaseId, d1DatabaseName, kvNamespaceId, r2BucketName, queueName, dlqName",
  );
  process.exit(1);
}

/** @type {StackOutputs} */
const outputs = {
  wranglerTarget: raw.wranglerTarget,
  d1DatabaseId: lastPathSegment(raw.d1DatabaseId),
  d1DatabaseName: raw.d1DatabaseName,
  kvNamespaceId: lastPathSegment(raw.kvNamespaceId),
  r2BucketName: raw.r2BucketName,
  queueName: raw.queueName,
  dlqName: raw.dlqName,
};

const wranglerFiles = [
  "apps/web-workspace/wrangler.jsonc",
  "workers/api-enrichment-consumer/wrangler.jsonc",
  "workers/api-maintenance/wrangler.jsonc",
];

for (const relativePath of wranglerFiles) {
  const absolutePath = resolve(repoRoot, relativePath);
  const original = readFileSync(absolutePath, "utf8");
  const patched = patchWrangler(original, outputs);
  if (patched === original) {
    throw new Error(`No wrangler binding replacements in ${relativePath}`);
  }
  writeFileSync(absolutePath, patched);
  console.log(`Updated ${relativePath} (${outputs.wranglerTarget})`);
}
