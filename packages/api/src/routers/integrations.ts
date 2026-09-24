import { accountProcedure, router } from "../index";
import { integrationCatalog } from "../service/integrations/catalog";

/** Public-to-the-account policy view. Secrets and admin-only issuer state stay in admin routes. */
export const integrationsRouter = router({
  list: accountProcedure("workspace:read").query(() => integrationCatalog()),
});
