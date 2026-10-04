// The nightly digest as a 5-second brief (pure; called by convex/monitorActions.ts
// sendDigest). Light ground, Outlook-safe tables, all CSS inline (Gmail strips
// <style>). Every interpolated value goes through esc(); every URL through safeHref.
import {
  money, signedMoney, toneOf, normalizeExit, displayFlags, oneLineReason, analystNote, safeHref,
  type PresentRow, type Tone,
} from "./monitorPresent";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface DigestRow extends PresentRow { _id: string; address: string; photoUrls?: string[] | null }
export interface DigestOpts { baseUrl: string; moreOnBoard: number; date: string }
export interface DigestCell { label: string; value: string; tone: Tone }

// AA on white: ink 17:1, body 8:1, muted 5.9:1, teal 5.3:1 (and white-on-teal 5.3:1),
// pos 5.4:1, neg 6.5:1.
const C = {
  ink: "#17191A", body: "#4A5156", muted: "#5F666B", line: "#E3E6E6", wash: "#F6F7F7",
  teal: "#1F7A66", pos: "#1E7B46", neg: "#B42318", flagBg: "#FFF4E5", flagFg: "#8A4B00",
} as const;
const PILL: Record<string, { bg: string; fg: string }> = {
  FLIP: { bg: "#E3F2EE", fg: "#1F7A66" },
  RENTAL: { bg: "#E6EEFB", fg: "#1E4FA3" },
};
const toneColor = (t: Tone) => (t === "pos" ? C.pos : t === "neg" ? C.neg : C.ink);
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const base = (u: string) => u.replace(/\/+$/, "");

export function dealLink(baseUrl: string, id: string): string {
  return `${base(baseUrl)}/monitor?id=${encodeURIComponent(id)}`;
}

const fin = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

export function digestCells(r: PresentRow): DigestCell[] {
  const list: DigestCell = { label: "List", value: money(r.listPrice), tone: "neutral" };
  if (normalizeExit(r.bestExit) === "RENTAL") {
    return [
      list,
      { label: "Cash flow", value: fin(r.cashFlow) ? `${signedMoney(r.cashFlow)}/mo` : "—", tone: toneOf(r.cashFlow) },
      { label: "DSCR", value: fin(r.dscr) ? r.dscr.toFixed(2) : "—", tone: "neutral" },
    ];
  }
  return [
    list,
    { label: "Max offer", value: money(r.flipMao), tone: "neutral" },
    { label: "Gap", value: fin(r.roomVsList) ? signedMoney(r.roomVsList) : "—", tone: toneOf(r.roomVsList) },
  ];
}

const TABLE = `role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`;

function cardHtml(r: DigestRow, o: DigestOpts): string {
  const exit = normalizeExit(r.bestExit) ?? "FLIP";
  const pill = PILL[exit] ?? PILL.FLIP;
  const score = r.dealScore != null ? `<span style="color:${C.body};font-size:12px;font-weight:600;">&nbsp;Score ${esc(String(r.dealScore))}</span>` : "";
  const photo = safeHref(r.photoUrls?.[0]);
  const thumb = photo
    ? `<td width="96" valign="top" style="width:96px;"><img src="${esc(photo)}" width="96" height="72" alt="" style="display:block;width:96px;height:72px;border:0;border-radius:6px;object-fit:cover;"></td>`
    : "";
  const cells = digestCells(r)
    .map((c) => `<td width="33%" valign="top" style="padding:8px 10px;"><div style="font-size:11px;line-height:14px;color:${C.muted};text-transform:uppercase;letter-spacing:0.5px;">${esc(c.label)}</div><div style="font-size:15px;line-height:20px;font-weight:700;color:${toneColor(c.tone)};">${esc(c.value)}</div></td>`)
    .join("");
  const reason = oneLineReason(r.aiReason);
  const flag = displayFlags(r)[0];
  const note = analystNote(r);
  const link = dealLink(o.baseUrl, r._id);
  return `<table ${TABLE} style="background:#ffffff;border:1px solid ${C.line};border-radius:10px;border-collapse:separate;margin:0 0 12px;">
<tr><td style="padding:16px;">
  <table ${TABLE}><tr>
    <td valign="top" style="padding:0 12px 0 0;">
      <div style="margin:0 0 6px;"><span style="display:inline-block;background:${pill.bg};color:${pill.fg};font-size:11px;font-weight:700;letter-spacing:0.5px;padding:3px 8px;border-radius:10px;">${esc(exit)}</span>${score}</div>
      <div style="font-size:16px;line-height:21px;font-weight:700;color:${C.ink};">${esc(r.address)}</div>
    </td>${thumb}
  </tr></table>
  <table ${TABLE} style="margin:12px 0 10px;background:${C.wash};border-radius:8px;"><tr>${cells}</tr></table>
  ${reason ? `<div style="font-size:13px;line-height:18px;color:${C.body};margin:0 0 8px;">${esc(reason)}</div>` : ""}
  ${flag ? `<div style="margin:0 0 8px;"><span style="display:inline-block;background:${C.flagBg};color:${C.flagFg};font-size:12px;font-weight:600;padding:3px 8px;border-radius:10px;">${esc(flag)}</span></div>` : ""}
  ${note ? `<div style="font-size:12px;line-height:16px;color:${C.muted};margin:0 0 8px;">${esc(note)}</div>` : ""}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;"><tr><td style="background:${C.teal};border-radius:8px;"><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Review deal</a></td></tr></table>
</td></tr></table>`;
}

function cardText(r: DigestRow, o: DigestOpts): string {
  const lines = [
    `${normalizeExit(r.bestExit) ?? "FLIP"}${r.dealScore != null ? ` ${r.dealScore}` : ""} · ${r.address}`,
    `   ${digestCells(r).map((c) => `${c.label} ${c.value}`).join(" · ")}`,
  ];
  const reason = oneLineReason(r.aiReason);
  if (reason) lines.push(`   ${reason}`);
  const flag = displayFlags(r)[0];
  if (flag) lines.push(`   Flag: ${flag}`);
  const note = analystNote(r);
  if (note) lines.push(`   ${note}`);
  lines.push(`   Review: ${dealLink(o.baseUrl, r._id)}`);
  return lines.join("\n");
}

export function buildDigest(rows: DigestRow[], o: DigestOpts): { subject: string; text: string; html: string } {
  const title = `${rows.length} worth a look`;
  const board = `${base(o.baseUrl)}/monitor`;
  const footerLabel = o.moreOnBoard > 0 ? `${o.moreOnBoard} more on the board` : "Open the board";
  const subject = `IRES Monitor: ${title}`;
  const text =
    `IRES MONITOR\n${title}\nNew Castle County · ${o.date}\n\n` +
    `${rows.map((r) => cardText(r, o)).join("\n\n")}\n\n` +
    `${footerLabel}: ${board}\nIRES CRM · automated nightly scan\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${C.wash};">
<div style="background:${C.wash};padding:20px 12px;font-family:${FONT};">
  <div style="max-width:600px;margin:0 auto;">
    <div style="padding:0 4px 14px;">
      <div style="color:${C.teal};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 6px;">IRES Monitor</div>
      <div style="color:${C.ink};font-size:22px;font-weight:800;line-height:1.2;margin:0 0 4px;">${esc(title)}</div>
      <div style="color:${C.muted};font-size:13px;">New Castle County &middot; ${esc(o.date)}</div>
    </div>
    ${rows.map((r) => cardHtml(r, o)).join("\n")}
    <div style="text-align:center;color:${C.muted};font-size:13px;line-height:1.7;padding:8px 4px 4px;">
      <a href="${esc(board)}" style="color:${C.teal};font-weight:600;text-decoration:none;">${esc(footerLabel)}</a><br>
      IRES CRM &middot; automated nightly scan
    </div>
  </div>
</div>
</body></html>`;
  return { subject, text, html };
}
