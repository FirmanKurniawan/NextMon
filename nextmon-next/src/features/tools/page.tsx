import { Icon } from '../../components/Icon';
import { NetAssets, NoRouter, PageHead } from '../_netkit/ui';
import type { PageProps } from '../types.ts';

export default async function ToolsPage({ ctx }: PageProps) {
  const t = ctx.t;
  if (!ctx.router) return <NoRouter t={t} />;
  const ifaces = (await ctx.driver().print('/interface', {}, ['name'])).map((i) => i.name ?? '').filter(Boolean);
  const tabs: [string, string][] = [
    ['ping', 'Ping'],
    ['traceroute', 'Traceroute'],
    ['torch', 'Torch'],
    ['health', 'System health'],
    ['logs', 'Logs'],
  ];
  const run = (
    <div className="field">
      <label>&nbsp;</label>
      <button className="btn btn-primary">{t('Run')}</button>
    </div>
  );
  return (
    <>
      <NetAssets />
      <PageHead title={t('Tools')} desc={t('Diagnostics that run on the router itself.')} />
      <section className="card glass" id="tools" data-run-url="/api/json/tools">
        <div className="card-b">
          <div className="tabs" role="tablist" aria-label={t('Tools')}>
            {tabs.map(([k, l], i) => (
              <button key={k} type="button" role="tab" id={`tab-${k}`} aria-controls={`panel-${k}`} aria-selected={i === 0 ? 'true' : 'false'} data-tab={k}>
                {t(l)}
              </button>
            ))}
          </div>

          <div className="tabpanel" role="tabpanel" id="panel-ping" aria-labelledby="tab-ping">
            <form className="row" data-tool="ping">
              <div className="field" style={{ flex: '1 1 220px' }}>
                <label htmlFor="pg-a">{t('Address')}</label>
                <input className="input mono" id="pg-a" name="address" defaultValue="8.8.8.8" required autoCapitalize="off" />
              </div>
              <div className="field" style={{ width: 96 }}>
                <label htmlFor="pg-c">{t('Count')}</label>
                <input className="input" id="pg-c" name="count" type="number" min={1} max={10} defaultValue={4} />
              </div>
              {run}
            </form>
          </div>
          <div className="tabpanel" role="tabpanel" id="panel-traceroute" aria-labelledby="tab-traceroute" hidden>
            <form className="row" data-tool="traceroute">
              <div className="field" style={{ flex: '1 1 220px' }}>
                <label htmlFor="tr-a">{t('Address')}</label>
                <input className="input mono" id="tr-a" name="address" defaultValue="8.8.8.8" required autoCapitalize="off" />
              </div>
              {run}
            </form>
          </div>
          <div className="tabpanel" role="tabpanel" id="panel-torch" aria-labelledby="tab-torch" hidden>
            <form className="row" data-tool="torch">
              <div className="field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="to-i">{t('Interface')}</label>
                <select className="select" id="to-i" name="interface">
                  {ifaces.map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ width: 120 }}>
                <label htmlFor="to-d">{t('Seconds')}</label>
                <input className="input" id="to-d" name="duration" type="number" min={1} max={10} defaultValue={3} />
              </div>
              <div className="field">
                <label>&nbsp;</label>
                <button className="btn btn-primary">{t('Start torch')}</button>
              </div>
            </form>
          </div>
          <div className="tabpanel" role="tabpanel" id="panel-health" aria-labelledby="tab-health" hidden>
            <form className="row" data-tool="health">
              <button className="btn btn-primary">
                <Icon name="refresh" size={16} />
                {t('Read health')}
              </button>
            </form>
          </div>
          <div className="tabpanel" role="tabpanel" id="panel-logs" aria-labelledby="tab-logs" hidden>
            <form className="row" data-tool="logs">
              <div className="field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="lg-t">{t('Topic contains')}</label>
                <input className="input" id="lg-t" name="topic" placeholder="hotspot" />
              </div>
              <div className="field">
                <label>&nbsp;</label>
                <button className="btn btn-primary">{t('Load logs')}</button>
              </div>
            </form>
          </div>

          <div id="tool-out" style={{ marginTop: 'var(--s4)' }} aria-live="polite" />
        </div>
      </section>
    </>
  );
}
