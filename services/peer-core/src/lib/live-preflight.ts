import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(fileDir, "..", "..");
const require = createRequire(path.join(serviceRoot, "package.json"));

export interface LivePreflightResult {
  ok: boolean;
  packageName: string;
  platform: string;
  arch: string;
  error?: string;
}

export function checkLiveRuntimeSupport(): LivePreflightResult {
  const platform = os.platform();
  const arch = os.arch();
  const packageName = `bare-runtime-${platform}-${arch}`;

  try {
    const sdkPath = require.resolve("@qvac/sdk");
    const sdkRequire = createRequire(sdkPath);
    const bareRuntime = sdkRequire("bare-runtime") as (
      referrer: string,
      opts: { platform: string; arch: string },
    ) => unknown;

    bareRuntime("bare", { platform, arch });

    return {
      ok: true,
      packageName,
      platform,
      arch,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      packageName,
      platform,
      arch,
      error: `Missing ${packageName}. QVAC live mode cannot start on ${platform}-${arch} until that runtime package is available. ${message}`,
    };
  }
}
