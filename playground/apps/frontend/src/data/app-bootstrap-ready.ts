import { createBootstrapGate } from "@arrzdev/adaptv/hooks"

const gate = createBootstrapGate()

export const useAppBootstrapReady = gate.useBootstrapReady
export const getAppBootstrapReady = gate.getBootstrapReady
export const setAppBootstrapReady = gate.setBootstrapReady
export const resetAppBootstrapReady = gate.resetBootstrapReady
export const subscribeAppBootstrapReady = gate.subscribeBootstrapReady
