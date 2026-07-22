import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import CountryCodeSelect from "@/components/CountryCodeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";

interface Member {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  status: string;
  created_at: string;
  avatar_url: string;
  primary_member_id: string | null;
  profile_completed: boolean;
  roles: string[];
}

const invokeAdmin = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    let message = "Something went wrong";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        const parsed = await ctx.json();
        if (parsed?.error) message = parsed.error;
      }
    } catch {
      // keep generic message
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

const Admin = () => {
  const { user, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+44");
  const [phone, setPhone] = useState("");
  const [resetTarget, setResetTarget] = useState<Member | null>(null);
  const [resetCountryCode, setResetCountryCode] = useState("+44");
  const [resetPhone, setResetPhone] = useState("");

  const { data: members, isLoading: membersLoading, error: membersError } = useQuery({
    queryKey: ["admin-members"],
    queryFn: async () => (await invokeAdmin({ action: "list" })).members as Member[],
    enabled: !!user && isAdmin,
  });

  const invite = useMutation({
    mutationFn: () =>
      invokeAdmin({
        action: "invite",
        full_name: fullName,
        email,
        phone: `${countryCode}${phone.replace(/[\s\-()]/g, "").replace(/^0+/, "")}`,
      }),
    onSuccess: () => {
      toast({
        title: "Member invited",
        description: `${fullName || "The new member"} can now sign in with their mobile number.`,
      });
      setInviteOpen(false);
      setFullName("");
      setEmail("");
      setPhone("");
      queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    },
    onError: (err: Error) => {
      toast({ title: "Invite failed", description: err.message, variant: "destructive" });
    },
  });

  const resetMfa = useMutation({
    mutationFn: () =>
      invokeAdmin({
        action: "reset_2fa",
        user_id: resetTarget!.id,
        new_phone: resetPhone.trim()
          ? `${resetCountryCode}${resetPhone.replace(/[\s\-()]/g, "").replace(/^0+/, "")}`
          : undefined,
      }),
    onSuccess: () => {
      toast({
        title: "2FA reset",
        description: "They will verify their mobile again on their next sign-in.",
      });
      setResetTarget(null);
      setResetPhone("");
      queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    },
    onError: (err: Error) => {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    },
  });

  const familyDecision = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: "approve_family" | "reject_family" }) =>
      invokeAdmin({ action, user_id: userId }),
    onSuccess: (_data, vars) => {
      toast({
        title: vars.action === "approve_family" ? "Family member approved" : "Request declined",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const setAccess = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: "revoke" | "restore" }) =>
      invokeAdmin({ action, user_id: userId }),
    onSuccess: (_data, vars) => {
      toast({ title: vars.action === "revoke" ? "Access revoked" : "Access restored" });
      queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-champagne" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: "/admin" }} replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-8 py-12 max-w-5xl">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase mb-12"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Site
        </Link>

        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-3">
              Admin
            </p>
            <h1 className="font-display text-3xl font-light tracking-wider text-foreground">
              Members
            </h1>
          </div>

          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button className="tracking-[0.15em] uppercase">
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display tracking-wider font-light">
                  Invite a Member
                </DialogTitle>
                <DialogDescription>
                  Access is immediate: they sign in with this mobile number and
                  a one-time code sent by text. No password, no email link. A
                  welcome email is sent as a courtesy.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  invite.mutate();
                }}
                className="space-y-4 mt-2"
              >
                <Input
                  placeholder="Full name (optional)"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={100}
                />
                <Input
                  type="email"
                  placeholder="Email address (optional)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={255}
                />
                <div className="flex gap-3">
                  <CountryCodeSelect value={countryCode} onChange={setCountryCode} />
                  <Input
                    type="tel"
                    placeholder="7700 900123"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="flex-1"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={invite.isPending}
                  className="w-full tracking-[0.15em] uppercase"
                >
                  {invite.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Send Invitation"
                  )}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {membersLoading ? (
          <div className="py-20 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-champagne mx-auto" />
          </div>
        ) : membersError ? (
          <p className="text-destructive text-sm py-10">
            Could not load members: {(membersError as Error).message}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Access</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members ?? []).map((m) => {
                const memberIsAdmin = m.roles.includes("admin");
                const revoked = m.status === "revoked";
                const pending = m.status === "pending";
                const primary = m.primary_member_id
                  ? (members ?? []).find((p) => p.id === m.primary_member_id)
                  : null;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        {m.avatar_url ? (
                          <img
                            src={m.avatar_url}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover"
                          />
                        ) : (
                          <span className="w-7 h-7 rounded-full bg-charcoal border border-border inline-block" />
                        )}
                        <span>
                          {m.full_name || "—"}
                          {primary && (
                            <span className="block text-xs text-smoke font-normal">
                              Family of {primary.full_name || primary.phone}
                            </span>
                          )}
                        </span>
                      </span>
                      {memberIsAdmin && (
                        <Badge variant="outline" className="ml-2 text-champagne border-champagne">
                          Admin
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{m.phone}</TableCell>
                    <TableCell>{m.email || "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={revoked ? "destructive" : pending ? "outline" : "secondary"}
                        className={pending ? "text-champagne border-champagne" : undefined}
                      >
                        {revoked ? "Revoked" : pending ? "Pending" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(m.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {pending && (
                        <>
                          <Button
                            size="sm"
                            disabled={familyDecision.isPending}
                            onClick={() =>
                              familyDecision.mutate({ userId: m.id, action: "approve_family" })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={familyDecision.isPending}
                            onClick={() =>
                              familyDecision.mutate({ userId: m.id, action: "reject_family" })
                            }
                          >
                            Decline
                          </Button>
                        </>
                      )}
                      {!pending && !memberIsAdmin && m.id !== user.id && !revoked && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={resetMfa.isPending}
                          onClick={() => {
                            setResetTarget(m);
                            setResetPhone("");
                          }}
                        >
                          Reset 2FA
                        </Button>
                      )}
                      {pending || memberIsAdmin || m.id === user.id ? null : revoked ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={setAccess.isPending}
                          onClick={() => setAccess.mutate({ userId: m.id, action: "restore" })}
                        >
                          Restore
                        </Button>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" disabled={setAccess.isPending}>
                              Revoke
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Revoke access for {m.full_name || m.phone}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                They will be signed out and unable to sign in or make
                                bookings until access is restored.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => setAccess.mutate({ userId: m.id, action: "revoke" })}
                              >
                                Revoke Access
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(members ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-smoke py-10">
                    No members yet. Invite your first member above.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}

        <Dialog
          open={!!resetTarget}
          onOpenChange={(open) => {
            if (!open) setResetTarget(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display tracking-wider font-light">
                Reset 2FA for {resetTarget?.full_name || resetTarget?.phone}
              </DialogTitle>
              <DialogDescription>
                They will confirm a security code again on their next sign-in.
                To move them to a new number, enter it below; leave blank to keep
                their current number ({resetTarget?.phone}).
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                resetMfa.mutate();
              }}
              className="space-y-4 mt-2"
            >
              <div className="flex gap-3">
                <CountryCodeSelect value={resetCountryCode} onChange={setResetCountryCode} />
                <Input
                  type="tel"
                  placeholder="New number (optional)"
                  value={resetPhone}
                  onChange={(e) => setResetPhone(e.target.value)}
                  className="flex-1"
                />
              </div>
              <Button
                type="submit"
                disabled={resetMfa.isPending}
                className="w-full tracking-[0.15em] uppercase"
              >
                {resetMfa.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Reset 2FA"
                )}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Admin;
