import { ImportMock, KitchenMock, LanguagePills, LanguagesMock } from './feature-mockups';
import { OrderTrackerScreen, PhoneFrame, WaiterCalledToast } from './mockups';
import { Container, Points, SectionHeading, type Point } from './ui';

/*
 * The page follows the tagline: 01 One menu, 02 Every order (plus the kitchen), 03 Every language.
 * Every claim here describes a feature that exists and is tested (docs/FEATURE_MATRIX.md).
 */

const FACTS = [
  { value: '0%', label: 'commission on orders through your own MenuNiva channels' },
  { value: '5', label: 'guest languages, including Arabic written right-to-left' },
  { value: '4', label: 'ways to order: at the table, takeaway, delivery and WhatsApp' },
  { value: '0', label: 'apps for guests to install. They scan and order in the browser' },
];

export function Facts() {
  return (
    <section aria-label="MenuNiva at a glance" className="border-y border-line bg-surface">
      <Container>
        <dl className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
          {FACTS.map((f) => (
            <div key={f.label} className="mn-reveal flex flex-col-reverse justify-end gap-2 bg-surface px-3 py-7 sm:px-7 sm:py-9">
              <dt className="text-sm leading-snug text-muted">{f.label}</dt>
              <dd className="text-4xl font-semibold tracking-tight text-ink tabular-nums sm:text-5xl">{f.value}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}

const ONE_MENU: Point[] = [
  { icon: 'wand', title: 'Magic setup', body: 'Paste your Google Maps link or website, and your address, phone and opening hours are filled in for you.' },
  { icon: 'layers', title: 'One menu for every channel', body: 'Table, takeaway and delivery share one menu, with a separate price per channel when you need one.' },
  { icon: 'shield', title: 'Checked before guests see it', body: 'Allergens are verified before publishing, and a sold-out dish is one tap away.' },
];

export function OneMenu() {
  return (
    <section id="one-menu" aria-labelledby="one-menu-title" className="scroll-mt-16 py-20 sm:py-28">
      <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHeading
            id="one-menu-title"
            index="01"
            eyebrow="One menu"
            title="Bring the menu you already have."
            lead="Paste your Glovo store link, or upload an Uber Eats export, a spreadsheet, a PDF or plain text. MenuNiva reads the categories, prices, sizes and extras, and you review every dish before anything goes live."
          />
          <Points items={ONE_MENU} className="mt-10" />
        </div>
        <div aria-hidden className="mn-reveal relative">
          <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-[radial-gradient(closest-side,rgb(185_255_54/0.22),transparent)] dark:bg-[radial-gradient(closest-side,rgb(185_255_54/0.08),transparent)]" />
          <ImportMock />
        </div>
      </Container>
    </section>
  );
}

const CHANNELS: Point[] = [
  { icon: 'qr', title: 'Table QR ordering', body: 'Guests order, call the waiter and ask for the bill from their phone.' },
  { icon: 'bag', title: 'Takeaway', body: 'Pickup slots that follow your opening hours and preparation time.' },
  { icon: 'truck', title: 'Your own delivery', body: 'Delivery zones by postal code in Portugal and Spain, with fees and minimum orders.' },
  { icon: 'chat', title: 'WhatsApp orders', body: 'Guests send their order to your WhatsApp, already written out.' },
];

export function EveryOrder() {
  return (
    <section id="every-order" aria-labelledby="every-order-title" className="scroll-mt-16 border-t border-line bg-surface py-20 sm:py-28">
      <Container className="grid items-center gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div aria-hidden className="mn-reveal relative order-last mx-auto w-full max-w-[300px] lg:order-first">
          <div className="absolute -inset-10 -z-10 bg-[radial-gradient(closest-side,rgb(185_255_54/0.25),transparent)] dark:bg-[radial-gradient(closest-side,rgb(185_255_54/0.08),transparent)]" />
          <PhoneFrame>
            <OrderTrackerScreen />
          </PhoneFrame>
          <WaiterCalledToast className="absolute -end-4 top-12 animate-float sm:-end-20" />
        </div>
        <div>
          <SectionHeading
            id="every-order-title"
            index="02"
            eyebrow="Every order"
            title="Every table and every channel on one live board."
            lead="Guests scan the QR code on their table, browse and order. No app, no account. Takeaway, delivery and WhatsApp orders arrive on the same board, with a chime until someone sees them."
          />
          <Points items={CHANNELS} className="mt-10 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-8" />
        </div>
      </Container>
    </section>
  );
}

const KITCHEN: Point[] = [
  { icon: 'monitor', title: 'Any screen will do', body: 'Displays run in the browser on a tablet, a laptop or a TV.' },
  { icon: 'bell', title: 'Nothing gets missed', body: 'New orders chime until someone sees them, and priority orders go to the top.' },
  { icon: 'print', title: 'Tickets when you want them', body: 'Print kitchen tickets from the browser or save them as PDF.' },
];

export function Kitchen() {
  return (
    // No overflow-hidden on the section: it would become the scroll container of the reveal animations
    // inside it (they would never play). The decorative layer clips its own glow instead.
    <section id="kitchen" aria-labelledby="kitchen-title" className="relative isolate scroll-mt-16 bg-graphite py-20 text-white sm:py-28 dark:border-y dark:border-white/10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="mn-grid-lines mn-on-dark mn-mask-center absolute inset-0" />
        <div className="absolute start-1/2 top-0 h-80 w-[50rem] max-w-none -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(185_255_54/0.14),transparent)]" />
      </div>
      <Container>
        <SectionHeading
          id="kitchen-title"
          tone="dark"
          align="center"
          eyebrow="Kitchen & café displays"
          title="Food goes to the kitchen. Tea goes to the café."
          lead="Every order is split by station. Each screen shows only its own part, and the order is ready when every station has finished."
        />
        <div aria-hidden className="mn-reveal mt-14">
          <KitchenMock />
        </div>
        <Points items={KITCHEN} tone="dark" className="mt-14 md:grid-cols-3 md:gap-8" />
      </Container>
    </section>
  );
}

const LANGUAGES: Point[] = [
  { icon: 'checkCircle', title: 'You approve every translation', body: 'Translations stay hidden from guests until you have reviewed them. Until then, guests see your original text.' },
  { icon: 'globe', title: 'Guests choose, any time', body: 'Guests pick their language on the menu and can switch whenever they like.' },
  { icon: 'users', title: 'For your team, too', body: 'Kitchen and service screens are available in the same five languages.' },
];

export function EveryLanguage() {
  return (
    <section id="every-language" aria-labelledby="every-language-title" className="scroll-mt-16 py-20 sm:py-28">
      <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHeading
            id="every-language-title"
            index="03"
            eyebrow="Every language"
            title="Your menu, in your guests' language."
            lead={
              <>
                Write your menu once. Guests read it in Português, English, Français,{' '}
                <bdi lang="ar" dir="rtl">
                  العربية
                </bdi>{' '}
                or Español, and Arabic reads right-to-left, as it should.
              </>
            }
          />
          <Points items={LANGUAGES} className="mt-10" />
        </div>
        <div aria-hidden className="mn-reveal relative">
          <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-[radial-gradient(closest-side,rgb(185_255_54/0.22),transparent)] dark:bg-[radial-gradient(closest-side,rgb(185_255_54/0.08),transparent)]" />
          <LanguagesMock />
          <div className="mt-4 flex justify-center">
            <LanguagePills />
          </div>
        </div>
      </Container>
    </section>
  );
}
