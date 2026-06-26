import { formatDate, formatMoney, formatQuoteAdjustment } from "@/components/format";

type QuotePdfInput = {
  workspaceName: string;
  quote: {
    number: string;
    status: string;
    currency: string;
    subtotalCents: number;
    discountType: "NONE" | "PERCENT" | "FIXED";
    discountValue: number;
    discountCents: number;
    taxType: "NONE" | "PERCENT" | "FIXED";
    taxValue: number;
    taxCents: number;
    totalCents: number;
    createdAt: Date | string;
    deal: {
      title: string;
      organization: { name: string } | null;
      person: { firstName: string; lastName: string | null } | null;
    };
    items: Array<{
      name: string;
      description: string | null;
      quantity: number;
      unitPriceCents: number;
      currency: string;
      lineTotalCents: number;
    }>;
  };
};

export function quotePdfFilename(quoteNumber: string) {
  const safeNumber = quoteNumber
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "") || "quote";
  return `quote-${safeNumber}.pdf`;
}

export function generateQuotePdf({ workspaceName, quote }: QuotePdfInput) {
  const lines = buildQuotePdfLines(workspaceName, quote);
  const content = lines.map((line) => textAt(line.x, line.y, line.size, line.text)).join("\n");
  return writePdf(content);
}

function buildQuotePdfLines(workspaceName: string, quote: QuotePdfInput["quote"]) {
  const organization = quote.deal.organization?.name ?? "No organization";
  const contact = formatPersonName(quote.deal.person) ?? "No contact";
  const rows: Array<{ x: number; y: number; size: number; text: string }> = [
    { x: 72, y: 742, size: 18, text: workspaceName },
    { x: 72, y: 716, size: 20, text: `Quote ${quote.number}` },
    { x: 72, y: 692, size: 10, text: "Authenticated internal PDF. Generated on demand, not stored, and not a public quote link." },
    { x: 72, y: 666, size: 11, text: `Status: ${quote.status}` },
    { x: 270, y: 666, size: 11, text: `Created: ${formatDate(quote.createdAt)}` },
    { x: 72, y: 642, size: 11, text: `Deal: ${quote.deal.title}` },
    { x: 72, y: 620, size: 11, text: `Organization: ${organization}` },
    { x: 72, y: 598, size: 11, text: `Contact: ${contact}` },
    { x: 72, y: 584, size: 11, text: "Item" },
    { x: 226, y: 584, size: 11, text: "Description" },
    { x: 386, y: 584, size: 11, text: "Qty" },
    { x: 430, y: 584, size: 11, text: "Unit" },
    { x: 512, y: 584, size: 11, text: "Total" }
  ];

  let y = 562;
  for (const item of quote.items) {
    rows.push(
      { x: 72, y, size: 10, text: truncate(item.name, 24) },
      { x: 226, y, size: 10, text: truncate(item.description ?? "", 26) },
      { x: 386, y, size: 10, text: String(item.quantity) },
      { x: 430, y, size: 10, text: formatMoney(item.unitPriceCents, item.currency) },
      { x: 512, y, size: 10, text: formatMoney(item.lineTotalCents, item.currency) }
    );
    y -= 20;
  }

  const totalY = Math.max(y - 24, 120);
  rows.push(
    { x: 386, y: totalY, size: 11, text: "Subtotal" },
    { x: 512, y: totalY, size: 11, text: formatMoney(quote.subtotalCents, quote.currency) },
    { x: 386, y: totalY - 22, size: 11, text: "Quote-level discount" },
    { x: 512, y: totalY - 22, size: 11, text: formatQuoteAdjustment(quote.discountType, quote.discountValue, quote.discountCents, quote.currency) },
    { x: 386, y: totalY - 44, size: 11, text: "Quote-level tax" },
    { x: 512, y: totalY - 44, size: 11, text: formatQuoteAdjustment(quote.taxType, quote.taxValue, quote.taxCents, quote.currency) },
    { x: 386, y: totalY - 68, size: 13, text: "Total" },
    { x: 512, y: totalY - 68, size: 13, text: formatMoney(quote.totalCents, quote.currency) }
  );

  return rows;
}

function formatPersonName(person: QuotePdfInput["quote"]["deal"]["person"]) {
  if (!person) return null;
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function textAt(x: number, y: number, size: number, text: string) {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function escapePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function writePdf(content: string) {
  const contentLength = Buffer.byteLength(content, "latin1");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets[index + 1] = Buffer.byteLength(pdf, "latin1");
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
