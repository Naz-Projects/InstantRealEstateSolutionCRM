// Direct-mail CSV for a filtered lead set — owner mailing addresses come free from
// the parcel spine (direct mail is the first outreach channel). Pure; unit-tested.

export interface MailCsvLead {
  ownerName: string;
  ownerAddr: string;
  ownerAddr2: string;
  ownerCity: string;
  ownerState: string;
  ownerZip: string;
  situsStreet: string;
  propCity: string;
  propZip: string;
  score: number;
  signalTypes: string[];
}

const HEADERS = [
  "owner_name", "mail_address", "mail_address_2", "mail_city", "mail_state", "mail_zip",
  "property_address", "property_city", "property_zip", "score", "signals",
];

const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildMailCsv(leads: MailCsvLead[]): string {
  const rows = leads.map((l) =>
    [
      l.ownerName, l.ownerAddr, l.ownerAddr2, l.ownerCity, l.ownerState, l.ownerZip,
      l.situsStreet, l.propCity, l.propZip, l.score, l.signalTypes.join("|"),
    ]
      .map(cell)
      .join(","),
  );
  return [HEADERS.join(","), ...rows].join("\n") + "\n";
}
