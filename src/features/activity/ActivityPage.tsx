import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { useAudit, useMembers } from '../../hooks/data';
import { Badge, EmptyState, Loading, PageHeader } from '../../components/ui';
import { SearchInput, Select } from '../../components/form';
import { fmtDateTime } from '../../lib/time';
import { ACTIVITY_LABELS as LABELS, activityTone } from './labels';

export default function ActivityPage() {
  const [limit, setLimit] = useState(300);
  const audit = useAudit(limit);
  const members = useMembers();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const names = useMemo(() => new Map((members ?? []).map((m) => [m.id, m.name])), [members]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (audit ?? []).filter((a) => (kind === 'all' || a.action === kind) && (!needle || a.summary.toLowerCase().includes(needle)));
  }, [audit, q, kind]);
  if (!audit) return <Loading />;
  const kinds = [...new Set(audit.map((a) => a.action))].sort();
  return (
    <div className="page narrow">
      <PageHeader title="Activity" subtitle="Who changed what, and when: prices, voids, payments, costs, payouts. It syncs with the rest of the data." />
      <div className="row wrap">
        <div className="grow" style={{ minWidth: 200 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search activity" />
        </div>
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">Everything</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {LABELS[k] ?? k}
            </option>
          ))}
        </Select>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<History size={44} />} title="Nothing here yet" />
      ) : (
        <div className="card flush">
          <div className="list">
            {shown.map((a) => (
              <div key={a.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <Badge tone={activityTone(a.action)}>{LABELS[a.action] ?? a.action}</Badge>
                <span className="main-text">
                  <span style={{ whiteSpace: 'normal', color: 'var(--ink)', fontSize: '0.93rem' }}>{a.summary}</span>
                  <span>
                    {fmtDateTime(a.at)}
                    {a.actorId ? ` · ${names.get(a.actorId) ?? 'someone'}` : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {audit.length >= limit ? (
        <button type="button" className="btn" onClick={() => setLimit(limit + 300)}>
          Show older
        </button>
      ) : null}
    </div>
  );
}
