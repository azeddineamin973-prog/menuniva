import 'server-only';
import { clientIdentity, type ClientIdentity } from './client-identity';
/**
 * Throttling identity of a public request: guest cookie + trusted client IP (if the deployment
 * makes it known). Replaces the former IP + User-Agent hash, which treated every guest on one
 * restaurant Wi-Fi with the same phone model as a single client (audit BUG-05).
 */
export function clientKeyFromRequest(req: Request): ClientIdentity {
  return clientIdentity(req).identity;
}
