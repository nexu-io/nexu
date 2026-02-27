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
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Ticket } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import "@/lib/api";
import { getV1Me, postV1InviteValidate } from "../../lib/api/sdk.gen";

export function InvitePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await getV1Me();
      return data;
    },
  });

  const mutation = useMutation({
    mutationFn: async (inviteCode: string) => {
      const { data, error } = await postV1InviteValidate({
        body: { code: inviteCode },
      });
      if (error) throw new Error("Validation failed");
      return data;
    },
    onSuccess: (data) => {
      if (data?.valid) {
        toast.success("Invite code accepted!");
        navigate("/workspace");
      } else {
        toast.error(data?.message ?? "Invalid invite code");
      }
    },
    onError: () => {
      toast.error("Failed to validate invite code");
    },
  });

  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (profile?.inviteAccepted) {
    return <Navigate to="/workspace" replace />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      toast.error("Please enter an invite code");
      return;
    }
    mutation.mutate(code);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Ticket className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Enter Invite Code</CardTitle>
          <CardDescription>
            You need an invite code to access Nexu during early access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Invite Code</Label>
              <Input
                id="code"
                placeholder="NEXU2026"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="text-center text-lg tracking-widest"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Verify
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
