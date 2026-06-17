import { adminProcedure, router } from "../..";
import {
  getCloudflareManualSetupInstructions,
  getCloudflareWorkerFiles,
} from "../../providers/cloudflare/setup";

export const cloudflareRouter = router({
  /** Instructions for admins who deploy the worker themselves. */
  manualSetup: adminProcedure.query(() => {
    return getCloudflareManualSetupInstructions();
  }),

  /** Downloadable worker source files so admins can deploy without the repo. */
  workerFiles: adminProcedure.query(() => {
    return getCloudflareWorkerFiles();
  }),
});
