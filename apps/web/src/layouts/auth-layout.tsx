import { authClient } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

export function AuthLayout() {
  const location = useLocation();
  const { data: session, isPending: authPending } = authClient.useSession();

  if (authPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!session?.user) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
