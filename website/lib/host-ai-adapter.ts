import type { HostAIAdapter } from './ai/host';

// ai.taoa.cc developers: supply your existing, authenticated AI service adapter
// here. The real API/session/quota contract has not been provided to this module.
// null deliberately disables sending; do not replace this with a guessed URL,
// browser-stored API key, fake success, or a second independent credit wallet.
export const hostAIAdapter: HostAIAdapter | null = null;
