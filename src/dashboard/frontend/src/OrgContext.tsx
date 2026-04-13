import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export const ORG_STORAGE_KEY = "nuvex_active_org";

interface Org {
  org_id: string;
  name: string;
  status: string;
}

interface OrgContextValue {
  activeOrg: string;
  setActiveOrg: (id: string) => void;
  orgs: Org[];
  orgsLoading: boolean;
}

const OrgContext = createContext<OrgContextValue>({
  activeOrg: "default",
  setActiveOrg: () => {},
  orgs: [],
  orgsLoading: false,
});

export function OrgProvider({ children }: { children: ReactNode }) {
  const [activeOrg, setActiveOrgState] = useState<string>(
    () => localStorage.getItem(ORG_STORAGE_KEY) ?? "default"
  );

  function setActiveOrg(id: string) {
    localStorage.setItem(ORG_STORAGE_KEY, id);
    setActiveOrgState(id);
  }

  const { data: orgs = [], isLoading: orgsLoading } = useQuery<Org[]>({
    queryKey: ["orgs"],
    queryFn: async () => {
      const res = await fetch("/api/orgs");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // If stored org no longer exists (e.g. was archived), fall back to first active
  useEffect(() => {
    if (!orgsLoading && orgs.length > 0) {
      const match = orgs.find((o) => o.org_id === activeOrg && o.status !== "archived");
      if (!match) {
        const first = orgs.find((o) => o.status === "active");
        if (first) setActiveOrg(first.org_id);
      }
    }
  }, [orgs, orgsLoading]);

  return (
    <OrgContext.Provider value={{ activeOrg, setActiveOrg, orgs, orgsLoading }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  return useContext(OrgContext);
}
