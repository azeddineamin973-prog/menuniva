import 'server-only';

/**
 * Provider abstractions for FUTURE integrations (Part 19). Nothing here takes money or issues
 * legal documents today; every provider reports its real status.
 *
 * - Online customer payments (MB WAY, Multibanco, cards, Bizum…) require a contract with a
 *   payment provider, credentials, testing and compliance. MenuNiva never handles raw card data.
 * - Certified invoicing (Portugal: AT-certified software / SAF-T; Spain: Verifactu / TicketBAI)
 *   must be done by a certified system. MenuNiva receipts are internal documents only.
 */
export interface OnlinePaymentProvider {
  readonly id: string;
  status(): { available: boolean; note: string };
}

export interface CertifiedInvoicingProvider {
  readonly id: string;
  status(): { available: boolean; note: string };
}

export const ONLINE_PAYMENTS: OnlinePaymentProvider = {
  id: 'none',
  status: () => ({ available: false, note: 'No online payment provider configured. Payments are taken at the restaurant and recorded by staff.' }),
};

export const CERTIFIED_INVOICING: CertifiedInvoicingProvider = {
  id: 'none',
  status: () => ({ available: false, note: 'No certified invoicing integration. Issue legal invoices with your certified POS/invoicing software.' }),
};
