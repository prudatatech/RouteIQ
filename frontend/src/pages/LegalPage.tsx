import { useEffect } from 'react'
import { Link } from 'react-router-dom'

type Doc = 'privacy' | 'terms'

interface Section { heading: string; body: (string | string[])[] }

const CONTACT = 'support@margixindia.com'
const EFFECTIVE = '21 November 2026'

// Plain statements of what the platform actually does; keep them in step with the product (and with the
// Google sign-in consent screen, which links here).
const PRIVACY: Section[] = [
  {
    heading: 'Who we are',
    body: [
      'MargixIndia is a freight platform operated by Prudata Technologies. It connects vendors who ship goods, logistic companies and 3PL partners who carry them, their drivers, and the people receiving the goods.',
      `Questions about this policy or your data: ${CONTACT}.`,
    ],
  },
  {
    heading: 'What we collect',
    body: [[
      'Account details: name, email address, mobile number and a protected (hashed) password. If you sign in with Google, we receive your name, email address and profile picture from Google.',
      'Business and verification details: company name and address, PAN, GSTIN, CIN, bank account and IFSC, and the documents you upload (for example KYC documents, licences, vehicle registration and insurance).',
      'Operations: loads, shipments, trips, cargo, quotes, invoices, payments you report, and proof of delivery such as photos and signatures.',
      'Location: the position of a driver\'s phone while a trip is active (through the driver app or a tracking link the driver opens), and vehicle positions from GPS devices connected by the logistic company.',
      'Technical data: IP address, browser and device type, and error logs, used to run and secure the service.',
    ]],
  },
  {
    heading: 'How we use it',
    body: [[
      'To create and sign in your account and keep it secure.',
      'To verify companies, partners, drivers and vehicles before they can work on the platform.',
      'To post, match, carry and track loads, and to show shipment status to the people involved.',
      'To prepare invoices and records required by Indian tax and transport rules (GST, e-way bills).',
      'To send messages about your account and shipments by email, SMS or in-app notification.',
      'To investigate problems, prevent fraud and meet legal obligations.',
    ]],
  },
  {
    heading: 'Who we share it with',
    body: [
      'We do not sell personal data and we do not show advertising.',
      [
        'The other parties to a shipment, only as needed to carry it: for example the logistic company and driver see pickup and drop details, and the receiver sees the shipment\'s status on its tracking page.',
        'Service providers that run parts of the platform for us: Microsoft Azure (hosting and storage in India), Resend (email), Twilio (SMS), map and traffic services (Mapbox, TomTom, Google Maps, Mappls, OpenWeather), Cashfree (verification of vehicle registration and bank details) and GPS providers connected by a logistic company. They receive only what their task needs.',
        'Government systems, when you use features that require them, such as e-way bills and the Unified Logistics Interface Platform (ULIP).',
        'Authorities, when the law requires it.',
      ],
    ],
  },
  {
    heading: 'Google user data',
    body: [
      'If you choose "Continue with Google", we request only your basic profile (name, email address and profile picture). We use it only to create your account and sign you in. We do not use it for advertising, we do not sell it, and we do not share it except with the service providers above as needed to run your account.',
      'Our use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.',
    ],
  },
  {
    heading: 'Where and how long we keep it',
    body: [
      'Data is stored on servers in India. We keep it while your account is active, and afterwards for as long as the law requires (for example, tax and invoice records). Location history is kept with the trip it belongs to.',
      'Access is limited to people who need it to run the service, and data is encrypted in transit.',
    ],
  },
  {
    heading: 'Cookies and browser storage',
    body: ['We use your browser\'s storage to keep you signed in and remember settings. We do not use advertising or tracking cookies.'],
  },
  {
    heading: 'Your rights',
    body: [
      `Under India's Digital Personal Data Protection Act, 2023, you may ask to see, correct or delete your personal data, withdraw consent, or raise a grievance. Write to ${CONTACT}; we reply within 30 days. Some records must be kept by law even after an account is closed.`,
    ],
  },
  {
    heading: 'Changes',
    body: ['If we change this policy, we will update this page and its date, and tell you in the app when the change matters.'],
  },
]

const TERMS: Section[] = [
  {
    heading: 'About these terms',
    body: [
      'These terms apply to MargixIndia, a freight platform operated by Prudata Technologies. By creating an account or using the platform you agree to them. If you use it for a company, you confirm you may accept them for that company.',
    ],
  },
  {
    heading: 'What the platform does',
    body: [
      'Vendors post loads; logistic companies and 3PL partners quote for, accept and carry them; drivers carry out trips; receivers follow shipments. MargixIndia provides the software that connects them. The contract to carry goods is between the vendor and the carrier who accepts the load.',
    ],
  },
  {
    heading: 'Your account',
    body: [[
      'Give accurate details, including the business and verification details we ask for, and keep them up to date.',
      'Keep your sign-in details private. You are responsible for what happens under your account.',
      'We may ask for documents to verify you, and may refuse, pause or close an account that fails verification or breaks these terms.',
    ]],
  },
  {
    heading: 'Using the platform',
    body: [[
      'Post only real loads and real capacity, with correct cargo descriptions, weights and prices.',
      'Do not carry goods that are illegal, or dangerous goods without the required permits.',
      'Do not misuse the platform: no attempts to get around security, copy data in bulk, or contact other users to avoid the platform after meeting them through it.',
      'Drivers: when you start a trip, your phone\'s location is shared with the shipment\'s parties until the trip ends.',
    ]],
  },
  {
    heading: 'Prices, fees and payments',
    body: [
      'Freight prices are agreed between the vendor and the carrier. MargixIndia may charge a fee per order, which is shown or agreed before you accept. Invoices and taxes are the responsibility of the parties that issue and receive them.',
    ],
  },
  {
    heading: 'Goods, loss and damage',
    body: [
      'The carrier is responsible for the goods while carrying them, under the agreement with the vendor and the law. The platform records custody, problems and claims to help the parties settle them, but MargixIndia is not the carrier.',
    ],
  },
  {
    heading: 'Availability and liability',
    body: [
      'We work to keep the platform available and accurate, but provide it as is: maps, travel times, prices and estimates are guides. To the extent the law allows, MargixIndia is not liable for indirect losses, and its total liability for any claim is limited to the fees you paid to MargixIndia in the three months before the claim.',
    ],
  },
  {
    heading: 'Ending use',
    body: [`You can stop using the platform and ask us to close your account at any time by writing to ${CONTACT}. Records the law requires us to keep are kept.`],
  },
  {
    heading: 'Law and contact',
    body: [
      `These terms are governed by the laws of India. We may update them; continued use after an update means you accept it. Contact: ${CONTACT}.`,
      'See also our privacy policy.',
    ],
  },
]

const DOCS: Record<Doc, { title: string; sections: Section[] }> = {
  privacy: { title: 'Privacy policy', sections: PRIVACY },
  terms: { title: 'Terms of service', sections: TERMS },
}

/** The public privacy policy (/privacy) and terms of service (/terms). */
export default function LegalPage({ doc }: { doc: Doc }) {
  const { title, sections } = DOCS[doc]

  useEffect(() => {
    const previous = document.title
    document.title = `${title} · MargixIndia`
    window.scrollTo(0, 0)
    return () => { document.title = previous }
  }, [title])

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-content items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 rounded-control">
            <img src="/margix-logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
            <span className="text-lg font-semibold text-text">MargixIndia</span>
          </Link>
          <nav aria-label="Legal" className="flex gap-4 text-sm">
            <Link to="/privacy" className={doc === 'privacy' ? 'font-medium text-text' : 'text-muted hover:text-text'}>Privacy</Link>
            <Link to="/terms" className={doc === 'terms' ? 'font-medium text-text' : 'text-muted hover:text-text'}>Terms</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-form px-4 py-8 sm:px-6 lg:py-12">
        <h1 className="text-3xl font-semibold text-text">{title}</h1>
        <p className="mt-2 text-sm text-muted">Effective {EFFECTIVE}</p>

        <div className="mt-8 space-y-8">
          {sections.map(section => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold text-text">{section.heading}</h2>
              <div className="mt-2 space-y-3 text-sm leading-relaxed text-text">
                {section.body.map((part, i) => Array.isArray(part)
                  ? <ul key={i} className="list-disc space-y-1.5 pl-5">{part.map(item => <li key={item}>{item}</li>)}</ul>
                  : <p key={i}>{part}</p>)}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-10 border-t border-border pt-6 text-sm text-muted">
          {doc === 'privacy'
            ? <>Read the <Link to="/terms" className="text-brand hover:underline">terms of service</Link>.</>
            : <>Read the <Link to="/privacy" className="text-brand hover:underline">privacy policy</Link>.</>}
        </p>
      </main>
    </div>
  )
}
