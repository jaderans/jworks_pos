import { useState } from 'react';
import { Cloud, Copy, LogOut, RefreshCw, Unplug } from 'lucide-react';
import { Link } from 'react-router';
import rulesText from '../../../firebase/firestore.rules?raw';
import { useApp } from '../../app/AppContext';
import { Badge, Button, Callout } from '../../components/ui';
import { Field, TextArea, TextInput } from '../../components/form';
import { useSyncStatus } from '../../sync/useSync';
import { AuthForm } from '../../sync/AuthForm';
import { parseFirebaseConfig, slugify } from '../../sync/config';
import { relativeTime } from '../../lib/time';
import { ROLE_LABEL } from '../../services/team';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CloudSection() {
  const app = useApp();
  const sync = useSyncStatus();
  const owner = app.can('settings');
  const [configText, setConfigText] = useState('');
  const [ws, setWs] = useState('joshworks');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const connect = async () => {
    setError('');
    try {
      const firebase = parseFirebaseConfig(configText);
      setBusy(true);
      const { connectCloud } = await import('../../sync/cloud');
      await connectCloud({ firebase, ws: slugify(ws) });
      app.toast('Connected. Now sign in or create the owner account.', { tone: 'good' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="s-sync" className="card pad-lg" style={{ scrollMarginTop: 80 }}>
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <Cloud size={22} className="teal" /> Cloud sync and team accounts
        </h2>
        {sync.enabled ? (
          <Badge tone={sync.state === 'error' ? 'bad' : sync.access ? 'good' : 'warn'}>{sync.access ? 'On' : sync.state === 'error' ? 'Problem' : 'Sign in needed'}</Badge>
        ) : (
          <Badge>Off</Badge>
        )}
      </div>

      {!sync.enabled ? (
        owner ? (
          <div className="stack">
            <p className="sub">
              Optional. With it, designers see live numbers on their phones, several phones can sell at once, and everything is backed up. Selling never waits for it; changes upload whenever there&rsquo;s a connection. It runs on your own free Firebase project.
            </p>
            <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
              <li>
                Go to <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer">console.firebase.google.com</a>, sign in with the JoshWorks Google account and <b>Add project</b> (free Spark plan, no card needed).
              </li>
              <li>
                <b>Build → Authentication → Get started</b>, and turn on <b>Email/Password</b>.
              </li>
              <li>
                <b>Build → Firestore Database → Create database</b>. Pick the <b>asia-southeast1 (Singapore)</b> location and start in <b>production mode</b>.
              </li>
              <li>
                In Firestore → <b>Rules</b>, replace everything with the JoshWorks rules (button below) and <b>Publish</b>.
              </li>
              <li>
                <b>Project settings → Your apps → Web (&lt;/&gt;)</b>, register an app, copy the <span className="mono">firebaseConfig</span> block and paste it here.
              </li>
            </ol>
            <div className="actions">
              <Button
                size="sm"
                onClick={async () => {
                  if (await copy(rulesText)) app.toast('Rules copied. Paste them in Firestore → Rules.', { tone: 'good' });
                  else setShowRules(true);
                }}
              >
                <Copy size={16} /> Copy the security rules
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowRules((v) => !v)}>
                {showRules ? 'Hide rules' : 'Show rules'}
              </Button>
            </div>
            {showRules ? <TextArea readOnly rows={10} value={rulesText} className="mono" aria-label="Firestore security rules" /> : null}
            <Field label="Paste the firebaseConfig" htmlFor="cl-config">
              <TextArea id="cl-config" rows={7} className="mono" value={configText} onChange={(e) => setConfigText(e.target.value)} placeholder={'const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "….firebaseapp.com",\n  projectId: "…",\n  …\n};'} />
            </Field>
            <Field label="Team name in the database" htmlFor="cl-ws" hint="Short, no spaces. Every device on the team uses the same one.">
              <TextInput id="cl-ws" value={ws} onChange={(e) => setWs(e.target.value)} />
            </Field>
            {error ? <Callout tone="bad">{error}</Callout> : null}
            <div>
              <Button variant="primary" onClick={connect} disabled={busy || !configText.trim()}>
                Connect this device
              </Button>
            </div>
          </div>
        ) : (
          <p className="sub">Ask the owner for an invite link. Opening it on this device connects it to the team.</p>
        )
      ) : (
        <div className="stack">
          {sync.access ? (
            <div className="stack tight">
              <div className="row between wrap">
                <span>
                  Signed in as <b>{sync.userEmail}</b> · <Badge tone="teal">{ROLE_LABEL[sync.access.role]}</Badge>
                </span>
                <span className="muted small">{sync.lastSyncAt ? `Last sync ${relativeTime(sync.lastSyncAt)}` : ''}</span>
              </div>
              <p className="small muted">{sync.message}</p>
              <div className="actions">
                <Button
                  size="sm"
                  onClick={async () => {
                    const { syncNow } = await import('../../sync/cloud');
                    await syncNow();
                  }}
                >
                  <RefreshCw size={16} /> Sync now
                </Button>
                {sync.access.role === 'owner' ? (
                  <Link to="/team" className="btn sm">
                    Invite the team
                  </Link>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const { signOutCloud } = await import('../../sync/cloud');
                    await signOutCloud();
                  }}
                >
                  <LogOut size={16} /> Sign out
                </Button>
              </div>
            </div>
          ) : (
            <>
              {sync.state === 'error' ? <Callout tone="bad">{sync.message}</Callout> : <p className="sub">{owner ? 'Sign in with the owner account. The first time, create it with the email you want the team to know you by.' : 'Sign in with the email the owner added for you.'}</p>}
              <AuthForm defaultMode={owner ? 'signup' : 'signin'} />
            </>
          )}
          {owner ? (
            <div className="row wrap">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!(await app.confirm({ title: 'Stop syncing on this device?', message: 'This device keeps its data and keeps selling offline. Cloud data isn’t deleted.', confirmLabel: 'Disconnect' }))) return;
                  const { disconnectCloud } = await import('../../sync/cloud');
                  await disconnectCloud();
                }}
              >
                <Unplug size={16} /> Disconnect this device
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (await copy(rulesText)) app.toast('Rules copied', { tone: 'good' });
                }}
              >
                <Copy size={16} /> Copy the security rules
              </Button>
            </div>
          ) : null}
          <p className="muted tiny">Receipt photos stay on the device that took them. Everything else syncs.</p>
        </div>
      )}
    </section>
  );
}
