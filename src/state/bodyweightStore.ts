import { createContext, useContext, useEffect, useState } from "react";
import type { BodyweightJournal } from "../services/BodyweightJournal";

export const BodyweightContext = createContext<BodyweightJournal | null>(null);

export function useBodyweight() {
  const journal = useContext(BodyweightContext);
  if (!journal) throw new Error("Журнал веса недоступен");
  const [, render] = useState(0);
  useEffect(() => journal.subscribe(() => render((n) => n + 1)), [journal]);
  return journal;
}
