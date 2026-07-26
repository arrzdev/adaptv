//the current sync run's abort signal, shared between the controller (which
//creates it and aborts it on timeout) and the transport (which threads it into
//every fetch). kept in its own leaf module so the transport doesn't have to
//import the controller — that would cycle (controller → store → collections →
//transport). undefined whenever no run is in flight.
let current: AbortSignal | undefined

export function setSyncSignal(signal: AbortSignal | undefined): void {
  current = signal
}

export function currentSyncSignal(): AbortSignal | undefined {
  return current
}
