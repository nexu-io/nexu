import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { Github, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

export function AuthPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const isLogin = searchParams.get("mode") === "login";
  const [loading, setLoading] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session?.user) {
    return <Navigate to="/invite" replace />;
  }

  const handleOAuth = async (provider: "github" | "google") => {
    setLoading(provider);
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: "/invite",
      });
    } catch {
      setLoading(null);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading("email");
    try {
      if (isLogin) {
        const { error } = await authClient.signIn.email({
          email,
          password,
        });
        if (error) {
          toast.error(error.message ?? "Login failed");
          setLoading(null);
          return;
        }
      } else {
        const { error } = await authClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0] || "User",
        });
        if (error) {
          toast.error(error.message ?? "Sign up failed");
          setLoading(null);
          return;
        }
      }
      navigate("/invite");
    } catch {
      toast.error("Something went wrong");
      setLoading(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {isLogin ? "Log in to Nexu" : "Create your Nexu account"}
          </CardTitle>
          <CardDescription>
            {isLogin
              ? "Welcome back"
              : "Get your AI assistant up and running in minutes"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => handleOAuth("github")}
            disabled={loading !== null}
          >
            <Github className="mr-2 h-4 w-4" />
            {loading === "github" ? "Redirecting..." : "Continue with GitHub"}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => handleOAuth("google")}
            disabled={loading !== null}
          >
            <svg
              className="mr-2 h-4 w-4"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {loading === "google" ? "Redirecting..." : "Continue with Google"}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                Or continue with email
              </span>
            </div>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-3">
            {!isLogin && (
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Min 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading !== null}
            >
              {loading === "email" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isLogin ? "Log in" : "Create account"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {isLogin ? (
              <>
                Don&apos;t have an account?{" "}
                <Link to="/auth" className="text-primary hover:underline">
                  Sign up
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link
                  to="/auth?mode=login"
                  className="text-primary hover:underline"
                >
                  Log in
                </Link>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
