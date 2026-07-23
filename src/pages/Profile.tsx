import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, UserPlus } from "lucide-react";
import MemberLayout from "@/components/MemberLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { invokeMemberFamily } from "@/lib/mfa";
import SignedAvatar, { resolveAvatarUrl } from "@/components/SignedAvatar";
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
import { toast } from "@/hooks/use-toast";

interface FamilyMember {
  id: string;
  full_name: string;
  phone: string;
  status: string;
  avatar_url: string;
}

const fieldLabel = "text-smoke text-xs tracking-[0.2em] uppercase block text-left mb-2";

const Profile = () => {
  const { user, profile, mfaVerified, mfaResolved, refreshProfile, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isWelcome = searchParams.get("welcome") === "1";
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [town, setTown] = useState("");
  const [postcode, setPostcode] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const seededRef = useRef(false);

  const [familyOpen, setFamilyOpen] = useState(false);
  const [familyName, setFamilyName] = useState("");
  const [familyCountryCode, setFamilyCountryCode] = useState("+44");
  const [familyPhone, setFamilyPhone] = useState("");

  // Seed the form from the loaded profile once
  useEffect(() => {
    if (!profile || seededRef.current) return;
    seededRef.current = true;
    setFullName(profile.full_name);
    setEmail(profile.email);
    setAddressLine1(profile.address_line1);
    setAddressLine2(profile.address_line2);
    setTown(profile.town);
    setPostcode(profile.postcode);
    setAvatarUrl(profile.avatar_url);
    resolveAvatarUrl(profile.avatar_url).then(setAvatarPreview);
  }, [profile]);

  const isPrimary = !!profile && !profile.primary_member_id;

  const { data: family } = useQuery({
    queryKey: ["my-family"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, status, avatar_url")
        .eq("primary_member_id", user!.id)
        .order("created_at");
      if (error) throw error;
      return data as FamilyMember[];
    },
    enabled: !!user && isPrimary,
  });

  const addFamily = useMutation({
    mutationFn: () =>
      invokeMemberFamily({
        action: "request",
        full_name: familyName,
        phone: `${familyCountryCode}${familyPhone.replace(/[\s\-()]/g, "").replace(/^0+/, "")}`,
      }),
    onSuccess: () => {
      toast({
        title: "Request sent",
        description: `${familyName} has been submitted for approval. We will notify them once approved.`,
      });
      setFamilyOpen(false);
      setFamilyName("");
      setFamilyPhone("");
      queryClient.invalidateQueries({ queryKey: ["my-family"] });
    },
    onError: (err: Error) => {
      toast({ title: "Request failed", description: err.message, variant: "destructive" });
    },
  });

  const removeFamily = useMutation({
    mutationFn: (memberId: string) => invokeMemberFamily({ action: "remove", user_id: memberId }),
    onSuccess: () => {
      toast({
        title: "Family member removed",
        description: "You can add them again at any time, subject to approval.",
      });
      queryClient.invalidateQueries({ queryKey: ["my-family"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not remove", description: err.message, variant: "destructive" });
    },
  });

  const uploadAvatar = async (file: File) => {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Photo too large", description: "Please choose an image under 5MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      // The bucket is private: store the path and display via signed URLs
      setAvatarUrl(path);
      setAvatarPreview(URL.createObjectURL(file));
    } catch {
      toast({ title: "Upload failed", description: "Please try a different image.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      toast({ title: "Invalid email", description: "Please check the email address.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        address_line1: addressLine1.trim(),
        address_line2: addressLine2.trim(),
        town: town.trim(),
        postcode: postcode.trim(),
        avatar_url: avatarUrl,
        profile_completed: true,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save", description: "Please try again.", variant: "destructive" });
      return;
    }
    await refreshProfile();
    toast({ title: "Profile saved" });
    if (isWelcome) navigate("/#contact");
  };

  if (loading || (user && !mfaResolved)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-champagne" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: "/profile" }} replace />;
  if (!mfaVerified) return <Navigate to="/login" state={{ from: "/profile" }} replace />;

  return (
    <MemberLayout>
      <div className="container mx-auto px-8 pb-16 max-w-2xl">
        <div className="text-center mb-12">
          <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-3">
            {isWelcome ? "Welcome to Apexia VIP" : "My Account"}
          </p>
          <h1 className="font-display text-3xl font-light tracking-wider text-foreground">
            {isWelcome ? "Tell Us About Yourself" : "Your Profile"}
          </h1>
          {isWelcome && (
            <p className="text-smoke text-sm font-light leading-relaxed mt-4">
              A few details so we can look after you properly. You can update
              these at any time.
            </p>
          )}
        </div>

        <form onSubmit={save} className="space-y-6">
          <div className="flex flex-col items-center gap-4 mb-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative w-24 h-24 rounded-full border border-champagne-muted overflow-hidden group"
              disabled={uploading}
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-charcoal">
                  <Camera className="w-6 h-6 text-champagne" />
                </div>
              )}
              <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                {uploading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-champagne" />
                ) : (
                  <Camera className="w-5 h-5 text-champagne" />
                )}
              </div>
            </button>
            <p className="text-smoke text-xs tracking-[0.15em] uppercase">Profile Photo</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar(f);
              }}
            />
          </div>

          <div>
            <label className={fieldLabel}>Full Name</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} required />
          </div>
          <div>
            <label className={fieldLabel}>Email Address</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className={fieldLabel}>Mobile</label>
            <Input value={profile?.phone ?? ""} disabled className="opacity-60" />
            <p className="text-smoke/60 text-xs mt-2 text-left">
              Your sign-in number. To change it, please contact us.
            </p>
          </div>
          <div>
            <label className={fieldLabel}>Address Line 1</label>
            <Input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label className={fieldLabel}>Address Line 2</label>
            <Input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fieldLabel}>Town / City</label>
              <Input value={town} onChange={(e) => setTown(e.target.value)} maxLength={100} />
            </div>
            <div>
              <label className={fieldLabel}>Postcode</label>
              <Input value={postcode} onChange={(e) => setPostcode(e.target.value)} maxLength={20} />
            </div>
          </div>

          <Button type="submit" disabled={saving || uploading} className="w-full tracking-[0.2em] uppercase">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isWelcome ? "Save & Continue" : "Save Profile"}
          </Button>
          {isWelcome && (
            <div className="text-center">
              <Link
                to="/#contact"
                className="text-smoke hover:text-foreground transition-colors text-xs tracking-[0.15em] uppercase"
              >
                Skip for now
              </Link>
            </div>
          )}
        </form>

        {isPrimary && (
          <div className="mt-16 pt-12 border-t border-border">
            <div className="flex items-end justify-between mb-6">
              <div className="text-left">
                <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-2">Family</p>
                <h2 className="font-display text-2xl font-light tracking-wider text-foreground">
                  Family Members
                </h2>
              </div>
              <Dialog open={familyOpen} onOpenChange={setFamilyOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="tracking-[0.15em] uppercase">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Add
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="font-display tracking-wider font-light">
                      Add a Family Member
                    </DialogTitle>
                    <DialogDescription>
                      They will share your account. Once approved by our team,
                      they sign in with their own mobile number and a one-time
                      code, no password needed.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addFamily.mutate();
                    }}
                    className="space-y-4 mt-2"
                  >
                    <Input
                      placeholder="Full name"
                      value={familyName}
                      onChange={(e) => setFamilyName(e.target.value)}
                      maxLength={100}
                      required
                    />
                    <div className="flex gap-3">
                      <CountryCodeSelect value={familyCountryCode} onChange={setFamilyCountryCode} />
                      <Input
                        type="tel"
                        placeholder="Their mobile number"
                        value={familyPhone}
                        onChange={(e) => setFamilyPhone(e.target.value)}
                        className="flex-1"
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={addFamily.isPending}
                      className="w-full tracking-[0.15em] uppercase"
                    >
                      {addFamily.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Submit for Approval"
                      )}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {(family ?? []).length === 0 ? (
              <p className="text-smoke text-sm font-light text-left">
                No family members yet. Add your partner or family so they can
                book under your account.
              </p>
            ) : (
              <ul className="space-y-3">
                {(family ?? []).map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between border border-border px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <SignedAvatar src={m.avatar_url} className="w-8 h-8 rounded-full" />
                      <div className="text-left">
                        <p className="text-foreground text-sm">{m.full_name}</p>
                        <p className="text-smoke text-xs">{m.phone}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={m.status === "active" ? "secondary" : "outline"}>
                        {m.status === "active" ? "Active" : "Awaiting Approval"}
                      </Badge>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={removeFamily.isPending}
                            className="text-smoke tracking-[0.15em] uppercase"
                          >
                            Remove
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Remove {m.full_name || m.phone}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              They will lose access immediately and can no longer
                              sign in or book. You can add them again in the
                              future; new additions are subject to approval.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep</AlertDialogCancel>
                            <AlertDialogAction onClick={() => removeFamily.mutate(m.id)}>
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </MemberLayout>
  );
};

export default Profile;
