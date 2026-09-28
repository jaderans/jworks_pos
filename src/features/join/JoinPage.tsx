import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import logo from '../../assets/brand/logo-128.png';
import { Button, Callout, Loading } from '../../components/ui';
import { Field, TextInput } from '../../components/form';
import { AuthForm } from '../../sync/AuthForm';
import { readInvite } from '../../sync/config';
import { useSyncStatus } from '../../sync/useSync';
import { getLocal, updateDevice } from '../../db/local';
import { ROLE_LABEL } from '../../services/team';

/** Where an invite link lands: connect this phone to the team and sign in. */
export function JoinPage({ onJoined }: { onJoined: () => void }) {
  const [params] = useSearchParams();
  const invite = readInvite(params.get('i'));
  const sync = useSyncStatus();
  const [ready, setReady] = useState(false);
  const [letter, setLetter] = useState('B');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!invite) return;
    (async () => {
      try {
        const existing = await getLocal<unknown>('cloudConfig', null);
        const { connectCloud, startCloudSync } = await import('../../sync/cloud');
        if (JSON.stringify(existing) !== JSON.stringify(invite.c)) await connectCloud(invite.c);
        else await startCloudSync();
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not connect.');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (invite?.n) setName(`${invite.n}’s phone`);
  }, [invite?.n]);

  const finish = async () => {
    await updateDevice({ letter: letter || 'B', name: name || 'Team phone' });
    onJoined();
  };

  return (
    <div className="main" style={{ gridRow: 'auto', minHeight: '100%' }}>
      <div className="page narrow" style={{ paddingTop: 36 }}>
        <div className="row" style={{ gap: 14 }}>
          <img src={logo} alt="" width={56} height={56} style={{ borderRadius: 14 }} />
          <div>
            <span className="eyebrow">Team invite</span>
            <h1>Join JoshWorks POS</h1>
          </div>
        </div>
        {!invite ? (
          <Callout tone="bad" title="This invite link is broken">
            Ask the owner to copy the link again from Team and send it whole.
          </Callout>
        ) : error ? (
          <Callout tone="bad">{error}</Callout>
        ) : !ready ? (
          <Loading label="Connecting…" />
        ) : sync.access ? (
          <div className="card pad-lg stack">
            <Callout tone="good" title={`You’re in as ${ROLE_LABEL[sync.access.role]}`}>
              Signed in as {sync.userEmail}. The team&rsquo;s products, events and your payouts are downloading now.
            </Callout>
            {sync.access.role === 'cashier' || sync.access.role === 'owner' ? (
              <div className="form-grid">
                <Field label="Register letter for this phone" htmlFor="jn-letter" hint="Must differ from every other device that sells, e.g. B or C.">
                  <TextInput id="jn-letter" value={letter} maxLength={2} onChange={(e) => setLetter(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
                </Field>
                <Field label="Device name" htmlFor="jn-name">
                  <TextInput id="jn-name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
              </div>
            ) : null}
            <div>
              <Button variant="primary" size="lg" onClick={finish}>
                Open the app
              </Button>
            </div>
          </div>
        ) : (
          <div className="card pad-lg stack">
            <p className="muted">
              {invite.n ? `Hi ${invite.n}! ` : ''}Sign in with the email the owner added{invite.e ? ` (${invite.e})` : ''}. New here? Choose Create account and use that same email.
            </p>
            {sync.state === 'error' ? <Callout tone="warn">{sync.message}</Callout> : null}
            <AuthForm defaultEmail={invite.e ?? ''} defaultMode="signup" />
          </div>
        )}
      </div>
    </div>
  );
}
