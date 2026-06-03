import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(fileDir, "..", "..");
const repoRoot = path.resolve(serviceRoot, "..", "..");
const require = createRequire(path.join(serviceRoot, "package.json"));

export type LivePreflightFailureCode =
  | "sdk-not-found"
  | "bare-runtime-not-found"
  | "platform-runtime-not-found"
  | "require-asset-not-found"
  | "binary-not-found"
  | "runtime-invoke-failed";

export type LivePreflightFailureStage =
  | "resolve-sdk"
  | "resolve-bare-runtime"
  | "resolve-platform-runtime"
  | "resolve-require-asset"
  | "resolve-binary"
  | "invoke-runtime";

export interface LivePreflightResult {
  ok: boolean;
  packageName: string;
  platform: string;
  arch: string;
  failureCode?: LivePreflightFailureCode;
  failureStage?: LivePreflightFailureStage;
  error?: string;
  resolvedPaths?: {
    sdkPath?: string;
    bareRuntimePath?: string;
    platformRuntimePath?: string;
    requireAssetPath?: string;
    bareBinaryPath?: string;
    customWorkerPath?: string;
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createFailure(
  packageName: string,
  platform: string,
  arch: string,
  failureCode: LivePreflightFailureCode,
  failureStage: LivePreflightFailureStage,
  error: unknown,
  resolvedPaths: LivePreflightResult["resolvedPaths"],
): LivePreflightResult {
  return {
    ok: false,
    packageName,
    platform,
    arch,
    failureCode,
    failureStage,
    error: formatError(error),
    resolvedPaths,
  };
}

export function checkLiveRuntimeSupport(): LivePreflightResult {
  const platform = os.platform();
  const arch = os.arch();
  const packageName = `bare-runtime-${platform}-${arch}`;
  const resolvedPaths: NonNullable<LivePreflightResult["resolvedPaths"]> = {
    customWorkerPath: path.join(repoRoot, "qvac", "worker.entry.mjs"),
  };

  let sdkPath: string;
  try {
    sdkPath = require.resolve("@qvac/sdk");
    resolvedPaths.sdkPath = sdkPath;
  } catch (error) {
    return createFailure(
      packageName,
      platform,
      arch,
      "sdk-not-found",
      "resolve-sdk",
      error,
      resolvedPaths,
    );
  }

  const sdkRequire = createRequire(sdkPath);

  let bareRuntimePath: string;
  try {
    bareRuntimePath = sdkRequire.resolve("bare-runtime");
    resolvedPaths.bareRuntimePath = bareRuntimePath;
  } catch (error) {
    return createFailure(
      packageName,
      platform,
      arch,
      "bare-runtime-not-found",
      "resolve-bare-runtime",
      error,
      resolvedPaths,
    );
  }

  const bareRuntimeRequire = createRequire(bareRuntimePath);

  try {
    resolvedPaths.platformRuntimePath = bareRuntimeRequire.resolve(packageName);
  } catch (error) {
    return createFailure(
      packageName,
      platform,
      arch,
      "platform-runtime-not-found",
      "resolve-platform-runtime",
      error,
      resolvedPaths,
    );
  }

  try {
    const platformRuntimeRequire = createRequire(resolvedPaths.platformRuntimePath);
    resolvedPaths.requireAssetPath = platformRuntimeRequire.resolve("require-asset");
  } catch (error) {
    return createFailure(
      packageName,
      platform,
      arch,
      "require-asset-not-found",
      "resolve-require-asset",
      error,
      resolvedPaths,
    );
  }

  let bareRuntime: ((referrer: string, opts: { platform: string; arch: string }) => unknown) | undefined;
  try {
    bareRuntime = bareRuntimeRequire("bare-runtime") as (
      referrer: string,
      opts: { platform: string; arch: string },
    ) => unknown;
    const bareBinaryPath = bareRuntime("bare", { platform, arch });
    if (typeof bareBinaryPath !== "string" || bareBinaryPath.length === 0) {
      throw new Error(`Unexpected bare binary path: ${String(bareBinaryPath)}`);
    }
    resolvedPaths.bareBinaryPath = bareBinaryPath;
  } catch (error) {
    return createFailure(
      packageName,
      platform,
      arch,
      "runtime-invoke-failed",
      "invoke-runtime",
      error,
      resolvedPaths,
    );
  }

  if (!resolvedPaths.bareBinaryPath || !fs.existsSync(resolvedPaths.bareBinaryPath)) {
    return createFailure(
      packageName,
      platform,
      arch,
      "binary-not-found",
      "resolve-binary",
      new Error(`Bare binary was not found at ${resolvedPaths.bareBinaryPath ?? "unknown path"}`),
      resolvedPaths,
    );
  }

  return {
    ok: true,
    packageName,
    platform,
    arch,
    resolvedPaths,
  };
}
