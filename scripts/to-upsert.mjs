import { readFileSync, writeFileSync } from 'fs';

const PK = {
  app_settings: 'setting_key',
  attendance: 'id',
  conference: 'conference_id',
  conference_sub_theme: 'id',
  invoices: 'invoice_id',
  paper_reviewer: 'review_id',
  paper_writers: 'writer_id',
  papers: 'paper_id',
  participant: 'attendance_id',
  payment_proofs: 'proof_id',
  payments: 'payment_id',
  payment_types: 'payment_type_id',
  schedule: 'schedule_id',
  sessions: 'session_id',
  users: 'user_id',
};

const [, , inFile, outFile] = process.argv;
const src = readFileSync(inFile, 'utf8');

// Pecah jadi statement lengkap, hormati string literal '...' (termasuk
// yang berisi newline atau tanda kutip ganda '' sebagai escape).
function splitStatements(text) {
  const statements = [];
  let cur = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    cur += ch;
    if (ch === "'") {
      if (inString && text[i + 1] === "'") {
        cur += text[++i];
        continue;
      }
      inString = !inString;
    } else if (ch === ';' && !inString) {
      statements.push(cur);
      cur = '';
    }
  }
  if (cur.trim()) statements.push(cur);
  return statements;
}

const insertRe = /INSERT INTO sisko\.(\w+) \(([^)]+)\) VALUES \(([\s\S]*)\);\s*$/;

let converted = 0;
const statements = splitStatements(src);
const out = statements.map((stmt) => {
  const m = stmt.match(insertRe);
  if (!m) return stmt;
  const [, table, colList] = m;
  const pk = PK[table];
  if (!pk) throw new Error(`No PK mapping for table ${table}`);
  const cols = colList.split(',').map((c) => c.trim());
  const updateCols = cols.filter((c) => c !== pk);
  converted++;
  const conflictClause =
    updateCols.length === 0
      ? `ON CONFLICT (${pk}) DO NOTHING`
      : `ON CONFLICT (${pk}) DO UPDATE SET ${updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`;
  return stmt.replace(/;\s*$/, ` ${conflictClause};\n`);
});

writeFileSync(outFile, out.join(''));
console.log(`Total statements: ${statements.length}, converted INSERTs: ${converted}`);
