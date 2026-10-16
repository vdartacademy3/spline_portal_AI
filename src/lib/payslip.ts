export type PayslipData = {
  employeeName: string;
  employeeCode: string;
  period: string;
  basic: number;
  allowances: number;
  deductions: number;
  gross: number;
  net: number;
  currency: string;
  generatedAt?: string;
};

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function money(currency: string, amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(amount) || 0);
  } catch {
    return `${(Number(amount) || 0).toFixed(2)} ${currency || "USD"}`;
  }
}

/**
 * Builds a minimal, dependency-free single-page PDF payslip so a run's paid
 * entries can be written through to `employee_documents` (Phase 10).
 */
export function buildPayslipPdf(data: PayslipData): Uint8Array {
  const generatedAt = data.generatedAt ?? new Date().toISOString().slice(0, 10);
  const rows = [
    "PAYSLIP",
    "________________",
    `Employee: ${data.employeeName}`,
    `Employee code: ${data.employeeCode}`,
    `Period: ${data.period}`,
    "",
    `Basic: ${money(data.currency, data.basic)}`,
    `Allowances: ${money(data.currency, data.allowances)}`,
    `Deductions: ${money(data.currency, data.deductions)}`,
    `Gross: ${money(data.currency, data.gross)}`,
    `Net Pay: ${money(data.currency, data.net)}`,
    "",
    `Generated: ${generatedAt}`,
  ];

  const lineHeight = 18;
  const startY = 720;
  let stream = "BT\n/F1 11 Tf\n0.2 0.2 0.2 rg\n";
  rows.forEach((row, i) => {
    const y = startY - i * lineHeight;
    if (i === 0) {
      stream += "1 0 0 rg\n/F1 16 Tf\n";
    }
    stream += `1 0 0 ${i === 0 ? 1 : 0} rg\n`;
    stream += `/F1 ${i === 0 ? 16 : 11} Tf\n`;
    stream += `${52} ${y} Td\n(${escapePdfText(row)}) Tj\n`;
    if (i === 0) {
      stream += "0 0 0 rg\n2 w\n52 715 m 200 715 l S\n";
    }
  });
  stream += "ET\n";

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
