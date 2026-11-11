import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { BodyweightJournal } from "../services/BodyweightJournal";
import { weightClient } from "../services/BodyweightApi";
import { cloudState } from "../device/cloudSync";
const Context = createContext<BodyweightJournal | null>(null);

/** One account-bound journal serves the profile, workout defaults, backup and weight screen. */
export function BodyweightProvider({
  accountId,
  timeZone,
  children,
}: {
  accountId: string;
  timeZone: string;
  children: ReactNode;
}) {
  const [cloud, setCloud] = useState(() =>
    import.meta.env.MODE === "device" ? cloudState() : null,
  );
  const binding =
    import.meta.env.MODE === "device" ? (cloud?.email ?? "") : undefined;
  const journal = useMemo(
    () => new BodyweightJournal(accountId, timeZone, weightClient(), binding),
    [accountId, timeZone, binding, cloud?.token],
  );
  useEffect(() => {
    const changed = () =>
      setCloud(import.meta.env.MODE === "device" ? cloudState() : null);
    window.addEventListener("tyaga:cloud", changed);
    return () => window.removeEventListener("tyaga:cloud", changed);
  }, []);
  useEffect(() => {
    const sync = () => {
      if (
        document.visibilityState === "visible" &&
        (import.meta.env.MODE !== "device" || cloudState())
      )
        void journal.sync();
    };
    const storage = () => {
      journal.reload();
      sync();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("online", sync);
    window.addEventListener("tyaga:synced", sync);
    document.addEventListener("visibilitychange", sync);
    const timer = window.setInterval(sync, 30000);
    sync();
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", storage);
      window.removeEventListener("online", sync);
      window.removeEventListener("tyaga:synced", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [journal]);
  return <Context.Provider value={journal}>{children}</Context.Provider>;
}
export function useBodyweight() {
  const journal = useContext(Context);
  if (!journal) throw new Error("Журнал веса недоступен");
  const [, render] = useState(0);
  useEffect(() => journal.subscribe(() => render((n) => n + 1)), [journal]);
  return journal;
}
