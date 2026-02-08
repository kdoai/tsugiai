/**
 * Authentication Context - Provides auth state and tenant info throughout the app
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  onAuthChange,
  signInWithGoogle as firebaseSignInWithGoogle,
  signInWithEmail as firebaseSignInWithEmail,
  signOut as firebaseSignOut,
  getUserRole,
  getUserRecord,
  createOrUpdateUserRecord,
  getTenantInfo,
  getTenantMember,
  getUserTenants,
  updateUserTenant,
  subscribeTenantInfo,
  subscribeTenantMember,
  type User,
  type UserRole,
  type UserRecord,
  type TenantRole,
  type TenantRecord,
  type TenantMember,
  type TenantWithRole,
} from "../lib/firebase";

// ==================== Types ====================

interface AuthContextType {
  // User state
  user: User | null;
  userRecord: UserRecord | null;
  userRole: UserRole | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isViewer: boolean;
  isApproved: boolean;

  // Tenant state
  tenantId: string | null;
  tenant: TenantRecord | null;
  tenantRole: TenantRole | null;
  tenantMember: TenantMember | null;
  isTenantOwner: boolean;
  isTenantAdmin: boolean;
  needsTenantSetup: boolean;

  // Multiple tenants state
  userTenants: TenantWithRole[];
  hasMultipleTenants: boolean;
  needsTenantSelection: boolean;

  // Auth methods
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUserRole: () => Promise<void>;

  // Tenant methods
  setActiveTenant: (tenantId: string | null) => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  refreshTenantInfo: () => Promise<void>;
  refreshUserTenants: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

// ==================== Provider Component ====================

export function AuthProvider({ children }: AuthProviderProps) {
  // User state
  const [user, setUser] = useState<User | null>(null);
  const [userRecord, setUserRecord] = useState<UserRecord | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Tenant state
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantRecord | null>(null);
  const [tenantRole, setTenantRole] = useState<TenantRole | null>(null);
  const [tenantMember, setTenantMember] = useState<TenantMember | null>(null);

  // Multiple tenants state
  const [userTenants, setUserTenants] = useState<TenantWithRole[]>([]);

  // Check if user signed in with email/password (should be admin)
  const isEmailPasswordUser = (currentUser: User): boolean => {
    return currentUser.providerData.some(
      (provider) => provider.providerId === "password"
    );
  };

  // Fetch user record and role
  const fetchUserRole = useCallback(async (currentUser: User, forceRole?: UserRole) => {
    try {
      // Email/password users are always admin
      const roleToSet = forceRole || (isEmailPasswordUser(currentUser) ? "admin" : undefined);
      // Get or create user record
      const record = await createOrUpdateUserRecord(currentUser, roleToSet);
      setUserRecord(record);
      setUserRole(record.role);
      return record;
    } catch (error) {
      console.error("Failed to fetch user role:", error);
      // Default to pending if we can't fetch the role
      setUserRole("pending");
      return null;
    }
  }, []);

  // Fetch user's tenants list
  const fetchUserTenants = useCallback(async (userId: string) => {
    try {
      const tenants = await getUserTenants(userId);
      setUserTenants(tenants);
      return tenants;
    } catch (error) {
      console.error("Failed to fetch user tenants:", error);
      setUserTenants([]);
      return [];
    }
  }, []);

  // Fetch tenant info for the current user
  const fetchTenantInfo = useCallback(async (record: UserRecord | null) => {
    if (!record?.tenantId) {
      setTenantId(null);
      setTenant(null);
      setTenantRole(null);
      setTenantMember(null);
      return;
    }

    try {
      // Get tenant info
      const tenantInfo = await getTenantInfo(record.tenantId);
      setTenant(tenantInfo);
      setTenantId(record.tenantId);

      // Get member info
      if (tenantInfo && record.uid) {
        const member = await getTenantMember(record.tenantId, record.uid);
        setTenantMember(member);
        setTenantRole(member?.role || null);
      }
    } catch (error) {
      console.error("Failed to fetch tenant info:", error);
      setTenant(null);
      setTenantRole(null);
      setTenantMember(null);
    }
  }, []);

  // Refresh user role
  const refreshUserRole = useCallback(async () => {
    if (user) {
      const role = await getUserRole(user.uid);
      setUserRole(role);

      // Also refresh user record
      const record = await getUserRecord(user.uid);
      setUserRecord(record);

      // Refresh tenant info
      await fetchTenantInfo(record);
    }
  }, [user, fetchTenantInfo]);

  // Refresh tenant info
  const refreshTenantInfo = useCallback(async () => {
    await fetchTenantInfo(userRecord);
  }, [userRecord, fetchTenantInfo]);

  // Refresh user tenants list
  const refreshUserTenants = useCallback(async () => {
    if (user) {
      await fetchUserTenants(user.uid);
    }
  }, [user, fetchUserTenants]);

  // Switch to a different tenant
  const switchTenant = useCallback(async (newTenantId: string) => {
    if (!user) return;

    try {
      // Update user's primary tenant in Firestore
      await updateUserTenant(user.uid, newTenantId);

      // Update local state
      const tenantInfo = await getTenantInfo(newTenantId);
      setTenant(tenantInfo);
      setTenantId(newTenantId);

      if (tenantInfo) {
        const member = await getTenantMember(newTenantId, user.uid);
        setTenantMember(member);
        setTenantRole(member?.role || null);
      }

      // Update user record
      const record = await getUserRecord(user.uid);
      setUserRecord(record);
    } catch (error) {
      console.error("Failed to switch tenant:", error);
      throw error;
    }
  }, [user]);

  // Set active tenant
  const setActiveTenant = useCallback(async (newTenantId: string | null) => {
    if (newTenantId === tenantId) return;

    setTenantId(newTenantId);

    if (!newTenantId) {
      setTenant(null);
      setTenantRole(null);
      setTenantMember(null);
      return;
    }

    try {
      const tenantInfo = await getTenantInfo(newTenantId);
      setTenant(tenantInfo);

      if (tenantInfo && user) {
        const member = await getTenantMember(newTenantId, user.uid);
        setTenantMember(member);
        setTenantRole(member?.role || null);
      }
    } catch (error) {
      console.error("Failed to set active tenant:", error);
    }
  }, [tenantId, user]);

  // Subscribe to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthChange(async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const record = await fetchUserRole(currentUser);
        // Fetch user's tenants list
        await fetchUserTenants(currentUser.uid);
        await fetchTenantInfo(record);
      } else {
        setUserRecord(null);
        setUserRole(null);
        setUserTenants([]);
        setTenantId(null);
        setTenant(null);
        setTenantRole(null);
        setTenantMember(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [fetchUserRole, fetchTenantInfo, fetchUserTenants]);

  // Subscribe to tenant changes when tenantId is set
  useEffect(() => {
    if (!tenantId || !user) return;

    // Subscribe to tenant info changes
    const unsubscribeTenant = subscribeTenantInfo(tenantId, (tenantInfo) => {
      setTenant(tenantInfo);
    });

    // Subscribe to member changes
    const unsubscribeMember = subscribeTenantMember(tenantId, user.uid, (member) => {
      setTenantMember(member);
      setTenantRole(member?.role || null);
    });

    return () => {
      unsubscribeTenant();
      unsubscribeMember();
    };
  }, [tenantId, user]);

  // Sign in with Google
  const signInWithGoogle = useCallback(async () => {
    try {
      const user = await firebaseSignInWithGoogle();
      const record = await fetchUserRole(user);
      await fetchUserTenants(user.uid);
      await fetchTenantInfo(record);
    } catch (error) {
      console.error("Sign in failed:", error);
      throw error;
    }
  }, [fetchUserRole, fetchTenantInfo, fetchUserTenants]);

  // Sign in with email/password
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    try {
      const user = await firebaseSignInWithEmail(email, password);
      // Email/password users are automatically admin
      const record = await fetchUserRole(user, "admin");
      await fetchUserTenants(user.uid);
      await fetchTenantInfo(record);
    } catch (error) {
      console.error("Email sign in failed:", error);
      throw error;
    }
  }, [fetchUserRole, fetchTenantInfo, fetchUserTenants]);

  // Sign out
  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut();
      setUserRecord(null);
      setUserRole(null);
      setTenantId(null);
      setTenant(null);
      setTenantRole(null);
      setTenantMember(null);
    } catch (error) {
      console.error("Sign out failed:", error);
      throw error;
    }
  }, []);

  // Computed values
  const isAuthenticated = !!user;
  const isAdmin = userRole === "admin";
  const isViewer = userRole === "viewer";
  const isApproved = userRole === "admin" || userRole === "user" || userRole === "viewer";
  const isTenantOwner = tenantRole === "owner";
  const isTenantAdmin = tenantRole === "owner" || tenantRole === "admin";
  const hasMultipleTenants = userTenants.length > 1;
  // Show tenant selection if user has multiple tenants but no current tenant selected
  const needsTenantSelection = isAuthenticated && hasMultipleTenants && !tenantId;
  // Show onboarding if user has no tenants AND no tenantId in user record
  const needsTenantSetup = isAuthenticated && userTenants.length === 0 && !tenantId;

  const value: AuthContextType = {
    // User state
    user,
    userRecord,
    userRole,
    isLoading,
    isAuthenticated,
    isAdmin,
    isViewer,
    isApproved,

    // Tenant state
    tenantId,
    tenant,
    tenantRole,
    tenantMember,
    isTenantOwner,
    isTenantAdmin,
    needsTenantSetup,

    // Multiple tenants state
    userTenants,
    hasMultipleTenants,
    needsTenantSelection,

    // Auth methods
    signInWithGoogle,
    signInWithEmail,
    signOut,
    refreshUserRole,

    // Tenant methods
    setActiveTenant,
    switchTenant,
    refreshTenantInfo,
    refreshUserTenants,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ==================== Hook ====================

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
