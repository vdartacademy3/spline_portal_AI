import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { GlobalSearchContext } from "@/components/hr/global-search-context";
import { supabase } from "@/integrations/supabase/client";

type Results = {
  employees: { id: string; name: string; sub: string }[];
  jobs: { id: string; name: string }[];
  tickets: { id: string; name: string }[];
  policies: { id: string; name: string }[];
};

const EMPTY: Results = { employees: [], jobs: [], tickets: [], policies: [] };

export function GlobalSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <GlobalSearchContext.Provider value={{ openSearch: () => setOpen(true) }}>
      {children}
      <GlobalSearch open={open} onOpenChange={setOpen} />
    </GlobalSearchContext.Provider>
  );
}

export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Results>(EMPTY);
  const [searching, setSearching] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!open) {
      seqRef.current += 1;
      setTerm("");
      setResults(EMPTY);
      setSearching(false);
      return;
    }
    const q = term.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      setSearching(false);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      if (seq !== seqRef.current) return;
      const like = `%${q}%`;
      const apply = (patch: Partial<Results>) => {
        if (seq !== seqRef.current) return;
        setResults((prev) => ({ ...prev, ...patch }));
      };
      setResults(EMPTY);
      setSearching(true);
      const queries = [
        supabase
          .from("employees")
          .select("id, first_name, last_name, designation, employee_code")
          .or(`first_name.ilike.${like},last_name.ilike.${like},employee_code.ilike.${like}`)
          .limit(5)
          .then(({ data }) =>
            apply({
              employees: (data ?? []).map((e) => ({
                id: e.id,
                name: `${e.first_name} ${e.last_name}`,
                sub: `${e.employee_code}${e.designation ? ` · ${e.designation}` : ""}`,
              })),
            }),
          ),
        supabase
          .from("job_requisitions")
          .select("id, title")
          .ilike("title", like)
          .limit(4)
          .then(({ data }) =>
            apply({ jobs: (data ?? []).map((j) => ({ id: j.id, name: j.title })) }),
          ),
        supabase
          .from("helpdesk_tickets")
          .select("id, subject")
          .ilike("subject", like)
          .limit(4)
          .then(({ data }) =>
            apply({ tickets: (data ?? []).map((t) => ({ id: t.id, name: t.subject })) }),
          ),
        supabase
          .from("kb_documents")
          .select("id, title")
          .ilike("title", like)
          .limit(4)
          .then(({ data }) =>
            apply({ policies: (data ?? []).map((k) => ({ id: k.id, name: k.title })) }),
          ),
      ];
      void Promise.allSettled(queries).then(() => {
        if (seq === seqRef.current) setSearching(false);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [term, open]);

  function go(to: string) {
    onOpenChange(false);
    setTerm("");
    void navigate({ to });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search employees, jobs, tickets, policies..."
        value={term}
        onValueChange={setTerm}
      />
      <CommandList>
        <CommandEmpty>
          {searching
            ? "Searching..."
            : term.length < 2
              ? "Type at least two characters."
              : "No authorized results found."}
        </CommandEmpty>
        {results.employees.length ? (
          <CommandGroup heading="Employees">
            {results.employees.map((e) => (
              <CommandItem
                key={e.id}
                value={`emp-${e.name}`}
                keywords={[e.sub]}
                onSelect={() => go(`/employees/${e.id}`)}
              >
                <span className="font-medium">{e.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{e.sub}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results.jobs.length ? (
          <CommandGroup heading="Jobs">
            {results.jobs.map((j) => (
              <CommandItem key={j.id} value={`job-${j.name}`} onSelect={() => go("/recruitment")}>
                {j.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results.tickets.length ? (
          <CommandGroup heading="Helpdesk">
            {results.tickets.map((t) => (
              <CommandItem key={t.id} value={`tic-${t.name}`} onSelect={() => go("/helpdesk")}>
                {t.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results.policies.length ? (
          <CommandGroup heading="Policies">
            {results.policies.map((p) => (
              <CommandItem
                key={p.id}
                value={`kb-${p.name}`}
                onSelect={() => go("/admin/knowledge")}
              >
                {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
