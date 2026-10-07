export interface AccountProfile {
  id: string;
  email: string;
  displayName: string;
  timeZone: string;
  bodyMassKg: number | null;
  revision: number;
  createdAt: string;
}
export interface AccountState { registered: boolean; profile: AccountProfile | null }
