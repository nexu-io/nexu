import { authClient } from "@/lib/auth-client";
import { Navigate, Outlet, useLocation } from "react-router-dom";

export function AuthLayout() {
  const location = useLocation();
  const { data: session, isPending: authPending } = authClient.useSession();

  if (authPending) {
    // Return empty div — in desktop mode the Nexu splash loader already
    // covers the webview, so no need for a separate spinner.
    return <div className="min-h-screen" />;
  }

  if (!session?.user) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
