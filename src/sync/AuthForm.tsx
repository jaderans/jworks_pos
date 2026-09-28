import { useState } from 'react';
import { Button, Callout, Segmented } from '../components/ui';
import { Field, TextInput } from '../components/form';
import { checkVerified, friendlyError, resendVerification, resetPassword, signInCloud, signOutCloud, signUpCloud } from './cloud';
import { useSyncStatus } from './useSync';

/** Sign in or create an account, then confirm the email. */
export function AuthForm({ defaultEmail = '', defaultMode = 'signin' }: { defaultEmail?: string; defaultMode?: 'signin' | 'signup' }) {
  const sync = useSyncStatus();
  const [mode, setMode] = useState<'signin' | 'signup'>(defaultMode);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (sync.needsVerification) {
    return (
      <div className="stack">
        <Callout tone="info" title="Check your email">
          We sent a verification link to <b>{sync.userEmail}</b>. Open it, then come back and tap the button below. Check Spam if it isn&rsquo;t there.
        </Callout>
        {error ? <Callout tone="bad">{error}</Callout> : null}
        {info ? <Callout tone="good">{info}</Callout> : null}
        <div className="actions">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const ok = await checkVerified();
                if (!ok) setError('Not verified yet. Open the link in the email first.');
              })
            }
          >
            I&rsquo;ve verified
          </Button>
          <Button disabled={busy} onClick={() => run(async () => { await resendVerification(); setInfo('Sent again.'); })}>
            Send the link again
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => run(signOutCloud)}>
            Use another account
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => (mode === 'signin' ? signInCloud(email, password) : signUpCloud(email, password)));
      }}
    >
      <Segmented<'signin' | 'signup'>
        label="Account"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'signin', label: 'Sign in' },
          { value: 'signup', label: 'Create account' },
        ]}
      />
      <div className="form-grid">
        <Field label="Email" htmlFor="au-email">
          <TextInput id="au-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="au-pass" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
          <TextInput id="au-pass" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </Field>
      </div>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      {info ? <Callout tone="good">{info}</Callout> : null}
      <div className="actions">
        <Button type="submit" variant="primary" disabled={busy || !email || password.length < 6}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
        {mode === 'signin' ? (
          <Button
            variant="link"
            disabled={busy || !email}
            onClick={() => run(async () => { await resetPassword(email); setInfo(`A reset link was sent to ${email}.`); })}
          >
            Forgot password
          </Button>
        ) : null}
      </div>
    </form>
  );
}
