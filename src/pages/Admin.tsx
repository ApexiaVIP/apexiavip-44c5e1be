import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus, Check } from "lucide-react";
import MemberLayout from "@/components/MemberLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import CountryCodeSelect from "@/components/CountryCodeSelect";
import SignedAvatar from "@/components/SignedAvatar";
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

interface Application {
  id: string;
  created_at: string;
  full_name: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  town: string;
  postcode: string;
  country: string;
  heard_from: string;
  message: string;
  status: string;
}

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
  /** A chauffeur sees their own jobs instead of the booking screens */
  is_driver?: boolean;
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
  const [isDriver, setIsDriver] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+44");
  const [phone, setPhone] = useState("");
  const [resetTarget, setResetTarget] = useState<Member | null>(null);
  const [editTarget, setEditTarget] = useState<Member | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [resetCountryCode, setResetCountryCode] = useState("+44");
  const [resetPhone, setResetPhone] = useState("");

  // People who asked to join through the website, waiting on the office
  const { data: applications } = useQuery({
    queryKey: ["admin-applications"],
    queryFn: async () =>
      (await invokeAdmin({ action: "list_applications" })).applications as Application[],
    enabled: !!user && isAdmin,
  });

  const decideApplication = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      invokeAdmin({
        action: approve ? "approve_application" : "decline_application",
        application_id: id,
      }),
    onSuccess: (_data, vars) => {
      toast({
        title: vars.approve ? "Member created" : "Application declined",
        description: vars.approve
          ? "They have been welcomed and can sign in straight away."
          : "They have been removed from the queue.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-applications"] });
      queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not do that", description: err.message, variant: "destructive" }),
  });

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
        phone: phone.trim()
          ? `${countryCode}${phone.replace(/[\s\-()]/g, "").replace(/^0+/, "")}`
          : "",
        is_driver: isDriver,
      }),
    onSuccess: () => {
      toast({
        title: isDriver ? "Chauffeur invited" : "Member invited",
        description: isDriver
          ? `${fullName || "The new chauffeur"} can sign in with their mobile and will see their own jobs.`
          : `${fullName || "The new member"} can now sign in with their ${phone.trim() ? "mobile number" : "email address"}.`,
      });
      setInviteOpen(false);
      setFullName("");
      setEmail("");
      setPhone("");
      setIsDriver(false);
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

  // Correcting a member's details, above all adding an address for someone
  // invited by mobile alone, who otherwise has nowhere to receive a code
  const updateMember = useMutation({
    mutationFn: () =>
      invokeAdmin({
        action: "update_member",
        user_id: editTarget!.id,
        full_name: editName.trim(),
        email: editEmail.trim(),
      }),
    onSuccess: () => {
      toast({
        title: "Member updated",
        description: "They can now be sent a sign-in code by email.",
      });
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  // The office drive to test the chauffeur app, so switching is a button
  const setDriver = useMutation({
    mutationFn: ({ userId, isDriver }: { userId: string; isDriver: boolean }) =>
      invokeAdmin({ action: "set_driver", user_id: userId, is_driver: isDriver }),
    onSuccess: (_data, vars) => {
      toast({
        title: vars.isDriver ? "Now a chauffeur" : "No longer a chauffeur",
        description: vars.isDriver
          ? "They see their own jobs. They will need to sign out and back in."
          : "They are back to the booking screens. They will need to sign out and back in.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not change that", description: err.message, variant: "destructive" }),
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

  const deleteMember = useMutation({
    mutationFn: (userId: string) => invokeAdmin({ action: "delete_member", user_id: userId }),
    onSuccess: () => {
      toast({
        title: "Account deleted",
        description: "The member's account and access have been permanently removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
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

  // Customers and chauffeurs are two different jobs, so the office reads them
  // as two lists rather than hunting through one
  const everyone = members ?? [];
  const chauffeurs = everyone.filter((m) => m.is_driver === true);
  const customers = everyone.filter((m) => m.is_driver !== true);

  /** One row of the people list, used by both tables. */
  const memberRow = (m: Member) => {
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
                          <SignedAvatar src={m.avatar_url} className="w-7 h-7 rounded-full" />
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
                        {!pending && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditName(m.full_name ?? "");
                              setEditEmail(m.email ?? "");
                              setEditTarget(m);
                            }}
                            className="text-smoke hover:text-champagne"
                          >
                            Edit
                          </Button>
                        )}
                        {!revoked && !pending && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={setDriver.isPending}
                            onClick={() =>
                              setDriver.mutate({ userId: m.id, isDriver: m.is_driver !== true })
                            }
                            className="text-smoke hover:text-champagne"
                          >
                            {m.is_driver === true ? "Stop driving" : "Make chauffeur"}
                          </Button>
                        )}
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
                        {!pending && !memberIsAdmin && m.id !== user.id && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={deleteMember.isPending}
                                className="text-destructive hover:text-destructive"
                              >
                                Delete
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Permanently delete {m.full_name || m.phone}?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Their account, profile and access are removed
                                  immediately and this cannot be undone. Booking
                                  history is kept for your records. To block
                                  access temporarily, use Revoke instead.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Keep Account</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMember.mutate(m.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete Permanently
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  );
  };

  return (
    <MemberLayout>
      <div className="container mx-auto px-8 pb-16 max-w-5xl">

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
                  Access is immediate: they sign in with a one-time code sent
                  to their mobile by text, or to their email if no mobile is
                  given. No password. Provide at least one.
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
                    placeholder="7700 900123 (optional if email given)"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="flex-1"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsDriver(!isDriver)}
                  aria-pressed={isDriver}
                  className={`w-full border p-3 text-left flex items-start gap-3 transition-colors ${
                    isDriver ? "border-champagne" : "border-border hover:border-champagne-muted"
                  }`}
                >
                  <span
                    className={`mt-0.5 w-4 h-4 flex-none border flex items-center justify-center ${
                      isDriver ? "border-champagne bg-champagne" : "border-champagne-muted"
                    }`}
                  >
                    {isDriver && <Check className="w-3 h-3 text-background" />}
                  </span>
                  <span>
                    <span className="block text-foreground text-sm">Assign as a chauffeur</span>
                    <span className="block text-smoke text-xs mt-0.5">
                      They see their own jobs and the shift clock instead of the booking screens.
                      A mobile number is required, as it is how Dispatch matches jobs to them.
                    </span>
                  </span>
                </button>

                <Button
                  type="submit"
                  disabled={
                    invite.isPending ||
                    (!phone.trim() && !email.trim()) ||
                    (isDriver && !phone.trim())
                  }
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

        {/* Applications waiting on the office, before the member lists, because
            somebody is sitting there expecting a reply */}
        {(applications?.length ?? 0) > 0 && (
          <div className="mb-12">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-champagne text-xs tracking-[0.4em] uppercase">
                Applications
              </h2>
              <span className="text-smoke text-xs">{applications!.length} waiting</span>
            </div>
            <div className="space-y-3">
              {applications!.map((a) => (
                <div key={a.id} className="border border-champagne-muted p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-foreground text-lg font-light tracking-wide">
                        {a.full_name}
                      </p>
                      <p className="text-smoke text-sm mt-0.5">
                        {a.email}
                        {a.phone ? ` · ${a.phone}` : ""}
                      </p>
                      <p className="text-smoke text-xs mt-2">
                        {[a.address_line1, a.address_line2, a.town, a.postcode, a.country]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      {a.heard_from && (
                        <p className="text-smoke text-xs mt-2">Heard of us via {a.heard_from}</p>
                      )}
                      {a.message && (
                        <p className="text-smoke text-xs mt-2 whitespace-pre-wrap border-l border-border pl-3">
                          {a.message}
                        </p>
                      )}
                      <p className="text-smoke/60 text-[11px] mt-3">
                        Applied{" "}
                        {new Date(a.created_at).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Europe/London",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-none">
                      <Button
                        size="sm"
                        disabled={decideApplication.isPending}
                        onClick={() => decideApplication.mutate({ id: a.id, approve: true })}
                        className="tracking-[0.15em] uppercase"
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={decideApplication.isPending}
                        onClick={() => decideApplication.mutate({ id: a.id, approve: false })}
                        className="text-smoke hover:text-destructive"
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {membersLoading ? (
          <div className="py-20 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-champagne mx-auto" />
          </div>
        ) : membersError ? (
          <p className="text-destructive text-sm py-10">
            Could not load members: {(membersError as Error).message}
          </p>
        ) : (
          <div className="space-y-12">
            {/* Customers and chauffeurs are different jobs and different
                conversations, so the office reads them separately */}
            {([
              { title: "Customers", rows: customers, empty: "No customers yet. Invite your first above." },
              { title: "Chauffeurs", rows: chauffeurs, empty: "No chauffeurs yet. Invite one above and tick \u201cAssign as a chauffeur\u201d." },
            ] as const).map((group) => (
              <div key={group.title}>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-champagne text-xs tracking-[0.4em] uppercase">
                    {group.title}
                  </h2>
                  <span className="text-smoke text-xs">{group.rows.length}</span>
                </div>
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
                    {group.rows.map(memberRow)}
                    {group.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-smoke py-10">
                          {group.empty}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}

        <Dialog
          open={!!editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Edit {editTarget?.full_name || editTarget?.phone}
              </DialogTitle>
              <DialogDescription>
                An email address lets them receive a sign-in code when we cannot text
                their number, which is how members abroad get in.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateMember.mutate();
              }}
              className="space-y-4 mt-2"
            >
              <Input
                placeholder="Full name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={100}
              />
              <Input
                type="email"
                placeholder="Email address"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                maxLength={255}
              />
              <p className="text-smoke text-xs">
                Mobile is {editTarget?.phone || "not set"}. To change it, use Reset 2FA.
              </p>
              <Button
                type="submit"
                disabled={updateMember.isPending}
                className="w-full tracking-[0.15em] uppercase"
              >
                {updateMember.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

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
    </MemberLayout>
  );
};

export default Admin;
