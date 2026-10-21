/**
 * Static guard for log hygiene. It scans the production sources and fails when someone adds a log statement that
 * interpolates raw exception messages, message bodies, file names or phone numbers. These are the ways patient data
 * reached logs before this guard existed. Use `errText(err)` / `maskPhone(phone)` or log ids and sizes instead.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'testing' ? [] : sourceFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [p] : [];
  });
}

/** Logical log statements: a logger call possibly spanning several lines, up to its closing `);`. */
function logStatements(file: string): Array<{ line: number; text: string }> {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const out: Array<{ line: number; text: string }> = [];
  const re = /\b(?:this\.)?(?:logger|winstonLogger)\.(?:log|warn|error|debug|verbose|info)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf(');', m.index);
    out.push({ line: src.slice(0, m.index).split('\n').length, text: src.slice(m.index, end < 0 ? m.index + 400 : end + 2) });
  }
  return out;
}

const files = sourceFiles(SRC);
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, '/');

describe('production log statements do not carry patient data', () => {
  const stmts = files.flatMap((f) => logStatements(f).map((s) => ({ ...s, file: rel(f) })));

  it('the scan actually finds the application\'s log statements', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(stmts.length).toBeGreaterThan(50);
  });

  it.each([
    ['raw exception messages (use errText(err))', /\$\{\s*\(?\s*(?:err|e|error)(?: as Error)?\s*\)?\.message\s*\}|,\s*(?:err|error)\.message\b|\+\s*(?:err|e)\.message/],
    ['stack traces passed unsanitised (use sanitizeStack)', /(?<!sanitizeStack\()(?:\(err as Error\)\.stack|\berr\.stack\b|\be\.stack\b)/],
    ['inbound message bodies', /\bbody\b\s*=|\$\{\s*body\s*\}|\bmessageBody\b/],
    ['file names', /originalname|\.fileName|\$\{\s*fileName\s*\}|\bfilename\b/i],
    ['raw phone numbers (use maskPhone)', /\$\{\s*(?:\w+\.)?phone\s*\}|\$\{\s*payload\.to\s*\}/],
    ['patient names', /fullName|patientName|\.name\b\s*\}/],
    ['raw request bodies / entities', /JSON\.stringify\(|\breq\.body\b|\bdto\b\s*[,)]/],
  ])('no log statement interpolates %s', (_label, bad) => {
    const offenders = stmts.filter((s) => bad.test(s.text)).map((s) => `${s.file}:${s.line}  ${s.text.replace(/\s+/g, ' ').slice(0, 140)}`);
    expect(offenders).toEqual([]);
  });

  it('no production code writes straight to the console (it bypasses redaction and the JSON format)', () => {
    const allowed = new Set(['database/seed.ts']);                    // one-off CLI script, prints no patient data
    const offenders = files.filter((f) => !allowed.has(rel(f))).flatMap((f) => {
      const src = fs.readFileSync(f, 'utf8').split('\n');
      return src.flatMap((l, i) => (/\bconsole\.(log|error|warn|debug|info)\(/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/node -e/.test(l) ? [`${rel(f)}:${i + 1}`] : []));
    });
    expect(offenders).toEqual([]);
  });
});
