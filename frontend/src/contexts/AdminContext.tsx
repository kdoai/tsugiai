import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface AdminContextType {
  isAdminMode: boolean;
  toggleAdminMode: () => void;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [isAdminMode, setIsAdminMode] = useState(() => {
    const saved = localStorage.getItem("adminMode");
    return saved === "true";
  });

  useEffect(() => {
    localStorage.setItem("adminMode", String(isAdminMode));
  }, [isAdminMode]);

  const toggleAdminMode = () => setIsAdminMode((prev) => !prev);

  return (
    <AdminContext.Provider value={{ isAdminMode, toggleAdminMode }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error("useAdmin must be used within an AdminProvider");
  }
  return context;
}
