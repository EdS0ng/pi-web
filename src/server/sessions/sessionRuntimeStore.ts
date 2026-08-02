export interface ActiveSession<TRuntime> {
  runtime: TRuntime;
  unsubscribe: () => void;
  /** Epoch ms of the last lookup or session event; drives idle reaping. */
  lastActivityAt: number;
}
