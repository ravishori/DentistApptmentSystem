import { OpsController } from './ops.controller';
import { MetricsService } from './metrics.service';

describe('OpsController (the HTTP role guard is covered in the live drill and role specs)', () => {
  const mk = (ticket: any, status: any = { enabled: true }) => {
    const alerts = { report: jest.fn(() => ticket), getStatus: jest.fn(() => status), verifyConnection: jest.fn(async () => ({ ok: true })) };
    return { alerts, ctl: new OpsController(alerts as any, new MetricsService()) };
  };
  it('metrics: JSON snapshot or Prometheus text', () => {
    const { ctl } = mk({});
    expect(ctl.getMetrics()).toHaveProperty('counters');
    expect(ctl.getMetrics('prometheus')).toMatchObject({ format: 'prometheus' });
  });
  it('status: optionally verifies the SMTP connection', async () => {
    const { ctl, alerts } = mk({});
    expect(await ctl.alertStatus()).toEqual({ enabled: true });
    expect(await ctl.alertStatus('true')).toEqual({ enabled: true, smtpConnection: { ok: true } });
    expect(alerts.verifyConnection).toHaveBeenCalledTimes(1);
  });
  it('test alert without wait returns immediately with the queued id', async () => {
    const { ctl, alerts } = mk({ outcome: 'queued', id: 'a1', result: new Promise(() => undefined) });
    expect(await ctl.testAlert()).toEqual({ outcome: 'queued', reason: undefined, alertId: 'a1' });
    expect(alerts.report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'test', code: 'TEST_ALERT' }));
  });
  it('test alert with wait reports the SMTP result (accepted / failed)', async () => {
    const ok = mk({ outcome: 'queued', id: 'a2', result: Promise.resolve({ state: 'smtp_accepted', attempts: 1 }) });
    expect(await ok.ctl.testAlert('true')).toMatchObject({ outcome: 'smtp_accepted', attempts: 1, alertId: 'a2' });
    const bad = mk({ outcome: 'queued', id: 'a3', result: Promise.resolve({ state: 'failed', attempts: 3, reason: '535 auth failed' }) });
    expect(await bad.ctl.testAlert('true')).toMatchObject({ outcome: 'failed', reason: '535 auth failed' });
  });
  it('disabled / dropped alerting is reported honestly, not as success', async () => {
    const { ctl } = mk({ outcome: 'disabled', reason: 'alerting is not configured' });
    expect(await ctl.testAlert('true')).toEqual({ outcome: 'disabled', reason: 'alerting is not configured', alertId: undefined });
  });
});
