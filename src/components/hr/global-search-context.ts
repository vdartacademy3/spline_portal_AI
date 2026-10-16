import { createContext, useContext } from "react";

export type GlobalSearchContextValue = {
  openSearch: () => void;
};

export const GlobalSearchContext = createContext<GlobalSearchContextValue | undefined>(undefined);

export function useGlobalSearch() {
  const context = useContext(GlobalSearchContext);
  if (!context) throw new Error("useGlobalSearch must be used within GlobalSearchProvider");
  return context;
}
