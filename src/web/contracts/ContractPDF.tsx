import type { JSX } from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type { ContractTerms, ContractType } from "../../scraper/contracts";

// ---------------------------------------------------------------------------
// Template legal copy. Kept in named constants so a reviewer/attorney can
// swap the wording without touching the rendering tree. This is generic,
// plain-language boilerplate — NOT legal advice (see DISCLAIMER).
// ---------------------------------------------------------------------------

const PSA_CLAUSES: string[] = [
  "1. Offer & Acceptance. The Buyer agrees to purchase, and the Seller agrees to sell, the Property described above on the terms set forth in this Agreement. This Agreement becomes binding when signed by both parties.",
  "2. Sold AS-IS. The Property is sold in its present, AS-IS condition, with all faults. The Buyer accepts the Property in its current state, subject only to any inspection rights expressly granted herein.",
  "3. Time is of the Essence. Time is of the essence with respect to all dates and deadlines stated in this Agreement, including the closing date.",
  "4. Default. If either party fails to perform its obligations under this Agreement, the non-defaulting party may pursue any remedy available at law or in equity, including retention or return of the earnest money as applicable.",
];

const ASSIGNMENT_CLAUSES: string[] = [
  "1. Assignment of Rights. The Assignor hereby assigns and transfers to the Assignee all of the Assignor's right, title, and interest in and to the underlying Purchase & Sale Agreement for the Property described above.",
  "2. Assumption. The Assignee accepts this assignment and agrees to assume and perform all of the obligations of the Assignor under the underlying Purchase & Sale Agreement from and after the date of this Assignment.",
  "3. Assignment Fee. In consideration of this assignment, the Assignee shall pay the Assignor the assignment fee stated above, due and payable at the closing of the underlying transaction.",
  "4. Representations. The Assignor represents that the underlying Purchase & Sale Agreement is in full force and effect and that the Assignor has not previously assigned its interest therein.",
];

const DISCLAIMER =
  "This document is a generated template provided for convenience and is NOT legal advice. Consult an attorney before signing.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || Number.isNaN(amount)) return "";
  return "$" + amount.toLocaleString("en-US");
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111827",
    backgroundColor: "#ffffff",
    paddingTop: 50,
    paddingBottom: 60,
    paddingLeft: 56,
    paddingRight: 56,
    lineHeight: 1.5,
  },
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 18,
    color: "#111827",
    textAlign: "center",
    marginBottom: 24,
    letterSpacing: 0.5,
  },
  sectionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#111827",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
  },
  partiesRow: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 6,
  },
  partyCol: {
    flex: 1,
  },
  fieldLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 11,
    color: "#111827",
    marginBottom: 8,
  },
  termRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  termLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#111827",
    width: 150,
  },
  termValue: {
    fontSize: 10,
    color: "#111827",
    flex: 1,
  },
  clause: {
    fontSize: 10,
    color: "#111827",
    marginBottom: 10,
    lineHeight: 1.55,
    textAlign: "justify",
  },
  signatureSection: {
    marginTop: 28,
  },
  signatureLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#111827",
    marginBottom: 6,
  },
  signatureImage: {
    width: 180,
    height: 60,
    objectFit: "contain",
    marginBottom: 2,
  },
  typedSignature: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 16,
    color: "#111827",
    paddingBottom: 4,
    minHeight: 28,
  },
  typedSignatureNote: {
    fontSize: 8,
    color: "#6b7280",
    marginBottom: 2,
  },
  blankSignatureLine: {
    height: 32,
  },
  signatureRule: {
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    width: 220,
    marginBottom: 6,
  },
  signatureMeta: {
    fontSize: 10,
    color: "#111827",
    marginBottom: 3,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    fontSize: 8,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 1.4,
  },
});

interface ContractPDFProps {
  type: ContractType; // "psa" | "assignment"
  terms: ContractTerms;
  signerRole: "seller" | "buyer";
  signatureDataUri?: string | null; // drawn signature PNG (data URI)
  typedName?: string | null; // typed-mode signature name
  acceptedDate?: string | null; // formatted date shown in the signature block
}

function SignatureBlock(props: {
  label: string;
  printName: string;
  signatureDataUri?: string | null;
  typedName?: string | null;
  acceptedDate?: string | null;
}) {
  return (
    <View style={styles.signatureSection} wrap={false}>
      <Text style={styles.signatureLabel}>{props.label}</Text>
      {props.signatureDataUri ? (
        <Image src={props.signatureDataUri} style={styles.signatureImage} />
      ) : props.typedName ? (
        <>
          <Text style={styles.typedSignatureNote}>
            Signed electronically (typed signature):
          </Text>
          <Text style={styles.typedSignature}>{props.typedName}</Text>
        </>
      ) : (
        <View style={styles.blankSignatureLine} />
      )}
      <View style={styles.signatureRule} />
      <Text style={styles.signatureMeta}>Print name: {props.printName}</Text>
      <Text style={styles.signatureMeta}>Date: {props.acceptedDate ?? ""}</Text>
    </View>
  );
}

export function ContractPDF(props: ContractPDFProps): JSX.Element {
  const { type, terms, signerRole, signatureDataUri, typedName, acceptedDate } =
    props;

  const isPsa = type === "psa";
  const title = isPsa ? "PURCHASE & SALE AGREEMENT" : "ASSIGNMENT OF CONTRACT";
  const clauses = isPsa ? PSA_CLAUSES : ASSIGNMENT_CLAUSES;

  const printName =
    typedName ??
    (signerRole === "seller" ? terms.sellerName : terms.assigneeName) ??
    "";

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{title}</Text>

        {/* Parties */}
        <Text style={styles.sectionHeading}>Parties</Text>
        <View style={styles.partiesRow}>
          <View style={styles.partyCol}>
            <Text style={styles.fieldLabel}>
              {isPsa ? "Buyer" : "Assignor"}
            </Text>
            <Text style={styles.fieldValue}>{terms.buyerEntity}</Text>
          </View>
          <View style={styles.partyCol}>
            <Text style={styles.fieldLabel}>
              {isPsa ? "Seller" : "Assignee"}
            </Text>
            <Text style={styles.fieldValue}>
              {isPsa ? terms.sellerName ?? "" : terms.assigneeName ?? ""}
            </Text>
          </View>
        </View>

        {/* Property */}
        <Text style={styles.sectionHeading}>Property</Text>
        <Text style={styles.fieldValue}>{terms.propertyAddress}</Text>

        {/* Terms */}
        <Text style={styles.sectionHeading}>Terms</Text>
        {isPsa ? (
          <>
            {terms.price !== undefined && (
              <View style={styles.termRow}>
                <Text style={styles.termLabel}>Purchase Price:</Text>
                <Text style={styles.termValue}>{formatMoney(terms.price)}</Text>
              </View>
            )}
            {terms.earnestMoney !== undefined && (
              <View style={styles.termRow}>
                <Text style={styles.termLabel}>Earnest Money:</Text>
                <Text style={styles.termValue}>
                  {formatMoney(terms.earnestMoney)}
                </Text>
              </View>
            )}
            {terms.closingDate !== undefined && (
              <View style={styles.termRow}>
                <Text style={styles.termLabel}>Closing Date:</Text>
                <Text style={styles.termValue}>{terms.closingDate}</Text>
              </View>
            )}
            {terms.inspectionDays !== undefined && (
              <View style={styles.termRow}>
                <Text style={styles.termLabel}>Inspection Period:</Text>
                <Text style={styles.termValue}>
                  {terms.inspectionDays} days
                </Text>
              </View>
            )}
          </>
        ) : (
          <>
            {terms.underlyingContractRef !== undefined && (
              <View style={styles.termRow}>
                <Text style={styles.termLabel}>Underlying Agreement:</Text>
                <Text style={styles.termValue}>
                  {terms.underlyingContractRef}
                </Text>
              </View>
            )}
            {terms.assignmentFee !== undefined && (
              <View style={styles.termRow}>
                <Text style={styles.termLabel}>Assignment Fee:</Text>
                <Text style={styles.termValue}>
                  {formatMoney(terms.assignmentFee)}
                </Text>
              </View>
            )}
          </>
        )}

        {/* Standard body */}
        <Text style={styles.sectionHeading}>Standard Terms</Text>
        {clauses.map((clause, i) => (
          <Text key={i} style={styles.clause}>
            {clause}
          </Text>
        ))}

        {/* Signature block */}
        <SignatureBlock
          label={isPsa ? "Seller Signature" : "Assignee Signature"}
          printName={printName}
          signatureDataUri={signatureDataUri}
          typedName={typedName}
          acceptedDate={acceptedDate}
        />

        {/* Per-page disclaimer footer */}
        <Text style={styles.footer} fixed>
          {DISCLAIMER}
        </Text>
      </Page>
    </Document>
  );
}
