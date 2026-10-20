import * as net from 'net';

/**
 * Minimal in-process SMTP server for tests and local verification: speaks just enough SMTP (EHLO/HELO, MAIL, RCPT,
 * DATA, RSET, NOOP, QUIT) on 127.0.0.1 and records what it received. It proves that nodemailer's real SMTP code path
 * works end to end WITHOUT contacting any external mail provider. It is not a substitute for a real-mailbox check.
 */
export type SinkMode = 'accept' | 'reject-rcpt' | 'fail-data' | 'drop' | 'hang';

export interface SinkMessage { from: string; to: string[]; raw: string; subject: string }

export class SmtpSink {
  private server!: net.Server;
  private readonly sockets = new Set<net.Socket>();
  readonly messages: SinkMessage[] = [];
  connections = 0;
  mode: SinkMode = 'accept';
  /** Number of upcoming DATA commands to fail with a transient 451 before behaving normally. */
  failNext = 0;
  port = 0;

  async start(port = 0): Promise<number> {
    this.server = net.createServer((sock) => this.onConnection(sock));
    await new Promise<void>((res) => this.server.listen(port, '127.0.0.1', res));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((res) => this.server.close(() => res()));
  }

  clear() { this.messages.length = 0; this.connections = 0; }

  private onConnection(sock: net.Socket) {
    this.connections++;
    this.sockets.add(sock);
    sock.on('close', () => this.sockets.delete(sock));
    sock.on('error', () => undefined);
    if (this.mode === 'drop') { sock.destroy(); return; }
    if (this.mode === 'hang') return;                            // accept the TCP connection, never send a greeting
    const send = (line: string) => sock.write(line + '\r\n');
    send('220 sink.local ESMTP test-sink');

    let from = ''; let to: string[] = []; let inData = false; let buf = ''; let data = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            if (this.failNext > 0 || this.mode === 'fail-data') { if (this.failNext > 0) this.failNext--; send('451 4.3.0 temporary failure, try again later'); continue; }
            const subject = /^Subject:\s*(.*)$/im.exec(data)?.[1] ?? '';
            this.messages.push({ from, to, raw: data, subject });
            send('250 2.0.0 queued as TEST' + this.messages.length);
            from = ''; to = []; data = '';
          } else data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') { send('250-sink.local'); send('250 8BITMIME'); }
        else if (cmd === 'HELO') send('250 sink.local');
        else if (cmd === 'MAIL') { from = /<([^>]*)>/.exec(line)?.[1] ?? ''; send('250 2.1.0 ok'); }
        else if (cmd === 'RCPT') {
          if (this.mode === 'reject-rcpt') send('550 5.1.1 mailbox unavailable');
          else { to.push(/<([^>]*)>/.exec(line)?.[1] ?? ''); send('250 2.1.5 ok'); }
        }
        else if (cmd === 'DATA') { inData = true; send('354 end data with <CR><LF>.<CR><LF>'); }
        else if (cmd === 'RSET') { from = ''; to = []; send('250 ok'); }
        else if (cmd === 'NOOP') send('250 ok');
        else if (cmd === 'QUIT') { send('221 bye'); sock.end(); }
        else send('502 5.5.2 command not recognised');
      }
    });
  }
}
