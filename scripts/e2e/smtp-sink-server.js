// Local SMTP sink for alert verification. Accepts mail on 127.0.0.1 only and appends each message as one JSON line to
// $E2E_SINK_FILE. It never forwards anything anywhere: this proves the API's real SMTP code path, NOT delivery to a mailbox.
// Usage: E2E_SINK_PORT=2525 E2E_SINK_FILE=sink.jsonl node scripts/e2e/smtp-sink-server.js   (uses ts-node; no build needed)
const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });   // the sink is test-only TypeScript, excluded from the production build
const { SmtpSink } = require(path.resolve(__dirname, '../../apps/api/src/common/observability/testing/smtp-sink.ts'));

const port = Number(process.env.E2E_SINK_PORT || 2525);
const file = process.env.E2E_SINK_FILE;
if (!file) { console.error('REFUSED: set E2E_SINK_FILE'); process.exit(3); }
const sink = new SmtpSink();
let written = 0;
sink.start(port).then((p) => {
  fs.writeFileSync(file, '');
  console.log(`sink listening on 127.0.0.1:${p}`);
  setInterval(() => {
    while (written < sink.messages.length) {
      const m = sink.messages[written++];
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), from: m.from, to: m.to, subject: m.subject, raw: m.raw }) + '\n');
    }
  }, 100);
});
