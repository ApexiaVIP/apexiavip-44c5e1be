import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { checkMfaStatus } from "@/lib/mfa";

interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  status: string;
  created_at: string;
  address_line1: string;
  address_line2: string;
  town: string;
  postcode: string;
  country: string;
  avatar_url: string;
  profile_completed: boolean;
  primary_member_id: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  /** True only once the user has passed SMS verification this session */
  mfaVerified: boolean;
  /** Re-check SMS verification status (call after a successful verify) */
  refreshMfa: () => Promise<void>;
  /** Re-fetch the profile (call after the member edits it) */
  refreshProfile: () => Promise<void>;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        if (!newSession?.user) {
          setProfile(null);
          setIsAdmin(false);
          setMfaVerified(false);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      if (!existing?.user) setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    let cancelled = false;
    const load = async () => {
      const [profileRes, adminRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      ]);
      if (cancelled) return;
      setProfile(profileRes.data ?? null);
      setIsAdmin(adminRes.data === true);
      setLoading(false);
    };
    load();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  // Check SMS verification status for this session
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    checkMfaStatus()
      .then((verified) => {
        if (!cancelled) setMfaVerified(verified);
      })
      .catch(() => {
        if (!cancelled) setMfaVerified(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  const refreshProfile = async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    setProfile(data ?? null);
  };

  const refreshMfa = async () => {
    try {
      setMfaVerified(await checkMfaStatus());
    } catch {
      setMfaVerified(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        isAdmin,
        mfaVerified,
        refreshMfa,
        refreshProfile,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
