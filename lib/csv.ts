export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

export function formatCsv<T>(columns: Array<CsvColumn<T>>, rows: T[]) {
  const header = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvCell(normalizeCsvValue(column.value(row)))).join(",")
  );

  return [header, ...body].join("\n");
}

export function parseCsv(text: string): ParsedCsv {
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new Error("CSV must include a header row.");

  const [headers, ...body] = rows;
  return { headers, rows: body };
}

export function parseCsvRows(text: string) {
  const rows: string[][] = [];
  if (text.length === 0) return rows;

  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quoteJustClosed = false;
  let justCommittedRow = false;
  let line = 1;
  let column = 1;

  function commitCell() {
    row.push(cell);
    cell = "";
  }

  function commitRow() {
    commitCell();
    rows.push(row);
    row = [];
    justCommittedRow = true;
  }

  function fail(message: string): never {
    throw new Error(`Malformed CSV at line ${line}, column ${column}: ${message}`);
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"") {
        if (next === "\"") {
          cell += "\"";
          index += 1;
          column += 2;
          continue;
        }
        inQuotes = false;
        quoteJustClosed = true;
        column += 1;
        continue;
      }

      cell += char;
      if (char === "\r" || char === "\n") {
        if (char === "\r" && next === "\n") {
          cell += "\n";
          index += 1;
        }
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      justCommittedRow = false;
      continue;
    }

    if (quoteJustClosed) {
      if (char === ",") {
        commitCell();
        quoteJustClosed = false;
        justCommittedRow = false;
        column += 1;
        continue;
      }
      if (char === "\r" || char === "\n") {
        commitRow();
        quoteJustClosed = false;
        if (char === "\r" && next === "\n") index += 1;
        line += 1;
        column = 1;
        continue;
      }
      fail("Unexpected character after closing quote.");
    }

    if (char === "\"") {
      if (cell.length > 0) fail("Unexpected quote in unquoted field.");
      inQuotes = true;
      justCommittedRow = false;
      column += 1;
      continue;
    }

    if (char === ",") {
      commitCell();
      justCommittedRow = false;
      column += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      commitRow();
      if (char === "\r" && next === "\n") index += 1;
      line += 1;
      column = 1;
      continue;
    }

    cell += char;
    justCommittedRow = false;
    column += 1;
  }

  if (inQuotes) fail("Unclosed quoted field.");
  if (!justCommittedRow || row.length > 0 || cell.length > 0) commitRow();

  return rows;
}

function normalizeCsvValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function escapeCsvCell(value: string) {
  const needsEscaping = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, "\"\"");
  return needsEscaping ? `"${escaped}"` : escaped;
}
