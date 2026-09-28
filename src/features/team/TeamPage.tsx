import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Eye, Link2, Plus, UserPlus, Users } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useMembers } from '../../hooks/data';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Initials, Loading, PageHeader, Toggle } from '../../components/ui';
import { Field, NumberInput, Select, TextArea, TextInput } from '../../components/form';
import { useSyncStatus } from '../../sync/useSync';
import { ROLE_HINT, ROLE_LABEL, deleteMember, saveMember } from '../../services/team';
import type { AccessRow } from '../../sync/cloud';
import type { AppRole, Member } from '../../db/types';

export default function TeamPage() {
  const app = useApp();
  const navigate = useNavigate();
  const members = useMembers();
  const sync = useSyncStatus();
  const cloudOwner = sync.access?.role === 'owner';
  const [editing, setEditing] = useState<Partial<Member> | null>(null);
  const [access, setAccess] = useState<AccessRow[] | null>(null);

  const loadAccess = useCallback(async () => {
    if (!cloudOwner) return;
    try {
      const { listAccess } = await import('../../sync/cloud');
      setAccess(await listAccess());
    } catch {
      setAccess(null);
    }
  }, [cloudOwner]);
  useEffect(() => {
    void loadAccess();
  }, [loadAccess, members]);

  const invite = async (m: Member) => {
    const { getCloudConfig } = await import('../../sync/cloud');
    const { inviteLink } = await import('../../sync/config');
    const cfg = await getCloudConfig();
    if (!cfg) return;
    const link = inviteLink(cfg, m.email, m.name);
    const text = `Hi ${m.name}! Join the JoshWorks POS team: open this link on your phone and sign in with ${m.email}.\n${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'JoshWorks POS invite', text });
        return;
      }
    } catch {
      /* cancelled; fall back to copy */
    }
    try {
      await navigator.clipboard.writeText(text);
      app.toast('Invite copied. Paste it in Messenger or Viber.', { tone: 'good' });
    } catch {
      window.prompt('Copy this invite', text);
    }
  };

  if (!members) return <Loading />;
  const accessByEmail = new Map((access ?? []).map((a) => [a.email, a]));

  return (
    <div className="page">
      <PageHeader
        title="Team"
        subtitle="Everyone who works booths, designs, or partners with JoshWorks. Roles decide what each person sees."
        actions={
          <Button variant="primary" onClick={() => setEditing({ appRole: 'designer', weight: 2, active: 1 })}>
            <UserPlus size={18} /> Add person
          </Button>
        }
      />
      {!sync.enabled ? (
        <Callout tone="info" title="Designers see the app on their own phones once cloud sync is on">
          Turn it on in Settings → Cloud sync. Until then, the team is used for rosters, payouts and design credit on this device.
        </Callout>
      ) : !cloudOwner ? (
        <Callout tone="warn">Sign in as the owner (Settings → Cloud sync) to send invites.</Callout>
      ) : null}

      {members.length === 0 ? (
        <EmptyState icon={<Users size={44} />} title="No one here yet" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>App role</th>
                <th className="r hide-phone">Weight</th>
                {sync.enabled ? <th className="hide-phone">Phone access</th> : null}
                <th className="r"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const acc = m.email ? accessByEmail.get(m.email) : undefined;
                return (
                  <tr key={m.id} className={`click ${m.active ? '' : 'muted'}`} onClick={() => setEditing(m)}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Initials name={m.name} />
                        <div>
                          <b>{m.name}</b>
                          <div className="muted tiny">{[m.roleLabel, m.email].filter(Boolean).join(' · ') || 'No booth role yet'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={m.appRole === 'owner' ? 'yellow' : m.appRole === 'cashier' ? 'teal' : undefined}>{ROLE_LABEL[m.appRole]}</Badge>
                      {!m.active ? <Badge>Inactive</Badge> : null}
                    </td>
                    <td className="r hide-phone">{m.weight}</td>
                    {sync.enabled ? (
                      <td className="hide-phone">
                        {!m.email ? <span className="muted small">No email</span> : acc ? <Badge tone={acc.active ? 'good' : undefined}>{acc.active ? 'Can sign in' : 'Paused'}</Badge> : <Badge tone="warn">Not invited</Badge>}
                      </td>
                    ) : null}
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      <div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {cloudOwner && m.email && m.appRole !== 'owner' ? (
                          <IconButton label={`Send ${m.name} an invite link`} size="sm" onClick={() => invite(m)}>
                            <Link2 size={16} />
                          </IconButton>
                        ) : null}
                        <IconButton label={`See ${m.name}'s page`} size="sm" onClick={() => navigate(`/me?as=${m.id}`)}>
                          <Eye size={16} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid-2">
        {(['owner', 'cashier', 'designer', 'partner'] as AppRole[]).map((r) => (
          <div key={r} className="card">
            <b>{ROLE_LABEL[r]}</b>
            <p className="sub">{ROLE_HINT[r]}</p>
          </div>
        ))}
      </div>
      <MemberDialog member={editing} onClose={() => setEditing(null)} cloudOwner={cloudOwner} onAccessChanged={loadAccess} />
    </div>
  );
}

function MemberDialog({ member, onClose, cloudOwner, onAccessChanged }: { member: Partial<Member> | null; onClose: () => void; cloudOwner: boolean; onAccessChanged: () => void }) {
  const app = useApp();
  const [f, setF] = useState<Partial<Member>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (member) setF({ name: '', email: '', appRole: 'designer', roleLabel: '', weight: 2, phone: '', payoutInfo: '', notes: '', active: 1, ...member });
  }, [member]);
  if (!member) return null;
  const isNew = !member.id;

  const save = async () => {
    if (!f.name?.trim()) return;
    setBusy(true);
    try {
      const saved = await saveMember({ ...f, name: f.name.trim() });
      if (cloudOwner) {
        const { grantAccess, revokeAccess } = await import('../../sync/cloud');
        const oldEmail = (member.email ?? '').toLowerCase();
        if (oldEmail && oldEmail !== saved.email) await revokeAccess(oldEmail).catch(() => undefined);
        if (saved.email) await grantAccess(saved);
        onAccessChanged();
      }
      app.toast(isNew ? `Added ${saved.name}` : 'Saved', { tone: 'good' });
      onClose();
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Could not save', { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!member}
      onClose={onClose}
      title={isNew ? 'Add a person' : `Edit ${member.name}`}
      size="wide"
      footer={
        <>
          {!isNew ? (
            <Button
              variant="danger"
              onClick={async () => {
                if (!(await app.confirm({ title: `Remove ${member.name}?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
                try {
                  await deleteMember(member.id!);
                  if (cloudOwner && member.email) {
                    const { revokeAccess } = await import('../../sync/cloud');
                    await revokeAccess(member.email).catch(() => undefined);
                  }
                  onClose();
                } catch (e) {
                  app.toast(e instanceof Error ? e.message : 'Could not remove', { tone: 'bad' });
                }
              }}
            >
              Remove
            </Button>
          ) : null}
          <span className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !f.name?.trim()}>
            {isNew ? (
              <>
                <Plus size={16} /> Add
              </>
            ) : (
              'Save'
            )}
          </Button>
        </>
      }
    >
      {!isNew && member.id === app.member?.id ? (
        <Callout tone="info">This is you. To add someone new, close this and use Add person.</Callout>
      ) : null}
      <div className="form-grid">
        <Field label="Name" htmlFor="mb-name">
          <TextInput id="mb-name" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Email" htmlFor="mb-email" hint="They sign in with this to see their page on their phone.">
          <TextInput id="mb-email" type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="App role" htmlFor="mb-role" hint={ROLE_HINT[(f.appRole ?? 'designer') as AppRole]}>
          <Select id="mb-role" value={f.appRole} onChange={(e) => setF({ ...f, appRole: e.target.value as AppRole })}>
            {(['owner', 'cashier', 'designer', 'partner'] as AppRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Usual booth role" htmlFor="mb-label" hint="Production, Illustrator, Cashier, Floater…">
          <TextInput id="mb-label" value={f.roleLabel ?? ''} onChange={(e) => setF({ ...f, roleLabel: e.target.value })} />
        </Field>
        <Field label="Role weight" htmlFor="mb-weight" hint="Specialised roles carry more weight in the staff pool (your sheet used 3 and 2).">
          <NumberInput id="mb-weight" value={f.weight ?? 2} onChange={(n) => setF({ ...f, weight: n ?? 0 })} />
        </Field>
        <Field label="Mobile number" htmlFor="mb-phone">
          <TextInput id="mb-phone" inputMode="tel" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Where to send payouts" htmlFor="mb-payout" className="span-2" hint="e.g. GCash 0917…">
          <TextInput id="mb-payout" value={f.payoutInfo ?? ''} onChange={(e) => setF({ ...f, payoutInfo: e.target.value })} />
        </Field>
      </div>
      <Toggle id="mb-active" checked={(f.active ?? 1) === 1} onChange={(v) => setF({ ...f, active: v ? 1 : 0 })} label="Active (shows in rosters and can sign in)" />
      <Field label="Notes" htmlFor="mb-notes">
        <TextArea id="mb-notes" rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Dialog>
  );
}
