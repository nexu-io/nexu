import type { auth } from "./auth.js";
import type { ErrorPolicy } from "./middleware/error-middleware.js";

type Session = typeof auth.$Infer.Session;

export type AppBindings = {
  Variables: {
    errorPolicy?: ErrorPolicy;
    requestId: string;
    userId: string;
    session: Session;
  };
};
